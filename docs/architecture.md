# Architecture

Tourguide separates evidence gathering and lesson authorship from deterministic execution and presentation.

```text
Codex skill / any MCP client
           │
           ▼
    MCP authoring tools ──── Git inspection
           │                       │
           ▼                       ▼
  versioned tour snapshot   committed HEAD + live dirty notice
           │
           ▼
 loopback Fastify service ─── declared-capability review
           │                            │
           ▼                            ▼
 React lesson player         disposable worktree + temp HOME
```

The canonical snapshot is anchored to one commit. A later HEAD is compared by changed evidence paths; staleness propagates to dependent lessons. Uncommitted files remain visible as a separate local view and never silently rewrite canonical explanations.

The schema lives in `packages/core`. `packages/server` exposes it through MCP and a token-protected loopback API. `apps/web` renders adaptive lesson and workspace panes. The distributable plugin bundles the service and static app under `plugins/tourguide`.

The deterministic starter tour is immediately usable. An authoring agent can progressively replace it with deeper tracks while preserving the same validated snapshot contract.
