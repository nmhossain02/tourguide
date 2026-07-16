import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  LessonSchema,
  PreferencesSchema,
  TourSnapshotSchema,
  TourStore,
  TrackSchema,
  assessFreshness,
  contentHash,
  findRepositoryRoot,
  inspectRepository,
  readRevisionFile,
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

async function validationErrors(draft: z.output<typeof TourSnapshotSchema>, root: string): Promise<string[]> {
  const ids = new Set(draft.lessons.map((lesson) => lesson.id));
  const errors: string[] = [];
  if (draft.tracks.length === 0) errors.push("Snapshot has no tracks.");
  if (draft.lessons.length === 0) errors.push("Snapshot has no lessons.");
  if (ids.size !== draft.lessons.length) errors.push("Lesson IDs must be unique.");
  if (new Set(draft.tracks.map((track) => track.id)).size !== draft.tracks.length) errors.push("Track IDs must be unique.");
  if (new Set(draft.tracks.map((track) => track.priority)).size !== draft.tracks.length) errors.push("Track priorities must be unique.");
  if (draft.tracks[0]?.kind !== "core" || draft.tracks[0]?.priority !== 0) errors.push("The first track must be the core track at priority 0.");
  if (draft.tracks.some((track, index) => index > 0 && track.priority <= draft.tracks[index - 1]!.priority)) errors.push("Tracks must be ordered by ascending priority.");
  const assignments = new Map<string, number>();
  for (const track of draft.tracks) {
    for (const id of track.lessonIds) {
      if (!ids.has(id)) errors.push(`Track ${track.id} references missing lesson ${id}.`);
      assignments.set(id, (assignments.get(id) ?? 0) + 1);
    }
  }
  for (const lesson of draft.lessons) {
    if (lesson.status !== "ready") errors.push(`Lesson ${lesson.id} must be ready before publication.`);
    if (assignments.get(lesson.id) !== 1) errors.push(`Lesson ${lesson.id} must belong to exactly one track.`);
    if (lesson.narrative.split(/\s+/).length > 350) errors.push(`Lesson ${lesson.id} exceeds 350 narrative words.`);
    for (const prerequisite of lesson.prerequisites) {
      if (!ids.has(prerequisite)) errors.push(`Lesson ${lesson.id} has missing prerequisite ${prerequisite}.`);
      if (prerequisite === lesson.id) errors.push(`Lesson ${lesson.id} cannot depend on itself.`);
    }
    if (lesson.status === "ready" && lesson.evidence.some((evidence) => !evidence.validated && evidence.kind !== "inference")) {
      errors.push(`Ready lesson ${lesson.id} contains unvalidated evidence.`);
    }
    for (const interaction of lesson.interactions) {
      if (interaction.type === "command" && !interaction.recipe.expected) errors.push(`Command recipe ${interaction.recipe.id} needs an expected observation.`);
      if (interaction.type === "source" && interaction.editable) errors.push(`Source interaction in ${lesson.id} cannot be editable; use typed command inputs for experiments.`);
    }
    for (const evidence of lesson.evidence.filter((item) => item.path)) {
      if (evidence.revision !== draft.head) errors.push(`Evidence ${evidence.id} must anchor to snapshot HEAD ${draft.head}.`);
      if (!evidence.contentHash) {
        errors.push(`Evidence ${evidence.id} needs a content hash from read_evidence.`);
        continue;
      }
      try {
        const content = await readRevisionFile(root, draft.head, evidence.path!);
        if (contentHash(content) !== evidence.contentHash) errors.push(`Evidence ${evidence.id} content hash does not match ${evidence.path}.`);
      } catch {
        errors.push(`Evidence ${evidence.id} cannot read tracked path ${evidence.path} at snapshot HEAD.`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const found = (draft.dependencies[id] ?? []).some(cycle);
    visiting.delete(id);
    visited.add(id);
    return found;
  };
  if (draft.lessons.some((lesson) => cycle(lesson.id))) errors.push("Lesson prerequisites must not contain a cycle.");
  return errors;
}

export async function startMcpServer(start?: string): Promise<void> {
  let root: string | undefined;
  let store: TourStore | undefined;
  const context = async (path?: string) => {
    if (path) {
      root = await findRepositoryRoot(path);
      store = new TourStore(root);
      await store.initialize();
    }
    if (!root || !store) throw new Error("Call inspect_project with the target repository's absolute path first.");
    return { root, store };
  };
  if (start) await context(start);
  let web: WebServerHandle | undefined;
  const server = new McpServer({ name: "tourguide", version: "0.1.0" });

  server.tool("inspect_project", "Select and inspect a Git repository using a bounded deterministic shallow scan.", {
    path: z.string().describe("Absolute path within the target Git repository."),
  }, async ({ path }) => {
    const selected = await context(path);
    return result(await inspectRepository(selected.root));
  });

  server.tool("collect_priorities", "Read or save ordered learning priorities and multiple learner goals.", {
    priorities: z.array(z.string()).optional(),
    goals: z.array(z.string()).optional(),
    allowCodexAdapter: z.boolean().optional(),
  }, async (input) => {
    const selected = await context();
    const current = await selected.store.preferences();
    const next = PreferencesSchema.parse({ ...current, ...input });
    await selected.store.savePreferences(next);
    return result(next);
  });

  server.tool("begin_snapshot", "Begin a versioned Tourguide draft anchored to committed HEAD.", {
    projectName: z.string().optional(),
  }, async ({ projectName }) => {
    const selected = await context();
    const inventory = await inspectRepository(selected.root);
    const snapshot = TourSnapshotSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      projectName: projectName ?? inventory.name,
      repositoryRoot: selected.root,
      head: inventory.head,
      branch: inventory.branch,
      generatedAt: new Date().toISOString(),
      generator: "tourguide-agent",
      status: "draft",
      tracks: [],
      lessons: [],
      dependencies: {},
    });
    await selected.store.saveDraft(snapshot);
    return result(snapshot);
  });

  server.tool("begin_refresh", "Clone the published tour onto current HEAD, re-anchor unchanged evidence, and mark only affected lessons stale.", {}, async () => {
    const selected = await context();
    const current = await selected.store.current();
    if (!current) throw new Error("No published snapshot exists. Use begin_snapshot instead.");
    const inventory = await inspectRepository(selected.root);
    const freshness = await assessFreshness(selected.root, current, inventory.head);
    const stale = new Set(freshness.staleLessonIds);
    const snapshot = TourSnapshotSchema.parse({
      ...current,
      id: randomUUID(),
      head: inventory.head,
      branch: inventory.branch,
      generatedAt: new Date().toISOString(),
      status: "draft",
      lessons: current.lessons.map((lesson) => stale.has(lesson.id)
        ? { ...lesson, status: "stale" }
        : { ...lesson, evidence: lesson.evidence.map((evidence) => evidence.path ? { ...evidence, revision: inventory.head } : evidence) }),
    });
    await selected.store.saveDraft(snapshot);
    return result({ snapshotId: snapshot.id, freshness, snapshot });
  });

  server.tool("write_outline", "Replace the track outline of a Tourguide draft.", {
    snapshotId: z.string(),
    tracks: z.array(TrackSchema),
  }, async ({ snapshotId, tracks }) => {
    const selected = await context();
    const draft = await selected.store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const next = TourSnapshotSchema.parse({ ...draft, tracks });
    await selected.store.saveDraft(next);
    return result({ snapshotId, trackCount: tracks.length });
  });

  server.tool("write_lessons", "Add or replace validated lessons in a Tourguide draft.", {
    snapshotId: z.string(),
    lessons: z.array(LessonSchema),
  }, async ({ snapshotId, lessons }) => {
    const selected = await context();
    const draft = await selected.store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const replacements = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    const merged = [...draft.lessons.filter((lesson) => !replacements.has(lesson.id)), ...lessons];
    const dependencies = Object.fromEntries(merged.map((lesson) => [lesson.id, lesson.prerequisites]));
    const next = TourSnapshotSchema.parse({ ...draft, lessons: merged, dependencies });
    await selected.store.saveDraft(next);
    return result({ snapshotId, written: lessons.map((lesson) => lesson.id), total: merged.length });
  });

  server.tool("validate_snapshot", "Validate lesson references, ordering, and publication readiness.", {
    snapshotId: z.string(),
  }, async ({ snapshotId }) => {
    const selected = await context();
    const draft = await selected.store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const errors = await validationErrors(draft, selected.root);
    return result({ valid: errors.length === 0, errors, lessonCount: draft.lessons.length });
  });

  server.tool("publish_snapshot", "Publish a valid draft for progressive use in the browser.", {
    snapshotId: z.string(),
  }, async ({ snapshotId }) => {
    const selected = await context();
    const draft = await selected.store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const errors = await validationErrors(draft, selected.root);
    if (errors.length > 0) throw new Error(`Snapshot is not publishable:\n${errors.join("\n")}`);
    await selected.store.publish(draft);
    return result({ published: true, snapshotId });
  });

  server.tool("probe_recipe", "Run an argv-based lesson recipe through Tourguide's local permission boundary.", {
    recipe: z.any(),
    trusted: z.boolean().default(false),
    inputs: z.record(z.string(), z.string()).default({}),
  }, async ({ recipe, trusted, inputs }) => {
    const selected = await context();
    return result(await runRecipe(selected.root, recipe, trusted, inputs));
  });

  server.tool("read_evidence", "Read a bounded source excerpt from a specific committed revision and compute its content hash.", {
    path: z.string(),
    revision: z.string().optional(),
    lineStart: z.number().int().positive().default(1),
    lineEnd: z.number().int().positive().optional(),
  }, async ({ path, revision, lineStart, lineEnd }) => {
    const selected = await context();
    const inventory = await inspectRepository(selected.root);
    if (!inventory.trackedFiles.includes(path)) throw new Error(`Not a tracked path: ${path}`);
    const anchoredRevision = revision ?? inventory.head;
    const content = await readRevisionFile(selected.root, anchoredRevision, path);
    const lines = content.split("\n");
    const end = Math.min(lineEnd ?? lineStart + 79, lineStart + 199, lines.length);
    if (end < lineStart) throw new Error("lineEnd must be greater than or equal to lineStart.");
    return result({ path, revision: anchoredRevision, lineStart, lineEnd: end, contentHash: contentHash(content), validated: true, content: lines.slice(lineStart - 1, end).join("\n") });
  });

  server.tool("assess_freshness", "Compare the published snapshot with current committed HEAD and propagate stale lesson dependencies.", {}, async () => {
    const selected = await context();
    const snapshot = await selected.store.current();
    if (!snapshot) return result({ fresh: false, reason: "No published snapshot" });
    const inventory = await inspectRepository(selected.root);
    return result(await assessFreshness(selected.root, snapshot, inventory.head));
  });

  server.tool("launch_app", "Launch the local Tourguide browser application.", {}, async () => {
    const selected = await context();
    web ??= await startWebServer(selected.root);
    await open(web.url);
    return result({ url: web.url });
  });

  server.tool("get_active_lesson_context", "Return the published tour for contextual learner questions.", {}, async () => {
    const selected = await context();
    return result({ tour: await selected.store.current(), preferences: await selected.store.preferences() });
  });

  await server.connect(new StdioServerTransport());
}
