import { access, readFile } from "node:fs/promises";

const mode = process.argv[2];
const root = new URL("../", import.meta.url);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

if (mode === "skill") {
  const text = await readFile(new URL("plugins/tourguide/skills/tourguide/SKILL.md", root), "utf8");
  invariant(text.startsWith("---\n"), "SKILL.md must start with YAML frontmatter.");
  const closing = text.indexOf("\n---\n", 4);
  invariant(closing > 0, "SKILL.md frontmatter must be closed.");
  const frontmatter = text.slice(4, closing);
  invariant(/^name:\s*tourguide\s*$/m.test(frontmatter), "Skill name must be tourguide.");
  invariant(/^description:\s*.+$/m.test(frontmatter), "Skill must have a description.");
  invariant(text.includes("inspect_project") && text.includes("publish_snapshot"), "Skill must cover the authoring lifecycle.");
  console.log("Skill metadata validation passed.");
} else if (mode === "plugin") {
  const manifest = JSON.parse(await readFile(new URL("plugins/tourguide/.codex-plugin/plugin.json", root), "utf8"));
  const marketplace = JSON.parse(await readFile(new URL(".agents/plugins/marketplace.json", root), "utf8"));
  invariant(manifest.name === "tourguide", "Plugin name must be tourguide.");
  invariant(manifest.mcpServers === "./.mcp.json", "Plugin must expose its MCP configuration.");
  invariant(marketplace.plugins?.some((plugin) => plugin.name === "tourguide" && plugin.source?.path === "./plugins/tourguide"), "Marketplace must reference the plugin.");
  await access(new URL("plugins/tourguide/dist/tourguide.mjs", root));
  console.log("Plugin metadata validation passed.");
} else {
  throw new Error("Usage: validate-metadata.mjs <skill|plugin>");
}
