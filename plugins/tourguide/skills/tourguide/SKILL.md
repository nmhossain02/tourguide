---
name: tourguide
description: Create, open, deepen, or refresh an interactive browser tour of a Git codebase. Use for broad repository onboarding, learning local development workflows, exploring architecture or subsystem tracks, and updating lessons after committed code changes. Do not trigger for an ordinary explanation of one file or symbol unless the user explicitly asks for a Tourguide lesson.
---

# Tourguide

Build evidence-backed lessons through the Tourguide MCP tools, then launch the local browser app. Keep source code in the repository: lessons store commit/path/symbol anchors, not copied implementations.

## Workflow

1. Call `inspect_project` from the target Git repository. Use the returned shallow inventory rather than scanning ignored, vendored, generated, binary, secret, or oversized files.
2. Call `collect_priorities` when the tour has no learner preferences. Let the local browser collect ordered subsystem choices and multiple goals.
3. Call `begin_snapshot` with the selected priorities. Treat committed `HEAD` as canonical; mention dirty referenced files only as live-change notifications.
4. Read [authoring.md](references/authoring.md), then call `write_outline` before drafting lessons.
5. Write small lesson batches with `write_lessons`. Give each lesson one objective, one primary experiment, evidence for material claims, and at most three deeper references.
6. Use `probe_recipe` only when runtime evidence materially improves a lesson. Keep commands argv-based and declare writes, network, secrets, and external-system capabilities accurately.
7. Call `validate_snapshot`, fix every error, and call `publish_snapshot`. Publish local-development lessons first, then selected tracks in priority order.
8. Call `launch_app` so the learner can use the validated tour.

## Refresh and deepen

- For a refresh, call `inspect_project`, read the committed change set, and regenerate only stale lessons and their dependent summaries.
- For a deeper track, retain existing stable objective IDs and add the requested track without rewriting unrelated lessons.
- For a correction, incorporate saved project hints and the learner's feedback; never erase progress merely because prose changed.

## Boundaries

- Never invent successful runtime output or undocumented product intent.
- Label inference separately from observed source, configuration, history, documentation, or runtime behavior.
- Never expose secret values, persist live-system output, or approve external writes.
- Do not modify the active checkout. Use Tourguide-managed workspaces for experiments.
- Keep navigation open. Knowledge checks are formative, unscored, and non-blocking.
