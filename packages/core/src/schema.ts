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
  prompt: z.string().min(1),
  expectedObservation: z.string().min(1),
});

export const PageKindSchema = z.enum([
  "orientation",
  "concept",
  "walkthrough",
  "demo",
  "exercise",
  "recap",
]);

export const ExerciseSchema = z.object({
  mode: z.enum(["observe", "trace", "diagnose", "patch", "design"]),
  task: z.string().min(1),
  allowedPaths: z.array(z.string()).default([]),
  hints: z.array(z.string().min(1)).default([]),
  verificationRecipe: RunRecipeSchema.optional(),
  formatRecipe: RunRecipeSchema.optional(),
  expectedObservation: z.string().min(1),
  solutionExplanation: z.string().optional(),
  reset: z.enum(["rerun", "fresh-worktree"]).default("fresh-worktree"),
});

export const PageSchema = z.object({
  id: z.string().min(1),
  moduleId: z.string().min(1),
  kind: PageKindSchema,
  title: z.string().min(1),
  objective: z.string().min(1),
  estimatedMinutes: z.number().int().min(1).max(10).default(3),
  narrative: z.string().min(1),
  status: z.enum(["draft", "ready", "blocked", "stale"]).default("draft"),
  prerequisites: z.array(z.string()).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  interactions: z.array(InteractionSchema).min(1),
  knowledgeCheck: KnowledgeCheckSchema.optional(),
  exercise: ExerciseSchema.optional(),
  references: z.array(z.object({ title: z.string(), url: z.url() })).max(3).default([]),
});

export const ModuleGapSchema = z.object({
  area: z.string().min(1),
  status: z.enum(["not-applicable", "blocked", "omitted"]),
  reason: z.string().min(1),
});

export const ModuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  outcome: z.string().min(1),
  relevance: z.string().min(1),
  estimatedMinutes: z.number().int().positive(),
  prerequisites: z.array(z.string()).default([]),
  pageIds: z.array(z.string()).default([]),
  surfaces: z.array(z.string()).default([]),
  gaps: z.array(ModuleGapSchema).default([]),
  status: z.enum(["planned", "draft", "ready", "blocked", "stale"]).default("planned"),
});

export const TrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  kind: z.enum(["core", "selected", "suggested"]),
  priority: z.number().int().nonnegative(),
  moduleIds: z.array(z.string()),
});

export const CoverageEntrySchema = z.object({
  capability: z.string().min(1),
  status: z.enum(["covered", "not-applicable", "blocked", "omitted"]),
  moduleIds: z.array(z.string()).default([]),
  reason: z.string().optional(),
});

export const ProjectAnchorSchema = z.object({
  ref: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
});

export const TourSnapshotSchema = z.object({
  schemaVersion: z.literal(2),
  id: z.string().min(1),
  projectName: z.string().min(1),
  repositoryRoot: z.string().min(1),
  anchor: ProjectAnchorSchema,
  generatedAt: z.string(),
  generator: z.string().default("tourguide"),
  promptVersion: z.number().int().positive().default(2),
  status: z.enum(["draft", "partial", "published"]).default("draft"),
  tracks: z.array(TrackSchema),
  modules: z.array(ModuleSchema),
  pages: z.array(PageSchema),
  coverage: z.array(CoverageEntrySchema).default([]),
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
  ref: z.string(),
  trackedFileCount: z.number().int().nonnegative(),
  trackedFiles: z.array(z.string()),
  excludedFiles: z.array(z.string()).default([]),
  dirtyFiles: z.array(z.string()),
  manifests: z.array(z.string()),
  commands: z.record(z.string(), z.string()),
  areas: z.array(AreaSchema),
});

export const PreferencesSchema = z.object({
  priorities: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  allowCodexAdapter: z.boolean().default(true),
});

export const PageProgressSchema = z.object({
  viewed: z.boolean().default(false),
  demonstrated: z.boolean().default(false),
  exerciseAttempted: z.boolean().default(false),
  completed: z.boolean().default(false),
  revisit: z.boolean().default(false),
  note: z.string().optional(),
  updatedAt: z.string(),
});

export const ProgressSchema = z.object({
  schemaVersion: z.literal(2).default(2),
  pages: z.record(z.string(), PageProgressSchema).default({}),
});

export const GenerationPhaseSchema = z.enum([
  "preparing",
  "planning",
  "drafting",
  "validating",
  "publishing",
  "complete",
]);

export const GenerationJobSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["create", "refresh", "deepen"]).default("create"),
  status: z.enum(["queued", "running", "cancelled", "failed", "partial", "complete"]),
  phase: GenerationPhaseSchema,
  anchor: ProjectAnchorSchema,
  goal: z.string().min(1),
  priorities: z.array(z.string()).default([]),
  model: z.string().optional(),
  snapshotId: z.string().optional(),
  threadId: z.string().optional(),
  codexVersion: z.string().optional(),
  plannedModuleIds: z.array(z.string()).default([]),
  completedModuleIds: z.array(z.string()).default([]),
  currentModuleId: z.string().optional(),
  message: z.string().default(""),
  errorCode: z.enum(["auth", "usage", "engine", "validation", "cancelled"]).optional(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative().default(0),
    cachedInputTokens: z.number().int().nonnegative().default(0),
    outputTokens: z.number().int().nonnegative().default(0),
  }).default({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }),
  startedAt: z.string(),
  updatedAt: z.string(),
});

export const CodexStatusSchema = z.object({
  status: z.enum(["ready", "missing", "unauthenticated", "unsupported", "error"]),
  version: z.string().optional(),
  auth: z.string().optional(),
  message: z.string(),
});

const PlannedPageSchema = z.object({
  id: z.string().min(1),
  kind: PageKindSchema,
  title: z.string().min(1),
  objective: z.string().min(1),
  interactionIntent: z.string().min(1),
});

export const PlannedModuleSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
  title: z.string().min(1),
  outcome: z.string().min(1),
  relevance: z.string().min(1),
  prerequisites: z.array(z.string()).default([]),
  surfaces: z.array(z.string()).default([]),
  gaps: z.array(ModuleGapSchema).default([]),
  pages: z.array(PlannedPageSchema).min(1),
});

export const CurriculumPlanSchema = z.object({
  projectName: z.string().min(1),
  summary: z.string().min(1),
  tracks: z.array(TrackSchema).min(1),
  modules: z.array(PlannedModuleSchema).min(1),
  coverage: z.array(CoverageEntrySchema).min(1),
});

const GeneratedEnvironmentEntrySchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

const GeneratedRunRecipeSchema = RunRecipeSchema.omit({ env: true }).extend({
  env: z.array(GeneratedEnvironmentEntrySchema).default([]),
});

const GeneratedInteractionSchema = z.discriminatedUnion("type", [
  SourceInteractionSchema,
  z.object({ type: z.literal("command"), recipe: GeneratedRunRecipeSchema }),
  BrowserInteractionSchema,
  DataInteractionSchema.omit({ rows: true }).extend({ rows: z.array(z.array(z.string())) }),
  TopologyInteractionSchema,
]);

const GeneratedExerciseSchema = ExerciseSchema.omit({ verificationRecipe: true, formatRecipe: true }).extend({
  verificationRecipe: GeneratedRunRecipeSchema.optional(),
  formatRecipe: GeneratedRunRecipeSchema.optional(),
});

const GeneratedEvidenceSchema = EvidenceRefSchema.omit({
  revision: true,
  contentHash: true,
  validated: true,
}).extend({
  validated: z.boolean().optional(),
});

export const GeneratedPageSchema = PageSchema.omit({
  moduleId: true,
  evidence: true,
  status: true,
  interactions: true,
  exercise: true,
}).extend({
  moduleId: z.string().optional(),
  evidence: z.array(GeneratedEvidenceSchema).default([]),
  interactions: z.array(GeneratedInteractionSchema).min(1),
  exercise: GeneratedExerciseSchema.optional(),
});

export const GeneratedModuleSchema = z.object({
  moduleId: z.string().min(1),
  pages: z.array(GeneratedPageSchema).min(1),
});

export const GenerationEventSchema = z.object({
  id: z.number().int().nonnegative(),
  jobId: z.string(),
  type: z.enum(["status", "module-ready", "message", "error", "complete"]),
  message: z.string(),
  moduleId: z.string().optional(),
  createdAt: z.string(),
});

export const DiagnosticErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});

export const DiagnosticReportSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  createdAt: z.string(),
  trigger: z.enum(["generation", "server", "process", "browser", "startup", "manual", "interrupted"]),
  summary: z.string().min(1),
  repository: z.object({
    root: z.string(),
    name: z.string().optional(),
    ref: z.string().optional(),
    commit: z.string().optional(),
    dirtyFiles: z.array(z.string()).default([]),
  }),
  runtime: z.object({
    tourguideVersion: z.string(),
    node: z.string(),
    platform: z.string(),
    arch: z.string(),
  }),
  codex: z.object({
    status: z.string(),
    version: z.string().optional(),
  }).optional(),
  generation: GenerationJobSchema.optional(),
  recentEvents: z.array(GenerationEventSchema).default([]),
  error: DiagnosticErrorSchema.optional(),
  context: z.record(z.string(), z.unknown()).default({}),
});

export const ExerciseSessionSchema = z.object({
  id: z.string().min(1),
  snapshotId: z.string().min(1),
  pageId: z.string().min(1),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  workspace: z.string().min(1),
  allowedPaths: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
});

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type RunRecipe = z.infer<typeof RunRecipeSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type Page = z.infer<typeof PageSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;
export type TourSnapshot = z.infer<typeof TourSnapshotSchema>;
export type ProjectAnchor = z.infer<typeof ProjectAnchorSchema>;
export type ProjectInventory = z.infer<typeof ProjectInventorySchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type CodexStatus = z.infer<typeof CodexStatusSchema>;
export type CurriculumPlan = z.infer<typeof CurriculumPlanSchema>;
export type GeneratedModule = z.infer<typeof GeneratedModuleSchema>;
export type GenerationEvent = z.infer<typeof GenerationEventSchema>;
export type DiagnosticError = z.infer<typeof DiagnosticErrorSchema>;
export type DiagnosticReport = z.infer<typeof DiagnosticReportSchema>;
export type ExerciseSession = z.infer<typeof ExerciseSessionSchema>;

// Compatibility names for downstream clients during the v1-to-v2 transition.
export const LessonSchema = PageSchema;
export type Lesson = Page;
