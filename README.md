# Tourguide

Tourguide turns a Git branch, tag, or commit into an interactive codebase curriculum. It launches Codex through `codex exec`, reuses the user's existing subscription, publishes one complete module at a time, and teaches through short pages, demonstrations, and isolated exercises.

Tourguide is local-first: source discovery, generated pages, progress, and runtime experiments stay on the developer's machine. There is no hosted repository service and no telemetry.

## Quick start

Tourguide has not been published to npm yet. Install the current version from source:

```bash
git clone https://github.com/nmhossain02/tourguide.git
cd tourguide
corepack pnpm install
corepack pnpm build
npm install --global ./packages/server

cd /path/to/repository
tourguide
```

Press **Start tour**. Tourguide uses `HEAD`, the default Codex model, and an inferred broad curriculum unless you open Advanced settings.

## Diagnostics

Tourguide saves redacted crash and generation-failure reports under
`.tourguide/diagnostics/`. Open **Diagnostics** in the browser to inspect and
copy the latest report, or print it from a terminal after the app stops:

```bash
tourguide diagnostics /path/to/repository
```

If generation stops after publishing a module, that completed curriculum remains
available instead of being discarded.

The report includes the failure stack, bounded Codex stdout/stderr, exit
metadata, repository revision, generation state, and recent events. Tourguide
does not include environment variables and redacts common credential patterns.

Without installing globally, run the built CLI directly:

```bash
node /path/to/tourguide/plugins/tourguide/dist/tourguide.mjs /path/to/repository
```

The shorter `npm install --global @nmhossain02/tourguide` and
`npx @nmhossain02/tourguide` commands will work after the first npm release.

## Development

Requirements: Git, Node.js 22 or newer, Corepack for development, and a recent authenticated Codex CLI.

```bash
corepack pnpm install
corepack pnpm build
node plugins/tourguide/dist/tourguide.mjs .
```

Run all checks with `corepack pnpm validate`.

Use `tourguide --ref main` or `tourguide --model <model>` only when overriding the defaults.

## Optional Codex integration

The CLI is the normal product surface. For MCP-based launching or manual authoring, register the optional Codex plugin:

```bash
git clone https://github.com/nmhossain02/tourguide.git
cd tourguide
codex plugin marketplace add "$(pwd)"
codex plugin add tourguide@tourguide
```

The plugin exposes Tourguide's MCP tools, including project inspection, launching the app, refresh, validation, and publication. It intentionally does not include a Codex skill; curriculum generation belongs to the standalone app's `codex exec` workflow.

## Codex plugin

The release-ready plugin lives in `plugins/tourguide`. Its MCP tools remain available for surgical refreshes, deeper tracks, and alternative clients. The repository marketplace is defined in `.agents/plugins/marketplace.json`.

Tourguide is experimental software. Generated explanations are paired with source or runtime evidence, but remain an onboarding aid rather than an authority on undocumented product intent.

See [the documentation](docs/index.md), including the architecture, authoring contract, and threat model.

## License

Apache-2.0.
