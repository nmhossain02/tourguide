# Architecture

Tourguide keeps generation and learning in one browser flow while reusing the user's existing Codex subscription.

```text
tourguide [repository] --ref <ref>
              │
              ▼
 token-protected loopback server ───── Git ref/commit inventory
              │                                  │
              ▼                                  ▼
       codex exec session ◄──── filtered copy of selected commit
              │
      plan → module → module
              │
              ▼
  .tourguide v2 snapshots ───── progressive browser curriculum
              │                             │
              ├── page evidence             ├── source / demos
              └── progress                  └── exercise worktrees → patch
```

## Generation boundary

The server checks the local Codex CLI version and login, then launches `codex exec` in read-only/no-approval mode with JSONL events and a JSON output schema. It ignores ambient Codex configuration and project rules, disables web search, and gives Codex a disposable filtered repository containing only bounded text files from the selected commit. The first turn plans tracks, modules, pages, and coverage. Later turns resume the same Codex thread and draft one module at a time.

Every generated module is normalized against the real selected commit: source paths must be tracked, evidence receives the exact revision and content hash, and the shared validator checks hierarchy, breadth, sequencing, recipes, and exercises. A valid module is published immediately as a partial snapshot; the complete tour is published only after final validation.

## Stored contract

The canonical model is `Track → Module → Page → Interaction`. Snapshots include an immutable `{ ref, commit }` anchor, explicit coverage/gaps, page prerequisites, and evidence. They live under `.tourguide/cache`; preferences, progress, job state, and exercise sessions live under `.tourguide/state`. V1 snapshots and progress are backed up and migrated automatically.

Current `HEAD` is compared with the authored commit by changed evidence paths. Staleness propagates through page dependencies and rolls up to modules. Uncommitted files remain a separate local view.

## Runtime boundary

Demonstrations execute at the snapshot commit in temporary detached Git worktrees. Exercises use longer-lived generated worktrees with an allowlist of editable regular text files. Reset recreates the worktree at the snapshot commit; export returns a patch limited to the exercise allowlist. Tourguide never applies that patch to the active checkout.

## Failure diagnostics

Generation, server, process, and browser failures produce a structured report
in `.tourguide/diagnostics/`. `latest.json` is the stable handoff path and
timestamped copies preserve earlier failures. Reports contain runtime versions,
the selected revision, generation state, recent events, stacks, and bounded
Codex stdout/stderr. Environment variables are excluded and common credentials
are redacted before persistence. The browser exposes the same report through a
copyable Diagnostics modal; `tourguide diagnostics` remains available when the
web process is no longer running.

`packages/core` owns schemas, Git inspection, migration, validation, storage, and worktrees. `packages/server` owns Codex orchestration, the CLI, MCP fallback, and loopback API. `apps/web` renders setup, progressive generation, hierarchical navigation, interactions, and exercises. The npm package and Codex plugin bundle the same server and web app.
