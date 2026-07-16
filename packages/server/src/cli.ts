import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { TourStore, findRepositoryRoot, inspectRepository } from "@tourguide/core";
import open from "open";

import { startMcpServer } from "./mcp.js";
import { startWebServer } from "./web-server.js";

const execFileAsync = promisify(execFile);
const usage = "Usage: tourguide <open|serve|status|doctor|clean|mcp> [repository]";

async function main(): Promise<void> {
  const [command = "open", suppliedPath] = process.argv.slice(2);
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage);
    return;
  }
  if (command === "mcp") {
    await startMcpServer(suppliedPath);
    return;
  }
  const path = suppliedPath ?? process.cwd();

  let root: string;
  try {
    root = await findRepositoryRoot(path);
  } catch {
    console.error(`Tourguide requires a Git repository: ${path}`);
    process.exitCode = 1;
    return;
  }

  if (command === "status") {
    const store = new TourStore(root);
    console.log(JSON.stringify({ inventory: await inspectRepository(root), tour: await store.current(), preferences: await store.preferences() }, null, 2));
    return;
  }
  if (command === "doctor") {
    const checks = await Promise.all([
      access(root).then(() => ({ name: "repository", ok: true })).catch(() => ({ name: "repository", ok: false })),
      Promise.resolve({ name: "node", ok: Number(process.versions.node.split(".")[0]) >= 22, detail: process.version }),
      Promise.all([inspectRepository(root), execFileAsync("git", ["--version"], { encoding: "utf8" })]).then(([inventory, version]) => ({ name: "git", ok: true, detail: `${version.stdout.trim()}; HEAD ${inventory.head.slice(0, 8)}` })).catch((error) => ({ name: "git", ok: false, detail: String(error) })),
    ]);
    console.log(JSON.stringify(checks, null, 2));
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
    return;
  }
  if (command === "clean") {
    const store = new TourStore(root);
    await store.cleanGenerated();
    console.log(`Cleaned generated Tourguide data in ${root}`);
    return;
  }
  if (command !== "open" && command !== "serve") {
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  const server = await startWebServer(root);
  console.log(`Tourguide is running at ${server.url}`);
  if (command === "open") await open(server.url);
  const close = async () => { await server.close(); process.exit(0); };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
