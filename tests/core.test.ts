import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  TourStore,
  assessFreshness,
  buildStarterTour,
  inspectRepository,
  runRecipe,
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
    expect(tour.lessons.length).toBeGreaterThanOrEqual(3);
    expect(tour.lessons.every((lesson) => lesson.interactions.length > 0)).toBe(true);
  });
});

describe("freshness", () => {
  it("marks evidence-backed lessons and their dependents stale after HEAD changes", async () => {
    const root = await repository();
    const inventory = await inspectRepository(root);
    const snapshot = await buildStarterTour(inventory) as TourSnapshot;
    snapshot.lessons[0]!.evidence = [{
      id: "readme", kind: "source", label: "README", claim: "The entry point", path: "README.md",
      revision: inventory.head, validated: true,
    }];
    snapshot.lessons[1]!.prerequisites = [snapshot.lessons[0]!.id];
    await writeFile(join(root, "README.md"), "# changed\n");
    await exec("git", ["-C", root, "add", "README.md"]);
    await exec("git", ["-C", root, "commit", "-m", "change docs"]);
    const current = await inspectRepository(root);
    const report = await assessFreshness(root, snapshot, current.head);
    expect(report.changedFiles).toEqual(["README.md"]);
    expect(report.staleLessonIds).toContain(snapshot.lessons[0]!.id);
    expect(report.staleLessonIds).toContain(snapshot.lessons[1]!.id);
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
});
