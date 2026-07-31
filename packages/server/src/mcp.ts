import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CoverageEntrySchema,
  ModuleSchema,
  PageSchema,
  PreferencesSchema,
  TourSnapshotSchema,
  TourStore,
  TrackSchema,
  assessFreshness,
  contentHash,
  findRepositoryRoot,
  inspectRepositoryAt,
  readRevisionFile,
  runRecipe,
  validateSnapshot,
  type EvidenceRef,
  type FreshnessReport,
  type TourSnapshot,
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

export async function buildRefreshDraft(
  root: string,
  current: TourSnapshot,
  ref: string,
): Promise<{ snapshot: TourSnapshot; freshness: FreshnessReport }> {
  const inventory = await inspectRepositoryAt(root, ref);
  const freshness = await assessFreshness(root, current, inventory.head);
  const stalePages = new Set(freshness.stalePageIds);
  const staleModules = new Set(freshness.staleModuleIds);
  const refreshEvidence = async (evidence: EvidenceRef): Promise<EvidenceRef> => {
    if (!evidence.path) return { ...evidence, revision: inventory.head };
    try {
      const content = await readRevisionFile(root, inventory.head, evidence.path);
      return { ...evidence, revision: inventory.head, contentHash: contentHash(content), validated: true };
    } catch {
      const { contentHash: _contentHash, ...rest } = evidence;
      return { ...rest, revision: inventory.head, validated: false };
    }
  };
  const pages = await Promise.all(current.pages.map(async (page) => ({
    ...page,
    status: stalePages.has(page.id) ? "stale" as const : page.status,
    evidence: await Promise.all(page.evidence.map(refreshEvidence)),
  })));
  const snapshot = TourSnapshotSchema.parse({
    ...current,
    id: randomUUID(),
    anchor: { ref: inventory.ref, commit: inventory.head },
    generatedAt: new Date().toISOString(),
    status: "draft",
    modules: current.modules.map((module) => staleModules.has(module.id) ? { ...module, status: "stale" } : module),
    pages,
  });
  return { snapshot, freshness };
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
    if (!root || !store) throw new Error("Call inspect_project with the target repository path first.");
    return { root, store };
  };
  if (start) await context(start);
  let web: WebServerHandle | undefined;
  const server = new McpServer({ name: "tourguide", version: "0.2.0" });

  server.tool("inspect_project", "Select and inspect a Git repository at a branch, tag, or commit.", {
    path: z.string(),
    ref: z.string().default("HEAD"),
  }, async ({ path, ref }) => {
    const selected = await context(path);
    return result(await inspectRepositoryAt(selected.root, ref));
  });

  server.tool("collect_priorities", "Read or save ordered learning priorities and learner goals.", {
    priorities: z.array(z.string()).optional(),
    goals: z.array(z.string()).optional(),
    allowCodexAdapter: z.boolean().optional(),
  }, async (input) => {
    const selected = await context();
    const next = PreferencesSchema.parse({ ...(await selected.store.preferences()), ...input });
    await selected.store.savePreferences(next);
    return result(next);
  });

  server.tool("begin_snapshot", "Begin a v2 Tourguide draft anchored to a selected Git ref.", {
    projectName: z.string().optional(),
    ref: z.string().default("HEAD"),
  }, async ({ projectName, ref }) => {
    const selected = await context();
    const inventory = await inspectRepositoryAt(selected.root, ref);
    const snapshot = TourSnapshotSchema.parse({
      schemaVersion: 2,
      id: randomUUID(),
      projectName: projectName ?? inventory.name,
      repositoryRoot: selected.root,
      anchor: { ref: inventory.ref, commit: inventory.head },
      generatedAt: new Date().toISOString(),
      generator: "tourguide-agent",
      promptVersion: 2,
      status: "draft",
      tracks: [],
      modules: [],
      pages: [],
      coverage: [],
      dependencies: {},
    });
    await selected.store.saveDraft(snapshot);
    return result(snapshot);
  });

  server.tool("begin_refresh", "Clone the published tour onto a selected ref and mark affected pages and modules stale.", {
    ref: z.string().default("HEAD"),
  }, async ({ ref }) => {
    const selected = await context();
    const current = await selected.store.current();
    if (!current) throw new Error("No published snapshot exists. Use begin_snapshot instead.");
    const { snapshot, freshness } = await buildRefreshDraft(selected.root, current, ref);
    await selected.store.saveDraft(snapshot);
    return result({ snapshotId: snapshot.id, freshness, snapshot });
  });

  server.tool("write_outline", "Replace tracks, modules, and coverage in a Tourguide draft.", {
    snapshotId: z.string(),
    tracks: z.array(TrackSchema),
    modules: z.array(ModuleSchema),
    coverage: z.array(CoverageEntrySchema),
  }, async ({ snapshotId, tracks, modules, coverage }) => {
    const selected = await context();
    const draft = await selected.store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const next = TourSnapshotSchema.parse({ ...draft, tracks, modules, coverage });
    await selected.store.saveDraft(next);
    return result({ snapshotId, trackCount: tracks.length, moduleCount: modules.length });
  });

  server.tool("write_pages", "Add or replace evidence-backed pages in a Tourguide draft.", {
    snapshotId: z.string(),
    pages: z.array(PageSchema),
  }, async ({ snapshotId, pages }) => {
    const selected = await context();
    const draft = await selected.store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const replacements = new Map(pages.map((page) => [page.id, page]));
    const merged = [...draft.pages.filter((page) => !replacements.has(page.id)), ...pages];
    const next = TourSnapshotSchema.parse({
      ...draft,
      pages: merged,
      dependencies: Object.fromEntries(merged.map((page) => [page.id, page.prerequisites])),
    });
    await selected.store.saveDraft(next);
    return result({ snapshotId, written: pages.map((page) => page.id), total: merged.length });
  });

  server.tool("validate_snapshot", "Validate hierarchy, breadth, evidence, exercises, and publication readiness.", {
    snapshotId: z.string(),
    partial: z.boolean().default(false),
  }, async ({ snapshotId, partial }) => {
    const selected = await context();
    const draft = await selected.store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    return result({ ...(await validateSnapshot(draft, selected.root, { partial })), pageCount: draft.pages.length });
  });

  server.tool("publish_snapshot", "Publish a valid complete draft.", {
    snapshotId: z.string(),
  }, async ({ snapshotId }) => {
    const selected = await context();
    const draft = await selected.store.loadDraft(snapshotId);
    if (!draft) throw new Error(`Unknown snapshot ${snapshotId}`);
    const report = await validateSnapshot(draft, selected.root);
    if (!report.valid) throw new Error(`Snapshot is not publishable:\n${report.errors.join("\n")}`);
    await selected.store.publish(draft);
    return result({ published: true, snapshotId, warnings: report.warnings });
  });

  server.tool("probe_recipe", "Run an argv-based page recipe in a disposable worktree at the snapshot commit.", {
    snapshotId: z.string(),
    recipe: z.any(),
    trusted: z.boolean().default(false),
    inputs: z.record(z.string(), z.string()).default({}),
  }, async ({ snapshotId, recipe, trusted, inputs }) => {
    const selected = await context();
    const snapshot = await selected.store.snapshot(snapshotId) ?? await selected.store.loadDraft(snapshotId);
    if (!snapshot) throw new Error(`Unknown snapshot ${snapshotId}`);
    return result(await runRecipe(selected.root, recipe, trusted, inputs, snapshot.anchor.commit));
  });

  server.tool("read_evidence", "Read a bounded source excerpt from a specific committed revision and compute its hash.", {
    path: z.string(),
    revision: z.string(),
    lineStart: z.number().int().positive().default(1),
    lineEnd: z.number().int().positive().optional(),
  }, async ({ path, revision, lineStart, lineEnd }) => {
    const selected = await context();
    const content = await readRevisionFile(selected.root, revision, path);
    const lines = content.split("\n");
    const end = Math.min(lineEnd ?? lineStart + 79, lineStart + 199, lines.length);
    if (end < lineStart) throw new Error("lineEnd must be greater than or equal to lineStart.");
    return result({
      path,
      revision,
      lineStart,
      lineEnd: end,
      contentHash: contentHash(content),
      validated: true,
      content: lines.slice(lineStart - 1, end).join("\n"),
    });
  });

  server.tool("assess_freshness", "Compare the published snapshot with current committed HEAD.", {}, async () => {
    const selected = await context();
    const snapshot = await selected.store.current();
    if (!snapshot) return result({ fresh: false, reason: "No published snapshot" });
    const inventory = await inspectRepositoryAt(selected.root, "HEAD");
    return result(await assessFreshness(selected.root, snapshot, inventory.head));
  });

  server.tool("launch_app", "Launch the local Tourguide browser application at a selected Git ref.", {
    ref: z.string().default("HEAD"),
    model: z.string().optional(),
  }, async ({ ref, model }) => {
    const selected = await context();
    web ??= await startWebServer(selected.root, 0, { ref, ...(model ? { model } : {}) });
    await open(web.url);
    return result({ url: web.url, ref });
  });

  server.tool("get_active_page_context", "Return the current tour and learner preferences for contextual questions.", {}, async () => {
    const selected = await context();
    return result({ tour: await selected.store.current(), preferences: await selected.store.preferences() });
  });

  await server.connect(new StdioServerTransport());
}
