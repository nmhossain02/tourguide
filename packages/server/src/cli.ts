import { access } from "node:fs/promises";

import { TourStore, findRepositoryRoot, inspectRepository } from "@tourguide/core";
import open from "open";

import { startMcpServer } from "./mcp.js";
import { startWebServer } from "./web-server.js";

async function main(): Promise<void> {
  const [command = "open", path = process.cwd()] = process.argv.slice(2);
  if (command === "mcp") {
    await startMcpServer(path);
    return;
  }

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
    await store.initialize();
    console.log(JSON.stringify({ inventory: await inspectRepository(root), tour: await store.current(), preferences: await store.preferences() }, null, 2));
    return;
  }
  if (command === "doctor") {
    const checks = await Promise.all([
      access(root).then(() => ({ name: "repository", ok: true })).catch(() => ({ name: "repository", ok: false })),
      Promise.resolve({ name: "node", ok: Number(process.versions.node.split(".")[0]) >= 22, detail: process.version }),
      inspectRepository(root).then((inventory) => ({ name: "git", ok: true, detail: inventory.head.slice(0, 8) })).catch((error) => ({ name: "git", ok: false, detail: String(error) })),
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
    console.error("Usage: tourguide <open|serve|status|doctor|clean|mcp> [repository]");
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
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
