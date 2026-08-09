import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  EvidenceRefSchema,
  InteractionSchema,
  KnowledgeCheckSchema,
  ModuleSchema,
  PageSchema,
  CoverageEntrySchema,
  TrackSchema,
  PageProgressSchema,
  PreferencesSchema,
  ProgressSchema,
  TourSnapshotSchema,
  type Progress,
  type TourSnapshot,
} from "./schema.js";
import { knowledgeSnapshotId } from "./knowledge.js";

const LegacyUrlReferenceSchema = z.object({ title: z.string(), url: z.url() });
const LegacyV2PageSchema = PageSchema.omit({ references: true }).extend({
  references: z.array(LegacyUrlReferenceSchema).default([]),
});

const LegacyV2SnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string(),
  projectName: z.string(),
  repositoryRoot: z.string(),
  anchor: z.object({ ref: z.string(), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  generatedAt: z.string(),
  generator: z.string().default("tourguide"),
  promptVersion: z.number().int().positive().default(2),
  status: z.enum(["draft", "partial", "published"]).default("draft"),
  tracks: z.array(TrackSchema),
  modules: z.array(ModuleSchema),
  pages: z.array(LegacyV2PageSchema),
  coverage: z.array(CoverageEntrySchema).default([]),
  dependencies: z.record(z.string(), z.array(z.string())).default({}),
});

const LegacyV2ProgressSchema = z.object({
  schemaVersion: z.literal(2).default(2),
  pages: z.record(z.string(), PageProgressSchema).default({}),
});

const LegacyLessonSchema = z.object({
  id: z.string(),
  objectiveId: z.string(),
  title: z.string(),
  objective: z.string(),
  estimatedMinutes: z.number().int().positive().default(5),
  narrative: z.string(),
  status: z.enum(["draft", "ready", "blocked", "stale"]).default("draft"),
  prerequisites: z.array(z.string()).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  interactions: z.array(InteractionSchema).min(1),
  knowledgeCheck: KnowledgeCheckSchema.optional(),
  references: z.array(z.object({ title: z.string(), url: z.url() })).default([]),
});

const LegacySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  projectName: z.string(),
  repositoryRoot: z.string(),
  head: z.string().regex(/^[0-9a-f]{40}$/),
  branch: z.string(),
  generatedAt: z.string(),
  generator: z.string().default("tourguide"),
  status: z.enum(["draft", "published", "partial"]).default("draft"),
  tracks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    summary: z.string(),
    kind: z.enum(["core", "selected", "suggested"]),
    priority: z.number().int().nonnegative(),
    lessonIds: z.array(z.string()),
  })),
  lessons: z.array(LegacyLessonSchema),
  dependencies: z.record(z.string(), z.array(z.string())).default({}),
});

const LegacyProgressSchema = z.object({
  lessons: z.record(z.string(), z.object({
    viewed: z.boolean().default(false),
    experimented: z.boolean().default(false),
    revisit: z.boolean().default(false),
    note: z.string().optional(),
    updatedAt: z.string(),
  })).default({}),
});

function pageKind(title: string, interactions: z.infer<typeof InteractionSchema>[]) {
  if (interactions.some((interaction) => interaction.type === "command")) return "demo" as const;
  if (interactions.some((interaction) => interaction.type === "data" || interaction.type === "topology")) return "orientation" as const;
  if (/orient|map|overview/i.test(title)) return "orientation" as const;
  return "concept" as const;
}

export function parseSnapshot(value: unknown): { snapshot: TourSnapshot; migrated: boolean } {
  const current = TourSnapshotSchema.safeParse(value);
  if (current.success) return { snapshot: current.data, migrated: false };
  const versionTwo = LegacyV2SnapshotSchema.safeParse(value);
  if (versionTwo.success) {
    const legacy = versionTwo.data;
    return {
      migrated: true,
      snapshot: TourSnapshotSchema.parse({
        ...legacy,
        schemaVersion: 3,
        promptVersion: Math.max(3, legacy.promptVersion),
        generator: `${legacy.generator}-v2-migration`,
        knowledgeSnapshotId: knowledgeSnapshotId(legacy.anchor.commit),
        knowledgeRefs: [],
        featureJourneys: [],
        labEnvironments: [],
        pages: legacy.pages.map((page) => ({
          ...page,
          references: page.references.map((reference) => ({ type: "external" as const, ...reference })),
        })),
      }),
    };
  }
  const legacy = LegacySnapshotSchema.parse(value);
  const modules = legacy.tracks.map((track) => {
    const moduleId = `${track.id}-module`;
    const lessons = track.lessonIds
      .map((id) => legacy.lessons.find((lesson) => lesson.id === id))
      .filter((lesson): lesson is z.infer<typeof LegacyLessonSchema> => Boolean(lesson));
    return {
      id: moduleId,
      title: track.title,
      outcome: track.summary || `Understand ${track.title}.`,
      relevance: track.summary || "Migrated from a Tourguide v1 track.",
      estimatedMinutes: lessons.reduce((total, lesson) => total + lesson.estimatedMinutes, 0) || 1,
      prerequisites: [],
      pageIds: lessons.map((lesson) => lesson.id),
      surfaces: [...new Set(lessons.flatMap((lesson) => lesson.evidence.flatMap((evidence) => evidence.path ? [evidence.path] : [])))],
      gaps: [
        ...(!lessons.some((lesson) => pageKind(lesson.title, lesson.interactions) === "demo") ? [{
          area: "demonstration",
          status: "omitted" as const,
          reason: "The v1 track did not record a demonstration page.",
        }] : []),
        {
          area: "synthesis exercise",
          status: "omitted" as const,
          reason: "Tourguide v1 did not store exercise metadata.",
        },
      ],
      status: lessons.every((lesson) => lesson.status === "ready") ? "ready" as const : "draft" as const,
    };
  });
  const moduleByLesson = new Map<string, string>();
  legacy.tracks.forEach((track) => track.lessonIds.forEach((lessonId) => moduleByLesson.set(lessonId, `${track.id}-module`)));
  return {
    migrated: true,
    snapshot: TourSnapshotSchema.parse({
      schemaVersion: 3,
      id: legacy.id || randomUUID(),
      projectName: legacy.projectName,
      repositoryRoot: legacy.repositoryRoot,
      anchor: { ref: legacy.branch || legacy.head, commit: legacy.head },
      generatedAt: legacy.generatedAt,
      generator: `${legacy.generator}-v1-migration`,
      promptVersion: 3,
      status: legacy.status,
      tracks: legacy.tracks.map((track) => ({
        id: track.id,
        title: track.title,
        summary: track.summary,
        kind: track.kind,
        priority: track.priority,
        moduleIds: [`${track.id}-module`],
      })),
      modules,
      pages: legacy.lessons.map((lesson) => ({
        id: lesson.id,
        moduleId: moduleByLesson.get(lesson.id) ?? modules[0]?.id ?? "migrated-module",
        kind: pageKind(lesson.title, lesson.interactions),
        title: lesson.title,
        objective: lesson.objective,
        estimatedMinutes: Math.min(10, lesson.estimatedMinutes),
        narrative: lesson.narrative,
        status: lesson.status,
        prerequisites: lesson.prerequisites,
        evidence: lesson.evidence,
        interactions: lesson.interactions,
        knowledgeCheck: lesson.knowledgeCheck,
        references: lesson.references.slice(0, 3).map((reference) => ({ type: "external" as const, ...reference })),
      })),
      coverage: [
        {
          capability: "orientation",
          status: "covered",
          moduleIds: modules[0] ? [modules[0].id] : [],
        },
        ...[
          "setup", "run", "architecture", "data and state", "test",
          "debug", "change workflow", "delivery and operations",
        ].map((capability) => ({
          capability,
          status: "omitted" as const,
          moduleIds: [],
          reason: "The migrated v1 snapshot did not record explicit breadth coverage.",
        })),
        ...legacy.tracks.map((track) => ({
          capability: `legacy track: ${track.title}`,
          status: "covered" as const,
          moduleIds: [`${track.id}-module`],
        })),
      ],
      dependencies: legacy.dependencies,
      knowledgeSnapshotId: knowledgeSnapshotId(legacy.head),
      knowledgeRefs: [],
      featureJourneys: [],
      labEnvironments: [],
    }),
  };
}

export function parseProgress(value: unknown): { progress: Progress; migrated: boolean } {
  const looksCurrent = Boolean(value && typeof value === "object" && (
    (value as Record<string, unknown>).schemaVersion === 3
    || "pages" in (value as Record<string, unknown>)
  ));
  const current = looksCurrent ? ProgressSchema.safeParse(value) : undefined;
  if (current?.success) return { progress: current.data, migrated: false };
  const hasV2Shape = Boolean(value && typeof value === "object" && (
    (value as Record<string, unknown>).schemaVersion === 2
    || "pages" in (value as Record<string, unknown>)
  ));
  const versionTwo = hasV2Shape ? LegacyV2ProgressSchema.safeParse(value) : undefined;
  if (versionTwo?.success) {
    return {
      migrated: true,
      progress: ProgressSchema.parse({ schemaVersion: 3, pages: versionTwo.data.pages, modules: {} }),
    };
  }
  const legacy = LegacyProgressSchema.parse(value ?? {});
  return {
    migrated: true,
    progress: ProgressSchema.parse({
      schemaVersion: 3,
      pages: Object.fromEntries(Object.entries(legacy.lessons).map(([id, state]) => [id, {
        viewed: state.viewed,
        demonstrated: state.experimented,
          exerciseAttempted: state.experimented,
          verified: false,
          completed: false,
          blocked: false,
        revisit: state.revisit,
        note: state.note,
        updatedAt: state.updatedAt,
      }])),
      modules: {},
    }),
  };
}

export function parsePreferences(value: unknown) {
  return PreferencesSchema.parse(value ?? {});
}
