# ADR 001: Separate repository knowledge, tours, and labs

Status: accepted; semantic refresh and runtime ownership amended by [ADR 002](adr-002-living-executable-documentation.md)

## Context

Newcomers need to explore a codebase before they know which tour to request. Repository facts also change at a different cadence from learning narrative, and experiments need a lifecycle distinct from learner progress.

## Decision

Tourguide uses three bounded domains:

- `RepositoryKnowledgeSnapshot` owns commit-anchored data model, API, component, and code or documentation catalogs. Deterministic adapters produce stable IDs, hashes, evidence, readiness, exclusions, and cross-catalog relationships.
- `TourSnapshot` owns learning sequence, narrative, feature journeys, exercises, and exact references to knowledge items. Codex keeps its existing one-plan-turn plus resumed module-turn flow.
- `LabManager` owns process-local module worktrees, services, editable paths, dependency provenance, invocation adapters, verification, reset, patch export, and branch retention. Browser state owns active file and unsaved content.

The analyzer and lab registries reject duplicate IDs and allow new languages or runtimes to be added without modifying central dispatch logic.

## Consequences

Catalogs are independently browsable without an LLM call. Exact item hashes preserve reproducible evidence, while ADR 002 owns semantic refresh and runtime reuse. Labs survive page navigation. A browser reload can reconnect to the same module lab while the server remains running, but a server restart ends every unretained lab. Durable cross-process reconnection, SCIP ingestion, and Tree-sitter analyzers remain later extensions.

Tourguide does not automatically refactor production code, execute hidden generated mocks, or retain learner work without an explicit action.
