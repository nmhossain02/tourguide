# Tourguide

Tourguide is a local-first learning workbench that turns a Git repository into many small, playable lessons. It borrows the pacing of language tours while adapting the interaction surface to real systems: source, commands, browser previews, data, and topology.

## What the alpha includes

- A Codex plugin and `$tourguide` authoring skill.
- An open MCP contract for inspection, drafting, validation, publication, runtime probes, and launching the learner app.
- A Git-aware browser player with HEAD/local source comparison, progress, learning priorities, evidence, and freshness notices.
- Capability-declared recipes. External access requires explicit approval; declared writes run in disposable Git worktrees.

## Try it locally

```bash
corepack pnpm install
corepack pnpm validate
node plugins/tourguide/dist/tourguide.mjs open /path/to/a/git/repository
```

Tourguide stores generated snapshots and learner state under `.tourguide/`, excludes that directory locally through `.git/info/exclude`, sends no telemetry, and does not retain raw recipe output.

Read the [architecture](architecture.md), [authoring contract](authoring.md), and [threat model](threat-model.md) before extending runtime capabilities.
