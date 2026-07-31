import { access, readFile } from "node:fs/promises";

const mode = process.argv[2];
const root = new URL("../", import.meta.url);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function invariantMissing(url, message) {
  try {
    await access(url);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(message);
}

if (mode === "plugin") {
  const manifest = JSON.parse(await readFile(new URL("plugins/tourguide/.codex-plugin/plugin.json", root), "utf8"));
  const marketplace = JSON.parse(await readFile(new URL(".agents/plugins/marketplace.json", root), "utf8"));
  invariant(manifest.name === "tourguide", "Plugin name must be tourguide.");
  invariant(!("skills" in manifest), "Plugin must not expose an agent skill; Tourguide is an MCP-backed application.");
  invariant(manifest.mcpServers === "./.mcp.json", "Plugin must expose its MCP configuration.");
  invariant(marketplace.plugins?.some((plugin) => plugin.name === "tourguide" && plugin.source?.path === "./plugins/tourguide"), "Marketplace must reference the plugin.");
  await invariantMissing(
    new URL("plugins/tourguide/skills", root),
    "Plugin must not package a skills directory; it can cause broad, unintended activation.",
  );
  await access(new URL("plugins/tourguide/dist/tourguide.mjs", root));
  console.log("Plugin metadata validation passed.");
} else {
  throw new Error("Usage: validate-metadata.mjs plugin");
}
