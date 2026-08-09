import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { TourStore, buildStarterTour, inspectRepository, type RunRecipe } from "../packages/core/src/index.js";
import { startWebServer, type WebServerHandle } from "../packages/server/src/web-server.js";

const exec = promisify(execFile);
const temporary: string[] = [];
const servers: WebServerHandle[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("web command execution", () => {
  it("resolves duplicate recipe IDs within the requested page", async () => {
    const root = await mkdtemp(join(tmpdir(), "tourguide-web-"));
    temporary.push(root);
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
    await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
    await writeFile(join(root, "README.md"), "# fixture\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const tour = await buildStarterTour(await inspectRepository(root));
    const commandPages = tour.pages.filter((page) => page.interactions.some((interaction) => interaction.type === "command"));
    expect(commandPages).toHaveLength(2);
    for (const [index, page] of commandPages.entries()) {
      page.interactions = page.interactions.map((interaction) => interaction.type === "command"
        ? {
            ...interaction,
            recipe: {
              ...interaction.recipe,
              id: "duplicate-recipe",
              command: process.execPath,
              args: ["-e", `console.log('page-${index + 1}')`],
            } satisfies RunRecipe,
          }
        : interaction);
    }
    const store = new TourStore(root);
    await store.initialize();
    await store.publish(tour);
    const server = await startWebServer(root);
    servers.push(server);
    const launched = new URL(server.url);
    const response = await fetch(new URL("/api/run", launched), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tourguide-token": launched.searchParams.get("token")!,
      },
      body: JSON.stringify({ pageId: commandPages[1]!.id, recipeId: "duplicate-recipe" }),
    });

    expect(response.status).toBe(200);
    expect((await response.json() as { stdout: string }).stdout.trim()).toBe("page-2");
  });

  it("serves standalone repository knowledge before a tour exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "tourguide-knowledge-web-"));
    temporary.push(root);
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
    await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
    await writeFile(join(root, "README.md"), "# Standalone catalog\n");
    await writeFile(join(root, "schema.sql"), "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const server = await startWebServer(root);
    servers.push(server);
    const launched = new URL(server.url);
    const headers = { "x-tourguide-token": launched.searchParams.get("token")! };

    const response = await fetch(new URL("/api/knowledge", launched), { headers });
    expect(response.status).toBe(200);
    const knowledge = await response.json() as { files: Array<{ path: string }>; catalogs: { dataModel: Array<{ title: string }>; codeDocs: Array<{ path?: string }> } };
    expect(knowledge.files.map((file) => file.path)).toEqual(["README.md", "schema.sql"]);
    expect(knowledge.catalogs.dataModel[0]?.title).toBe("tasks");
    expect(knowledge.catalogs.codeDocs.some((item) => item.path === "README.md")).toBe(true);

    const search = await fetch(new URL("/api/knowledge/search?q=tasks&catalog=data-model", launched), { headers });
    expect((await search.json() as { items: unknown[] }).items).toHaveLength(1);

    const documentationResponse = await fetch(new URL("/api/documentation", launched), { headers });
    expect(documentationResponse.status).toBe(200);
    const documentation = await documentationResponse.json() as {
      id: string;
      subjects: Array<{ id: string; title: string; domain: string }>;
      runtimeProfiles: Array<{ id: string }>;
      inferenceRequests: Array<{ domain: string }>;
    };
    const taskSubject = documentation.subjects.find((subject) => subject.title === "tasks")!;
    expect(taskSubject.domain).toBe("data-model");
    expect(documentation.runtimeProfiles).toContainEqual(expect.objectContaining({ id: "data:application" }));
    expect(documentation.inferenceRequests).toContainEqual(expect.objectContaining({ domain: "data-model" }));
    const documentationSearch = await fetch(new URL("/api/documentation/search?q=tasks&domain=data-model", launched), { headers });
    expect((await documentationSearch.json() as { subjects: unknown[] }).subjects).toHaveLength(1);
    const subjectResponse = await fetch(new URL(`/api/documentation/subjects/${encodeURIComponent(taskSubject.id)}`, launched), { headers });
    expect(subjectResponse.status).toBe(200);
    expect((await subjectResponse.json() as { scenarios: Array<{ operation: string }> }).scenarios).toContainEqual(expect.objectContaining({ operation: "inspect" }));

    await writeFile(join(root, "schema.sql"), "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\nCREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL);\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "add documented data subject"]);
    const updated = await fetch(new URL("/api/documentation", launched), { headers });
    const updatedDocumentation = await updated.json() as { id: string; subjects: Array<{ title: string }> };
    expect(updatedDocumentation.id).not.toBe(documentation.id);
    expect(updatedDocumentation.subjects.some((subject) => subject.title === "projects")).toBe(true);
    const diffResponse = await fetch(new URL(`/api/documentation/diff?from=${encodeURIComponent(documentation.id)}`, launched), { headers });
    expect((await diffResponse.json() as { changes: Array<{ domain: string; classification: string }> }).changes).toContainEqual(expect.objectContaining({ domain: "data-model", classification: "additive" }));
    const updateResponse = await fetch(new URL(`/api/documentation/update-plan?from=${encodeURIComponent(documentation.id)}`, launched), { headers });
    const updatePlan = await updateResponse.json() as { update: { runtimeActions: Array<{ profileId: string; action: string }>; environmentSynthesisProfileIds: string[] } };
    expect(updatePlan.update.runtimeActions).toContainEqual(expect.objectContaining({ profileId: "data:application", action: "update-registry" }));
    expect(updatePlan.update.environmentSynthesisProfileIds).toEqual([]);
  });

  it("reconciles documentation through Codex once and serves validated warm artifacts afterward", async () => {
    const root = await mkdtemp(join(tmpdir(), "tourguide-reconcile-web-"));
    temporary.push(root);
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
    await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
    await writeFile(join(root, "schema.sql"), "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL);\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    let calls = 0;
    const runner = {
      status: async () => ({ status: "ready" as const, version: "test", message: "Ready" }),
      run: async ({ prompt, schema }: { prompt: string; schema: { parse(value: unknown): unknown } }) => {
        calls += 1;
        const requestIds = [...new Set([...prompt.matchAll(/"id": "(inference:[^"]+)"/g)].map((match) => match[1]!))];
        return {
          value: schema.parse({ results: requestIds.map((requestId) => ({ requestId, claims: [], scenarios: [], dependencyContracts: [] })) }),
          usage: { inputTokens: 20, cachedInputTokens: 0, outputTokens: 5 },
          messages: [],
        };
      },
    };
    const server = await startWebServer(root, 0, { runner: runner as never });
    servers.push(server);
    const launched = new URL(server.url);
    const headers = { "content-type": "application/json", "x-tourguide-token": launched.searchParams.get("token")! };

    const firstResponse = await fetch(new URL("/api/documentation/reconcile", launched), {
      method: "POST",
      headers,
      body: JSON.stringify({ includeRuntimes: false }),
    });
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as { documentation: { inferenceRequests: Array<{ status: string }> }; stats: { coldCalls: number; cacheHits: number; usage: { inputTokens: number } } };
    expect(first.documentation.inferenceRequests.every((request) => request.status === "resolved")).toBe(true);
    expect(first.stats).toMatchObject({ coldCalls: 1, cacheHits: 0, usage: { inputTokens: 20 } });

    const warmResponse = await fetch(new URL("/api/documentation/reconcile", launched), {
      method: "POST",
      headers,
      body: JSON.stringify({ includeRuntimes: false }),
    });
    const warm = await warmResponse.json() as { stats: { coldCalls: number; cacheHits: number } };
    expect(warm.stats).toMatchObject({ coldCalls: 0, cacheHits: 1 });
    expect(calls).toBe(1);
  });

  it("runs the contribution loop through process-local lab APIs", async () => {
    const root = await mkdtemp(join(tmpdir(), "tourguide-lab-web-"));
    temporary.push(root);
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
    await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
    await writeFile(join(root, "README.md"), "# fixture\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const tour = await buildStarterTour(await inspectRepository(root));
    const page = tour.pages.find((candidate) => candidate.kind === "exercise")!;
    page.exercise = {
      ...page.exercise!, mode: "patch", allowedPaths: ["README.md"],
      verificationRecipe: {
        id: "verify-readme", title: "Verify README", command: process.execPath,
        args: ["-e", "process.exit(require('fs').readFileSync('README.md','utf8').includes('changed')?0:1)"],
        cwd: ".", lifecycle: "oneshot", timeoutMs: 2_000, env: {}, inputs: [],
        capabilities: { writes: [], network: "none", secrets: [], containers: false, externalSystems: [] },
        expected: "README contains changed.",
      },
    };
    const store = new TourStore(root);
    await store.initialize();
    await store.publish(tour);
    const server = await startWebServer(root);
    servers.push(server);
    const launched = new URL(server.url);
    const token = launched.searchParams.get("token")!;
    const headers = { "content-type": "application/json", "x-tourguide-token": token };
    const createdResponse = await fetch(new URL("/api/exercises", launched), { method: "POST", headers, body: JSON.stringify({ pageId: page.id }) });
    const created = await createdResponse.json() as { session: { id: string; workspace: string }; files: Array<{ path: string }> };
    expect(created.files.map((file) => file.path)).toEqual(["README.md"]);
    await fetch(new URL(`/api/labs/${created.session.id}/files`, launched), { method: "PUT", headers, body: JSON.stringify({ path: "README.md", content: "# changed\n" }) });
    const verified = await fetch(new URL(`/api/labs/${created.session.id}/verify`, launched), { method: "POST", headers, body: JSON.stringify({ pageId: page.id }) });
    expect(await verified.json()).toMatchObject({ status: "pass", expected: "README contains changed." });
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("# fixture\n");
    const retained = await fetch(new URL(`/api/labs/${created.session.id}/retain`, launched), { method: "POST", headers, body: JSON.stringify({ slug: "web flow" }) });
    expect(await retained.json()).toMatchObject({ status: "retained", retainedBranch: expect.stringMatching(/^tourguide\/web-flow-/) });
    expect((await exec("git", ["-C", root, "branch", "--show-current"])).stdout.trim()).toBe("main");
    await fetch(new URL(`/api/labs/${created.session.id}?removeRetained=true`, launched), { method: "DELETE", headers });
  });
});
