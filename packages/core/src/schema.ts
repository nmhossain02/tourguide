import { z } from "zod";

export const EvidenceKindSchema = z.enum([
  "source",
  "config",
  "runtime",
  "history",
  "documentation",
  "inference",
]);

export const EvidenceRefSchema = z.object({
  id: z.string().min(1),
  kind: EvidenceKindSchema,
  label: z.string().min(1),
  claim: z.string().min(1),
  path: z.string().optional(),
  url: z.url().optional(),
  revision: z.string().optional(),
  symbol: z.string().optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  contentHash: z.string().optional(),
  validated: z.boolean().default(false),
});

export const CapabilitySchema = z.object({
  writes: z.array(z.string()).default([]),
  network: z.enum(["none", "loopback", "external"]).default("none"),
  secrets: z.array(z.string()).default([]),
  containers: z.boolean().default(false),
  externalSystems: z.array(z.string()).default([]),
});

export const RecipeInputSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  label: z.string().min(1),
  type: z.enum(["text", "number", "select"]).default("text"),
  default: z.string().default(""),
  options: z.array(z.string()).optional(),
});

export const RunRecipeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().default("."),
  lifecycle: z.enum(["oneshot", "service"]).default("oneshot"),
  timeoutMs: z.number().int().min(100).max(900_000).default(60_000),
  env: z.record(z.string(), z.string()).default({}),
  inputs: z.array(RecipeInputSchema).default([]),
  capabilities: CapabilitySchema.default({
    writes: [],
    network: "none",
    secrets: [],
    containers: false,
    externalSystems: [],
  }),
  expected: z.string().optional(),
});

const SourceInteractionSchema = z.object({
  type: z.literal("source"),
  path: z.string(),
  editable: z.boolean().default(false),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
});

const CommandInteractionSchema = z.object({
  type: z.literal("command"),
  recipe: RunRecipeSchema,
});

const BrowserInteractionSchema = z.object({
  type: z.literal("browser"),
  url: z.string(),
  title: z.string().optional(),
});

const DataInteractionSchema = z.object({
  type: z.literal("data"),
  title: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});

const TopologyInteractionSchema = z.object({
  type: z.literal("topology"),
  nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.string().optional() })),
  edges: z.array(z.object({ id: z.string(), source: z.string(), target: z.string(), label: z.string().optional() })),
});

export const InteractionSchema = z.discriminatedUnion("type", [
  SourceInteractionSchema,
  CommandInteractionSchema,
  BrowserInteractionSchema,
  DataInteractionSchema,
  TopologyInteractionSchema,
]);

export const KnowledgeCheckSchema = z.object({
  prompt: z.string(),
  expectedObservation: z.string(),
});

export const LessonSchema = z.object({
  id: z.string().min(1),
  objectiveId: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  estimatedMinutes: z.number().int().min(1).max(30).default(5),
  narrative: z.string().min(1),
  status: z.enum(["draft", "ready", "blocked", "stale"]).default("draft"),
  prerequisites: z.array(z.string()).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  interactions: z.array(InteractionSchema).min(1),
  knowledgeCheck: KnowledgeCheckSchema.optional(),
  references: z.array(z.object({ title: z.string(), url: z.url() })).max(3).default([]),
});

export const TrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  kind: z.enum(["core", "selected", "suggested"]),
  priority: z.number().int().nonnegative(),
  lessonIds: z.array(z.string()),
});

export const TourSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  projectName: z.string().min(1),
  repositoryRoot: z.string().min(1),
  head: z.string().min(1),
  branch: z.string().min(1),
  generatedAt: z.string(),
  generator: z.string().default("tourguide"),
  status: z.enum(["draft", "published", "partial"]).default("draft"),
  tracks: z.array(TrackSchema),
  lessons: z.array(LessonSchema),
  dependencies: z.record(z.string(), z.array(z.string())).default({}),
});

export const AreaSchema = z.object({
  id: z.string(),
  title: z.string(),
  reason: z.string(),
  paths: z.array(z.string()),
});

export const ProjectInventorySchema = z.object({
  schemaVersion: z.literal(1),
  root: z.string(),
  name: z.string(),
  head: z.string(),
  branch: z.string(),
  trackedFileCount: z.number().int().nonnegative(),
  trackedFiles: z.array(z.string()),
  dirtyFiles: z.array(z.string()),
  manifests: z.array(z.string()),
  commands: z.record(z.string(), z.string()),
  areas: z.array(AreaSchema),
});

export const PreferencesSchema = z.object({
  priorities: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  allowCodexAdapter: z.boolean().default(false),
});

export const ProgressSchema = z.object({
  lessons: z.record(
    z.string(),
    z.object({
      viewed: z.boolean().default(false),
      experimented: z.boolean().default(false),
      revisit: z.boolean().default(false),
      note: z.string().optional(),
      updatedAt: z.string(),
    }),
  ).default({}),
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type RunRecipe = z.infer<typeof RunRecipeSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type TourSnapshot = z.infer<typeof TourSnapshotSchema>;
export type ProjectInventory = z.infer<typeof ProjectInventorySchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
