import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import {
  LabManager,
  KnowledgeCatalogSchema,
  PreferencesSchema,
  ProgressSchema,
  TourSnapshotSchema,
  TourStore,
  assessFreshness,
  buildLivingDocumentation,
  buildRepositoryKnowledge,
  documentationSnapshotId,
  diffLivingDocumentation,
  findKnowledgeItem,
  inspectRepositoryAt,
  listRepositoryRefs,
  readRevisionFile,
  readWorkingFile,
  planDocumentationUpdate,
  runRecipe,
  searchKnowledge,
  validateSnapshot,
  type Page,
  type Interaction,
  type RunRecipe,
  type TourSnapshot,
  type RepositoryKnowledgeSnapshot,
  type LivingDocumentationSnapshot,
} from "@tourguide/core";

import { CodexExecRunner } from "./codex-exec.js";
import { buildDiagnosticReport, captureDiagnostic } from "./diagnostics.js";
import { TourGenerator } from "./generation.js";
import { IntelligenceCoordinator } from "./intelligence.js";
import { TOURGUIDE_VERSION } from "./version.js";

const here = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

function staticDirectory(): string {
  const candidates = [
    process.env.TOURGUIDE_WEB_DIR,
    resolve(here, "web"),
    resolve(here, "../../../apps/web/dist"),
    resolve(process.cwd(), "plugins/tourguide/dist/web"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(resolve(candidate, "index.html"))) ?? candidates[0]!;
}

function findRecipe(tour: TourSnapshot | undefined, pageId: string, recipeId: string): RunRecipe | undefined {
  const page = tour?.pages.find((candidate) => candidate.id === pageId);
  const matches = page?.interactions.flatMap((interaction) =>
    interaction.type === "command" && interaction.recipe.id === recipeId ? [interaction.recipe] : []) ?? [];
  return matches.length === 1 ? matches[0] : undefined;
}

function findPage(tour: TourSnapshot | undefined, id: string): Page | undefined {
  return tour?.pages.find((page) => page.id === id);
}

type KnowledgeInteraction = Extract<Interaction, { type: "component" | "http" | "database" | "function" }>;

function isKnowledgeInteraction(interaction: Interaction): interaction is KnowledgeInteraction {
  return interaction.type === "component" || interaction.type === "http" || interaction.type === "database" || interaction.type === "function";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface WebServerOptions {
  ref?: string;
  model?: string;
  runner?: CodexExecRunner;
}

export interface WebServerHandle {
  url: string;
  close(): Promise<void>;
}

export async function startWebServer(
  start: string,
  port = 0,
  options: WebServerOptions = {},
): Promise<WebServerHandle> {
  const initialInventory = await inspectRepositoryAt(start, options.ref ?? "HEAD");
  const store = new TourStore(initialInventory.root);
  await store.initialize();
  const interrupted = await store.generationJob();
  if (interrupted && !interrupted.errorCode && interrupted.phase !== "complete"
    && ["queued", "running", "partial"].includes(interrupted.status)) {
    const partial = Boolean((await store.current())?.pages.length);
    await store.saveGenerationJob({
      ...interrupted,
      status: partial ? "partial" : "failed",
      errorCode: "engine",
      message: "The previous Tourguide process stopped before generation completed. Start a new tour to retry.",
      updatedAt: new Date().toISOString(),
    });
    await captureDiagnostic(initialInventory.root, {
      trigger: "interrupted",
      summary: "The previous Tourguide process stopped during generation.",
      context: { jobId: interrupted.id, phase: interrupted.phase },
    }, store).catch(() => undefined);
  }
  const runner = options.runner ?? new CodexExecRunner();
  const generator = new TourGenerator(initialInventory.root, store, runner);
  const intelligence = new IntelligenceCoordinator(initialInventory.root, store, runner, options.model);
  const labs = new LabManager(initialInventory.root);
  const labSweep = setInterval(() => { void labs.sweep(); }, 60_000);
  labSweep.unref();
  let knowledgeBuild: Promise<RepositoryKnowledgeSnapshot> | undefined;
  const documentationBuilds = new Map<string, Promise<LivingDocumentationSnapshot>>();
  const currentKnowledge = async (): Promise<RepositoryKnowledgeSnapshot> => {
    const tour = await store.current();
    const inventory = await inspectRepositoryAt(initialInventory.root, tour?.anchor.commit ?? initialInventory.head);
    const id = tour?.knowledgeSnapshotId ?? `knowledge:${inventory.head}:1`;
    const cached = await store.knowledge(id);
    if (cached) return cached;
    knowledgeBuild ??= buildRepositoryKnowledge(inventory).then(async (snapshot) => {
      await store.saveKnowledge(snapshot);
      return snapshot;
    }).finally(() => {
      knowledgeBuild = undefined;
    });
    return knowledgeBuild;
  };
  const documentationAt = async (ref = "HEAD"): Promise<LivingDocumentationSnapshot> => {
    const inventory = await inspectRepositoryAt(initialInventory.root, ref);
    const knowledgeId = `knowledge:${inventory.head}:1`;
    let knowledge = await store.knowledge(knowledgeId);
    if (!knowledge) {
      knowledge = await buildRepositoryKnowledge(inventory);
      await store.saveKnowledge(knowledge);
    }
    const tour = await store.current();
    const id = documentationSnapshotId(knowledge.anchor.commit);
    const cached = await store.documentation(id);
    if (cached && cached.sourceKnowledgeSnapshotId === knowledge.id) return cached;
    const existing = documentationBuilds.get(id);
    if (existing) return existing;
    const build = Promise.resolve().then(async () => {
      const previous = tour?.documentationSnapshotId ? await store.documentation(tour.documentationSnapshotId) : undefined;
      const snapshot = buildLivingDocumentation(knowledge, previous);
      await store.saveDocumentation(snapshot);
      return snapshot;
    }).finally(() => {
      documentationBuilds.delete(id);
    });
    documentationBuilds.set(id, build);
    return build;
  };
  const currentDocumentation = () => documentationAt("HEAD");

  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const token = randomBytes(24).toString("base64url");
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers.host && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host)) {
      return reply.code(403).send({ error: "Invalid Host header" });
    }
    if (request.url.startsWith("/api/") && request.headers["x-tourguide-token"] !== token) {
      return reply.code(401).send({ error: "Invalid Tourguide session token" });
    }
  });
  app.setErrorHandler(async (error, request, reply) => {
    const httpError = error as Error & { statusCode?: number };
    const statusCode = httpError.statusCode && httpError.statusCode >= 400 ? httpError.statusCode : 500;
    if (statusCode < 500) return reply.code(statusCode).send({ error: httpError.message });
    const captured = await captureDiagnostic(initialInventory.root, {
      trigger: "server",
      summary: `${request.method} ${request.url} failed unexpectedly.`,
      error: httpError,
      context: { method: request.method, url: request.url },
    }, store).catch(() => undefined);
    return reply.code(statusCode).send({
      error: httpError.message,
      ...(captured ? { diagnosticPath: captured.path } : {}),
    });
  });
  app.addHook("onClose", async () => {
    clearInterval(labSweep);
    await labs.shutdown();
  });

  const bootstrap = async () => {
    const tour = await store.current();
    const anchoredInventory = await inspectRepositoryAt(
      initialInventory.root,
      tour?.anchor.commit ?? initialInventory.head,
    );
    const inventory = tour ? { ...anchoredInventory, ref: tour.anchor.ref } : initialInventory;
    const job = await store.generationJob();
    return {
      inventory,
      refs: await listRepositoryRefs(initialInventory.root),
      codex: await runner.status(),
      tour,
      job,
      events: job ? await store.generationEvents(job.id) : [],
      preferences: await store.preferences(),
      progress: await store.progress(),
      freshness: tour
        ? await assessFreshness(initialInventory.root, tour, (await inspectRepositoryAt(initialInventory.root, "HEAD")).head)
        : undefined,
      defaultModel: options.model,
    };
  };

  app.get("/api/health", async () => ({ ok: true, version: TOURGUIDE_VERSION }));
  app.get("/api/diagnostics", async () => ({
    latest: await store.latestDiagnostic(),
    latestPath: store.diagnosticPath(),
    current: await buildDiagnosticReport(initialInventory.root, {
      trigger: "manual",
      summary: "Current Tourguide diagnostic snapshot.",
      codex: await runner.status(),
    }, store),
  }));
  app.post<{ Body: { message?: string; stack?: string; componentStack?: string; url?: string; userAgent?: string } }>(
    "/api/diagnostics/client",
    async (request, reply) => {
      const message = request.body?.message?.trim();
      if (!message) return reply.code(400).send({ error: "A browser error message is required." });
      const error = new Error(message);
      if (request.body.stack) error.stack = request.body.stack;
      const captured = await captureDiagnostic(initialInventory.root, {
        trigger: "browser",
        summary: "The Tourguide browser application crashed.",
        error,
        context: {
          componentStack: request.body.componentStack,
          url: request.body.url,
          userAgent: request.body.userAgent,
        },
      }, store);
      return reply.code(201).send(captured);
    },
  );
  app.get("/api/bootstrap", bootstrap);
  app.get("/api/project", bootstrap);
  app.get("/api/refs", async () => await listRepositoryRefs(initialInventory.root));
  app.get("/api/codex", async () => await runner.status());
  app.get("/api/tour", async () => await store.current());
  app.get("/api/knowledge", async () => await currentKnowledge());
  app.get<{ Querystring: { ref?: string } }>("/api/documentation", async (request) => await documentationAt(request.query.ref ?? "HEAD"));
  app.get<{ Querystring: { q?: string; domain?: string } }>("/api/documentation/search", async (request) => {
    const snapshot = await currentDocumentation();
    const query = (request.query.q ?? "").trim().toLowerCase();
    const domain = request.query.domain?.trim();
    return {
      snapshotId: snapshot.id,
      subjects: snapshot.subjects.filter((subject) => (
        (!domain || subject.domain === domain)
        && (!query || `${subject.title} ${subject.summary} ${subject.kind}`.toLowerCase().includes(query))
      )),
    };
  });
  app.get<{ Params: { subjectId: string } }>("/api/documentation/subjects/:subjectId", async (request, reply) => {
    const snapshot = await currentDocumentation();
    const subject = snapshot.subjects.find((candidate) => candidate.id === request.params.subjectId);
    if (!subject) return reply.code(404).send({ error: "Unknown documentation subject" });
    return {
      snapshotId: snapshot.id,
      subject,
      claims: snapshot.claims.filter((claim) => claim.subjectId === subject.id),
      scenarios: snapshot.scenarios.filter((scenario) => scenario.subjectId === subject.id),
      runtimeProfiles: snapshot.runtimeProfiles.filter((profile) => profile.subjectIds.includes(subject.id)),
      relationships: snapshot.relationships.filter((relationship) => relationship.sourceId === subject.id || relationship.targetId === subject.id),
    };
  });
  app.get<{ Querystring: { from?: string } }>("/api/documentation/diff", async (request, reply) => {
    if (!request.query.from) return reply.code(400).send({ error: "A previous documentation snapshot ID is required." });
    const previous = await store.documentation(request.query.from);
    if (!previous) return reply.code(404).send({ error: "Unknown previous documentation snapshot" });
    return diffLivingDocumentation(previous, await currentDocumentation());
  });
  app.get<{ Querystring: { from?: string } }>("/api/documentation/update-plan", async (request, reply) => {
    if (!request.query.from) return reply.code(400).send({ error: "A previous documentation snapshot ID is required." });
    const previous = await store.documentation(request.query.from);
    if (!previous) return reply.code(404).send({ error: "Unknown previous documentation snapshot" });
    const next = await currentDocumentation();
    const diff = diffLivingDocumentation(previous, next);
    const tour = await store.current();
    return { diff, update: planDocumentationUpdate(previous, next, diff, { affectedTours: tour ? [tour] : [] }) };
  });
  app.post<{ Body: { ref?: string; includeRuntimes?: boolean } }>("/api/documentation/reconcile", async (request, reply) => {
    const preferences = await store.preferences();
    if (!preferences.allowCodexAdapter) return reply.code(403).send({ error: "Codex inference is disabled in Tourguide preferences." });
    const status = await runner.status();
    if (status.status !== "ready") return reply.code(503).send({ error: status.message });
    const inventory = await inspectRepositoryAt(initialInventory.root, request.body?.ref ?? "HEAD");
    const knowledgeId = `knowledge:${inventory.head}:1`;
    const knowledge = await store.knowledge(knowledgeId) ?? await buildRepositoryKnowledge(inventory);
    await store.saveKnowledge(knowledge);
    const tour = await store.current();
    const previous = tour?.documentationSnapshotId ? await store.documentation(tour.documentationSnapshotId) : undefined;
    const reconciled = await intelligence.reconcileDocumentation(knowledge, previous);
    const runtimes = request.body?.includeRuntimes === false
      ? { documentation: reconciled.documentation, artifacts: [], stats: { coldCalls: 0, cacheHits: 0, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } } }
      : await intelligence.resolveRuntimeProviders(reconciled.documentation, inventory);
    const diff = previous ? diffLivingDocumentation(previous, runtimes.documentation) : undefined;
    const assessment = tour && diff
      ? await intelligence.assessTourImpact(tour, diff, runtimes.documentation)
      : { stats: { coldCalls: 0, cacheHits: 0, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } } };
    return {
      documentation: runtimes.documentation,
      ...(diff ? { diff } : {}),
      runtimeProviders: runtimes.artifacts,
      ...(assessment.artifact ? { tourAssessment: assessment.artifact } : {}),
      stats: {
        coldCalls: reconciled.stats.coldCalls + runtimes.stats.coldCalls + assessment.stats.coldCalls,
        cacheHits: reconciled.stats.cacheHits + runtimes.stats.cacheHits + assessment.stats.cacheHits,
        usage: {
          inputTokens: reconciled.stats.usage.inputTokens + runtimes.stats.usage.inputTokens + assessment.stats.usage.inputTokens,
          cachedInputTokens: reconciled.stats.usage.cachedInputTokens + runtimes.stats.usage.cachedInputTokens + assessment.stats.usage.cachedInputTokens,
          outputTokens: reconciled.stats.usage.outputTokens + runtimes.stats.usage.outputTokens + assessment.stats.usage.outputTokens,
        },
      },
    };
  });
  app.get<{ Querystring: { q?: string; catalog?: string } }>("/api/knowledge/search", async (request, reply) => {
    const parsedCatalog = request.query.catalog ? KnowledgeCatalogSchema.safeParse(request.query.catalog) : undefined;
    if (parsedCatalog && !parsedCatalog.success) return reply.code(400).send({ error: "Unknown knowledge catalog" });
    const snapshot = await currentKnowledge();
    return {
      snapshotId: snapshot.id,
      items: searchKnowledge(snapshot, request.query.q ?? "", parsedCatalog?.data),
    };
  });
  app.get<{ Params: { catalog: string; itemId: string } }>("/api/knowledge/:catalog/:itemId", async (request, reply) => {
    const catalog = KnowledgeCatalogSchema.safeParse(request.params.catalog);
    if (!catalog.success) return reply.code(404).send({ error: "Unknown knowledge catalog" });
    const snapshot = await currentKnowledge();
    const item = findKnowledgeItem(snapshot, catalog.data, request.params.itemId);
    if (!item) return reply.code(404).send({ error: "Unknown knowledge item" });
    return {
      snapshotId: snapshot.id,
      item,
      relationships: snapshot.relationships.filter((relationship) => relationship.sourceId === item.id || relationship.targetId === item.id),
    };
  });

  app.get<{ Querystring: { path?: string; view?: string } }>("/api/source", async (request, reply) => {
    const tour = await store.current();
    const revision = tour?.anchor.commit ?? initialInventory.head;
    const inventory = await inspectRepositoryAt(initialInventory.root, revision);
    const path = request.query.path;
    if (!path || !inventory.trackedFiles.includes(path)) return reply.code(404).send({ error: "Unknown tracked source path" });
    const content = request.query.view === "working"
      ? await readWorkingFile(initialInventory.root, path).catch(() => readRevisionFile(initialInventory.root, revision, path))
      : await readRevisionFile(initialInventory.root, revision, path);
    return {
      path,
      revision,
      view: request.query.view === "working" ? "working" : "selected",
      content,
      dirty: inventory.dirtyFiles.includes(path),
    };
  });

  app.post<{ Body: unknown }>("/api/preferences", async (request) => {
    const value = PreferencesSchema.parse(request.body);
    await store.savePreferences(value);
    return value;
  });
  app.post<{ Body: unknown }>("/api/progress", async (request) => {
    const value = ProgressSchema.parse(request.body);
    await store.saveProgress(value);
    return value;
  });
  app.post<{ Body: unknown }>("/api/tour", async (request, reply) => {
    const value = TourSnapshotSchema.parse(request.body);
    const knowledge = await store.knowledge(value.knowledgeSnapshotId);
    const documentation = value.documentationSnapshotId ? await store.documentation(value.documentationSnapshotId) : undefined;
    const report = await validateSnapshot(value, initialInventory.root, {
      ...(knowledge ? { knowledge } : {}),
      ...(documentation ? { documentation } : {}),
    });
    if (!report.valid) return reply.code(400).send({ error: "Tour is not publishable.", report });
    await store.publish(value);
    return { ok: true, id: value.id, warnings: report.warnings };
  });

  app.get<{ Querystring: { after?: string } }>("/api/generation/events", async (request) => {
    const job = await store.generationJob();
    if (!job) return { job: undefined, events: [] };
    const after = Number(request.query.after ?? 0);
    const events = (await store.generationEvents(job.id)).filter((event) => event.id > after);
    return { job, events, tour: await store.current() };
  });
  app.post<{
    Body: { ref?: string; goal?: string; priorities?: string[]; model?: string; depth?: "quick" | "standard" | "deep" };
  }>("/api/generation", async (request, reply) => {
    const goal = request.body?.goal?.trim();
    if (!goal) return reply.code(400).send({ error: "Describe what you want to learn or accomplish." });
    try {
      const preferences = PreferencesSchema.parse({
        ...(await store.preferences()),
        goals: [goal],
        priorities: request.body.priorities ?? [],
      });
      await store.savePreferences(preferences);
      const model = request.body.model ?? options.model;
      const job = await generator.start({
        ref: request.body.ref ?? initialInventory.ref,
        goal,
        priorities: preferences.priorities,
        ...(model ? { model } : {}),
        ...(request.body.depth ? { depth: request.body.depth } : {}),
      });
      return reply.code(202).send(job);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.post("/api/generation/cancel", async (_request, reply) => {
    try {
      await generator.cancel();
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post<{ Body: { pageId?: string; recipeId?: string; trusted?: boolean; inputs?: Record<string, string> } }>("/api/run", async (request, reply) => {
    const tour = await store.current();
    const recipe = request.body?.pageId && request.body.recipeId
      ? findRecipe(tour, request.body.pageId, request.body.recipeId)
      : undefined;
    if (!recipe || !tour) return reply.code(404).send({ error: "Unknown recipe" });
    try {
      return await runRecipe(
        initialInventory.root,
        recipe,
        request.body.trusted === true,
        request.body.inputs ?? {},
        tour.anchor.commit,
      );
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get("/api/labs", async () => ({ sessions: labs.list() }));
  app.post<{ Body: { moduleId?: string; trusted?: boolean } }>("/api/labs", async (request, reply) => {
    const tour = await store.current();
    if (!tour || !request.body?.moduleId) return reply.code(404).send({ error: "Unknown lab module" });
    try {
      return await labs.create(tour, request.body.moduleId, request.body.trusted === true);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.get<{ Params: { id: string } }>("/api/labs/:id", async (request, reply) => {
    try { return labs.get(request.params.id); } catch (error) { return reply.code(404).send({ error: errorMessage(error) }); }
  });
  app.get<{ Params: { id: string } }>("/api/labs/:id/files", async (request, reply) => {
    try { return { files: await labs.files(request.params.id) }; } catch (error) { return reply.code(404).send({ error: errorMessage(error) }); }
  });
  app.put<{ Params: { id: string }; Body: { path?: string; content?: string } }>("/api/labs/:id/files", async (request, reply) => {
    if (typeof request.body?.path !== "string" || typeof request.body.content !== "string") return reply.code(400).send({ error: "Path and content are required." });
    try { return await labs.write(request.params.id, request.body.path, request.body.content); } catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
  });
  app.post<{ Params: { id: string }; Body: { pageId?: string; recipeId?: string; trusted?: boolean; inputs?: Record<string, string> } }>("/api/labs/:id/run", async (request, reply) => {
    const tour = await store.current();
    const recipe = request.body?.pageId && request.body.recipeId ? findRecipe(tour, request.body.pageId, request.body.recipeId) : undefined;
    if (!recipe) return reply.code(404).send({ error: "Unknown lab recipe" });
    try { return await labs.run(request.params.id, recipe, request.body.trusted === true, request.body.inputs ?? {}); } catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
  });
  app.post<{ Params: { id: string }; Body: { pageId?: string; action?: "verify" | "format"; trusted?: boolean } }>("/api/labs/:id/verify", async (request, reply) => {
    const tour = await store.current();
    const page = request.body?.pageId ? findPage(tour, request.body.pageId) : undefined;
    const action = request.body.action ?? "verify";
    const recipe = action === "format" ? page?.exercise?.formatRecipe : page?.exercise?.verificationRecipe;
    if (!recipe) return reply.code(404).send({ error: `This exercise does not provide a ${action} recipe.` });
    try {
      return await labs.verify(request.params.id, recipe, request.body.trusted === true, {}, page?.exercise?.verificationChecks ?? []);
    } catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
  });
  app.get<{ Params: { id: string } }>("/api/labs/:id/patch", async (request, reply) => {
    try { return { patch: await labs.patch(request.params.id) }; } catch (error) { return reply.code(404).send({ error: errorMessage(error) }); }
  });
  app.post<{ Params: { id: string } }>("/api/labs/:id/reset", async (request, reply) => {
    try { return await labs.reset(request.params.id); } catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
  });
  app.post<{ Params: { id: string }; Body: { slug?: string } }>("/api/labs/:id/retain", async (request, reply) => {
    try { return await labs.retain(request.params.id, request.body?.slug); } catch (error) { return reply.code(400).send({ error: errorMessage(error) }); }
  });
  app.get<{ Params: { id: string } }>("/api/labs/:id/events", async (request, reply) => {
    try { return { session: labs.get(request.params.id) }; } catch (error) { return reply.code(404).send({ error: errorMessage(error) }); }
  });
  app.delete<{ Params: { id: string }; Querystring: { removeRetained?: string } }>("/api/labs/:id", async (request) => {
    await labs.close(request.params.id, request.query.removeRetained === "true");
    return { ok: true };
  });
  app.post<{ Body: { pageId?: string; itemId?: string; inputs?: Record<string, unknown>; trusted?: boolean } }>("/api/lab-interactions", async (request, reply) => {
    const tour = await store.current();
    const page = request.body?.pageId ? findPage(tour, request.body.pageId) : undefined;
    const interaction = page?.interactions.find((candidate): candidate is KnowledgeInteraction => (
      isKnowledgeInteraction(candidate) && candidate.target.itemId === request.body.itemId
    ));
    if (!tour || !page || !interaction) return reply.code(404).send({ error: "Unknown lab interaction" });
    const knowledge = await currentKnowledge();
    const item = findKnowledgeItem(knowledge, interaction.target.catalog, interaction.target.itemId);
    if (!item || item.contentHash !== interaction.target.contentHash) return reply.code(409).send({ error: "The interaction target is stale or unavailable." });
    const capability = interaction.type === "component"
      ? "ui.render"
      : interaction.type === "function"
        ? "code.invoke"
        : interaction.type === "database"
          ? "data.query"
          : "service.request";
    try {
      const { session } = await labs.create(tour, page.moduleId, request.body.trusted === true);
      return { session, invocation: await labs.invokeCapability(session.id, capability, { item, inputs: request.body.inputs ?? {} }) };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.post<{ Body: { labId?: string; path?: string } }>("/api/editor/open", async (request, reply) => {
    if (!request.body?.labId) return reply.code(400).send({ error: "A lab session is required." });
    try {
      const session = labs.get(request.body.labId);
      const selectedPath = request.body.path ?? ".";
      if (selectedPath !== "." && !session.editablePaths.includes(selectedPath)) throw new Error("The requested editor path is not editable in this lab.");
      const target = resolve(session.workspace, selectedPath);
      const rel = relative(session.workspace, target);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Editor path escapes the lab workspace.");
      const configured = (await store.preferences()).editorCommand;
      const [command, ...args] = configured ?? ["code", "--reuse-window"];
      if (!configured) await execFileAsync(command!, ["--version"], { timeout: 3_000 }).catch(() => { throw new Error("VS Code was not detected. Configure an argv-based editor command first."); });
      const child = spawn(command!, [...args, target], { shell: false, detached: true, stdio: "ignore" });
      child.unref();
      return { ok: true, command: [command, ...args], target };
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });

  // Compatibility delegates for clients authored against the v2 exercise routes.
  app.post<{ Body: { pageId?: string } }>("/api/exercises", async (request, reply) => {
    const tour = await store.current();
    const page = request.body?.pageId ? findPage(tour, request.body.pageId) : undefined;
    if (!tour || !page) return reply.code(404).send({ error: "Unknown exercise page" });
    try {
      return await labs.create(tour, page.moduleId);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.get<{ Params: { id: string } }>("/api/exercises/:id/files", async (request, reply) => {
    try {
      return { files: await labs.files(request.params.id) };
    } catch (error) {
      return reply.code(404).send({ error: errorMessage(error) });
    }
  });
  app.put<{ Params: { id: string }; Body: { path?: string; content?: string } }>("/api/exercises/:id/files", async (request, reply) => {
    if (typeof request.body?.path !== "string" || typeof request.body.content !== "string") {
      return reply.code(400).send({ error: "Path and content are required." });
    }
    try {
      return await labs.write(request.params.id, request.body.path, request.body.content);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.post<{
    Params: { id: string };
    Body: { pageId?: string; action?: "verify" | "format"; trusted?: boolean };
  }>("/api/exercises/:id/run", async (request, reply) => {
    const tour = await store.current();
    const page = request.body?.pageId ? findPage(tour, request.body.pageId) : undefined;
    if (!tour || !page) return reply.code(404).send({ error: "Unknown exercise page" });
    try {
      const action = request.body.action ?? "verify";
      const recipe = action === "format" ? page.exercise?.formatRecipe : page.exercise?.verificationRecipe;
      if (!recipe) return reply.code(404).send({ error: `This exercise does not provide a ${action} recipe.` });
      return action === "verify"
        ? (await labs.verify(request.params.id, recipe, request.body.trusted === true, {}, page.exercise?.verificationChecks ?? [])).result
        : await labs.run(request.params.id, recipe, request.body.trusted === true);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.get<{ Params: { id: string } }>("/api/exercises/:id/patch", async (request, reply) => {
    try {
      return { patch: await labs.patch(request.params.id) };
    } catch (error) {
      return reply.code(404).send({ error: errorMessage(error) });
    }
  });
  app.post<{ Params: { id: string } }>("/api/exercises/:id/reset", async (request, reply) => {
    try {
      return await labs.reset(request.params.id);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.delete<{ Params: { id: string } }>("/api/exercises/:id", async (request) => {
    await labs.close(request.params.id);
    return { ok: true };
  });

  const webRoot = staticDirectory();
  await app.register(fastifyStatic, { root: webRoot, prefix: "/" });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
    return reply.type("text/html").sendFile("index.html");
  });

  await app.listen({ host: "127.0.0.1", port });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("Tourguide did not receive a TCP port.");
  return {
    url: `http://127.0.0.1:${address.port}/?token=${token}`,
    close: () => app.close(),
  };
}
