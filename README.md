# Tourguide

Tourguide turns a Git repository into small, interactive lessons. It combines a Codex skill, an open MCP authoring interface, a local runtime service, and a browser-based learning workbench.

Tourguide is local-first: source discovery, generated lessons, progress, and runtime experiments stay on the developer's machine. There is no hosted repository service and no telemetry.

## Development

Requirements: Git, Node.js 22 or newer (Node.js 24 LTS is recommended), and Corepack.

```bash
corepack pnpm install
corepack pnpm build
node plugins/tourguide/dist/tourguide.mjs open .
```

Run all checks with `corepack pnpm validate`.

## Codex plugin

The release-ready plugin lives in `plugins/tourguide`. Its MCP server launches the same local service used by the standalone CLI. The repository marketplace is defined in `.agents/plugins/marketplace.json`.

Tourguide is experimental software. Generated explanations are paired with source or runtime evidence, but remain an onboarding aid rather than an authority on undocumented product intent.

## License

Apache-2.0.
