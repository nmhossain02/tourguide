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

## Install in Codex

With Git and Node.js 22 or newer installed, clone the repository and register its local marketplace snapshot (the release bundle is committed):

```bash
git clone https://github.com/nmhossain02/tourguide.git
cd tourguide
codex plugin marketplace add "$(pwd)"
codex plugin add tourguide@tourguide
```

Start a new Codex thread in any Git repository and ask: `Use $tourguide to teach me how to develop this repository locally.` The standalone path is `node /path/to/tourguide/plugins/tourguide/dist/tourguide.mjs open .`.

## Codex plugin

The release-ready plugin lives in `plugins/tourguide`. Its MCP server launches the same local service used by the standalone CLI. The repository marketplace is defined in `.agents/plugins/marketplace.json`.

Tourguide is experimental software. Generated explanations are paired with source or runtime evidence, but remain an onboarding aid rather than an authority on undocumented product intent.

See [the documentation](docs/index.md), including the architecture, authoring contract, and threat model.

## License

Apache-2.0.
