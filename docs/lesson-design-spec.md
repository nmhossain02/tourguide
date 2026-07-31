# Tourguide lesson design specification

Status: implemented baseline in Tourguide v0.2  
Research baseline: A Tour of Go at `golang/website` commit `1137bfafedc6d402a8bf2472281efd6477b45d55` (2026-07-20)  
Scope: curriculum shape, authoring behavior, validation, and learner navigation

## Problem

Tourguide currently models a track as a flat list of independent 3–8 minute lessons. Each lesson has one objective, no more than 350 narrative words, and at least one interaction. This produces useful introductions, but it encourages an author to sample a repository rather than teach it. A four-lesson starter tour can identify the repository, Git state, detected surfaces, and history without explaining how the software actually works or how to change it safely.

The desired change is not longer prose. It is a larger, deliberately sequenced curriculum made of small pages.

## What A Tour of Go does

The official tour describes itself as a series of slides and exercises with editable, runnable examples. Its table of contents groups material first into broad modules and then into named lessons. In the studied source revision, seven lesson files contain 101 pages, 92 `.play` examples, and 12 pages explicitly titled as exercises.

| Lesson file | Pages | Runnable examples | Exercise pages |
| --- | ---: | ---: | ---: |
| Welcome | 3 | 1 | 0 |
| Packages, variables, and functions | 17 | 16 | 0 |
| Flow control | 14 | 13 | 1 |
| More types | 27 | 26 | 3 |
| Methods and interfaces | 26 | 25 | 5 |
| Generics | 3 | 2 | 0 |
| Concurrency | 11 | 9 | 3 |

The design patterns worth copying are:

1. **Hierarchy creates breadth.** A table of contents exposes the whole curriculum, while a learner sees one page at a time.
2. **Pages stay atomic.** A page usually introduces one concept with a short explanation and one example. Closely related pages are adjacent, so the sequence provides depth.
3. **Examples dominate the experience.** Almost every concept page has a runnable program, and the learner is repeatedly prompted to change a value or remove a construct and observe the result.
4. **Complexity is staged.** Primitives precede compositions: arrays precede slices, methods precede interfaces, goroutines precede channels, and channels precede concurrency exercises.
5. **Exercises follow concept clusters.** Exercises ask the learner to combine recently introduced ideas. A difficult exercise may use one page for context and another for the task and editor.
6. **Navigation is continuous.** Previous/next actions cross lesson boundaries, every page shows its position, and the complete table of contents remains available.
7. **Modules close explicitly.** Most end with a congratulations page; the final module points to deeper primary material.

These observations come from the [live tour](https://go.dev/tour/), its [table of contents](https://go.dev/tour/list), the official [tour source](https://go.googlesource.com/website/+/master/_content/tour/), and the Go team's description of its hands-on structure in [Learn Go from your browser](https://go.dev/blog/tour).

## Why a repository tour cannot copy it literally

A language tour has a stable, universal syllabus and self-contained programs. A software package has a versioned implementation, uneven documentation, role-specific learning goals, and behaviors distributed across source, configuration, processes, data stores, and external systems.

Tourguide must therefore preserve the Go tour's pacing while changing its curriculum logic:

- The curriculum is generated from repository evidence and learner goals, not from a universal topic list.
- Source examples must be authentic and anchored to committed `HEAD`; explanatory snippets must not replace repository source.
- A useful concept may span multiple files or processes, so pages can use source, command, browser, data, and topology views.
- Exercises must run in disposable worktrees or use read-only observations. They must not turn the active checkout into a playground.
- Secrets, containers, network access, and external systems may be unavailable. A blocked experiment needs a diagnostic or a safe local substitute, never invented output.
- A large monorepo cannot be exhaustive. The tour must state what it covers, what it omits, and why.
- Refresh operates at evidence-backed page granularity and rolls staleness up to its containing module and track.

## Proposed curriculum model

Tourguide v2 should use four levels:

```text
Tour
└── Track: a route selected for a learner goal
    └── Module: a coherent capability or subsystem
        └── Page: one step in a teaching sequence
            └── Interaction: evidence or an experiment
```

### Track

A track is a purposeful route, not a source directory. The core track teaches the minimum path to become productive locally. Selected tracks teach work-relevant capabilities such as “change request authentication” or “operate the ingestion pipeline.” Suggested tracks advertise uncovered routes but contain no published pages.

A published tour must contain:

- one core track at priority 0;
- the learner-selected tracks in priority order;
- a coverage statement for every published track;
- explicit omissions when a requested area cannot be supported by evidence or safe experiments.

### Module

A module is the package equivalent of a Go tour lesson: a substantial, ordered concept cluster that a learner can complete in roughly 20–60 minutes over multiple sittings.

Each module must declare:

- one capability-level outcome;
- why that outcome matters to the learner's saved goal;
- prerequisites;
- an ordered list of pages;
- primary repository surfaces and runtime behaviors covered;
- a completion task or final synthesis page;
- known gaps and blocked experiments.

A normal module contains 6–15 pages. Shorter modules require an author-supplied reason; longer modules should be split at a natural capability boundary. These are quality signals, not reasons to pad content.

### Page

A page is the package equivalent of a Go tour slide. It should take 1–5 minutes, teach one step, and remain useful only as part of its surrounding sequence. Most pages should use roughly 40–180 words of narrative; the existing 350-word ceiling remains a hard maximum.

Every page has exactly one of these kinds:

- `orientation`: establish vocabulary, boundaries, or a map;
- `concept`: explain one repository-specific mechanism;
- `walkthrough`: follow one step in an end-to-end path;
- `demo`: predict and observe real behavior;
- `exercise`: make, diagnose, or explain a bounded change;
- `recap`: connect the module's ideas and identify next steps.

`orientation` and `recap` pages may use a topology or data interaction. All other page kinds should have a source or runtime interaction. “Read this file” alone is not an exercise.

### Sequence shape

Each substantial module should follow this learning arc, omitting a stage only with a stated reason:

1. **Context:** user-visible purpose, boundaries, and vocabulary.
2. **Structure:** important entry points and ownership.
3. **Flow:** a representative request, event, command, or data path.
4. **Behavior:** run or observe the normal path.
5. **Failure:** see how the package reports, contains, or debugs a realistic failure.
6. **Change:** complete a bounded task and verify it.
7. **Recap:** explain the path and point to the next module.

This is the repository analogue of the Go tour's progression from primitive syntax to composed exercises.

## Breadth requirements

Before writing pages, the author must produce a coverage map. Detection of a directory is not evidence that it deserves a lesson, and choosing one source file per area is not adequate coverage.

The core track should address every applicable row below:

| Capability | Minimum evidence of coverage |
| --- | --- |
| Orientation | purpose, repository boundaries, vocabulary, ownership clues |
| Setup | prerequisites, install/bootstrap, configuration sources |
| Run | primary entry point and one successful local path |
| Architecture | component map plus one end-to-end execution path |
| Data and state | important state, schemas, migrations, caches, or a stated non-applicability |
| Test | test layers, representative test, and how to target it |
| Debug | one realistic failure signal and diagnostic path |
| Change workflow | a bounded change, verification, and repository checks |
| Delivery/operations | CI, build, packaging, deployment, or an explicit omission |

A selected subsystem track should cover its boundary, inputs/outputs, main path, important state, failure behavior, tests, extension points, and operational concerns when applicable.

The outline validator should report coverage as `covered`, `not-applicable`, `blocked`, or `omitted-with-reason`. It should reject a core outline with silent gaps. This makes breadth reviewable without requiring every repository to have the same curriculum.

## Interaction and exercise model

The Go tour uses one editable sandbox for both demonstration and exercise. Tourguide needs several safe equivalents.

### Demonstrations

A demonstration asks the learner to predict an observable result, run a bounded recipe, and compare the result with an evidence-backed expectation. Inputs should vary meaningful behavior rather than merely the amount of output.

Examples include selecting a valid versus invalid configuration value, targeting one test versus a suite, or sending two local requests that exercise different branches.

### Exercises

Every exercise must define:

- the task in terms of an observable outcome;
- a resettable starting state;
- the files or inputs the learner may change;
- a verification recipe;
- one or more progressive hints;
- reset behavior;
- a solution explanation or evidence-backed comparison, hidden until requested.

Supported exercise modes should be:

1. `observe`: vary inputs and explain runtime behavior;
2. `trace`: locate or order the steps in a real code path;
3. `diagnose`: use logs, failures, or tests to identify a cause;
4. `patch`: edit explicitly allowed files in a disposable worktree and run verification;
5. `design`: propose an extension and compare it with documented constraints and source evidence.

`patch` is the closest analogue to the Go editor, but it must never edit the active checkout. External writes remain out of scope. A solution is not marked correct globally; verification and knowledge checks stay formative and non-blocking.

Each normal module should contain at least one demonstration and one synthesis exercise. A selected track should end with a task that crosses more than one page's concepts. If runtime prerequisites prevent this, the module records the gap and supplies a read-only `trace` or `diagnose` alternative.

## Proposed schema changes

The names below describe the contract; implementation may preserve internal v1 names during migration.

```ts
type PageKind =
  | "orientation"
  | "concept"
  | "walkthrough"
  | "demo"
  | "exercise"
  | "recap";

interface Module {
  id: string;
  title: string;
  outcome: string;
  relevance: string;
  estimatedMinutes: number;
  prerequisites: string[];
  pageIds: string[];
  surfaces: string[];
  gaps: Array<{ area: string; status: "not-applicable" | "blocked" | "omitted"; reason: string }>;
}

interface Page {
  id: string;
  moduleId: string;
  kind: PageKind;
  title: string;
  objective: string;
  estimatedMinutes: number;
  narrative: string;
  evidence: EvidenceRef[];
  interactions: Interaction[];
  knowledgeCheck?: KnowledgeCheck;
  exercise?: Exercise;
  references: Reference[];
}

interface Exercise {
  mode: "observe" | "trace" | "diagnose" | "patch" | "design";
  task: string;
  allowedPaths: string[];
  hints: string[];
  verificationRecipeId?: string;
  expectedObservation: string;
  solutionExplanation?: string;
  reset: "rerun" | "fresh-worktree";
}

interface CoverageEntry {
  capability: string;
  status: "covered" | "not-applicable" | "blocked" | "omitted";
  moduleIds: string[];
  reason?: string;
}
```

Tracks should reference `moduleIds` rather than directly referencing pages. Progress should record page views, attempted demonstrations, attempted exercises, and module completion separately. Merely opening a page is not completion.

## Authoring workflow

The agent workflow should change from “outline tracks, then write small lesson batches” to:

1. Inspect the repository and collect learner goals.
2. Build an evidence-backed surface inventory and identify one representative execution path per selected capability.
3. Write a coverage map, including explicit gaps.
4. Outline tracks and modules before naming individual pages.
5. Expand each module into a dependency-ordered page sequence using the context-to-recap arc.
6. Read evidence for a complete module before drafting its pages, so adjacent pages form one explanation instead of isolated file summaries.
7. Draft and validate one module at a time.
8. Probe demonstrations and verification recipes when runtime evidence matters.
9. Publish the core track module-by-module, then selected tracks in priority order.

The author should prefer a representative “spine”—for example one HTTP request, CLI invocation, job, or library call—that reappears across pages. This gives a package tour the continuity that the evolving examples give a language tour.

## Validation rules

Publication validation should enforce:

- every published page belongs to exactly one module and every module to exactly one track;
- prerequisites are acyclic and appear before their dependents in the default route;
- a core track has no silent coverage gaps;
- a normal module has a demonstration and synthesis exercise, or a recorded reason;
- concept, walkthrough, demo, and exercise pages have source or runtime interaction;
- every exercise has an observable task, reset behavior, hints, and an expected observation;
- patch exercises declare allowed paths and use disposable worktrees;
- material claims remain evidence-backed and anchored to the snapshot revision;
- narrative remains at or below 350 words per page;
- external references remain primary and limited; they deepen a page rather than substitute for it;
- module and track estimates equal the sum of their published pages;
- ready pages contain no invented runtime output or unresolved blocked interaction.

Warnings, rather than hard errors, should flag modules outside the 6–15 page range, repeated use of the same evidence without a new objective, pages over 180 words, tracks without a cross-concept task, and coverage concentrated in a single file.

## Learner experience

The browser should copy the Go tour's navigational strengths:

- show `Track / Module / Page` and the position within both module and tour;
- group the table of contents by module and allow modules to collapse;
- let previous/next cross module boundaries;
- distinguish viewed, demonstrated, exercise-attempted, completed, stale, and blocked states;
- provide a module overview before its first page and a recap after its last page;
- keep interactions beside the explanation and preserve learner edits within an exercise session;
- offer reset and progressive hints for exercises;
- show coverage and explicit omissions from the track overview;
- preserve open navigation: prerequisites guide the route but do not lock pages.

## Migration and delivery

Implement this in four increments:

1. **Authoring depth:** update the generation prompts and authoring contract to require coverage maps, multi-page module outlines, the sequence arc, and module-level drafting.
2. **Hierarchy:** add v2 modules, page kinds, coverage, module navigation, and progress migration. A v1 track migrates to one generated module and each v1 lesson becomes a page.
3. **Exercises:** add exercise metadata, hints, verification, and disposable-worktree patch editing. Retain command-input demonstrations as the safe default.
4. **Quality and refresh:** add breadth warnings, module roll-up freshness, module-level regeneration, and fixture-based conformance tests for a complete core and selected track.

The first increment should improve generated tours without waiting for UI or runtime changes. The later increments make the deeper structure visible and bring hands-on package changes closer to the Go tour's editable examples.

## Acceptance criteria

The design is successful when, for the polyglot fixture and at least one real repository:

- the generated core track covers every applicable core capability or explains the gap;
- each substantial module forms a 6–15 page sequence rather than a set of unrelated file summaries;
- the learner follows one representative behavior from entry point through state, failure, test, and change;
- every substantial module contains a verified demonstration and a synthesis exercise or a justified safe fallback;
- the UI exposes hierarchy and meaningful progress without gating navigation;
- refresh can stale and regenerate affected pages without rewriting unrelated modules;
- validation catches shallow breadth, unsafe exercises, unsupported claims, and broken ordering before publication.
