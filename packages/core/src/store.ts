import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  PreferencesSchema,
  ProgressSchema,
  TourSnapshotSchema,
  type Preferences,
  type Progress,
  type TourSnapshot,
} from "./schema.js";

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export class TourStore {
  readonly base: string;

  constructor(readonly root: string) {
    this.base = join(root, ".tourguide");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(join(this.base, "cache", "drafts"), { recursive: true }),
      mkdir(join(this.base, "state"), { recursive: true }),
      mkdir(join(this.base, "workspaces"), { recursive: true }),
    ]);
    await this.ensureGitExclude();
  }

  private async ensureGitExclude(): Promise<void> {
    const exclude = join(this.root, ".git", "info", "exclude");
    try {
      const current = await readFile(exclude, "utf8");
      if (!current.split("\n").includes("/.tourguide/")) {
        await writeFile(exclude, `${current}${current.endsWith("\n") ? "" : "\n"}/.tourguide/\n`);
      }
    } catch {
      // Worktrees may use a .git file. The local cache remains untracked and is
      // still never added by Tourguide.
    }
  }

  async current(): Promise<TourSnapshot | undefined> {
    const value = await readJson(join(this.base, "cache", "current.json"));
    return value === undefined ? undefined : TourSnapshotSchema.parse(value);
  }

  async saveDraft(snapshot: TourSnapshot): Promise<void> {
    await atomicJson(join(this.base, "cache", "drafts", `${snapshot.id}.json`), TourSnapshotSchema.parse(snapshot));
  }

  async loadDraft(id: string): Promise<TourSnapshot | undefined> {
    const value = await readJson(join(this.base, "cache", "drafts", `${id}.json`));
    return value === undefined ? undefined : TourSnapshotSchema.parse(value);
  }

  async publish(snapshot: TourSnapshot): Promise<void> {
    const parsed = TourSnapshotSchema.parse({ ...snapshot, status: "published" });
    await atomicJson(join(this.base, "cache", "current.json"), parsed);
    await this.saveDraft(parsed);
  }

  async preferences(): Promise<Preferences> {
    const value = await readJson(join(this.base, "state", "preferences.json"));
    return PreferencesSchema.parse(value ?? {});
  }

  async savePreferences(value: Preferences): Promise<void> {
    await atomicJson(join(this.base, "state", "preferences.json"), PreferencesSchema.parse(value));
  }

  async progress(): Promise<Progress> {
    const value = await readJson(join(this.base, "state", "progress.json"));
    return ProgressSchema.parse(value ?? {});
  }

  async saveProgress(value: Progress): Promise<void> {
    await atomicJson(join(this.base, "state", "progress.json"), ProgressSchema.parse(value));
  }

  async cleanGenerated(): Promise<void> {
    await Promise.all([
      rm(join(this.base, "cache"), { recursive: true, force: true }),
      rm(join(this.base, "workspaces"), { recursive: true, force: true }),
    ]);
    await this.initialize();
  }
}
