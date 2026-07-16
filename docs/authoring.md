# Authoring contract

A useful Tourguide lesson should teach one observable idea in roughly three to seven minutes. It must include at least one interaction and should end with a learner-checkable observation.

Evidence is typed as source, config, runtime, history, documentation, or explicit inference. Ready lessons may not present unvalidated non-inference evidence. Source evidence should include its repository-relative path, authored revision, and content hash where practical.

Command interactions are argv arrays, never shell strings. Authors declare writes, network reach, secrets, containers, external systems, timeout, and lifecycle. Keep default recipes offline and self-contained. A recipe with external capabilities is unusable until the learner opts into trusted mode; a recipe declaring writes is run against a detached disposable worktree.

The recommended MCP sequence is:

1. `inspect_project`
2. `collect_priorities`
3. `begin_snapshot`
4. `write_outline`
5. `write_lessons` in small batches
6. `probe_recipe` for bounded runtime claims
7. `validate_snapshot`
8. `publish_snapshot`
9. `launch_app`

Publication is progressive: keep a coherent local-development track usable while optional areas deepen. Do not claim undocumented product intent as fact.
