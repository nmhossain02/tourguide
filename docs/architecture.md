# Architecture

Tourguide keeps generation and learning in one browser flow while reusing the user's existing Codex subscription.

```text
tourguide [repository] --ref <ref>
              │
              ▼
 token-protected loopback server ───── Git ref/commit inventory
              │                                  │
              ▼                                  ▼
 deterministic adapters ───── repository knowledge snapshot
              │                         │
              ├── hard evidence         ▼
              │              living documentation snapshot
              │                   │              │
              │          capability profiles    semantic tour bindings
              │                   │              │
              ▼                   ▼              ▼
       codex exec escalation ◄── evidence gaps, failed probes, material tour diffs
              │
       validated artifact reuse
              │
       codex exec tour session ◄─ filtered copy plus documentation JSON
              │
      plan → module → module
              │
              ▼
  .tourguide v3 tours ──────── progressive browser curriculum
              │                             │
              ├── page evidence             ├── source / demos
              └── knowledge refs            └── process-local module lab → patch or branch
```

## Generation boundary

The server first builds a deterministic repository knowledge snapshot with catalogs for data model, API, components, and code or documentation. Every tracked path is indexed or records an exclusion reason. This snapshot is the hard-evidence layer beneath a living documentation snapshot containing stable subjects, claims, scenarios, dependency contracts, runtime profiles, and unresolved inference requests. The data, API, component, compute, and general views are projections of that shared documentation graph.

Every selected commit receives a documentation snapshot. Deterministic reconciliation reuses inferred claims whose evidence is unchanged and invalidates claims whose supporting evidence changed. Semantic diffs classify changes as additive, compatible, behavioral, breaking, or ambiguous. Domain-scoped Codex inference is reserved for material gaps that deterministic adapters cannot resolve. Missing requests are batched into one structured call and each result is validated before reuse.

The server checks the local Codex CLI version and login, then launches `codex exec` in read-only/no-approval mode with JSONL events and a JSON output schema. It ignores ambient Codex configuration and project rules and disables web search. Documentation inference and runtime synthesis inspect detached worktrees at the selected commit. Tour planning receives a disposable filtered repository containing bounded text files plus the complete deterministic catalog and documentation JSON. The first tour turn plans tracks, feature journeys, modules, pages, and coverage. Later turns resume the same Codex thread and draft one module at a time. Quick, Standard, and Deep modes reserve at most 7, 11, and 19 turns including up to two cold documentation or runtime calls. Warm artifacts reduce the actual number.

Every generated module is normalized against the real selected commit: source paths must be tracked, evidence receives the exact revision and content hash, and the shared validator checks hierarchy, breadth, sequencing, recipes, and exercises. If normalization or repository-aware validation rejects a module, it receives at most one repair attempt in the same Codex thread. A valid module is published immediately as a partial snapshot; the complete tour is published only after final validation.

## Stored contract

Repository facts belong to a versioned `RepositoryKnowledgeSnapshot`; repository meaning and executable contracts belong to a `LivingDocumentationSnapshot`. A `TourSnapshot` owns `Track → Module → Page → Interaction`, narrative, sequencing, and exercises, while the separate `Progress` schema owns learner state. During compatibility migration, tours retain exact knowledge refs while also binding stable documentation subjects with latest-compatible or pinned policies. Knowledge, documentation, tours, and content-addressed intelligence artifacts live under `.tourguide/cache`; preferences, progress, and job state live under `.tourguide/state`. Browser progress writes are serialized and each resulting snapshot is persisted atomically. Inference artifacts are keyed by supporting evidence. Runtime artifacts are keyed by capability contract and construction dependencies. Tour assessments are keyed by semantic diff and teaching contract.

Current `HEAD` is compared with the authored commit by changed evidence paths and catalog item hashes. The reverse knowledge dependency index identifies affected tours, modules, pages, journeys, and labs. Staleness propagates through page dependencies and rolls up to modules. Uncommitted files remain a separate local view.

## Runtime boundary

Demonstrations execute at the snapshot commit in temporary detached Git worktrees. A process-local module lab shares one worktree across pages, starts bounded loopback services, and exposes only declared regular text files for editing. Browser state retains the active file and versioned dirty buffers during page navigation, while per-file autosaves are serialized into the lab worktree so switching files cannot reorder writes. Reset recreates the worktree at the snapshot commit. Verification reports pass, fail, or inconclusive with expected and observed behavior. A learner can copy or download a patch, open the workspace in a configured editor, or keep it as an unstaged `tourguide/*` branch worktree. Tourguide never commits, pushes, merges, or modifies the active checkout.

The runtime registry resolves required capabilities instead of mapping an interaction directly to one adapter ID. Built-in providers include Storybook preview discovery, JSON-callable JavaScript exports, allocated-port HTTP requests, and SQLite queries or explicit guided mutations. When those providers do not satisfy a runtime profile, Codex may synthesize a bounded provider manifest. Generated providers are materialized and invoked against a representative subject in a disposable worktree before their artifacts are accepted for reuse. Every invocation returns provenance such as production, repository story, Tourguide harness, or mock. Lab sessions are intentionally not persisted in the first release. Retained branch worktrees are explicit user artifacts.

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
