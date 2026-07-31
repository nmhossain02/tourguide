import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import {
  ExerciseWorkspaceManager,
  PreferencesSchema,
  ProgressSchema,
  TourSnapshotSchema,
  TourStore,
  assessFreshness,
  inspectRepositoryAt,
  listRepositoryRefs,
  readRevisionFile,
  readWorkingFile,
  runRecipe,
  validateSnapshot,
  type Page,
  type RunRecipe,
  type TourSnapshot,
} from "@tourguide/core";

import { CodexExecRunner } from "./codex-exec.js";
import { buildDiagnosticReport, captureDiagnostic } from "./diagnostics.js";
import { TourGenerator } from "./generation.js";
import { TOURGUIDE_VERSION } from "./version.js";

const here = dirname(fileURLToPath(import.meta.url));

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface WebServerOptions {
  ref?: string;
  model?: string;
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
  const runner = new CodexExecRunner();
  const generator = new TourGenerator(initialInventory.root, store, runner);
  const exercises = new ExerciseWorkspaceManager(initialInventory.root, store);

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
    const report = await validateSnapshot(value, initialInventory.root);
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
    Body: { ref?: string; goal?: string; priorities?: string[]; model?: string };
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

  app.post<{ Body: { pageId?: string } }>("/api/exercises", async (request, reply) => {
    const tour = await store.current();
    const page = request.body?.pageId ? findPage(tour, request.body.pageId) : undefined;
    if (!tour || !page) return reply.code(404).send({ error: "Unknown exercise page" });
    try {
      return await exercises.create(tour, page);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.get<{ Params: { id: string } }>("/api/exercises/:id/files", async (request, reply) => {
    try {
      return { files: await exercises.files(request.params.id) };
    } catch (error) {
      return reply.code(404).send({ error: errorMessage(error) });
    }
  });
  app.put<{ Params: { id: string }; Body: { path?: string; content?: string } }>("/api/exercises/:id/files", async (request, reply) => {
    if (typeof request.body?.path !== "string" || typeof request.body.content !== "string") {
      return reply.code(400).send({ error: "Path and content are required." });
    }
    try {
      return await exercises.write(request.params.id, request.body.path, request.body.content);
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
      return await exercises.run(
        request.params.id,
        tour,
        page,
        request.body.action ?? "verify",
        request.body.trusted === true,
      );
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.get<{ Params: { id: string } }>("/api/exercises/:id/patch", async (request, reply) => {
    try {
      return { patch: await exercises.patch(request.params.id) };
    } catch (error) {
      return reply.code(404).send({ error: errorMessage(error) });
    }
  });
  app.post<{ Params: { id: string } }>("/api/exercises/:id/reset", async (request, reply) => {
    try {
      return await exercises.reset(request.params.id);
    } catch (error) {
      return reply.code(400).send({ error: errorMessage(error) });
    }
  });
  app.delete<{ Params: { id: string } }>("/api/exercises/:id", async (request) => {
    await exercises.remove(request.params.id);
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
