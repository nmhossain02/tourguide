# Tourguide

Tourguide is a local-first learning workbench that turns a Git repository into a sequence of small, playable pages. It borrows the pacing of language tours while adapting the interaction surface to real systems: source, commands, browser previews, data, and topology.

## What the v2 prototype includes

- A standalone `tourguide` CLI that launches structured `codex exec` sessions using the user's local login.
- Branch/tag/commit selection, filtered generation workspaces, coverage planning, and module-by-module publication.
- A `Track → Module → Page → Interaction` browser player with open navigation and richer progress states.
- Demonstrations anchored to the selected commit and editable exercises in resettable worktrees with patch export.
- Automatic v1 snapshot/progress migration and module-level freshness rollups.
- A Codex plugin and open MCP contract as a secondary authoring surface.

## Try it locally

Follow the authoritative [Quick start](../README.md#quick-start) for the current install and launch commands.

Press **Start tour**. The optional focus and advanced settings can narrow the curriculum or select another ref.

Tourguide stores generated snapshots and learner state under `.tourguide/`, sends no telemetry, and does not retain raw recipe output.

Read the [architecture](architecture.md), [authoring contract](authoring.md), [lesson design specification](lesson-design-spec.md), and [threat model](threat-model.md) before extending runtime capabilities.
