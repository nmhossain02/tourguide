import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";

import { ProjectInventorySchema, type ProjectInventory } from "./schema.js";

const execFileAsync = promisify(execFile);
const MANIFEST_NAMES = new Set([
  "package.json", "pnpm-workspace.yaml", "go.mod", "Cargo.toml", "pyproject.toml",
  "requirements.txt", "Gemfile", "pom.xml", "build.gradle", "Dockerfile",
  "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml",
  "flake.nix", "devbox.json", "Makefile", "Justfile",
]);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

export async function changedFilesBetween(root: string, from: string, to = "HEAD"): Promise<string[]> {
  if (from === to) return [];
  const output = await git(root, ["diff", "--name-only", "-z", `${from}..${to}`]);
  return output.split("\0").filter(Boolean);
}

export async function findRepositoryRoot(start = process.cwd()): Promise<string> {
  const output = await git(resolve(start), ["rev-parse", "--show-toplevel"]);
  return output.trim();
}

export async function readHeadFile(root: string, path: string): Promise<string> {
  return git(root, ["show", `HEAD:${path}`]);
}

export async function readRevisionFile(root: string, revision: string, path: string): Promise<string> {
  return git(root, ["show", `${revision}:${path}`]);
}

export async function readWorkingFile(root: string, path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function detectAreas(files: string[]) {
  const buckets = [
    { id: "frontend", title: "Frontend", test: /(^|\/)(web|frontend|client|ui|apps\/web)(\/|$)|\.(tsx|jsx|vue|svelte)$/ },
    { id: "backend", title: "Backend and services", test: /(^|\/)(server|backend|api|services|cmd)(\/|$)/ },
    { id: "data", title: "Data and persistence", test: /(^|\/)(db|database|migrations|schema|models)(\/|$)|\.sql$/ },
    { id: "infrastructure", title: "Infrastructure and containers", test: /(^|\/)(infra|terraform|k8s|kubernetes|deploy)(\/|$)|Dockerfile|compose\.ya?ml|\.tf$/ },
    { id: "ci", title: "CI and delivery", test: /^\.github\/workflows\/|(^|\/)(ci|scripts)(\/|$)/ },
    { id: "documentation", title: "Architecture and documentation", test: /(^|\/)(docs|adr|architecture)(\/|$)|README/i },
  ];

  return buckets.flatMap((bucket) => {
    const paths = files.filter((path) => bucket.test.test(path)).slice(0, 12);
    return paths.length === 0 ? [] : [{
      id: bucket.id,
      title: bucket.title,
      reason: `Detected ${paths.length}${paths.length === 12 ? "+" : ""} relevant tracked paths.`,
      paths,
    }];
  });
}

async function rootCommands(root: string, files: string[]): Promise<Record<string, string>> {
  if (!files.includes("package.json")) return {};
  try {
    const pkg = JSON.parse(await readHeadFile(root, "package.json")) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

export async function inspectRepository(start = process.cwd()): Promise<ProjectInventory> {
  const root = await findRepositoryRoot(start);
  await git(root, ["rev-parse", "--verify", "HEAD"]).catch(() => {
    throw new Error(`Tourguide requires at least one commit in ${root}. Commit the repository's initial state and try again.`);
  });
  const [head, branch, fileOutput, statusOutput] = await Promise.all([
    git(root, ["rev-parse", "HEAD"]),
    git(root, ["branch", "--show-current"]),
    git(root, ["ls-files", "-z"]),
    git(root, ["status", "--porcelain=v1", "-z"]),
  ]);
  const trackedFiles = fileOutput.split("\0").filter(Boolean);
  const dirtyFiles = statusOutput
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.length > 3 ? entry.slice(3) : entry)
    .filter((path, index, all) => all.indexOf(path) === index);
  const manifests = trackedFiles.filter((path) => MANIFEST_NAMES.has(basename(path)) || path === ".devcontainer/devcontainer.json");

  return ProjectInventorySchema.parse({
    schemaVersion: 1,
    root,
    name: basename(root),
    head: head.trim(),
    branch: branch.trim() || "detached",
    trackedFileCount: trackedFiles.length,
    trackedFiles,
    dirtyFiles,
    manifests,
    commands: await rootCommands(root, trackedFiles),
    areas: detectAreas(trackedFiles),
  });
}
