# Threat model

Tourguide analyzes repositories and executes lesson recipes, so repository content and generated instructions are untrusted input.

## Boundaries

- The browser server binds only to `127.0.0.1`, rejects non-loopback Host headers, and requires a random per-process token on every API request.
- Source reads are restricted to Git-tracked repository-relative paths. The default view is the snapshot's selected commit.
- Codex generation receives a disposable filtered copy of that commit. Common secret paths, binary files, `node_modules` trees, and oversized files are omitted. Codex starts with ambient configuration and project rules ignored and web search disabled.
- `codex exec` output is constrained by JSON schema, then normalized and validated against the real repository commit before publication.
- Recipe commands use `spawn` with an argv array and `shell: false`. Working directories cannot escape the repository.
- External network or external-system declarations require a visible trusted-mode opt-in.
- Every recipe executes in a detached Git worktree with a temporary HOME. Tracked and untracked patches, changed paths, and undeclared writes are returned before removal.
- Browser lab editing is limited to declared regular, non-symlink tracked text files. Lab sessions are process-local and expire after 15 minutes of inactivity. Reset recreates the selected commit, and export produces a patch; the app never applies it.
- Lab services receive allocated loopback ports, bounded logs, an isolated HOME, and process-group termination. HTTP workbench requests are restricted to a port allocated to that lab.
- LLM-generated runtime providers are constrained to structured files, recipes, loopback services, and capability invocations. Tourguide materializes them in a detached worktree, provides an isolated HOME without ambient environment variables, executes a representative probe, and reuses only a successful artifact.
- SQLite paths and editor paths are contained inside the lab worktree. Data mutation requires an explicit `allowWrite` input. Editor launch uses an argv array with `shell: false` and only a detected VS Code command or a user-configured command.
- "Keep on branch" creates a validated `tourguide/*` branch in the lab worktree and leaves changes unstaged. It does not commit, push, merge, or change the active checkout.
- Recipe output is capped in memory and is not persisted. Generated state and redacted, bounded diagnostics are local-only. Tourguide never stages them and adds `/.tourguide/` to `.git/info/exclude` in standard checkouts.

## Known alpha limitations

Capability declarations are authored metadata, not an operating-system sandbox. A dishonest executable can write outside its worktree by absolute path or access the network despite its declaration. Tourguide forwards `PATH`, an isolated temporary `HOME`, and explicitly declared recipe variables; host paths remain reachable without a future OS sandbox.

Generated provider probes execute code proposed by Codex. Structured validation, detached worktrees, isolated HOME values, and declared loopback networking reduce accidental impact but do not prevent a malicious process from reading host paths or opening undeclared network connections. Starting a tour or choosing **Update and probe** is consent to run these probes. Use this capability only with repositories you trust until an operating-system or container sandbox is mandatory.

The Codex generation process runs in Codex's read-only sandbox with network and approvals disabled, but read-only mode is not a confidentiality boundary: it may still be able to read host files outside the filtered repository, and it retains access to its own authentication/session directory so it can reuse the user's subscription. A malicious repository can contain prompt injection. Only generate tours for repositories you trust until Tourguide adds a separate unprivileged OS/container boundary.

Container orchestration remains behind trusted mode and requires further isolation before broad enablement. Process-local loopback service supervision is supported, but capability declarations are still not an operating-system sandbox.

Only run tours from repositories and authors you trust. Review recipe declarations and argv before execution.
