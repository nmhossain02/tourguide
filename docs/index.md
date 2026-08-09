# Tourguide

Tourguide is a local-first learning workbench that turns a Git repository into a sequence of small, playable pages. It borrows the pacing of language tours while adapting the interaction surface to real systems: source, commands, browser previews, data, and topology.

## What the v3 workbench includes

- A standalone `tourguide` CLI that launches structured `codex exec` sessions using the user's local login.
- Branch/tag/commit selection, filtered generation workspaces, coverage planning, and module-by-module publication.
- Four deterministic, independently browsable catalogs for data models, APIs, components, and code or documentation.
- A `Track → Module → Page → Interaction` browser player whose journeys and viewers reference exact catalog items.
- Demonstrations anchored to the selected commit and process-local module labs with services, editing, verification, patch export, and branch retention.
- Automatic v1 and v2 snapshot/progress migration plus knowledge-aware freshness rollups.
- A Codex plugin and open MCP contract as a secondary authoring surface.

## Try it locally

Follow the authoritative [Quick start](../README.md#quick-start) for the current install and launch commands.

Press **Explore codebase** to browse without generating, or press **Start tour**. The optional focus and settings can select a generation depth or another ref.

Tourguide stores generated snapshots and learner state under `.tourguide/`, sends no telemetry, and does not retain raw recipe output.

Read the [architecture](architecture.md), [living executable documentation model](living-documentation.md), [authoring contract](authoring.md), [capability matrix](capabilities.md), [ADR 001](adr-001-repository-knowledge-and-labs.md), [ADR 002](adr-002-living-executable-documentation.md), [historical v2 curriculum research](lesson-design-spec.md), and [threat model](threat-model.md) before extending runtime capabilities.
