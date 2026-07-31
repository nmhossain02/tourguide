# Threat model

Tourguide analyzes repositories and executes lesson recipes, so repository content and generated instructions are untrusted input.

## Boundaries

- The browser server binds only to `127.0.0.1`, rejects non-loopback Host headers, and requires a random per-process token on every API request.
- Source reads are restricted to Git-tracked repository-relative paths. The default view is the snapshot's selected commit.
- Codex generation receives a disposable filtered copy of that commit. Common secret paths, binary files, vendor trees, oversized files, ambient Codex configuration, project rules, and web search are excluded.
- `codex exec` output is constrained by JSON schema, then normalized and validated against the real repository commit before publication.
- Recipe commands use `spawn` with an argv array and `shell: false`. Working directories cannot escape the repository.
- External network or external-system declarations require a visible trusted-mode opt-in.
- Every recipe executes in a detached Git worktree with a temporary HOME. Tracked and untracked patches, changed paths, and undeclared writes are returned before removal.
- Browser exercise editing is limited to declared regular, non-symlink tracked text files. Reset recreates the selected commit, and export produces a patch; the app never applies it.
- Output is capped in memory and is not persisted. Generated state is local-only and excluded through `.git/info/exclude`.

## Known alpha limitations

Capability declarations are authored metadata, not an operating-system sandbox. A dishonest executable can write outside its worktree by absolute path or access the network despite its declaration. Tourguide forwards `PATH`, an isolated temporary `HOME`, and explicitly declared recipe variables; host paths remain reachable without a future OS sandbox.

The Codex generation process runs in Codex's read-only sandbox with network and approvals disabled, but read-only mode is not a confidentiality boundary: it may still be able to read host files outside the filtered repository, and it retains access to its own authentication/session directory so it can reuse the user's subscription. A malicious repository can contain prompt injection. Only generate tours for repositories you trust until Tourguide adds a separate unprivileged OS/container boundary.

Container orchestration and long-lived service supervision require further isolation before broad enablement.

Only run tours from repositories and authors you trust. Review recipe declarations and argv before execution.
