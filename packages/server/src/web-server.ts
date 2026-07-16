import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import {
  PreferencesSchema,
  ProgressSchema,
  TourSnapshotSchema,
  TourStore,
  buildStarterTour,
  assessFreshness,
  inspectRepository,
  readHeadFile,
  readWorkingFile,
  runRecipe,
  type RunRecipe,
} from "@tourguide/core";

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

function findRecipe(tour: Awaited<ReturnType<TourStore["current"]>>, id: string): RunRecipe | undefined {
  for (const lesson of tour?.lessons ?? []) {
    for (const interaction of lesson.interactions) {
      if (interaction.type === "command" && interaction.recipe.id === id) return interaction.recipe;
    }
  }
  return undefined;
}

export interface WebServerHandle {
  url: string;
  close(): Promise<void>;
}

export async function startWebServer(start: string, port = 0): Promise<WebServerHandle> {
  const inventory = await inspectRepository(start);
  const store = new TourStore(inventory.root);
  await store.initialize();
  if (!(await store.current())) await store.publish(await buildStarterTour(inventory));

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

  app.get("/api/health", async () => ({ ok: true, version: "0.1.0" }));
  app.get("/api/project", async () => {
    const currentInventory = await inspectRepository(inventory.root);
    const tour = await store.current();
    return {
      inventory: currentInventory,
      preferences: await store.preferences(),
      progress: await store.progress(),
      freshness: tour ? await assessFreshness(inventory.root, tour, currentInventory.head) : undefined,
    };
  });
  app.get("/api/tour", async () => await store.current());
  app.get<{ Querystring: { path?: string; view?: string } }>("/api/source", async (request, reply) => {
    const path = request.query.path;
    if (!path || !inventory.trackedFiles.includes(path)) return reply.code(404).send({ error: "Unknown tracked source path" });
    const content = request.query.view === "working"
      ? await readWorkingFile(inventory.root, path).catch(() => readHeadFile(inventory.root, path))
      : await readHeadFile(inventory.root, path);
    return { path, view: request.query.view === "working" ? "working" : "head", content, dirty: inventory.dirtyFiles.includes(path) };
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
  app.post<{ Body: unknown }>("/api/tour", async (request) => {
    const value = TourSnapshotSchema.parse(request.body);
    await store.publish(value);
    return { ok: true, id: value.id };
  });
  app.post<{ Body: { recipeId?: string; trusted?: boolean; inputs?: Record<string, string> } }>("/api/run", async (request, reply) => {
    const recipe = request.body?.recipeId ? findRecipe(await store.current(), request.body.recipeId) : undefined;
    if (!recipe) return reply.code(404).send({ error: "Unknown recipe" });
    try {
      return await runRecipe(inventory.root, recipe, request.body.trusted === true, request.body.inputs ?? {});
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
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
