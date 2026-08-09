# ADR 002: Make living documentation the product backbone

Status: Accepted

Date: 2026-08-07

## Context

The first workbench architecture made deterministic knowledge catalogs canonical and attached runtime environments to tours. That made hard facts inspectable, but it also made playground support depend on specific adapters such as Storybook and SQLite. Exact content-hash references caused implementation changes to stale tours even when their semantic teaching contract remained compatible.

Tourguide needs the LLM to infer missing meaning and repository-specific runtime glue without invoking it for every component, interaction, tour, or commit.

## Decision

Tourguide will maintain a versioned living-documentation snapshot for every selected commit. The existing knowledge snapshot becomes its deterministic evidence layer.

The documentation graph contains stable subjects, evidence-backed claims, declarative scenarios, dependency contracts, runtime profiles, and unresolved inference requests. Claims record whether they are observed, documented, runtime-verified, or inferred.

Playgrounds resolve subjects and scenarios through reusable runtime profiles. Tours bind stable semantic subjects and required capabilities rather than relying only on commit-specific content hashes. Semantic diffs determine whether evidence can be rebound, a runtime profile needs rebuilding, or a focused agent assessment is necessary.

Codex inference is domain-scoped and evidence-invalidated. An unchanged inferred claim is reused. A changed domain receives an LLM call only when deterministic adapters and runtime probes cannot resolve a material documentation gap.

Reusable intelligence is stored as validated, content-addressed artifacts rather than opaque response caching. Documentation artifacts depend on evidence and questions. Runtime artifacts depend on capability and construction evidence, not the list of available subjects. Tour assessments depend on the semantic diff and teaching contract. Concurrent cold requests share one call.

Runtime execution resolves capabilities. Repository and built-in providers are attempted first. If no provider satisfies the contract, Codex generates a bounded manifest that Tourguide probes in an isolated worktree before accepting it. Behavioral, breaking, and ambiguous changes receive a focused Codex assessment only when a tour binds the affected subject.

## Consequences

- Documentation, not tours, owns the reusable understanding of repository subjects and runtimes.
- Adding a compatible component or endpoint updates a subject registry without rebuilding a runtime harness.
- Repository tools are preferred providers but no longer product requirements.
- Generated runtime glue can be reused until its dependency evidence changes or probes fail.
- Tour refresh becomes semantic rather than purely hash-based.
- Existing knowledge refs, adapter IDs, and lab environments remain during an incremental compatibility migration.
- The documentation reconciler and inference coordinator become critical correctness boundaries and require evidence, provenance, validation, and focused regression coverage.
