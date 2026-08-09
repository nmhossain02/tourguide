import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  TourStore,
  buildRepositoryKnowledge,
  buildStarterTour,
  diffLivingDocumentation,
  inspectRepository,
  type LivingDocumentationSnapshot,
  type ProjectInventory,
  type TourSnapshot,
} from "../packages/core/src/index.js";
import {
  DocumentationInferenceBatchSchema,
  IntelligenceCoordinator,
  RuntimeSynthesisBatchSchema,
  TourImpactProposalSchema,
} from "../packages/server/src/intelligence.js";

const exec = promisify(execFile);
const temporary: string[] = [];

async function repository(): Promise<{ root: string; inventory: ProjectInventory }> {
  const root = await mkdtemp(join(tmpdir(), "tourguide-intelligence-"));
  temporary.push(root);
  await exec("git", ["init", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
  await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
  await writeFile(join(root, "README.md"), "# Intelligent fixture\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "intelligent-fixture", scripts: {} }));
  await writeFile(join(root, "Button.tsx"), [
    "export interface ButtonProps { label: string }",
    "export function Button(props: ButtonProps) { return <button>{props.label}</button> }",
    "",
  ].join("\n"));
  await writeFile(join(root, "math.ts"), "export function add(a: number, b: number) { return a + b }\n");
  await writeFile(join(root, "schema.sql"), "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);\n");
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "commit", "-m", "fixture"]);
  return { root, inventory: await inspectRepository(root) };
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

class FakeIntelligenceRunner {
  calls = { documentation: 0, runtime: 0, tour: 0 };
  documentation?: LivingDocumentationSnapshot;
  tour?: TourSnapshot;

  async run(request: { prompt: string; schema: { parse(value: unknown): unknown } }) {
    let value: unknown;
    if (request.prompt.includes("updating Tourguide's living executable documentation")) {
      this.calls.documentation += 1;
      value = {
        results: this.documentation!.inferenceRequests.map((inference) => ({
          requestId: inference.id,
          claims: inference.subjectIds.map((subjectId) => ({
            subjectId,
            field: "purpose",
            value: `Purpose inferred for ${subjectId}`,
            confidence: 0.8,
          })),
          scenarios: [],
          dependencyContracts: [],
        })),
      };
      value = DocumentationInferenceBatchSchema.parse(value);
    } else if (request.prompt.includes("synthesizing reusable Tourguide runtime providers")) {
      this.calls.runtime += 1;
      const profiles = this.documentation!.runtimeProfiles.filter((profile) => (
        profile.domain === "component-library" || profile.domain === "compute"
      ));
      value = {
        providers: profiles.map((profile) => profile.domain === "component-library" ? {
          profileId: profile.id,
          title: "Generated component preview",
          capabilities: profile.capabilities,
          files: [{
            path: "server.mjs",
            content: "import{createServer}from'node:http';createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(req.url==='/health'?'ok':'<button>preview</button>')}).listen(Number(process.env.PORT),'127.0.0.1');\n",
          }],
          preparationRecipes: [],
          services: [{
            id: "generated-component-preview",
            title: "Generated component preview",
            recipe: {
              id: "generated-component-preview",
              title: "Generated component preview",
              command: process.execPath,
              args: ["server.mjs"],
              cwdMode: "provider",
              lifecycle: "service",
              timeoutMs: 30_000,
              env: [],
              inputs: [],
              capabilities: { writes: [], network: "loopback", secrets: [], containers: false, externalSystems: [] },
            },
            portEnv: "PORT",
            healthUrl: "http://127.0.0.1:{{port}}/health",
            healthTimeoutMs: 5_000,
          }],
          invocations: [{
            capability: "ui.render",
            kind: "service-url",
            serviceId: "generated-component-preview",
            pathTemplate: "/preview?subject={{subject_symbol}}",
            result: "url",
          }],
        } : {
          profileId: profile.id,
          title: "Generated TypeScript compute worker",
          capabilities: profile.capabilities,
          files: [],
          preparationRecipes: [],
          services: [],
          invocations: [{
            capability: "code.invoke",
            kind: "command",
            recipe: {
              id: "generated-compute-invoke",
              title: "Invoke TypeScript surface",
              command: process.execPath,
              args: ["-e", "console.log(JSON.stringify({ok:true}))"],
              cwdMode: "repository",
              lifecycle: "oneshot",
              timeoutMs: 5_000,
              env: [],
              inputs: [],
              capabilities: { writes: [], network: "none", secrets: [], containers: false, externalSystems: [] },
            },
            result: "json",
          }],
        }),
      };
      value = RuntimeSynthesisBatchSchema.parse(value);
    } else {
      this.calls.tour += 1;
      value = {
        pages: this.tour!.pages.filter((page) => page.documentationBindings.length).map((page) => ({
          pageId: page.id,
          action: "reuse",
          reason: "The teaching objective and explanation remain correct.",
        })),
        modules: this.tour!.modules.filter((module) => module.documentationBindings.length).map((module) => ({
          moduleId: module.id,
          action: "reuse",
          reason: "The module remains semantically compatible.",
        })),
      };
      value = TourImpactProposalSchema.parse(value);
    }
    return {
      value,
      threadId: "00000000-0000-4000-8000-000000000001",
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
      messages: [],
    };
  }
}

describe("intelligent Codex escalation and artifact reuse", () => {
  it("batches documentation gaps once and reuses validated inference by evidence fingerprint", async () => {
    const { root, inventory } = await repository();
    const store = new TourStore(root);
    await store.initialize();
    const knowledge = await buildRepositoryKnowledge(inventory);
    const base = (await import("../packages/core/src/documentation.js")).buildLivingDocumentation(knowledge);
    const runner = new FakeIntelligenceRunner();
    runner.documentation = base;
    const coordinator = new IntelligenceCoordinator(root, store, runner as never);

    const [first, concurrent] = await Promise.all([
      coordinator.reconcileDocumentation(knowledge),
      coordinator.reconcileDocumentation(knowledge),
    ]);
    expect(runner.calls.documentation).toBe(1);
    expect(first.stats.coldCalls).toBe(1);
    expect(concurrent.stats.coldCalls).toBe(1);
    expect(first.documentation.inferenceRequests.every((request) => request.status === "resolved")).toBe(true);
    expect(first.documentation.claims.some((claim) => claim.origin === "inferred" && claim.field === "purpose")).toBe(true);

    runner.documentation = first.documentation;
    const warm = await coordinator.reconcileDocumentation(knowledge, first.documentation);
    expect(warm.stats.coldCalls).toBe(0);
    expect(warm.stats.cacheHits).toBe(base.inferenceRequests.length);
    expect(runner.calls.documentation).toBe(1);
  });

  it("synthesizes, executes, validates, and then reuses missing runtime providers", async () => {
    const { root, inventory } = await repository();
    const store = new TourStore(root);
    await store.initialize();
    const knowledge = await buildRepositoryKnowledge(inventory);
    const base = (await import("../packages/core/src/documentation.js")).buildLivingDocumentation(knowledge);
    const runner = new FakeIntelligenceRunner();
    runner.documentation = base;
    const coordinator = new IntelligenceCoordinator(root, store, runner as never);
    const documentation = (await coordinator.reconcileDocumentation(knowledge)).documentation;
    runner.documentation = documentation;

    const cold = await coordinator.resolveRuntimeProviders(documentation, inventory);
    expect(cold.stats.coldCalls).toBe(1);
    expect(runner.calls.runtime).toBe(1);
    expect(cold.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "component-library", source: "generated", validation: expect.objectContaining({ status: "pass", validator: "runtime-provider-probe-v1" }) }),
      expect.objectContaining({ domain: "compute", source: "generated", validation: expect.objectContaining({ status: "pass", validator: "runtime-provider-probe-v1" }) }),
      expect.objectContaining({ domain: "data-model", source: "builtin", validation: expect.objectContaining({ status: "pass" }) }),
    ]));
    expect(cold.documentation.runtimeProfiles.every((profile) => profile.probeStatus === "pass")).toBe(true);

    runner.documentation = cold.documentation;
    const warm = await coordinator.resolveRuntimeProviders(cold.documentation, inventory);
    expect(warm.stats.coldCalls).toBe(0);
    expect(warm.stats.cacheHits).toBe(cold.documentation.runtimeProfiles.length);
    expect(runner.calls.runtime).toBe(1);
  });

  it("refreshes a changed subject registry without rebuilding a compatible provider", async () => {
    const { root, inventory } = await repository();
    const store = new TourStore(root);
    await store.initialize();
    const firstKnowledge = await buildRepositoryKnowledge(inventory);
    const firstDocumentation = (await import("../packages/core/src/documentation.js")).buildLivingDocumentation(firstKnowledge);
    const runner = new FakeIntelligenceRunner();
    runner.documentation = firstDocumentation;
    const coordinator = new IntelligenceCoordinator(root, store, runner as never);
    const resolvedDocumentation = (await coordinator.reconcileDocumentation(firstKnowledge)).documentation;
    runner.documentation = resolvedDocumentation;
    const first = await coordinator.resolveRuntimeProviders(resolvedDocumentation, inventory);
    const runtimeCalls = runner.calls.runtime;

    await writeFile(join(root, "Card.tsx"), "export function Card({ title }: { title: string }) { return <article>{title}</article> }\n");
    await exec("git", ["-C", root, "add", "Card.tsx"]);
    await exec("git", ["-C", root, "commit", "-m", "add card"]);
    const nextInventory = await inspectRepository(root);
    const nextKnowledge = await buildRepositoryKnowledge(nextInventory);
    const nextDocumentation = (await import("../packages/core/src/documentation.js")).buildLivingDocumentation(nextKnowledge, first.documentation);
    runner.documentation = nextDocumentation;
    const refreshed = await coordinator.resolveRuntimeProviders(nextDocumentation, nextInventory);

    expect(refreshed.stats.coldCalls).toBe(0);
    expect(runner.calls.runtime).toBe(runtimeCalls);
    expect(refreshed.artifacts.find((artifact) => artifact.profileId === "frontend:main")?.cacheKey)
      .toBe(first.artifacts.find((artifact) => artifact.profileId === "frontend:main")?.cacheKey);
    expect(refreshed.documentation.runtimeProfiles.find((profile) => profile.id === "frontend:main")?.probeStatus).toBe("pass");
  });

  it("escalates after a deterministic provider fails its executable probe", async () => {
    const { root } = await repository();
    await writeFile(join(root, "schema.sql"), "CREATE TABLE notes (id INTEGER PRIMARY KEY);\nTHIS IS NOT SQLITE;\n");
    await exec("git", ["-C", root, "add", "schema.sql"]);
    await exec("git", ["-C", root, "commit", "-m", "break deterministic schema probe"]);
    const inventory = await inspectRepository(root);
    const knowledge = await buildRepositoryKnowledge(inventory);
    const documentation = (await import("../packages/core/src/documentation.js")).buildLivingDocumentation(knowledge);
    documentation.runtimeProfiles = documentation.runtimeProfiles.filter((profile) => profile.domain === "data-model");
    let runtimeCalls = 0;
    const runner = {
      async run() {
        runtimeCalls += 1;
        return {
          value: RuntimeSynthesisBatchSchema.parse({ providers: documentation.runtimeProfiles.map((profile) => ({
            profileId: profile.id, title: "Generated data probe", capabilities: profile.capabilities, files: [], preparationRecipes: [], services: [],
            invocations: [{
              capability: "data.query", kind: "command", result: "json",
              recipe: {
                id: "generated-data", title: "Generated data", command: process.execPath,
                args: ["-e", "console.log(JSON.stringify({ok:true}))"], cwdMode: "repository", lifecycle: "oneshot", timeoutMs: 5_000,
                env: [], inputs: [], capabilities: { writes: [], network: "none", secrets: [], containers: false, externalSystems: [] },
              },
            }],
          })) }),
          threadId: "00000000-0000-4000-8000-000000000001",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, messages: [],
        };
      },
    };
    const store = new TourStore(root);
    await store.initialize();
    const result = await new IntelligenceCoordinator(root, store, runner as never).resolveRuntimeProviders(documentation, inventory);
    expect(runtimeCalls).toBe(1);
    expect(result.artifacts).toContainEqual(expect.objectContaining({ source: "generated", validation: expect.objectContaining({ status: "pass" }) }));
  });

  it("rejects generated write declarations outside the provider root", async () => {
    const { root, inventory } = await repository();
    const knowledge = await buildRepositoryKnowledge(inventory);
    const documentation = (await import("../packages/core/src/documentation.js")).buildLivingDocumentation(knowledge);
    documentation.runtimeProfiles = documentation.runtimeProfiles.filter((profile) => profile.domain === "compute");
    const runner = {
      async run() {
        const profile = documentation.runtimeProfiles[0]!;
        return {
          value: RuntimeSynthesisBatchSchema.parse({ providers: [{
            profileId: profile.id, title: "Unsafe provider", capabilities: profile.capabilities, files: [], preparationRecipes: [], services: [],
            invocations: [{
              capability: "code.invoke", kind: "command", result: "json",
              recipe: {
                id: "unsafe", title: "Unsafe", command: process.execPath, args: ["-e", "console.log('{}')"], cwdMode: "repository",
                lifecycle: "oneshot", timeoutMs: 5_000, env: [], inputs: [],
                capabilities: { writes: ["README.md"], network: "none", secrets: [], containers: false, externalSystems: [] },
              },
            }],
          }] }),
          threadId: "00000000-0000-4000-8000-000000000001",
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, messages: [],
        };
      },
    };
    const store = new TourStore(root);
    await store.initialize();
    const result = await new IntelligenceCoordinator(root, store, runner as never).resolveRuntimeProviders(documentation, inventory);
    expect(result.artifacts).toEqual([]);
    expect(result.documentation.runtimeProfiles[0]?.probeStatus).not.toBe("pass");
  });

  it("assesses a material tour change once and reuses the semantic assessment", async () => {
    const { root, inventory: firstInventory } = await repository();
    const store = new TourStore(root);
    await store.initialize();
    const runner = new FakeIntelligenceRunner();
    const coordinator = new IntelligenceCoordinator(root, store, runner as never);
    const firstKnowledge = await buildRepositoryKnowledge(firstInventory);
    const firstBase = (await import("../packages/core/src/documentation.js")).buildLivingDocumentation(firstKnowledge);
    runner.documentation = firstBase;
    const first = (await coordinator.reconcileDocumentation(firstKnowledge)).documentation;
    const button = first.subjects.find((subject) => subject.title === "Button")!;
    const tour = await buildStarterTour(firstInventory);
    tour.documentationSnapshotId = first.id;
    tour.pages[0]!.documentationBindings = [{ subjectId: button.id, binding: "latest-compatible", requiredCapabilities: [], concepts: [] }];
    tour.modules[0]!.documentationBindings = [{ subjectId: button.id, binding: "latest-compatible", requiredCapabilities: [], concepts: [] }];
    runner.tour = tour;

    await writeFile(join(root, "Button.tsx"), [
      "export interface ButtonProps { label: string; tone?: 'normal' | 'danger' }",
      "export function Button(props: ButtonProps) { return <button data-tone={props.tone}>{props.label}</button> }",
      "",
    ].join("\n"));
    await exec("git", ["-C", root, "add", "Button.tsx"]);
    await exec("git", ["-C", root, "commit", "-m", "change button contract"]);
    const nextKnowledge = await buildRepositoryKnowledge(await inspectRepository(root));
    const nextBase = (await import("../packages/core/src/documentation.js")).buildLivingDocumentation(nextKnowledge, first);
    runner.documentation = nextBase;
    const next = (await coordinator.reconcileDocumentation(nextKnowledge, first)).documentation;
    const diff = diffLivingDocumentation(first, next);
    expect(diff.changes).toContainEqual(expect.objectContaining({ subjectId: button.id, classification: "behavioral" }));

    const cold = await coordinator.assessTourImpact(tour, diff, next);
    expect(cold.stats).toMatchObject({ coldCalls: 1, cacheHits: 0 });
    expect(cold.artifact?.pageAssessments).toContainEqual(expect.objectContaining({ pageId: tour.pages[0]!.id, action: "reuse" }));
    const warm = await coordinator.assessTourImpact(tour, diff, next);
    expect(warm.stats).toMatchObject({ coldCalls: 0, cacheHits: 1 });
    expect(runner.calls.tour).toBe(1);
  });
});
