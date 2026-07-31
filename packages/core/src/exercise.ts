import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { runRecipeInWorkspace, type RunResult } from "./runtime.js";
import type { ExerciseSession, Page, TourSnapshot } from "./schema.js";
import { TourStore } from "./store.js";

const execFileAsync = promisify(execFile);
const MAX_EDITABLE_BYTES = 512 * 1024;
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface ExerciseFile {
  path: string;
  content: string;
}

function safeRelativePath(path: string): string {
  if (!path || isAbsolute(path) || path.includes("\0")) throw new Error("Exercise paths must be relative.");
  const normalized = path.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === ".." || part === "")) {
    throw new Error("Exercise paths cannot escape the workspace.");
  }
  return normalized;
}

function sessionWorkspace(root: string, id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid exercise session ID.");
  const base = resolve(root, ".tourguide", "workspaces", "exercises");
  const target = resolve(base, id);
  if (!target.startsWith(`${base}${sep}`)) throw new Error("Exercise workspace escapes its generated directory.");
  return target;
}

async function assertEditableFile(workspace: string, path: string): Promise<string> {
  const target = resolve(workspace, safeRelativePath(path));
  const rel = relative(workspace, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Exercise path escapes its workspace.");
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Only regular, non-symlink files can be edited.");
  if (stat.size > MAX_EDITABLE_BYTES) throw new Error("Exercise file is too large for the browser editor.");
  return target;
}

async function addWorktree(root: string, workspace: string, commit: string): Promise<void> {
  await mkdir(resolve(root, ".tourguide", "workspaces", "exercises"), { recursive: true });
  await execFileAsync("git", ["-C", root, "worktree", "add", "--detach", workspace, commit]);
}

async function removeWorktree(root: string, workspace: string): Promise<void> {
  await execFileAsync("git", ["-C", root, "worktree", "remove", "--force", workspace]).catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
}

export class ExerciseWorkspaceManager {
  readonly store: TourStore;

  constructor(readonly root: string, store?: TourStore) {
    this.store = store ?? new TourStore(root);
  }

  private async requireSession(id: string): Promise<ExerciseSession> {
    const session = await this.store.exerciseSession(id);
    if (!session) throw new Error("Exercise session not found.");
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await this.remove(id);
      throw new Error("Exercise session expired.");
    }
    if (session.workspace !== sessionWorkspace(this.root, id)) throw new Error("Exercise session has an invalid workspace.");
    return session;
  }

  async create(snapshot: TourSnapshot, page: Page): Promise<{ session: ExerciseSession; files: ExerciseFile[] }> {
    if (page.kind !== "exercise" || !page.exercise) throw new Error("This page is not an exercise.");
    const allowedPaths = [...new Set(page.exercise.allowedPaths.map(safeRelativePath))];
    const id = randomUUID();
    const workspace = sessionWorkspace(this.root, id);
    await this.store.initialize();
    await addWorktree(this.root, workspace, snapshot.anchor.commit);
    try {
      const files: ExerciseFile[] = [];
      for (const path of allowedPaths) {
        const target = await assertEditableFile(workspace, path);
        const buffer = await readFile(target);
        if (buffer.includes(0)) throw new Error(`Exercise file ${path} is binary.`);
        files.push({ path, content: buffer.toString("utf8") });
      }
      const now = new Date();
      const session: ExerciseSession = {
        id,
        snapshotId: snapshot.id,
        pageId: page.id,
        commit: snapshot.anchor.commit,
        workspace,
        allowedPaths,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString(),
      };
      await this.store.saveExerciseSession(session);
      return { session, files };
    } catch (error) {
      await removeWorktree(this.root, workspace);
      throw error;
    }
  }

  async files(id: string): Promise<ExerciseFile[]> {
    const session = await this.requireSession(id);
    return Promise.all(session.allowedPaths.map(async (path) => ({
      path,
      content: await readFile(await assertEditableFile(session.workspace, path), "utf8"),
    })));
  }

  async write(id: string, path: string, content: string): Promise<ExerciseFile> {
    const session = await this.requireSession(id);
    const normalized = safeRelativePath(path);
    if (!session.allowedPaths.includes(normalized)) throw new Error("This path is not editable in the exercise.");
    if (Buffer.byteLength(content, "utf8") > MAX_EDITABLE_BYTES) throw new Error("Exercise file is too large.");
    const target = await assertEditableFile(session.workspace, normalized);
    await writeFile(target, content, "utf8");
    await this.store.saveExerciseSession({ ...session, updatedAt: new Date().toISOString() });
    return { path: normalized, content };
  }

  async run(
    id: string,
    snapshot: TourSnapshot,
    page: Page,
    action: "verify" | "format",
    trusted = false,
  ): Promise<RunResult> {
    const session = await this.requireSession(id);
    if (session.snapshotId !== snapshot.id || session.pageId !== page.id) throw new Error("Exercise session does not match this page.");
    const recipe = action === "format" ? page.exercise?.formatRecipe : page.exercise?.verificationRecipe;
    if (!recipe) throw new Error(`This exercise does not provide a ${action} recipe.`);
    return runRecipeInWorkspace(session.workspace, recipe, trusted);
  }

  async patch(id: string): Promise<string> {
    const session = await this.requireSession(id);
    if (session.allowedPaths.length === 0) return "";
    const { stdout } = await execFileAsync(
      "git",
      ["-C", session.workspace, "diff", "--binary", "--", ...session.allowedPaths],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout;
  }

  async reset(id: string): Promise<{ session: ExerciseSession; files: ExerciseFile[] }> {
    const session = await this.requireSession(id);
    await removeWorktree(this.root, session.workspace);
    await addWorktree(this.root, session.workspace, session.commit);
    const updated = { ...session, updatedAt: new Date().toISOString() };
    await this.store.saveExerciseSession(updated);
    return { session: updated, files: await this.files(id) };
  }

  async remove(id: string): Promise<void> {
    const workspace = sessionWorkspace(this.root, id);
    await removeWorktree(this.root, workspace);
    await this.store.removeExerciseSession(id);
  }
}
