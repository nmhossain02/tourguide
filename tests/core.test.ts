import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  ExerciseWorkspaceManager,
  KnowledgeAdapterRegistry,
  LabAdapterRegistry,
  LabManager,
  TourStore,
  assessFreshness,
  buildLivingDocumentation,
  buildStarterTour,
  buildRepositoryKnowledge,
  diffRepositoryKnowledge,
  diffLivingDocumentation,
  findTourDocumentationImpact,
  findTourKnowledgeDependents,
  inspectRepository,
  inspectRepositoryAt,
  LivingDocumentationSnapshotSchema,
  resolveSemanticBinding,
  semanticBindingsForKnowledgeRefs,
  parseProgress,
  parseSnapshot,
  planDocumentationUpdate,
  runRecipe,
  validateSnapshot,
  type TourSnapshot,
  type KnowledgeAdapter,
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
    const inventory = await inspectRepository(root);
    const tour = await buildStarterTour(inventory);
    expect(tour.status).toBe("published");
    expect(tour.modules).toHaveLength(1);
    expect(tour.pages.length).toBeGreaterThanOrEqual(6);
    expect(tour.pages.every((page) => page.interactions.length > 0)).toBe(true);
    const knowledge = await buildRepositoryKnowledge(inventory);
    expect((await validateSnapshot(tour, root, { knowledge })).valid).toBe(true);
    const unavailable = await validateSnapshot(tour, root);
    expect(unavailable.errors).toContain(`Tour knowledge snapshot ${tour.knowledgeSnapshotId} was not available for validation.`);
    expect((await validateSnapshot(tour, root, { partial: true })).warnings).toContain(`Tour knowledge snapshot ${tour.knowledgeSnapshotId} was not available for validation.`);
    tour.documentationSnapshotId = "documentation:missing";
    expect((await validateSnapshot(tour, root, { knowledge })).errors)
      .toContain("Tour documentation snapshot documentation:missing was not available for validation.");
    expect((await validateSnapshot(tour, root, { partial: true, knowledge })).warnings)
      .toContain("Tour documentation snapshot documentation:missing was not available for validation.");
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

describe("repository knowledge", () => {
  async function knowledgeRepository() {
    const root = await repository();
    await mkdir(join(root, "src", "components"), { recursive: true });
    await mkdir(join(root, "db", "migrations"), { recursive: true });
    await writeFile(join(root, "src", "components", "Button.tsx"), `
export interface ButtonProps { label: string; disabled?: boolean }
export function Button(props: ButtonProps) { return <button disabled={props.disabled}>{props.label}</button> }
`);
    await writeFile(join(root, "src", "components", "Button.stories.tsx"), `
import { Button } from "./Button";
export default { component: Button };
export const Primary = { args: { label: "Save" } };
`);
    await writeFile(join(root, "db", "migrations", "001.sql"), `
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE notes (id INTEGER PRIMARY KEY, owner_id INTEGER REFERENCES users(id), body TEXT);
`);
    await writeFile(join(root, "openapi.yaml"), `
openapi: 3.1.0
info: { title: Fixture, version: 1.0.0 }
paths:
  /notes:
    get:
      operationId: listNotes
      summary: List notes
      responses: { "200": { description: OK } }
`);
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "add knowledge surfaces"]);
    return root;
  }

  it("indexes every tracked path and builds four stable catalogs", async () => {
    const root = await knowledgeRepository();
    const inventory = await inspectRepository(root);
    const first = await buildRepositoryKnowledge(inventory);
    const second = await buildRepositoryKnowledge(inventory);

    expect(first.files.map((file) => file.path)).toEqual([...inventory.trackedFiles].sort());
    expect(first.files.every((file) => file.contentHash && (file.excludedReason || first.catalogs.codeDocs.some((item) => item.path === file.path)))).toBe(true);
    expect(first.catalogs.dataModel.map((item) => item.title)).toEqual(expect.arrayContaining(["users", "notes"]));
    expect(first.catalogs.api.some((item) => item.method === "GET" && item.route === "/notes")).toBe(true);
    expect(first.catalogs.components.some((item) => item.title === "Button" && item.props.some((prop) => prop.name === "label"))).toBe(true);
    expect(first.catalogs.components.find((item) => item.title === "Button")?.storyIds).toContain("Primary");
    expect(first.catalogs.components.some((item) => item.kind === "story" && item.title === "Button.Primary")).toBe(true);
    expect(first.relationships.some((relationship) => relationship.kind === "renders")).toBe(true);
    expect(first.catalogs.codeDocs.some((item) => item.path === "README.md" && item.headings.includes("fixture"))).toBe(true);
    expect(first.catalogs.codeDocs.map((item) => item.id)).toEqual(second.catalogs.codeDocs.map((item) => item.id));
    expect(first.id).toBe(second.id);
  });

  it("supports independent adapters and rejects duplicate registrations", async () => {
    const root = await knowledgeRepository();
    const adapter: KnowledgeAdapter = {
      id: "custom",
      version: "1",
      analyze: (context) => ({
        items: [{
          id: context.itemId("code-docs", "README.md", "custom"), catalog: "code-docs", kind: "symbol",
          title: "Custom analyzer result", summary: "Added by a test adapter.", path: "README.md", symbol: "custom",
          contentHash: "custom-v1", adapterId: "custom", tags: ["custom"], language: "Markdown", headings: [],
          evidence: context.evidence("README.md", "Custom adapter inspected the README."), confidence: 1, readiness: "ready",
        }],
      }),
    };
    const registry = new KnowledgeAdapterRegistry().register(adapter);
    expect(() => registry.register(adapter)).toThrow("already registered");
    const snapshot = await buildRepositoryKnowledge(await inspectRepository(root), registry);
    expect(snapshot.catalogs.codeDocs[0]?.adapterId).toBe("custom");
  });

  it("round-trips knowledge snapshots through the repository cache", async () => {
    const root = await knowledgeRepository();
    const snapshot = await buildRepositoryKnowledge(await inspectRepository(root));
    const store = new TourStore(root);
    await store.initialize();
    await store.saveKnowledge(snapshot);
    expect(await store.knowledge(snapshot.id)).toEqual(snapshot);
  });

  it("diffs stable catalog items and identifies only their tour dependents", async () => {
    const root = await knowledgeRepository();
    const first = await buildRepositoryKnowledge(await inspectRepository(root));
    const button = first.catalogs.components.find((item) => item.title === "Button")!;
    await writeFile(join(root, "src", "components", "Button.tsx"), "export function Button() { return <button>Changed</button> }\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "change button"]);
    const second = await buildRepositoryKnowledge(await inspectRepository(root));
    const changedButton = second.catalogs.components.find((item) => item.title === "Button")!;
    expect(changedButton.id).toBe(button.id);
    const diff = diffRepositoryKnowledge(first, second);
    expect(diff.changedItemIds).toContain(button.id);

    const tour = await buildStarterTour(await inspectRepository(root));
    tour.pages[0]!.knowledgeRefs = [{ catalog: "components", itemId: button.id, contentHash: button.contentHash }];
    const dependents = findTourKnowledgeDependents(tour, diff.changedItemIds);
    expect(dependents.pageIds).toEqual([tour.pages[0]!.id]);
    expect(dependents.moduleIds).toEqual([]);
  });

  it("builds living documentation with semantic subjects, scenarios, and reusable runtime profiles", async () => {
    const root = await knowledgeRepository();
    const knowledge = await buildRepositoryKnowledge(await inspectRepository(root));
    const documentation = buildLivingDocumentation(knowledge);
    const button = knowledge.catalogs.components.find((item) => item.title === "Button")!;
    const subject = documentation.subjects.find((candidate) => candidate.id === button.id)!;
    expect(subject.domain).toBe("component-library");
    expect(subject.capabilities).toContain("ui.render");
    expect(documentation.scenarios.some((scenario) => scenario.subjectId === subject.id && scenario.operation === "render")).toBe(true);
    expect(documentation.runtimeProfiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "frontend:main", providerHints: expect.arrayContaining(["generic-react"]) }),
      expect.objectContaining({ id: "api:main" }),
      expect.objectContaining({ id: "data:application" }),
      expect.objectContaining({ id: "compute:main" }),
    ]));
    const binding = semanticBindingsForKnowledgeRefs([{ catalog: button.catalog, itemId: button.id, contentHash: button.contentHash }])[0]!;
    expect(resolveSemanticBinding(documentation, binding)).toMatchObject({ status: "resolved", subject: { id: button.id } });
    const store = new TourStore(root);
    await store.initialize();
    await store.saveDocumentation(documentation);
    expect(await store.documentation(documentation.id)).toEqual(documentation);
  });

  it("updates declarative subject registries without rebuilding an unchanged runtime profile", async () => {
    const root = await knowledgeRepository();
    const firstKnowledge = await buildRepositoryKnowledge(await inspectRepository(root));
    const first = buildLivingDocumentation(firstKnowledge);
    const firstFrontend = first.runtimeProfiles.find((profile) => profile.id === "frontend:main")!;
    await writeFile(join(root, "src", "components", "Card.tsx"), "export function Card({ title }: { title: string }) { return <article>{title}</article> }\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "add compatible component"]);
    const secondKnowledge = await buildRepositoryKnowledge(await inspectRepository(root));
    const second = buildLivingDocumentation(secondKnowledge, first);
    const secondFrontend = second.runtimeProfiles.find((profile) => profile.id === "frontend:main")!;
    const diff = diffLivingDocumentation(first, second);
    expect(diff.changes).toContainEqual(expect.objectContaining({ domain: "component-library", classification: "additive" }));
    expect(secondFrontend.dependencyFingerprint).toBe(firstFrontend.dependencyFingerprint);
    expect(secondFrontend.subjectRegistryFingerprint).not.toBe(firstFrontend.subjectRegistryFingerprint);
    const update = planDocumentationUpdate(first, second, diff, { adapterResolvedDomains: ["component-library"] });
    expect(update.runtimeActions).toContainEqual(expect.objectContaining({ profileId: "frontend:main", action: "update-registry" }));
    expect(update.environmentSynthesisProfileIds).toEqual([]);
    expect(update.inferenceRequests.some((request) => request.domain === "component-library")).toBe(false);
    expect(planDocumentationUpdate(first, second, diff, { failedRuntimeProfileIds: ["frontend:main"] }).environmentSynthesisProfileIds).toEqual(["frontend:main"]);
  });

  it("reuses inferred claims until their supporting evidence changes and impacts only material tour bindings", async () => {
    const root = await knowledgeRepository();
    const firstKnowledge = await buildRepositoryKnowledge(await inspectRepository(root));
    const base = buildLivingDocumentation(firstKnowledge);
    const button = base.subjects.find((subject) => subject.title === "Button" && subject.domain === "component-library")!;
    const inferred = LivingDocumentationSnapshotSchema.parse({
      ...base,
      claims: [...base.claims, {
        id: `claim:${button.id}:purpose`, subjectId: button.id, field: "purpose", value: "Primary repository action",
        origin: "inferred", evidence: button.evidence, evidenceFingerprint: button.evidenceFingerprint,
        confidence: 0.8, lastConfirmedCommit: base.anchor.commit, status: "valid",
      }],
    });
    const unchanged = buildLivingDocumentation(firstKnowledge, inferred);
    expect(unchanged.claims.find((claim) => claim.field === "purpose")?.status).toBe("valid");
    await writeFile(join(root, "src", "components", "Button.tsx"), "export interface ButtonProps { label: string; tone: 'safe' | 'danger' }\nexport function Button(props: ButtonProps) { return <button>{props.label}:{props.tone}</button> }\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "change button contract"]);
    const changed = buildLivingDocumentation(await buildRepositoryKnowledge(await inspectRepository(root)), inferred);
    expect(changed.claims.find((claim) => claim.field === "purpose")?.status).toBe("invalidated");
    const diff = diffLivingDocumentation(inferred, changed);
    expect(diff.changes).toContainEqual(expect.objectContaining({ subjectId: button.id, classification: "behavioral" }));
    const tour = await buildStarterTour(await inspectRepository(root));
    tour.pages[0]!.documentationBindings = [{ subjectId: button.id, binding: "latest-compatible", requiredCapabilities: ["ui.render"], concepts: [] }];
    expect(findTourDocumentationImpact(tour, diff).pageIds).toEqual([tour.pages[0]!.id]);
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

  it("upgrades v2 tours and progress without losing learning state", async () => {
    const root = await repository();
    const current = await buildStarterTour(await inspectRepository(root));
    const legacy = {
      ...current,
      schemaVersion: 2,
      promptVersion: 2,
    };
    delete (legacy as Partial<TourSnapshot>).knowledgeSnapshotId;
    delete (legacy as Partial<TourSnapshot>).knowledgeRefs;
    delete (legacy as Partial<TourSnapshot>).featureJourneys;
    delete (legacy as Partial<TourSnapshot>).labEnvironments;
    const migrated = parseSnapshot(legacy);
    expect(migrated.migrated).toBe(true);
    expect(migrated.snapshot.schemaVersion).toBe(3);
    expect(migrated.snapshot.knowledgeSnapshotId).toContain(current.anchor.commit);

    const progress = parseProgress({
      schemaVersion: 2,
      pages: { one: { viewed: true, demonstrated: true, exerciseAttempted: true, completed: false, revisit: false, updatedAt: "now" } },
    });
    expect(progress.progress.schemaVersion).toBe(3);
    expect(progress.progress.pages.one).toMatchObject({ viewed: true, verified: false, blocked: false });
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

describe("process-local module labs", () => {
  it("reuses a module lab, isolates edits, verifies behavior, and retains an explicit branch", async () => {
    const root = await repository();
    const tour = await buildStarterTour(await inspectRepository(root));
    const module = tour.modules[0]!;
    const exercise = tour.pages.find((page) => page.kind === "exercise")!;
    exercise.exercise = { ...exercise.exercise!, mode: "patch", allowedPaths: ["README.md"] };
    const manager = new LabManager(root);

    const created = await manager.create(tour, module.id);
    expect(created.files.map((file) => file.path)).toEqual(["README.md"]);
    await manager.write(created.session.id, "README.md", "# lab edit\n");
    const reused = await manager.create(tour, module.id);
    expect(reused.session.id).toBe(created.session.id);
    expect(reused.files[0]?.content).toBe("# lab edit\n");
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("# fixture\n");
    await expect(manager.write(created.session.id, "../README.md", "bad")).rejects.toThrow("escape");

    const passing = await manager.verify(created.session.id, {
      id: "pass", title: "Pass", command: process.execPath, args: ["-e", "process.exit(0)"], cwd: ".",
      lifecycle: "oneshot", timeoutMs: 2_000, env: {}, inputs: [],
      capabilities: { writes: [], network: "none", secrets: [], containers: false, externalSystems: [] },
      expected: "The command succeeds.",
    });
    expect(passing.status).toBe("pass");
    const structured = await manager.verify(created.session.id, {
      id: "structured", title: "Structured", command: process.execPath, args: ["-e", "console.log(JSON.stringify({ ok: true, count: 2 }))"], cwd: ".",
      lifecycle: "oneshot", timeoutMs: 2_000, env: {}, inputs: [],
      capabilities: { writes: [], network: "none", secrets: [], containers: false, externalSystems: [] },
      expected: "Structured checks pass.",
    }, false, {}, [
      { type: "exit-code", expected: 0 },
      { type: "output", stream: "stdout", includes: "count" },
      { type: "json-subset", expected: { ok: true } },
    ]);
    expect(structured.checks.every((check) => check.status === "pass")).toBe(true);
    const failing = await manager.verify(created.session.id, {
      id: "fail", title: "Fail", command: process.execPath, args: ["-e", "console.error('broken'); process.exit(2)"], cwd: ".",
      lifecycle: "oneshot", timeoutMs: 2_000, env: {}, inputs: [],
      capabilities: { writes: [], network: "none", secrets: [], containers: false, externalSystems: [] },
      expected: "The command succeeds.",
    });
    expect(failing).toMatchObject({ status: "fail", expected: "The command succeeds.", observed: "broken" });
    expect(await manager.patch(created.session.id)).toContain("lab edit");

    const retained = await manager.retain(created.session.id, "readme experiment");
    expect(retained.retainedBranch).toMatch(/^tourguide\/readme-experiment-/);
    expect((await exec("git", ["-C", retained.workspace, "status", "--porcelain"])).stdout).toContain("README.md");
    expect((await exec("git", ["-C", root, "branch", "--show-current"])).stdout.trim()).toBe("main");
    await manager.close(created.session.id, true);
  });

  it("runs service adapters on an allocated loopback port and stops them on shutdown", async () => {
    const root = await repository();
    const tour = await buildStarterTour(await inspectRepository(root));
    const module = tour.modules[0]!;
    tour.labEnvironments = [{
      id: "web-lab", moduleId: module.id, title: "Web lab", adapterIds: ["http"], editablePaths: [],
      preparationRecipes: [], dependencies: [], readiness: "ready",
      services: [{
        id: "fixture-http", title: "Fixture HTTP service", portEnv: "PORT", healthUrl: "http://127.0.0.1:{{port}}/health", healthTimeoutMs: 5_000,
        recipe: {
          id: "fixture-http", title: "Fixture HTTP service", command: process.execPath,
          args: ["-e", "require('http').createServer((q,r)=>{r.end(q.url==='\/health'?'ok':'fixture')}).listen(Number(process.env.PORT),'127.0.0.1')"],
          cwd: ".", lifecycle: "service", timeoutMs: 60_000, env: {}, inputs: [],
          capabilities: { writes: [], network: "loopback", secrets: [], containers: false, externalSystems: [] },
        },
      }],
    }];
    const manager = new LabManager(root);
    const { session } = await manager.create(tour, module.id);
    const service = session.services[0]!;
    expect(service.status).toBe("ready");
    expect(await (await fetch(`http://127.0.0.1:${service.port}/`)).text()).toBe("fixture");
    const invoked = await manager.invoke(session.id, "http", {
      item: {
        id: "api:test", catalog: "api", kind: "endpoint", title: "GET /", summary: "Fixture endpoint",
        contentHash: "fixture", confidence: 1, readiness: "ready", evidence: [], adapterId: "test", tags: [],
        method: "GET", route: "/", authentication: [],
      },
      inputs: {},
    });
    expect(invoked).toMatchObject({ adapterId: "http", provenance: "production", value: { status: 200, body: "fixture" } });
    await manager.shutdown();
    await expect(fetch(`http://127.0.0.1:${service.port}/`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  });

  it("waits for ports, selects the API service, and resets service state", async () => {
    const root = await repository();
    const tour = await buildStarterTour(await inspectRepository(root));
    const module = tour.modules[0]!;
    const service = (id: string, body: string, delay: number) => ({
      id, title: id, portEnv: "PORT", healthTimeoutMs: 5_000,
      recipe: {
        id, title: id, command: process.execPath,
        args: ["-e", `setTimeout(()=>require('http').createServer((q,r)=>r.end(${JSON.stringify(body)})).listen(Number(process.env.PORT),'127.0.0.1'),${delay})`],
        cwd: ".", lifecycle: "service" as const, timeoutMs: 60_000, env: {}, inputs: [],
        capabilities: { writes: [], network: "loopback" as const, secrets: [], containers: false, externalSystems: [] },
      },
    });
    tour.labEnvironments = [{
      id: "multi-service", moduleId: module.id, title: "Multi-service", adapterIds: ["http"], editablePaths: [],
      preparationRecipes: [], dependencies: [], readiness: "ready",
      services: [service("storybook", "preview", 0), service("api", "api", 250)],
    }];
    const manager = new LabManager(root);
    const startedAt = Date.now();
    const { session } = await manager.create(tour, module.id);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(200);
    const apiItem = {
      id: "api:test", catalog: "api" as const, kind: "endpoint" as const, title: "GET /", summary: "API",
      contentHash: "fixture", confidence: 1, readiness: "ready" as const, evidence: [], adapterId: "test", tags: [],
      method: "GET", route: "/", authentication: [],
    };
    expect(await manager.invokeCapability(session.id, "service.request", { item: apiItem, inputs: {} })).toMatchObject({ value: { body: "api" } });
    const oldPorts = session.services.map((state) => state.port);
    const reset = await manager.reset(session.id);
    expect(reset.session.services).toHaveLength(2);
    expect(reset.session.services.every((state) => state.status === "ready")).toBe(true);
    const newPorts = new Set(reset.session.services.map((state) => state.port));
    for (const port of oldPorts.filter((candidate) => !newPorts.has(candidate))) {
      await expect(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
    }
    await manager.shutdown();
  });

  it("invokes JavaScript functions and SQLite through typed adapters", async () => {
    const root = await repository();
    await writeFile(join(root, "math.mjs"), "export function add(a, b) { return { total: a + b } }\n");
    await exec("git", ["-C", root, "add", "math.mjs"]);
    await exec("git", ["-C", root, "commit", "-m", "add callable function"]);
    const tour = await buildStarterTour(await inspectRepository(root));
    const module = tour.modules[0]!;
    tour.labEnvironments = [{
      id: "adapter-lab", moduleId: module.id, title: "Adapter lab", adapterIds: ["function-js", "sqlite"],
      editablePaths: [], preparationRecipes: [], services: [], dependencies: [], readiness: "ready",
    }];
    const manager = new LabManager(root);
    const { session } = await manager.create(tour, module.id);
    const functionResult = await manager.invoke(session.id, "function-js", {
      item: {
        id: "code:add", catalog: "code-docs", kind: "symbol", title: "add", summary: "Adds two values.",
        path: "math.mjs", symbol: "add", contentHash: "fixture", confidence: 1, readiness: "ready", evidence: [],
        adapterId: "test", tags: [], language: "JavaScript", headings: [],
      },
      inputs: { args: [2, 5] },
    });
    expect(functionResult).toMatchObject({ provenance: "tourguide-harness", value: { total: 7 } });

    const tableItem = {
      id: "data:notes", catalog: "data-model" as const, kind: "table" as const, title: "notes", summary: "Notes table",
      contentHash: "fixture", confidence: 1, readiness: "ready" as const, evidence: [], adapterId: "test", tags: [], fields: [],
    };
    expect((await manager.invoke(session.id, "sqlite", { item: tableItem, inputs: { databasePath: "app.db", query: "CREATE TABLE notes (id INTEGER, body TEXT)", allowWrite: true } })).value).toMatchObject({ changes: 0 });
    await manager.invoke(session.id, "sqlite", { item: tableItem, inputs: { databasePath: "app.db", query: "INSERT INTO notes VALUES (?, ?)", parameters: [1, "hello"], allowWrite: true } });
    expect((await manager.invoke(session.id, "sqlite", { item: tableItem, inputs: { databasePath: "app.db", query: "SELECT * FROM notes" } })).value).toEqual([{ id: 1, body: "hello" }]);
    await manager.shutdown();
  });

  it("allows lab adapters to be extended without changing the manager", async () => {
    const root = await repository();
    const tour = await buildStarterTour(await inspectRepository(root));
    const module = tour.modules[0]!;
    let prepared = false;
    let closed = false;
    const adapter = { id: "fixture-adapter", prepare: () => { prepared = true; }, close: () => { closed = true; } };
    const registry = new LabAdapterRegistry().register(adapter);
    expect(() => registry.register(adapter)).toThrow("already registered");
    tour.labEnvironments = [{
      id: "custom", moduleId: module.id, title: "Custom", adapterIds: [adapter.id], editablePaths: [],
      preparationRecipes: [], services: [], dependencies: [], readiness: "ready",
    }];
    const manager = new LabManager(root, registry);
    const created = await manager.create(tour, module.id);
    expect(prepared).toBe(true);
    await manager.close(created.session.id);
    expect(closed).toBe(true);
  });
});
