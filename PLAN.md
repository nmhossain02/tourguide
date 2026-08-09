# Strengthen Tourguide into a Safe Codebase Learning Workbench

> Architecture update, 2026-08-07: repository knowledge catalogs are now the deterministic evidence layer beneath a living executable documentation graph. Documentation subjects, claims, scenarios, dependency contracts, and runtime profiles become the backbone for playgrounds and tours. See `docs/adr-002-living-executable-documentation.md`. The delivery history below remains useful, but statements that make tours own reusable runtime environments or make raw catalog hashes the only dependency contract are superseded by ADR 002.

## Intelligence escalation decisions

| Area | Chosen approach | Alternatives left unchosen |
|---|---|---|
| LLM stages | Use focused `codex exec` calls for unresolved documentation, missing runtime providers after deterministic capability checks, and material tour impact | Per-page calls, per-component calls, or making the LLM the deterministic indexer |
| Reuse identity | Content-address documentation by evidence and questions, runtimes by capability and construction dependencies, and tour assessments by semantic diff and teaching contract | Cache by commit, cache by model response text, or invalidate every runtime when a subject is added |
| Cold-call shape | Batch all missing documentation domains into one call and all missing runtime profiles into one call | One cold process per domain or provider |
| Runtime acceptance | Materialize generated providers in a detached worktree and invoke a representative subject before accepting a warm artifact | Trusting schema-valid generated commands without execution or requiring Storybook, SQLite, or another fixed repository technology |
| Runtime selection | Resolve semantic capabilities while retaining exact adapter IDs as compatibility providers | Immediate removal of v3 adapter IDs or continuing hard-coded interaction-to-adapter routing |
| Failed artifacts | Preserve diagnostics but never use failed validation or failed probes as cache hits | Negative caching that prevents repair attempts or silent fallback to an unvalidated provider |
| Lab durability | Keep lab sessions process-local while persisting only reusable repository-understanding artifacts | Persisting learner sessions as part of this architecture change |

## Summary

Evolve the existing v2 product rather than replace it. Preserve the current flow:

```text
Git commit
  -> deterministic repository index
  -> versioned knowledge catalogs and dedicated viewers
  -> one structured codex exec planning turn
  -> resumed codex exec module turns
  -> validated tour that references catalog items
  -> process-local isolated lab
  -> experiment, edit, verify
  -> retain as branch worktree or export patch
```

The work will ship as six end-to-end milestones. Data models, APIs, frontend components, and the code map or general documentation are first-class repository knowledge products. They can be browsed without a tour. A tour owns the learning sequence and narrative, and depends on versioned items from those catalogs.

## Decisions and Unchosen Alternatives

| Area | Chosen approach | Alternatives left unchosen |
|---|---|---|
| Delivery | Six independently usable milestones | One large release |
| LLM engine | Keep `codex exec`, JSONL usage events, output schemas, and resumed module turns, which are supported by the current [non-interactive Codex flow](https://learn.chatgpt.com/docs/non-interactive-mode) | Responses API, Agents SDK, or runtime LLM calls |
| Generation shape | One planning turn, one turn per module, at most one repair per module | Extra summarization, indexing, or evaluation turns |
| Learner edits | Temporary isolated worktree, followed by an explicit "Keep on branch" action | Editing the active checkout or asking on every exercise |
| Lab scope | One process-local lab session per module so frontend, API, logic, and data can share state during the current run | A fresh worktree for every interaction or persisted sessions in the first lab milestone |
| First adapters | Deep web slice: React, Storybook, REST/OpenAPI, SQLite, and JSON-callable JS/TS functions | Broad but shallow Python and Go adapters initially |
| Domain ownership | A versioned repository knowledge snapshot owns data-model, API, component, and code/docs catalogs; tours reference catalog items | Embedding repository knowledge inside each generated tour |
| Awareness | Deterministic exhaustive catalogs plus a Codex-authored tour journey that references catalog item IDs | LLM-only indexing, mandatory LSP setup, or mandatory SCIP generation |
| Existing tooling | Prefer repository-owned stories, tests, dev commands, OpenAPI, mocks, and Compose definitions | Replacing repository workflows with Tourguide-specific equivalents |
| Frontend rendering | Existing Storybook first, using stories and args, then a constrained Vite React harness for simple components. Storybook already provides reusable component states and live-editable args. [Storybook stories](https://storybook.js.org/docs/8/writing-stories/index), [Storybook args](https://storybook.js.org/docs/writing-stories/args) | Sandpack or arbitrary generated component harness code |
| API exploration | Parse OpenAPI and render a Tourguide-native request/expected-result workbench; reuse an existing Swagger UI when present | Bundling Swagger UI for every repository |
| Database | SQLite first inside the shared worktree, using `node:sqlite`; container-backed databases only through explicit trusted mode. [Node SQLite](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html) | Native database dependencies or mandatory Testcontainers |
| Mocking | Repository-owned doubles first, then declarative HTTP/data fixtures with visible provenance | Hidden mocks or arbitrary LLM-generated executable mock code |
| Documentation | Local documentation and source comments first; list repository-owned external links without fetching them | Codex web search or silent external document ingestion |
| Editor integration | Monaco remains the default; detected VS Code and custom argv-based editor commands are opt-in user actions | Editor-specific URI schemes or shell commands |
| Bad modularity | Produce an evidence-backed interactivity-readiness report and optional refactor exercise | Automatically refactoring production code during tour generation |

## Architecture and Contract Changes

### Repository knowledge catalogs

- Add a cached `RepositoryIndex` keyed by commit and analyzer version. Every tracked path gets a record containing language, size, hash, classification, and either parsed metadata or an explicit exclusion reason.
- Parse Markdown headings and links, manifests and scripts, workspaces, JS/TS imports and exports, React components, routes, tests, Storybook stories, OpenAPI operations, SQL schemas and migrations, and CI or delivery configuration.
- Add an analyzer interface. Initial semantic analysis uses the TypeScript compiler APIs and format-specific parsers. Later, accept existing SCIP indexes and add Tree-sitter-based Python and Go analyzers. SCIP remains optional because it is language-agnostic but requires separate indexers. [SCIP protocol](https://github.com/scip-code/scip), [Tree-sitter](https://tree-sitter.github.io/)
- Build a `RepositoryKnowledgeSnapshot` from that index. It is anchored to one Git commit, exists independently of any tour, and contains four catalogs:
  - `dataModel`: entities, tables, fields, relationships, migrations, fixtures, storage adapters, and source evidence.
  - `api`: services, endpoints, methods, paths, authentication declarations, request and response schemas, implementations, clients, and source evidence.
  - `components`: component exports, Storybook stories, props or args, events, variants, providers, consumers, render readiness, and source evidence.
  - `codeDocs`: packages, files, symbols, imports, calls, tests, configuration, CI or delivery surfaces, repository documentation, and relationships between them.
- Give every catalog item a stable ID, content hash, evidence references, confidence, readiness state, and relationships to items in any catalog. Relationships include imports, calls, renders, serves, reads, writes, tests, documents, and deploys.
- Add four dedicated viewers that are available with or without a tour:
  - Data model viewer: entity or table list, ER graph, field and relationship details, migrations, fixtures, storage code, and later live lab data.
  - API viewer: service and endpoint navigation, request and response contracts, auth requirements, implementation and client links, and later a request workbench.
  - Component library viewer: searchable component and story gallery, props or args, variants, consumers, providers, source links, readiness, and later live rendering.
  - Code map and docs viewer: repository tree, package or symbol graph, documentation reader, source viewer, search, and cross-catalog links.
- Keep catalog extraction deterministic. Codex may explain or sequence catalog items in a tour, but it does not become the canonical owner of catalog facts.
- Bottom-up browsing and cross-catalog search never call Codex. Asking for a new generated track remains an explicit, budgeted action.

### Tour dependencies and generation schemas

- Introduce `TourSnapshot` schema version 3 with `knowledgeSnapshotId`, `knowledgeRefs`, `featureJourneys`, `labEnvironments`, and typed local references. It does not copy catalog records into the tour.
- Define `KnowledgeRef` as `{ catalog, itemId, contentHash }`. Every module, page, evidence claim, and interaction records the exact catalog items it depends on.
- Define `ViewerTarget` as a `KnowledgeRef` plus view state such as selected field, operation, story, source range, or graph neighborhood. Opening a tour page drives the appropriate dedicated viewer to this target.
- Keep narrative, objectives, sequencing, prerequisites, exercises, expected observations, and learner progress in the tour domain. Keep repository facts, schemas, component metadata, and source relationships in the knowledge domain.
- Extend `Interaction` with `component`, `http`, `database`, and `function`, while retaining `source`, `command`, `browser`, `data`, and `topology`. Knowledge-backed interactions reference `ViewerTarget` instead of duplicating catalog data.
- Add `LabEnvironment` containing preparation recipes, long-lived services, health checks, loopback ports, database connections, fixtures, editable paths, dependency bindings, capabilities, and reset behavior.
- Add `DependencyBinding.mode` values `real`, `repository-mock`, `declarative-mock`, and `blocked`. Every interaction displays this provenance.
- Replace URL-only references with a discriminated reference type for source, local documentation, or external URLs.
- Add structured verification checks for exit code, output fragments, JSON subsets, HTTP responses, database rows, and file changes. Verification remains formative and never locks navigation.
- Upgrade progress to schema version 3 with page viewed, demonstration run, exercise attempted, verified, completed, stale, blocked, and module completion. Lab state remains separate from learning progress.
- Add generation depth presets:
  - Quick: at most 2 modules and 7 Codex turns, including two cold intelligence calls.
  - Standard, default: at most 4 modules and 11 turns, including two cold intelligence calls.
  - Deep: at most 8 modules and 19 turns, including two cold intelligence calls.
- Show the selected model, commit, indexed and filtered source sizes, maximum Codex turns, and current token usage before and during generation. Do not claim a hard token ceiling because `codex exec` does not expose one.

### Lab runtime and HTTP surface

- Replace page-local exercise state with a process-local `LabSession` managed by the running server. It contains the module, environment, temporary worktree, services, editable paths, mocks, timestamps, and status, but is not written to `.tourguide/state` initially.
- Keep active-file selection and unsaved editor content in browser state. Lift the session to module scope so page navigation within the running app does not recreate it, but treat browser reload and server restart as a new session initially.
- Implement actual `service` recipe lifecycle handling: random loopback ports, health checks, bounded logs, process-group termination, and a 15-minute idle timeout.
- Remove non-retained worktrees when the session is closed, expires, or the server shuts down. Retained branch worktrees are explicit user-owned artifacts and are not automatically removed.
- Add APIs under:
  - `/api/knowledge`, `/api/knowledge/search`, and `/api/knowledge/:catalog/:itemId`
  - `/api/labs` and `/api/labs/:id`
  - `/api/labs/:id/files`, `/run`, `/verify`, `/reset`, `/patch`, `/retain`, and `/events`
  - `/api/editor/open`
- Keep existing `/api/exercises` routes as compatibility delegates for one schema generation.
- "Keep on branch" creates a validated `tourguide/<exercise-slug>-<short-id>` branch in the lab worktree and leaves edits unstaged. It never commits, pushes, merges, or alters the active checkout.
- Setup, dependency installation, containers, external network, and external systems require a capability review. Approval is session-scoped and tied to the exact recipe hash. Secret injection remains unsupported initially.

### Migration

- Back up v2 snapshots and progress before conversion.
- Build a repository knowledge snapshot at the v2 tour's anchor commit, then map existing source, data, topology, and command evidence to catalog items where possible.
- Preserve unmappable inline interactions as explicitly marked legacy content until their module is regenerated.
- Add `KnowledgeRef` dependencies to migrated modules and pages without copying catalog records into the tour.
- Convert exercises into page-scoped compatibility lab environments.
- Convert URL references to external references and initialize new progress fields without losing prior state.
- Preserve current snapshots, source evidence, and progress through the transition.

## Delivery Sequence

### 1. Awareness foundation

- Implement the repository index, knowledge snapshot, four catalogs, analyzer interface, v3 migration, search API, and the shared viewer shell.
- Deliver read-only first versions of the data model, API, component library, and code map/docs viewers. Reuse ReactFlow for relationship graphs, Monaco for source, and the existing table UI for structured catalog details.
- Include every tracked file or its exclusion reason. Never send excluded content to Codex.
- Materialize the full repository knowledge snapshot as queryable JSON in the filtered generation repository, while placing only a bounded catalog summary and stable item IDs in the prompt.
- Preserve `strengthening-guide.md` as product input and add an architecture decision record for the choices above.

Exit gate: without generating a tour, a learner can use the four viewers to browse every fixture path, navigate the data model, inspect API contracts, explore the component library, read documentation, and follow cross-catalog links.

### 2. Top-down generation and teaching quality

- Extend the existing planning response to include feature journeys composed entirely of `KnowledgeRef` values. Do not add another LLM turn.
- Validate every generated journey step, module dependency, page reference, source claim, and viewer target against the selected repository knowledge snapshot.
- Make the planning prompt documentation-first, require one representative user journey, and connect frontend, API, logic, and data where those layers exist.
- Keep pages short and sequential. Add module overviews, explicit deferred topics, local reference links, source-range highlighting, prediction prompts, input variation, and expected-versus-observed comparisons.
- Require the core track to contain one verified patch exercise when a tracked editable file and local verification path exist. Otherwise require a specific blocked reason and an interactivity-readiness recommendation.
- Add the generation consent and live usage UI using the depth presets.

Exit gate: Standard generation reserves no more than eleven Codex turns, including cold documentation and runtime synthesis, and produces a documentation-backed tour centered on one traceable feature journey, with every page driving a dedicated viewer to versioned subjects.

### 3. Process-local lab and contribution loop

- Introduce process-local module-scoped lab sessions, service lifecycle management, autosaved files, reset, cleanup, and compatibility with existing command and exercise pages.
- Replace raw verification output as the primary result with pass, fail, or inconclusive checks, while retaining expandable stdout, stderr, patches, and side effects.
- Add copy patch, download patch, open workspace in editor, keep on branch, and remove retained workspace actions.
- Extend diagnostics with a redacted lab-failure report containing commit, recipes, inputs, expected and observed results, mock provenance, service logs, changed files, and patch.
- Do not use Codex to summarize failures automatically.

Exit gate: a learner can edit, navigate between pages, fail verification, fix the code, pass verification, and retain the work on a branch while the active checkout remains byte-for-byte unchanged. Reloading the browser may start a fresh disposable session at this milestone.

### 4. React, Storybook, and JS/TS function adapters

- Upgrade the component library viewer from catalog-only to interactive rendering while keeping the component catalog as its source of truth.
- Detect and launch existing Storybook configurations, enumerate story IDs and args, embed the selected story, and let learners vary JSON-serializable args.
- When Storybook is absent, materialize a fixed Vite harness template that imports only a validated component path and export. Support simple JSON props and repository-owned decorators; mark provider-heavy components blocked rather than generating arbitrary code.
- Add a JS/TS function harness for JSON-callable exports using a repository-owned runner when available. Capture return values, exceptions, filesystem effects, and declared mock calls.
- Surface whether the rendered behavior comes from production source, a repository story, a Tourguide harness, or a mock.

Exit gate: the fixture supports changing component props and function inputs, observing outputs, and seeing clear dependency provenance.

### 5. HTTP, SQLite, and shared full-stack labs

- Upgrade the API and data model viewers from catalog-only to interactive workbenches while keeping their catalogs as the source of truth.
- Detect OpenAPI documents and code-defined routes, then generate parameterized HTTP interactions against an allocated session service.
- Start repository-owned API and frontend commands in the same lab environment. Restrict server-side requests to ports allocated to that session.
- Add SQLite schema browsing, read-only queries, and guided row creation, editing, and deletion against the session database. Reset reruns the declared migrations and seed fixtures.
- Ensure frontend and API services receive the same session database configuration so data edits appear through both layers.
- Reuse repository-owned MSW handlers, fixtures, or test doubles when detected. Otherwise allow only declarative HTTP responses and data fixtures, always labeled as mocks.
- Keep Docker Compose and container-backed dependencies behind trusted mode instead of making them prerequisites.

Exit gate: the expanded polyglot fixture demonstrates one flow from React UI through an HTTP API and business function into SQLite, including a visible mocked dependency and resettable state.

### 6. Refresh, bottom-up expansion, and hardening

- Diff catalog item hashes and relationships between repository knowledge snapshots, then stale only tours, journeys, pages, labs, and viewer targets that depend on changed items.
- Maintain a reverse dependency index from each catalog item to the tours, modules, and pages that reference it.
- Start a fresh Codex session for a new commit, passing the previous feature journey and deterministic catalog diff. Reuse unaffected modules byte-for-byte and regenerate only affected modules.
- Let learners select any indexed surface and explicitly request a new track, with a fresh usage confirmation.
- Add durable lab sessions as a separate enhancement: persist only the metadata needed to reconnect to an existing worktree, restore the active file and revealed hints, restart stopped services on demand, resume after browser or server restart, and expire non-retained sessions after 24 hours.
- Add optional existing-SCIP ingestion and Tree-sitter-based Python and Go symbol extraction without making their toolchains mandatory.
- Turn readiness gaps into evidence-backed suggestions or optional design and patch exercises. Do not auto-refactor.
- Update the authoring contract, architecture, threat model, CLI help, and capability matrix.

Exit gate: changing one source or documentation surface stales and regenerates only its dependent content, while unsupported languages and environments remain browsable with explicit limitations.

## Test and Acceptance Plan

- Add unit and integration coverage for index completeness, catalog extraction, stable IDs, cross-catalog relationships, knowledge references, reverse tour dependencies, schema migration, dynamic module limits, recipe probing, mock provenance, verification checks, service cleanup, port isolation, session expiry, reset, branch retention, and editor command validation.
- Expand the polyglot fixture into a runnable React, Storybook, API, JS/TS logic, OpenAPI, and SQLite stack with success, failure, and mocked paths.
- Add Playwright browser tests for all four standalone viewers, cross-catalog links, tour-driven viewer selection, generation consent, progressive publication, navigation, component args, API requests, data mutation, code editing, verification, patch export, branch retention, and diagnostics. Add reload and restart resume coverage only when durable sessions are implemented in milestone 6.
- Add security regressions for path traversal, symlinks, branch-name collisions, undeclared writes, unallocated loopback requests, external access without trust, service-process leaks, oversized fixtures, and secret redaction.
- Keep fake-Codex structured-output tests deterministic in CI. Before each milestone ships, run a real `codex exec` generation on the polyglot fixture and Tourguide itself.
- Every PR must pass `corepack pnpm validate`, the relevant Playwright suite, a real browser flow, and `no-mistakes` during PR preparation.
- Do not declare a milestone complete unless its stated exit flow has been exercised end to end.

Final acceptance requires:

- Every tracked path is indexed or has an exclusion reason.
- Data models, APIs, components, code, and documentation are independently browsable before a tour exists.
- A tour declares its repository knowledge snapshot and exact catalog-item dependencies.
- A top-down journey links all applicable frontend, API, logic, and data catalog items, or records an evidence-backed gap.
- Standard generation never exceeds eleven Codex turns, including two cold intelligence calls, and shows actual usage.
- Learner changes and data mutations survive page navigation during the initial lab milestone and survive reload or restart after the milestone 6 durability enhancement. They never touch the active checkout.
- Verification explains expected versus observed behavior instead of exposing only raw command output.
- Real and mocked dependencies are always distinguishable.
- Verified learner work can be retained on a branch worktree without automatic staging, commits, pushes, or merges.
- A changed catalog item stales only dependent tour content, and refresh preserves unaffected modules.
- Both the fixture and Tourguide repository pass the real user flows without browser console errors.

## Assumptions and Defaults

- Implementation starts from `origin/main` at merge commit `8e5c938`, not the currently stale local `main`.
- Node is raised from `>=22` to `>=22.13` for flag-free `node:sqlite` availability.
- Tourguide remains local-only, token-protected, telemetry-free, and anchored to committed Git revisions.
- Repositories are treated as trusted enough for the existing alpha model, but generated instructions and runtime recipes remain untrusted.
- Codex web search stays disabled. External links are shown but not fetched.
- Standard depth, internal Monaco viewing, isolated worktrees, declarative mocks, and no container access are the defaults.
- Python, Go, GraphQL, non-SQLite databases, arbitrary component providers, secret-backed services, and automatic refactoring remain explicit follow-on capabilities rather than hidden partial support.
