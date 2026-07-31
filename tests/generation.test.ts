import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { TourStore } from "../packages/core/src/index.js";
import { CodexExecRunner } from "../packages/server/src/codex-exec.js";
import { TourGenerator } from "../packages/server/src/generation.js";

const exec = promisify(execFile);
const temporary: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tourguide-generation-"));
  temporary.push(root);
  await exec("git", ["init", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
  await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
  await writeFile(join(root, "README.md"), "# fixture\n");
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "commit", "-m", "initial"]);
  return root;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function recipe(id: string) {
  return {
    id,
    title: "Inspect repository",
    command: "git",
    args: ["status", "--short"],
    cwd: ".",
    lifecycle: "oneshot",
    timeoutMs: 10_000,
    env: [{ name: "MODE", value: "test" }],
    inputs: [],
    capabilities: {
      writes: [],
      network: "none",
      secrets: [],
      containers: false,
      externalSystems: [],
    },
    expected: "Git reports the isolated repository state.",
  };
}

async function fakeCodex(root: string, options: {
  invalidFirstModule?: boolean;
  invalidExercisePath?: boolean;
  invalidPagePrerequisite?: boolean;
  invalidPlanPrerequisite?: boolean;
  invalidEditableSource?: boolean;
  modulePrerequisite?: boolean;
} = {}): Promise<string> {
  const pages = [
    ["context", "orientation"],
    ["structure", "concept"],
    ["flow", "walkthrough"],
    ["behavior", "demo"],
    ["diagnose", "exercise"],
    ["recap", "recap"],
  ] as const;
  const coverage = [
    "orientation", "setup", "run", "architecture", "data and state",
    "test", "debug", "change workflow", "delivery and operations",
  ].map((capability) => ({
    capability,
    status: capability === "orientation" ? "covered" : "omitted",
    moduleIds: capability === "orientation" ? ["foundations"] : [],
    ...(capability === "orientation" ? {} : { reason: "Fixture scope." }),
  }));
  const plan = {
    projectName: "fixture",
    summary: "A fixture curriculum.",
    tracks: [{
      id: "core",
      title: "Core",
      summary: "Core route.",
      kind: "core",
      priority: 0,
      moduleIds: ["foundations"],
    }],
    modules: [{
      id: "foundations",
      trackId: "core",
      title: "Foundations",
      outcome: "Understand the fixture.",
      relevance: "It is the whole fixture.",
      prerequisites: options.invalidPlanPrerequisite ? ["Node.js installed locally"] : [],
      surfaces: ["README.md"],
      gaps: [],
      pages: pages.map(([id, kind]) => ({
        id,
        kind,
        title: id,
        objective: `Understand ${id}.`,
        interactionIntent: "Inspect repository state.",
      })),
    }],
    coverage,
  };
  const generated = {
    moduleId: "foundations",
    pages: pages.map(([id, kind], index) => ({
      id,
      kind,
      title: id,
      objective: `Understand ${id}.`,
      estimatedMinutes: 2,
      narrative: `This fixture page teaches ${id} through a bounded repository observation.`,
      prerequisites: index === 0
        ? options.invalidPagePrerequisite ? ["Node.js installed locally"] : []
        : [pages[index - 1]![0]],
      evidence: [{
        id: `${id}-inference`,
        kind: index === 0 ? "runtime" : index === 1 ? "source" : "inference",
        label: "Fixture inference",
        claim: "This is explicitly an inference for the test fixture.",
        validated: index === 1,
        ...(index === 1 ? { path: "README.md", lineStart: 2, lineEnd: 1 } : {}),
      }],
      interactions: [
        ...(index === 1 ? [options.invalidEditableSource ? {
          type: "source",
          path: "README.md",
          editable: true,
          lineStart: 2,
          lineEnd: 1,
        } : {
          type: "topology",
          nodes: [{ id: "fixture", label: "Fixture" }],
          edges: [],
        }] : [{ type: "command", recipe: recipe(`${id}-status`) }]),
        ...(index === 0 ? [{ type: "data", title: "Fixture table", columns: ["key", "value"], rows: [["mode", "test"]] }] : []),
      ],
      ...(kind === "exercise" ? {
        exercise: {
          mode: "diagnose",
          task: "Inspect status and explain the result.",
          allowedPaths: [],
          hints: ["Look at the status columns."],
          verificationRecipe: recipe("verify-status"),
          expectedObservation: "The generated repository is clean.",
          reset: "fresh-worktree",
        },
      } : {}),
      references: [],
    })),
  };
  if (options.modulePrerequisite) generated.pages[0]!.prerequisites = ["foundations"];
  const invalidGenerated = options.invalidFirstModule
    ? { ...generated, moduleId: "wrong-foundations" }
    : options.invalidExercisePath
      ? {
          ...generated,
          pages: generated.pages.map((page) => page.exercise
            ? { ...page, exercise: { ...page.exercise, allowedPaths: ["missing.txt"] } }
            : page),
        }
      : generated;
  const path = join(root, "fake-codex.mjs");
  await writeFile(path, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("codex-cli 0.144.6");
  process.exit(0);
}
if (args[0] === "login" && args[1] === "status") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}
if (args[0] === "exec" && args[1] === "--help") {
  console.log("--output-schema --json");
  process.exit(0);
}
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
const outputIndex = args.indexOf("-o");
const value = prompt.includes("curriculum architect")
  ? ${JSON.stringify(plan)}
  : prompt.includes("Repair the previously generated")
    ? ${JSON.stringify(generated)}
    : ${JSON.stringify(invalidGenerated)};
writeFileSync(args[outputIndex + 1], JSON.stringify(value));
console.log(JSON.stringify({ type: "thread.started", thread_id: "00000000-0000-4000-8000-000000000001" }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 } }));
`, "utf8");
  await chmod(path, 0o755);
  return path;
}

describe("Codex generation orchestration", () => {
  it("plans once, resumes for a module, and publishes a validated v2 tour", async () => {
    const root = await repository();
    const executable = await fakeCodex(root);
    const store = new TourStore(root);
    const generator = new TourGenerator(root, store, new CodexExecRunner(executable));
    const started = await generator.start({ goal: "Understand the fixture.", ref: "HEAD" });
    expect(started.status).toBe("queued");

    let job = await store.generationJob();
    for (let attempt = 0; attempt < 100 && job?.status !== "complete" && !job?.errorCode; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await store.generationJob();
    }
    expect(job?.message).toBe("Tour generation is complete.");
    expect(job?.completedModuleIds).toEqual(["foundations"]);
    expect(job?.usage.outputTokens).toBe(10);
    const tour = await store.current();
    expect(tour?.schemaVersion).toBe(2);
    expect(tour?.status).toBe("published");
    expect(tour?.modules[0]?.pageIds).toHaveLength(6);
    expect(tour?.pages.some((page) => page.kind === "exercise")).toBe(true);
    const command = tour?.pages[0]?.interactions.find((interaction) => interaction.type === "command");
    expect(command?.type === "command" ? command.recipe.env : undefined).toEqual({ MODE: "test" });
    const data = tour?.pages[0]?.interactions.find((interaction) => interaction.type === "data");
    expect(data?.type === "data" ? data.rows : undefined).toEqual([{ key: "mode", value: "test" }]);
    const source = tour?.pages[1]?.interactions.find((interaction) => interaction.type === "source");
    expect(source?.type === "source" ? [source.lineStart, source.lineEnd] : undefined).toEqual([1, 2]);
    expect(tour?.pages[0]?.evidence[0]).toMatchObject({ kind: "inference", validated: false });
    await expect(readFile(join(root, ".tourguide", "cache", "jobs", `${started.id}.plan.json`), "utf8")).resolves.toContain("foundations");
    await expect(readFile(join(root, ".tourguide", "cache", "jobs", `${started.id}.module-foundations.json`), "utf8")).resolves.toContain("Fixture table");
  });

  it("repairs a module once when repository-aware validation rejects it", async () => {
    const root = await repository();
    const executable = await fakeCodex(root, { invalidFirstModule: true });
    const store = new TourStore(root);
    const generator = new TourGenerator(root, store, new CodexExecRunner(executable));
    const started = await generator.start({ goal: "Understand the fixture.", ref: "HEAD" });

    let job = await store.generationJob();
    for (let attempt = 0; attempt < 100 && job?.status !== "complete" && !job?.errorCode; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await store.generationJob();
    }
    expect(job?.status).toBe("complete");
    expect(job?.completedModuleIds).toEqual(["foundations"]);
    expect(job?.usage.outputTokens).toBe(15);
    await expect(readFile(join(root, ".tourguide", "cache", "jobs", `${started.id}.module-foundations-repair.json`), "utf8")).resolves.toContain('"moduleId": "foundations"');
    const events = await store.generationEvents(started.id);
    expect(events.some((event) => event.message.includes("Repairing Foundations"))).toBe(true);
  });

  it("repairs generated exercise paths that cannot be edited", async () => {
    const root = await repository();
    const executable = await fakeCodex(root, { invalidExercisePath: true });
    const store = new TourStore(root);
    const generator = new TourGenerator(root, store, new CodexExecRunner(executable));
    const started = await generator.start({ goal: "Understand the fixture.", ref: "HEAD" });

    let job = await store.generationJob();
    for (let attempt = 0; attempt < 100 && job?.status !== "complete" && !job?.errorCode; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await store.generationJob();
    }
    expect(job?.status).toBe("complete");
    expect(job?.usage.outputTokens).toBe(15);
    expect((await store.current())?.pages.find((page) => page.kind === "exercise")?.exercise?.allowedPaths).toEqual([]);
    const repaired = JSON.parse(await readFile(
      join(root, ".tourguide", "cache", "jobs", `${started.id}.module-foundations-repair.json`),
      "utf8",
    )) as { pages: Array<{ exercise?: { allowedPaths: string[] } }> };
    expect(repaired.pages.find((page) => page.exercise)?.exercise?.allowedPaths).toEqual([]);
  });

  it("removes module IDs mistakenly emitted as page prerequisites without a model retry", async () => {
    const root = await repository();
    const executable = await fakeCodex(root, { modulePrerequisite: true });
    const store = new TourStore(root);
    const generator = new TourGenerator(root, store, new CodexExecRunner(executable));
    await generator.start({ goal: "Understand the fixture.", ref: "HEAD" });

    let job = await store.generationJob();
    for (let attempt = 0; attempt < 100 && job?.status !== "complete" && !job?.errorCode; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await store.generationJob();
    }
    expect(job?.status).toBe("complete");
    expect(job?.usage.outputTokens).toBe(10);
    expect((await store.current())?.pages[0]?.prerequisites).toEqual([]);
    const events = await store.generationEvents(job!.id);
    expect(events.some((event) => event.message.includes("Repairing Foundations"))).toBe(false);
  });

  it("removes environment requirements mistakenly emitted as page prerequisites", async () => {
    const root = await repository();
    const executable = await fakeCodex(root, { invalidPagePrerequisite: true });
    const store = new TourStore(root);
    const generator = new TourGenerator(root, store, new CodexExecRunner(executable));
    await generator.start({ goal: "Understand the fixture.", ref: "HEAD" });

    let job = await store.generationJob();
    for (let attempt = 0; attempt < 100 && job?.status !== "complete" && !job?.errorCode; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await store.generationJob();
    }
    expect(job?.status).toBe("complete");
    expect((await store.current())?.pages[0]?.prerequisites).toEqual([]);
  });

  it("removes environment requirements mistakenly emitted as module prerequisites", async () => {
    const root = await repository();
    const executable = await fakeCodex(root, { invalidPlanPrerequisite: true });
    const store = new TourStore(root);
    const generator = new TourGenerator(root, store, new CodexExecRunner(executable));
    await generator.start({ goal: "Understand the fixture.", ref: "HEAD" });

    let job = await store.generationJob();
    for (let attempt = 0; attempt < 100 && job?.status !== "complete" && !job?.errorCode; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await store.generationJob();
    }
    expect(job?.status).toBe("complete");
    expect((await store.current())?.modules[0]?.prerequisites).toEqual([]);
  });

  it("disables generated source editing outside patch exercises", async () => {
    const root = await repository();
    const executable = await fakeCodex(root, { invalidEditableSource: true });
    const store = new TourStore(root);
    const generator = new TourGenerator(root, store, new CodexExecRunner(executable));
    await generator.start({ goal: "Understand the fixture.", ref: "HEAD" });

    let job = await store.generationJob();
    for (let attempt = 0; attempt < 100 && job?.status !== "complete" && !job?.errorCode; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      job = await store.generationJob();
    }
    expect(job?.status).toBe("complete");
    expect(job?.usage.outputTokens).toBe(10);
    const source = (await store.current())?.pages[1]?.interactions.find((interaction) => interaction.type === "source");
    expect(source?.type === "source" ? source.editable : undefined).toBe(false);
  });
});
