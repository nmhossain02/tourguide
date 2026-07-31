# @nmhossain02/tourguide

Tourguide turns a Git branch, tag, or commit into an interactive, Codex-authored codebase curriculum with short pages, runnable demonstrations, and disposable exercise workspaces.

Tourguide has not been published to npm yet. From the repository root:

```sh
corepack pnpm install
corepack pnpm build
npm install --global ./packages/server

cd /path/to/repository
tourguide
```

Then press **Start tour**. A learning focus, another Git ref, and a model override are all optional.

For a one-off run from a source checkout, use
`node plugins/tourguide/dist/tourguide.mjs /path/to/repository`.

Requirements: Node.js 22+, Git, and a recent authenticated Codex CLI (`codex login`). Tourguide reuses the local Codex subscription through `codex exec`; it does not require a separate model-provider key.

Generated snapshots and progress live under `.tourguide/` in the selected repository. Exercise edits occur only in generated Git worktrees and can be exported as patches; Tourguide never applies them to the active checkout.

Crash and generation diagnostics persist in `.tourguide/diagnostics/latest.json`.
Use the browser's **Diagnostics** button to copy a report, or run
`tourguide diagnostics /path/to/repository` after the process exits. Reports
include bounded process output and failure context with common credentials
redacted.
