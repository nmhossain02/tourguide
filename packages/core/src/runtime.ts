import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
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
}

const execFileAsync = promisify(execFile);

function contained(root: string, requested: string): string {
  const target = resolve(root, requested);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Recipe working directory escapes the repository root.");
  return target;
}

async function execute(root: string, recipe: RunRecipe): Promise<Omit<RunResult, "isolated" | "patch">> {
  const cwd = contained(root, recipe.cwd);
  const startedAt = Date.now();
  return new Promise((resolveResult, reject) => {
    const child = spawn(recipe.command, recipe.args, {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...recipe.env },
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

export async function runRecipe(root: string, input: RunRecipe, trusted = false, values: Record<string, string> = {}): Promise<RunResult> {
  const recipe = materialize(RunRecipeSchema.parse(input), values);
  if (!trusted && (recipe.capabilities.network === "external" || recipe.capabilities.externalSystems.length > 0)) {
    throw new Error("This recipe requires explicit trusted-mode approval for external access.");
  }

  if (recipe.capabilities.writes.length === 0) return { ...await execute(root, recipe), isolated: false };

  const workspace = join(root, ".tourguide", "workspaces", randomUUID());
  await mkdir(join(root, ".tourguide", "workspaces"), { recursive: true });
  await execFileAsync("git", ["-C", root, "worktree", "add", "--detach", workspace, "HEAD"]);
  try {
    const result = await execute(workspace, recipe);
    const { stdout: patch } = await execFileAsync("git", ["-C", workspace, "diff", "--binary"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ...result, isolated: true, ...(patch ? { patch } : {}) };
  } finally {
    await execFileAsync("git", ["-C", root, "worktree", "remove", "--force", workspace]).catch(() => undefined);
    await rm(workspace, { recursive: true, force: true });
  }
}
