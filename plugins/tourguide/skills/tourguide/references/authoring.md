# Tourguide authoring contract

## Lesson rubric

- Teach one repository-specific objective in roughly 3–8 minutes.
- Keep narrative below approximately 350 words.
- Pair each material claim with source, configuration, documentation, history, runtime, or clearly labeled inference evidence.
- Prefer one typed command-input experiment with a resettable starting state. Source panes are for comparison and evidence, not executable scratch edits.
- Use formative checks to compare observed and expected behavior; never score or gate the learner.
- Link to larger primary references rather than copying them.

## Evidence

Anchor source evidence to committed `HEAD` with a repository-relative path, line range or symbol when known, and content hash. Do not copy source into lesson prose. Use bounded history only around selected evidence and treat commit messages as clues.

## Runtime recipes

Prefer repository-native development commands. Use argv arrays with an explicit working directory and timeout. Alpha recipes are bounded runs; a `service` lifecycle is still terminated by its timeout and is not a production supervisor. Declare filesystem writes, network scope, secret names, containers, and external systems. Every run uses a disposable worktree and temporary HOME, but capability metadata is still not an operating-system sandbox. If prerequisites are missing during drafting, mark the lesson blocked and provide a diagnostic instead of fabricating output; resolve or omit it before publication.

## Curriculum order

Publish a coherent local setup, configuration, run, test, health, and debugging track first. Generate learner-selected subsystem tracks afterward in ranked order. Suggested tracks may be described in track summaries, but `lessonIds` must contain only lessons that currently exist.
