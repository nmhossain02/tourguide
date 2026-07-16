# Authoring contract

A useful Tourguide lesson should teach one observable idea in roughly three to seven minutes. It must include at least one interaction and should end with a learner-checkable observation.

Evidence is typed as source, config, runtime, history, documentation, or explicit inference. Ready lessons may not present unvalidated non-inference evidence. Source evidence must use `read_evidence` and include its repository-relative path, authored revision, and full-file content hash.

Command interactions are argv arrays, never shell strings. Authors declare writes, network reach, secrets, containers, external systems, timeout, and lifecycle. Keep default recipes offline and self-contained. A recipe with external capabilities is unusable until the learner opts into trusted mode. Every recipe runs against a detached disposable worktree with a temporary HOME; actual changed paths and undeclared writes are reported before the workspace is removed.

The recommended MCP sequence is:

1. `inspect_project` with the repository's absolute path
2. `collect_priorities`; if empty, `launch_app`, let the learner save choices, then read again
3. `begin_snapshot`
4. `write_outline`
5. `write_lessons` in small batches
6. `probe_recipe` for bounded runtime claims
7. `validate_snapshot`
8. `publish_snapshot`
9. `launch_app` if it is not already open

Publication is progressive: keep a coherent local-development track usable while optional areas deepen. Do not claim undocumented product intent as fact.

For refreshes, use `assess_freshness` followed by `begin_refresh`. The refresh draft advances unchanged evidence to the new HEAD only when Git proves those paths unchanged, and marks affected or unverifiable lessons stale. Publication requires ready lessons, one track assignment per lesson, an acyclic prerequisite graph, and a core priority-0 track followed by unique ascending priorities.
