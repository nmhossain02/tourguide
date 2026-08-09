# Authoring contract

Tourguide builds deterministic repository knowledge before it authors a curriculum. The normal standalone flow asks Codex for a coverage map, feature journey, and module outline, then resumes the same thread to draft complete modules. Catalog extraction and bottom-up browsing do not call Codex.

## Curriculum

- One core track is priority 0. Add one selected track for the learner's task-shaped goal when useful.
- Tracks contain modules; modules contain ordered pages.
- A normal module has 6–15 pages and develops one capability or subsystem through context, structure, representative flow, behavior, failure, change, and recap.
- Every applicable core capability, including orientation, setup, run, architecture, data/state, test, debug, change workflow, and delivery/operations, is covered or given an explicit `not-applicable`, `blocked`, or `omitted` reason.
- Each normal module has a demonstration and synthesis exercise, or a recorded safe fallback.
- A representative feature journey uses exact catalog item IDs and connects documentation, frontend, API, logic, and data where those layers exist.
- Quick, Standard, and Deep generation contain at most 2, 4, and 8 modules respectively. With one optional repair per module and up to two cold documentation or runtime calls, they reserve no more than 7, 11, and 19 Codex turns. Warm validated artifacts reduce actual usage.

## Pages

A page teaches one observable step in 1–5 minutes. Narrative is normally 40–180 words and cannot exceed 350. Every page contains an interaction; concept, walkthrough, demo, and exercise pages use source or runtime evidence. Adjacent pages should follow a recurring representative request, command, job, data path, or change.

Evidence is source, config, runtime, history, documentation, or explicit inference. A ready page cannot present unvalidated non-inference evidence. Source evidence uses a repository-relative path, selected revision, useful line range or symbol, and full-file content hash.

Modules, pages, journeys, and knowledge-backed interactions use `KnowledgeRef` or `ViewerTarget` values from the selected repository knowledge snapshot. Component, HTTP, database, and function interactions drive the dedicated catalog viewers. References are explicitly source, repository documentation, or external URLs.

## Runtime and exercises

Command interactions use executable-plus-argv, not shell strings. Authors declare writes, network reach, secrets, containers, external systems, timeout, and expected observation. A demo asks the learner to predict and vary meaningful behavior.

Exercises use `observe`, `trace`, `diagnose`, `patch`, or `design`. Each defines an observable task, allowed paths or inputs, progressive hints, expected observation, reset behavior, and structured verification where feasible. Patch exercises can edit only named tracked text files in a disposable module lab. Real, repository-mock, declarative-mock, and blocked dependencies are always labeled.

Unavailable prerequisites produce an honest blocked experiment or safe diagnostic, never fabricated output.

## MCP fallback

The Codex plugin retains manual authoring tools for surgical refreshes, deeper tracks, and alternative clients:

1. `inspect_project`
2. `collect_priorities`
3. `begin_snapshot` or `begin_refresh`
4. `write_outline`
5. `read_evidence`
6. `write_pages` one module at a time
7. `probe_recipe` where runtime evidence matters
8. `validate_snapshot`
9. `publish_snapshot`
10. `launch_app`

The same v3 validator and browser are used by standalone and MCP-authored tours.
