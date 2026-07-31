import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  ExerciseWorkspaceManager,
  TourStore,
  assessFreshness,
  buildStarterTour,
  inspectRepository,
  inspectRepositoryAt,
  parseProgress,
  parseSnapshot,
  runRecipe,
  validateSnapshot,
  type TourSnapshot,
} from "../packages/core/src/index.js";

const exec = promisify(execFile);
const temporary: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tourguide-test-"));
  temporary.push(root);
  await exec("git", ["init", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
  await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "node test.js" } }));
  await writeFile(join(root, "README.md"), "# fixture\n");
  await writeFile(join(root, "test.js"), "console.log('ok')\n");
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "commit", "-m", "initial"]);
  return root;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("repository discovery and state", () => {
  it("discovers committed structure while reporting local changes separately", async () => {
    const root = await repository();
    await writeFile(join(root, "README.md"), "# live change\n");
    const inventory = await inspectRepository(root);
    expect(inventory.branch).toBe("main");
    expect(inventory.trackedFiles).toContain("package.json");
    expect(inventory.dirtyFiles).toContain("README.md");
    expect(inventory.commands.test).toBe("node test.js");

    const store = new TourStore(root);
    await store.initialize();
    await store.savePreferences({ priorities: ["backend"], goals: ["on-call"], allowCodexAdapter: false });
    expect((await store.preferences()).goals).toEqual(["on-call"]);
    expect(await readFile(join(root, ".git", "info", "exclude"), "utf8")).toContain("/.tourguide/");
  });

  it("builds a playable local-development starter tour", async () => {
    const root = await repository();
    const tour = await buildStarterTour(await inspectRepository(root));
    expect(tour.status).toBe("published");
    expect(tour.modules).toHaveLength(1);
    expect(tour.pages.length).toBeGreaterThanOrEqual(6);
    expect(tour.pages.every((page) => page.interactions.length > 0)).toBe(true);
    expect((await validateSnapshot(tour, root)).valid).toBe(true);
  });

  it("inspects an explicit historical ref without reading the newer working tree", async () => {
    const root = await repository();
    const first = await inspectRepository(root);
    await writeFile(join(root, "new.ts"), "export const newer = true;\n");
    await exec("git", ["-C", root, "add", "new.ts"]);
    await exec("git", ["-C", root, "commit", "-m", "new source"]);
    const historical = await inspectRepositoryAt(root, first.head);
    expect(historical.head).toBe(first.head);
    expect(historical.ref).toBe(first.head);
    expect(historical.trackedFiles).not.toContain("new.ts");
  });
});

describe("freshness", () => {
  it("marks evidence-backed pages, modules, and dependents stale after HEAD changes", async () => {
    const root = await repository();
    const inventory = await inspectRepository(root);
    const snapshot = await buildStarterTour(inventory) as TourSnapshot;
    snapshot.pages[0]!.evidence = [{
      id: "readme", kind: "source", label: "README", claim: "The entry point", path: "README.md",
      revision: inventory.head, validated: true,
    }];
    snapshot.pages[1]!.prerequisites = [snapshot.pages[0]!.id];
    await writeFile(join(root, "README.md"), "# changed\n");
    await exec("git", ["-C", root, "add", "README.md"]);
    await exec("git", ["-C", root, "commit", "-m", "change docs"]);
    const current = await inspectRepository(root);
    const report = await assessFreshness(root, snapshot, current.head);
    expect(report.changedFiles).toEqual(["README.md"]);
    expect(report.stalePageIds).toContain(snapshot.pages[0]!.id);
    expect(report.stalePageIds).toContain(snapshot.pages[1]!.id);
    expect(report.staleModuleIds).toContain(snapshot.modules[0]!.id);
  });

  it("invalidates every page when authored history is unavailable", async () => {
    const root = await repository();
    const snapshot = await buildStarterTour(await inspectRepository(root));
    snapshot.anchor.commit = "0000000000000000000000000000000000000000";
    const report = await assessFreshness(root, snapshot, (await inspectRepository(root)).head);
    expect(report.historyAvailable).toBe(false);
    expect(report.stalePageIds).toHaveLength(snapshot.pages.length);
    expect(report.reason).toContain("review every page");
  });
});

describe("v1 migration", () => {
  it("turns flat lessons into module pages and preserves progress", () => {
    const revision = "a".repeat(40);
    const migrated = parseSnapshot({
      schemaVersion: 1,
      id: "old",
      projectName: "fixture",
      repositoryRoot: "/tmp/fixture",
      head: revision,
      branch: "main",
      generatedAt: new Date().toISOString(),
      generator: "old",
      status: "published",
      tracks: [{ id: "core", title: "Core", summary: "", kind: "core", priority: 0, lessonIds: ["one"] }],
      lessons: [{
        id: "one", objectiveId: "one", title: "One", objective: "Learn one", estimatedMinutes: 3,
        narrative: "A page.", status: "ready", prerequisites: [], evidence: [],
        interactions: [{ type: "data", title: "One", columns: ["x"], rows: [{ x: 1 }] }],
        references: [],
      }],
      dependencies: {},
    });
    expect(migrated.migrated).toBe(true);
    expect(migrated.snapshot.modules[0]?.pageIds).toEqual(["one"]);
    expect(migrated.snapshot.pages[0]?.id).toBe("one");
    const progress = parseProgress({
      lessons: { one: { viewed: true, experimented: true, revisit: false, updatedAt: new Date().toISOString() } },
    });
    expect(progress.progress.pages.one?.demonstrated).toBe(true);
  });
});

describe("recipe runtime", () => {
  it("materializes only declared typed inputs", async () => {
    const root = await repository();
    const recipe = {
      id: "input", title: "input", command: "node", args: ["-e", "console.log(process.env.COUNT)"], cwd: ".",
      lifecycle: "oneshot" as const, timeoutMs: 2_000, env: { COUNT: "{{count}}" },
      inputs: [{ id: "count", label: "Count", type: "select" as const, default: "1", options: ["1", "3"] }],
      capabilities: { writes: [], network: "none" as const, secrets: [], containers: false, externalSystems: [] },
    };
    expect((await runRecipe(root, recipe, false, { count: "3" })).stdout.trim()).toBe("3");
    await expect(runRecipe(root, recipe, false, { count: "99" })).rejects.toThrow("declared options");
  });

  it("requires approval for external capabilities", async () => {
    const root = await repository();
    await expect(runRecipe(root, {
      id: "external", title: "external", command: "node", args: ["-e", "console.log('no')"], cwd: ".",
      lifecycle: "oneshot", timeoutMs: 2_000, env: {},
      capabilities: { writes: [], network: "external", secrets: [], containers: false, externalSystems: [] },
    })).rejects.toThrow("trusted-mode");
  });

  it("requires approval for declared host-affecting capabilities", async () => {
    const root = await repository();
    const base = {
      id: "host", title: "host", command: "node", args: ["-e", "console.log('no')"], cwd: ".",
      lifecycle: "oneshot" as const, timeoutMs: 2_000, env: {}, inputs: [],
      capabilities: { writes: [], network: "none" as const, secrets: [], containers: false, externalSystems: [] },
    };
    await expect(runRecipe(root, {
      ...base,
      capabilities: { ...base.capabilities, containers: true },
    })).rejects.toThrow("trusted-mode");
    await expect(runRecipe(root, {
      ...base,
      capabilities: { ...base.capabilities, writes: ["/tmp/tourguide-host-write"] },
    })).rejects.toThrow("trusted-mode");
    await expect(runRecipe(root, {
      ...base,
      capabilities: { ...base.capabilities, writes: ["../outside.txt"] },
    })).rejects.toThrow("trusted-mode");
  });

  it("runs declared writes in a disposable Git worktree and returns the patch", async () => {
    const root = await repository();
    const original = await readFile(join(root, "README.md"), "utf8");
    const result = await runRecipe(root, {
      id: "edit", title: "edit", command: "node", args: ["-e", "require('fs').writeFileSync('README.md', '# experiment\\n')"], cwd: ".",
      lifecycle: "oneshot", timeoutMs: 5_000, env: {},
      capabilities: { writes: ["README.md"], network: "none", secrets: [], containers: false, externalSystems: [] },
    });
    expect(result.exitCode).toBe(0);
    expect(result.isolated).toBe(true);
    expect(result.patch).toContain("# experiment");
    expect(await readFile(join(root, "README.md"), "utf8")).toBe(original);
  });

  it("isolates undeclared writes, captures new files, and hides the host HOME", async () => {
    const root = await repository();
    const result = await runRecipe(root, {
      id: "undeclared", title: "undeclared", command: "node",
      args: ["-e", "require('fs').writeFileSync('new.txt', process.env.HOME)"], cwd: ".",
      lifecycle: "oneshot", timeoutMs: 5_000, env: {},
      capabilities: { writes: [], network: "none", secrets: [], containers: false, externalSystems: [] },
    });
    expect(result.isolated).toBe(true);
    expect(result.changedFiles).toEqual(["new.txt"]);
    expect(result.undeclaredWrites).toEqual(["new.txt"]);
    expect(result.patch).toContain("new.txt");
    expect(result.patch).not.toContain(process.env.HOME ?? "__missing_home__");
    await expect(readFile(join(root, "new.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("exercise workspaces", () => {
  it("keeps browser edits isolated and exports only an allowed patch", async () => {
    const root = await repository();
    const snapshot = await buildStarterTour(await inspectRepository(root));
    const page = snapshot.pages.find((candidate) => candidate.kind === "exercise")!;
    page.exercise = {
      ...page.exercise!,
      mode: "patch",
      allowedPaths: ["README.md"],
    };
    page.interactions = [{ type: "source", path: "README.md", editable: true }];
    const manager = new ExerciseWorkspaceManager(root);
    const created = await manager.create(snapshot, page);
    await manager.write(created.session.id, "README.md", "# exercise edit\n");
    expect(await manager.patch(created.session.id)).toContain("# exercise edit");
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("# fixture\n");
    await expect(manager.write(created.session.id, "package.json", "{}")).rejects.toThrow("not editable");
    await manager.remove(created.session.id);
  });
});
