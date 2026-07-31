import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const web = resolve(root, "apps", "web", "dist");
const server = resolve(root, "packages", "server", "dist");
const plugin = resolve(root, "plugins", "tourguide", "dist");

await mkdir(resolve(server, "web"), { recursive: true });
await cp(web, resolve(server, "web"), { recursive: true, force: true });
await mkdir(plugin, { recursive: true });
await cp(resolve(server, "tourguide.mjs"), resolve(plugin, "tourguide.mjs"), { force: true });
await rm(resolve(plugin, "web"), { recursive: true, force: true });
await cp(web, resolve(plugin, "web"), { recursive: true, force: true });
