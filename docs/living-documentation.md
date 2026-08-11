# Living executable documentation

Tourguide maintains an evidence-backed understanding of a repository at every selected commit. The documentation snapshot is the product backbone. Catalogs provide hard facts, playgrounds execute documented scenarios, and tours teach stable semantic subjects.

```text
commit
  -> deterministic evidence catalogs
  -> living documentation reconciliation
  -> evidence-keyed Codex inference for unresolved gaps
  -> semantic documentation diff
  -> capability provider probe, reuse, or Codex synthesis
  -> deterministic tour rebind or focused Codex assessment
```

## Documentation subjects

A subject represents a stable concept such as a component, endpoint, domain entity, operation, exported compute surface, or repository document. Its identity is stable across compatible implementation changes. Commit-specific evidence and contract fingerprints remain separate from that identity.

Each subject owns claims, scenarios, required capabilities, dependency contracts, and evidence. Claims explicitly distinguish observed facts, repository documentation, runtime observations, and LLM inference. Inferred claims remain valid only while their evidence fingerprint remains unchanged.

The data-model, API, component-library, compute, and general-documentation views are projections of this shared graph. They are not independent stores.

## Incremental reconciliation

Every commit receives a documentation snapshot. Deterministic adapters update affected evidence first. Existing inferred claims are reused when their evidence is unchanged and invalidated when supporting evidence changes. Unresolved questions are batched into domain-specific inference requests.

An inference request does not automatically imply an LLM call. The inference coordinator first looks for a validated artifact with the same evidence, questions, subjects, reconciler version, and prompt version. It calls Codex once for all remaining requests at that commit. Invalid subject references or incomplete batch results fail validation and are not reusable.

Semantic changes are classified as additive, compatible, behavioral, breaking, or ambiguous. Additive subjects update playground registries without rebuilding runtime harnesses. Compatible changes rebind evidence. Behavioral and breaking changes affect only tours that bind the changed subject. Ambiguous material changes can trigger a focused agent assessment.

## Declarative playgrounds

Playgrounds consume subject and scenario identifiers instead of component-specific generated code. A runtime profile describes a reusable repository boundary such as `frontend:main`, `api:main`, `data:application`, or `compute:main`.

Runtime profiles have two fingerprints:

- The dependency fingerprint covers build configuration and runtime construction. It controls whether a harness must be rebuilt or regenerated.
- The subject-registry fingerprint covers available subjects and contracts. It updates declarative playground choices without rebuilding a compatible harness.

Repository-owned Storybook, tests, CLIs, schemas, and services remain preferred providers. They are not prerequisites. Generic and generated providers can satisfy the same capabilities.

Runtime invocation resolves capabilities such as `ui.render`, `service.request`, `data.query`, and `code.invoke`. Exact adapter IDs remain a compatibility declaration, not the selection algorithm. When no repository or built-in provider satisfies a profile, Codex can generate a provider manifest containing isolated files, preparation recipes, loopback services, and capability invocations. Tourguide materializes the provider in a disposable worktree and runs a representative subject probe. Only a successful probe becomes a warm reusable artifact.

## Validated artifact reuse

Tourguide does not cache an LLM answer by commit alone. It stores content-addressed artifacts under `.tourguide/cache/intelligence`:

- Documentation inference keys include evidence fingerprints, questions, subject IDs, and prompt or reconciler versions.
- Runtime provider keys include required capabilities and the dependency fingerprint, but exclude the subject registry. Adding a compatible component updates the registry without regenerating the provider.
- Tour impact keys include the semantic documentation diff and the tour teaching contract.

Concurrent requests for the same cold artifact share one in-flight Codex call. Failed validation and failed runtime probes remain diagnostic evidence but are never warm cache hits. Token usage reports distinguish cold calls from validated artifact reuse.

## Tour bindings

Tours retain exact knowledge references for reproducibility during the compatibility period, but they also bind stable documentation subjects with `latest-compatible` or `pinned` policies. A tour states which subject, scenario, capability, and concept it teaches. The documentation snapshot resolves that intent to current evidence and a runtime profile.

This lets a component implementation or additive catalog change update the playground without rewriting an unaffected tour. Behavioral, breaking, or ambiguous changes trigger one focused assessment for only the bound pages and modules. The assessment chooses reuse, evidence rebind, or regeneration and is itself reusable while the semantic diff and teaching contract remain unchanged.

## Compatibility path

The current repository-knowledge snapshot remains the deterministic evidence layer. Schema v3 tours and adapter IDs remain readable while semantic bindings, runtime-profile references, and validated runtime providers are populated alongside them. Runtime execution resolves capabilities while retaining exact adapters as fallback providers.

Process-local lab sessions remain intentionally non-durable. Cached documentation and reusable runtime artifacts are repository understanding, not persisted learner sessions.
