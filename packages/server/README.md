# @nmhossain02/tourguide

Tourguide maintains living, executable documentation for a Git branch, tag, or commit. It combines deterministic data-model, API, component, compute, and code/documentation viewers with Codex-authored tours and process-local contribution labs.

Tourguide has not been published to npm yet. From the repository root:

```sh
corepack pnpm install
corepack pnpm build
npm install --global ./packages/server

cd /path/to/repository
tourguide
```

Press **Explore codebase** to browse repository knowledge without an LLM call. Choose **Update and probe** to resolve documentation gaps and validate missing runtime providers, or press **Start tour** for a Codex-authored learning path. A learning focus, another Git ref, generation depth, and a model override are optional.

For a one-off run from a source checkout, use
`node plugins/tourguide/dist/tourguide.mjs /path/to/repository`.

Requirements: Node.js 22.13+, Git, and a recent authenticated Codex CLI (`codex login`). Tourguide reuses the local Codex subscription through `codex exec`; it does not require a separate model-provider key.

Generated snapshots and progress live under `.tourguide/` in the selected repository. Lab edits occur only in generated Git worktrees and can be verified, exported as patches, or retained on an unstaged `tourguide/*` branch. Lab sessions are process-local, and Tourguide never applies their edits to the active checkout.

Crash and generation diagnostics persist in `.tourguide/diagnostics/latest.json`.
Use the browser's **Diagnostics** button to copy a report, or run
`tourguide diagnostics /path/to/repository` after the process exits. Reports
include bounded process output and failure context with common credentials
redacted.
