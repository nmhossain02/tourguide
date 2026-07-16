# Tourguide authoring contract

## Lesson rubric

- Teach one repository-specific objective in roughly 3–8 minutes.
- Keep narrative below approximately 350 words.
- Pair each material claim with source, configuration, documentation, history, runtime, or clearly labeled inference evidence.
- Prefer one editable experiment with a resettable starting state.
- Use formative checks to compare observed and expected behavior; never score or gate the learner.
- Link to larger primary references rather than copying them.

## Evidence

Anchor source evidence to committed `HEAD` with a repository-relative path, line range or symbol when known, and content hash. Do not copy source into lesson prose. Use bounded history only around selected evidence and treat commit messages as clues.

## Runtime recipes

Prefer repository-native development commands. Use argv arrays with an explicit working directory, timeout, lifecycle, readiness probe, and cleanup. Declare filesystem writes, network scope, secret names, containers, and external systems. If prerequisites are missing, mark the interaction blocked and provide a diagnostic instead of fabricating output.

## Curriculum order

Publish local setup, configuration, run, test, health, and debugging lessons first. Generate learner-selected subsystem tracks afterward in ranked order. Leave unselected areas as outline-only suggestions.
