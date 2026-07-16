# Threat model

Tourguide analyzes repositories and executes lesson recipes, so repository content and generated instructions are untrusted input.

## Boundaries

- The browser server binds only to `127.0.0.1`, rejects non-loopback Host headers, and requires a random per-process token on every API request.
- Source reads are restricted to Git-tracked repository-relative paths. The default view is committed HEAD.
- Recipe commands use `spawn` with an argv array and `shell: false`. Working directories cannot escape the repository.
- External network or external-system declarations require a visible trusted-mode opt-in.
- Every recipe executes in a detached Git worktree with a temporary HOME. Tracked and untracked patches, changed paths, and undeclared writes are returned before removal.
- Output is capped in memory and is not persisted. Generated state is local-only and excluded through `.git/info/exclude`.

## Known alpha limitations

Capability declarations are authored metadata, not an operating-system sandbox. A dishonest executable can write outside its worktree by absolute path or access the network despite its declaration. Tourguide forwards `PATH`, an isolated temporary `HOME`, and explicitly declared recipe variables; host paths remain reachable without a future OS sandbox. Container orchestration and long-lived service supervision are represented in the schema but require further isolation before broad enablement.

Only run tours from repositories and authors you trust. Review recipe declarations and argv before execution.
