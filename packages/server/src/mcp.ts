import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  LessonSchema,
  PreferencesSchema,
  TourSnapshotSchema,
  TourStore,
  TrackSchema,
  findRepositoryRoot,
  inspectRepository,
  runRecipe,
} from "@tourguide/core";
import open from "open";
import { z } from "zod";

import { startWebServer, type WebServerHandle } from "./web-server.js";

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function validationErrors(draft: z.output<typeof TourSnapshotSchema>): string[] {
  const ids = new Set(draft.lessons.map((lesson) => lesson.id));
  const errors: string[] = [];
  for (const track of draft.tracks) {
    for (const id of track.lessonIds) if (!ids.has(id)) errors.push(`Track ${track.id} references missing lesson ${id}.`);
  }
  for (const lesson of draft.lessons) {
    if (lesson.narrative.split(/\s+/).length > 350) errors.push(`Lesson ${lesson.id} exceeds 350 narrative words.`);
    if (lesson.status === "ready" && lesson.evidence.some((evidence) => !evidence.validated && evidence.kind !== "inference")) {
      errors.push(`Ready lesson ${lesson.id} contains unvalidated evidence.`);
    }
  }
  return errors;
}

export async function startMcpServer(start = process.cwd()): Promise<void> {
  const root = await findRepositoryRoot(start);
  const store = new TourStore(root);
  await store.initialize();
  let web: WebServerHandle | undefined;
  const server = new McpServer({ name: "tourguide", version: "0.1.0" });

  server.tool("inspect_project", "Inspect the current Git repository using a bounded deterministic shallow scan.", {}, async () => result(await inspectRepository(root)));

  server.tool("collect_priorities", "Read or save ordered learning priorities and multiple learner goals.", {
    priorities: z.array(z.string()).optional(),
    goals: z.array(z.string()).optional(),
    allowCodexAdapter: z.boolean().optional(),
  }, async (input) => {
    const current = await store.preferences();
    const next = PreferencesSchema.parse({ ...current, ...input });
    await store.savePreferences(next);
    return result(next);
  });

  server.tool("begin_snapshot", "Begin a versioned Tourguide draft anchored to committed HEAD.", {
    projectName: z.string().optional(),
  }, async ({ projectName }) => {
    const inventory = await inspectRepository(root);
    const snapshot = TourSnapshotSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectName: projectName ?? inventory.name,
      repositoryRoot: root,
      head: inventory.head,
      branch: inventory.branch,
      generatedAt: new Date().toISOString(),
      generator: "tourguide-agent",
      status: "draft",
      tracks: [],
      lessons: [],
      dependencies: {},
    });
    await store.saveDraft(snapshot);
    return result(snapshot);
  });

  server.tool("write_outline", "Replace the track outline of a Tourguide draft.", {
    snapshotId: z.string(),
    tracks: z.array(TrackSchema),
  }, async ({ snapshotId, tracks }) => {
    const draft = await store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const next = TourSnapshotSchema.parse({ ...draft, tracks });
    await store.saveDraft(next);
    return result({ snapshotId, trackCount: tracks.length });
  });

  server.tool("write_lessons", "Add or replace validated lessons in a Tourguide draft.", {
    snapshotId: z.string(),
    lessons: z.array(LessonSchema),
  }, async ({ snapshotId, lessons }) => {
    const draft = await store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const replacements = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    const merged = [...draft.lessons.filter((lesson) => !replacements.has(lesson.id)), ...lessons];
    const next = TourSnapshotSchema.parse({ ...draft, lessons: merged });
    await store.saveDraft(next);
    return result({ snapshotId, written: lessons.map((lesson) => lesson.id), total: merged.length });
  });

  server.tool("validate_snapshot", "Validate lesson references, ordering, and publication readiness.", {
    snapshotId: z.string(),
  }, async ({ snapshotId }) => {
    const draft = await store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const errors = validationErrors(draft);
    return result({ valid: errors.length === 0, errors, lessonCount: draft.lessons.length });
  });

  server.tool("publish_snapshot", "Publish a valid draft for progressive use in the browser.", {
    snapshotId: z.string(),
  }, async ({ snapshotId }) => {
    const draft = await store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const errors = validationErrors(draft);
    if (errors.length > 0) throw new Error(`Snapshot is not publishable:\n${errors.join("\n")}`);
    await store.publish(draft);
    return result({ published: true, snapshotId });
  });

  server.tool("probe_recipe", "Run an argv-based lesson recipe through Tourguide's local permission boundary.", {
    recipe: z.any(),
    trusted: z.boolean().default(false),
    inputs: z.record(z.string(), z.string()).default({}),
  }, async ({ recipe, trusted, inputs }) => result(await runRecipe(root, recipe, trusted, inputs)));

  server.tool("launch_app", "Launch the local Tourguide browser application.", {}, async () => {
    web ??= await startWebServer(root);
    await open(web.url);
    return result({ url: web.url });
  });

  server.tool("get_active_lesson_context", "Return the published tour for contextual learner questions.", {}, async () => result({ tour: await store.current(), preferences: await store.preferences() }));

  await server.connect(new StdioServerTransport());
}
