import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readlink, rm } from "node:fs/promises";
import { resolve, relative, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import { RunRecipeSchema, type RunRecipe } from "./schema.js";

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  isolated: boolean;
  patch?: string;
  changedFiles: string[];
  undeclaredWrites: string[];
}

const execFileAsync = promisify(execFile);

function writeEscapesWorkspace(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return !path
    || path.includes("\0")
    || isAbsolute(path)
    || normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").some((part) => part === "..");
}

export function recipeRequiresTrustedMode(recipe: RunRecipe): boolean {
  return recipe.capabilities.network === "external"
    || recipe.capabilities.externalSystems.length > 0
    || recipe.capabilities.containers
    || recipe.capabilities.writes.some(writeEscapesWorkspace);
}

export function containedPath(root: string, requested: string): string {
  const target = resolve(root, requested);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Recipe working directory escapes the repository root.");
  return target;
}

async function execute(root: string, recipe: RunRecipe, home: string): Promise<Omit<RunResult, "isolated" | "patch" | "changedFiles" | "undeclaredWrites">> {
  const cwd = containedPath(root, recipe.cwd);
  const startedAt = Date.now();
  return new Promise((resolveResult, reject) => {
    const child = spawn(recipe.command, recipe.args, {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      env: { PATH: process.env.PATH ?? "", HOME: home, ...recipe.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current: string, chunk: Buffer) => `${current}${chunk.toString("utf8")}`.slice(-1_048_576);
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      } else child.kill("SIGTERM");
    }, recipe.timeoutMs);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolveResult({ exitCode, signal, stdout, stderr, durationMs: Date.now() - startedAt, timedOut });
    });
  });
}

function materialize(recipe: RunRecipe, values: Record<string, string>): RunRecipe {
  const declared = new Map(recipe.inputs.map((input) => [input.id, input]));
  for (const key of Object.keys(values)) if (!declared.has(key)) throw new Error(`Unknown recipe input: ${key}`);
  const resolved = Object.fromEntries(recipe.inputs.map((input) => {
    const value = values[input.id] ?? input.default;
    if (input.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`${input.label} must be a number.`);
    if (input.type === "select" && !input.options?.includes(value)) throw new Error(`${input.label} must be one of its declared options.`);
    return [input.id, value];
  }));
  const replace = (value: string) => value.replace(/\{\{([a-z][a-z0-9_-]*)\}\}/g, (_, id: string) => {
    if (!(id in resolved)) throw new Error(`Recipe references undeclared input: ${id}`);
    return resolved[id]!;
  });
  return { ...recipe, args: recipe.args.map(replace), env: Object.fromEntries(Object.entries(recipe.env).map(([key, value]) => [key, replace(value)])) };
}

async function visibleWorkspacePaths(workspace: string): Promise<string[]> {
  const [{ stdout: changedOutput }, { stdout: untrackedOutput }] = await Promise.all([
    execFileAsync("git", ["-C", workspace, "diff", "HEAD", "--name-only", "-z"], { encoding: "utf8" }),
    execFileAsync("git", ["-C", workspace, "ls-files", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }),
  ]);
  return [...new Set([...changedOutput.split("\0"), ...untrackedOutput.split("\0")]
    .filter(Boolean)
    .filter((path) => !path.startsWith(".tourguide-home/")))];
}

async function workspaceState(workspace: string): Promise<Map<string, string>> {
  const state = new Map<string, string>();
  await Promise.all((await visibleWorkspacePaths(workspace)).map(async (path) => {
    const target = containedPath(workspace, path);
    try {
      const metadata = await lstat(target);
      const value = metadata.isSymbolicLink()
        ? `symlink:${await readlink(target)}`
        : metadata.isFile()
          ? await readFile(target)
          : `mode:${metadata.mode}:size:${metadata.size}`;
      const hash = createHash("sha256").update(value).digest("hex");
      state.set(path, hash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state.set(path, "missing");
    }
  }));
  return state;
}

async function workspaceChanges(workspace: string, recipe: RunRecipe, baseline: Map<string, string>) {
  const { stdout: trackedPatch } = await execFileAsync("git", ["-C", workspace, "diff", "--binary"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const { stdout: untrackedOutput } = await execFileAsync(
    "git",
    ["-C", workspace, "ls-files", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  const untracked = untrackedOutput
    .split("\0")
    .filter(Boolean)
    .filter((path) => !path.startsWith(".tourguide-home/"));
  const patches = [trackedPatch];
  for (const path of untracked) {
    try {
      await execFileAsync(
        "git",
        ["-C", workspace, "diff", "--no-index", "--binary", "--", "/dev/null", path],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      );
    } catch (error) {
      const output = (error as { stdout?: string }).stdout;
      if (output) patches.push(output);
    }
  }
  const declared = (path: string) => recipe.capabilities.writes.some(
    (pattern) => pattern === path || (pattern.endsWith("/**") && path.startsWith(pattern.slice(0, -3))),
  );
  const current = await workspaceState(workspace);
  const visibleChanges = [...current.keys()];
  const recipeChanges = [...new Set([...baseline.keys(), ...current.keys()])]
    .filter((path) => baseline.get(path) !== current.get(path));
  return {
    patch: patches.join(""),
    changedFiles: visibleChanges,
    undeclaredWrites: recipeChanges.filter((path) => !declared(path)),
  };
}

/** Run a declared recipe in an existing isolated worktree. */
export async function runRecipeInWorkspace(
  workspace: string,
  input: RunRecipe,
  trusted = false,
  values: Record<string, string> = {},
): Promise<RunResult> {
  const recipe = materialize(RunRecipeSchema.parse(input), values);
  if (!trusted && recipeRequiresTrustedMode(recipe)) {
    throw new Error("This recipe requires explicit trusted-mode approval for external or host access.");
  }
  const isolatedHome = join(workspace, ".tourguide-home");
  await mkdir(isolatedHome, { recursive: true });
  const baseline = await workspaceState(workspace);
  const result = await execute(workspace, recipe, isolatedHome);
  const changes = await workspaceChanges(workspace, recipe, baseline);
  return {
    ...result,
    isolated: true,
    changedFiles: changes.changedFiles,
    undeclaredWrites: changes.undeclaredWrites,
    ...(changes.patch ? { patch: changes.patch } : {}),
  };
}

export async function runRecipe(
  root: string,
  input: RunRecipe,
  trusted = false,
  values: Record<string, string> = {},
  revision = "HEAD",
): Promise<RunResult> {
  const workspace = join(root, ".tourguide", "workspaces", randomUUID());
  await mkdir(join(root, ".tourguide", "workspaces"), { recursive: true });
  await execFileAsync("git", ["-C", root, "worktree", "add", "--detach", workspace, revision]);
  try {
    return await runRecipeInWorkspace(workspace, input, trusted, values);
  } finally {
    await execFileAsync("git", ["-C", root, "worktree", "remove", "--force", workspace]).catch(() => undefined);
    await rm(workspace, { recursive: true, force: true });
  }
}
