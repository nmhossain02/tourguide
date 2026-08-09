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

export const KnowledgeCatalogSchema = z.enum(["data-model", "api", "components", "code-docs"]);
export const KnowledgeReadinessSchema = z.enum(["ready", "needs-setup", "needs-mock", "blocked"]);

const KnowledgeItemBaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(""),
  path: z.string().optional(),
  symbol: z.string().optional(),
  contentHash: z.string().min(1),
  confidence: z.number().min(0).max(1).default(1),
  readiness: KnowledgeReadinessSchema.default("ready"),
  evidence: z.array(EvidenceRefSchema).default([]),
  adapterId: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export const DataModelFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().default("unknown"),
  required: z.boolean().default(false),
  primaryKey: z.boolean().default(false),
  references: z.string().optional(),
});

export const DataModelItemSchema = KnowledgeItemBaseSchema.extend({
  catalog: z.literal("data-model"),
  kind: z.enum(["entity", "table", "migration", "fixture", "storage"]),
  fields: z.array(DataModelFieldSchema).default([]),
});

export const ApiItemSchema = KnowledgeItemBaseSchema.extend({
  catalog: z.literal("api"),
  kind: z.enum(["service", "endpoint", "schema", "client"]),
  method: z.string().optional(),
  route: z.string().optional(),
  authentication: z.array(z.string()).default([]),
  requestSchema: z.unknown().optional(),
  responseSchema: z.unknown().optional(),
});

export const ComponentPropSchema = z.object({
  name: z.string().min(1),
  type: z.string().default("unknown"),
  required: z.boolean().default(false),
  defaultValue: z.string().optional(),
});

export const ComponentItemSchema = KnowledgeItemBaseSchema.extend({
  catalog: z.literal("components"),
  kind: z.enum(["component", "story"]),
  props: z.array(ComponentPropSchema).default([]),
  storyIds: z.array(z.string()).default([]),
  providers: z.array(z.string()).default([]),
});

export const CodeDocItemSchema = KnowledgeItemBaseSchema.extend({
  catalog: z.literal("code-docs"),
  kind: z.enum(["package", "file", "symbol", "document", "test", "config", "delivery"]),
  language: z.string().optional(),
  headings: z.array(z.string()).default([]),
});

export const KnowledgeItemSchema = z.discriminatedUnion("catalog", [
  DataModelItemSchema,
  ApiItemSchema,
  ComponentItemSchema,
  CodeDocItemSchema,
]);

export const KnowledgeRelationshipSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  kind: z.enum(["contains", "imports", "calls", "renders", "serves", "reads", "writes", "tests", "documents", "deploys", "references"]),
  label: z.string().optional(),
  evidence: z.array(EvidenceRefSchema).default([]),
});

export const RepositoryFileRecordSchema = z.object({
  path: z.string().min(1),
  language: z.string().optional(),
  size: z.number().int().nonnegative(),
  contentHash: z.string().min(1),
  classification: z.enum([
    "source",
    "test",
    "documentation",
    "configuration",
    "data",
    "delivery",
    "asset",
    "generated",
    "unknown",
  ]),
  excludedReason: z.string().optional(),
});

export const RepositoryKnowledgeSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  projectName: z.string().min(1),
  repositoryRoot: z.string().min(1),
  anchor: z.object({ ref: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  analyzerVersion: z.string().min(1),
  generatedAt: z.string(),
  files: z.array(RepositoryFileRecordSchema),
  catalogs: z.object({
    dataModel: z.array(DataModelItemSchema).default([]),
    api: z.array(ApiItemSchema).default([]),
    components: z.array(ComponentItemSchema).default([]),
    codeDocs: z.array(CodeDocItemSchema).default([]),
  }),
  relationships: z.array(KnowledgeRelationshipSchema).default([]),
  exclusions: z.array(z.object({ path: z.string(), reason: z.string() })).default([]),
});

export const DocumentationDomainSchema = z.enum([
  "data-model",
  "api",
  "component-library",
  "compute",
  "general",
]);

export const DocumentationClaimSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  field: z.string().min(1),
  value: z.json(),
  origin: z.enum(["observed", "repository-doc", "runtime", "inferred"]),
  evidence: z.array(EvidenceRefSchema).default([]),
  evidenceFingerprint: z.string().min(1),
  confidence: z.number().min(0).max(1),
  lastConfirmedCommit: z.string().regex(/^[0-9a-f]{40}$/),
  status: z.enum(["valid", "questionable", "invalidated"]).default("valid"),
});

export const DocumentationScenarioSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  title: z.string().min(1),
  operation: z.string().min(1),
  inputs: z.record(z.string(), z.json()).default({}),
  expected: z.json().optional(),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  dependencyContractIds: z.array(z.string().min(1)).default([]),
  origin: z.enum(["observed", "repository-doc", "runtime", "inferred"]),
  evidence: z.array(EvidenceRefSchema).default([]),
});

export const DocumentationDependencyContractSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["http", "module", "function", "data", "environment", "time", "randomness"]),
  operations: z.array(z.string()).default([]),
  mode: z.enum(["real", "repository-mock", "declarative-mock", "generated-mock", "blocked"]),
  subjectIds: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  reason: z.string().optional(),
});

export const DocumentationSubjectSchema = z.object({
  id: z.string().min(1),
  domain: DocumentationDomainSchema,
  kind: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  knowledgeItemId: z.string().min(1),
  contract: z.record(z.string(), z.json()).default({}),
  contractFingerprint: z.string().min(1),
  evidenceFingerprint: z.string().min(1),
  claimIds: z.array(z.string().min(1)).default([]),
  scenarioIds: z.array(z.string().min(1)).default([]),
  dependencyContractIds: z.array(z.string().min(1)).default([]),
  capabilities: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  confidence: z.number().min(0).max(1).default(1),
  readiness: KnowledgeReadinessSchema.default("ready"),
});

export const RuntimeProfileSchema = z.object({
  id: z.string().min(1),
  domain: DocumentationDomainSchema,
  title: z.string().min(1),
  capabilities: z.array(z.string().min(1)).default([]),
  subjectIds: z.array(z.string().min(1)).default([]),
  providerHints: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  dependencyFingerprint: z.string().min(1),
  subjectRegistryFingerprint: z.string().min(1),
  generatedArtifactRef: z.string().optional(),
  readiness: KnowledgeReadinessSchema.default("ready"),
  probeStatus: z.enum(["unprobed", "pass", "fail"]).default("unprobed"),
});

export const DocumentationInferenceRequestSchema = z.object({
  id: z.string().min(1),
  domain: DocumentationDomainSchema,
  subjectIds: z.array(z.string().min(1)).default([]),
  questions: z.array(z.string().min(1)).default([]),
  evidence: z.array(EvidenceRefSchema).default([]),
  evidenceFingerprint: z.string().min(1),
  status: z.enum(["pending", "resolved", "blocked"]).default("pending"),
});

export const LivingDocumentationSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  projectName: z.string().min(1),
  repositoryRoot: z.string().min(1),
  anchor: z.object({ ref: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  sourceKnowledgeSnapshotId: z.string().min(1),
  reconcilerVersion: z.string().min(1),
  generatedAt: z.string(),
  subjects: z.array(DocumentationSubjectSchema).default([]),
  claims: z.array(DocumentationClaimSchema).default([]),
  scenarios: z.array(DocumentationScenarioSchema).default([]),
  dependencyContracts: z.array(DocumentationDependencyContractSchema).default([]),
  runtimeProfiles: z.array(RuntimeProfileSchema).default([]),
  relationships: z.array(KnowledgeRelationshipSchema).default([]),
  inferenceRequests: z.array(DocumentationInferenceRequestSchema).default([]),
});

export const DocumentationChangeSchema = z.object({
  subjectId: z.string().min(1),
  domain: DocumentationDomainSchema,
  classification: z.enum(["additive", "compatible", "behavioral", "breaking", "ambiguous"]),
  reason: z.string().min(1),
});

export const DocumentationDiffSchema = z.object({
  fromSnapshotId: z.string().min(1),
  toSnapshotId: z.string().min(1),
  changes: z.array(DocumentationChangeSchema).default([]),
  changedDomains: z.array(DocumentationDomainSchema).default([]),
  inferenceDomains: z.array(DocumentationDomainSchema).default([]),
});

export const SemanticBindingSchema = z.object({
  subjectId: z.string().min(1),
  scenarioId: z.string().optional(),
  binding: z.enum(["latest-compatible", "pinned"]).default("latest-compatible"),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  concepts: z.array(z.string().min(1)).default([]),
});

export const KnowledgeRefSchema = z.object({
  catalog: KnowledgeCatalogSchema,
  itemId: z.string().min(1),
  contentHash: z.string().min(1),
});

export const ViewerTargetSchema = KnowledgeRefSchema.extend({
  field: z.string().optional(),
  operation: z.string().optional(),
  storyId: z.string().optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  neighborhoodDepth: z.number().int().min(0).max(3).optional(),
});

export const FeatureJourneySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  outcome: z.string().min(1),
  steps: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    target: ViewerTargetSchema,
  })).default([]),
  gaps: z.array(z.object({ area: z.string(), reason: z.string() })).default([]),
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

const ComponentInteractionSchema = z.object({
  type: z.literal("component"),
  target: ViewerTargetSchema,
  environmentId: z.string().optional(),
  inputs: z.array(RecipeInputSchema).default([]),
});

const HttpInteractionSchema = z.object({
  type: z.literal("http"),
  target: ViewerTargetSchema,
  environmentId: z.string().optional(),
  inputs: z.array(RecipeInputSchema).default([]),
});

const DatabaseInteractionSchema = z.object({
  type: z.literal("database"),
  target: ViewerTargetSchema,
  environmentId: z.string().optional(),
  mode: z.enum(["schema", "query", "rows"]).default("schema"),
});

const FunctionInteractionSchema = z.object({
  type: z.literal("function"),
  target: ViewerTargetSchema,
  environmentId: z.string().optional(),
  inputs: z.array(RecipeInputSchema).default([]),
});

export const InteractionSchema = z.discriminatedUnion("type", [
  SourceInteractionSchema,
  CommandInteractionSchema,
  BrowserInteractionSchema,
  DataInteractionSchema,
  TopologyInteractionSchema,
  ComponentInteractionSchema,
  HttpInteractionSchema,
  DatabaseInteractionSchema,
  FunctionInteractionSchema,
]);

export const KnowledgeCheckSchema = z.object({
  prompt: z.string().min(1),
  expectedObservation: z.string().min(1),
});

export const ReferenceSchema = z.union([
  z.object({ type: z.literal("external"), title: z.string().min(1), url: z.url() }),
  z.object({ type: z.literal("documentation"), title: z.string().min(1), path: z.string().min(1), contentHash: z.string().optional() }),
  z.object({ type: z.literal("source"), title: z.string().min(1), target: ViewerTargetSchema }),
]);

export const VerificationCheckSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exit-code"), expected: z.number().int().default(0) }),
  z.object({ type: z.literal("output"), stream: z.enum(["stdout", "stderr", "combined"]).default("combined"), includes: z.string() }),
  z.object({ type: z.literal("json-subset"), expected: z.json() }),
  z.object({ type: z.literal("http"), status: z.number().int(), bodySubset: z.json().optional() }),
  z.object({ type: z.literal("database-rows"), expected: z.array(z.record(z.string(), z.json())) }),
  z.object({ type: z.literal("file-change"), path: z.string(), includes: z.string().optional() }),
]);

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
  verificationChecks: z.array(VerificationCheckSchema).optional(),
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
  knowledgeRefs: z.array(KnowledgeRefSchema).default([]),
  documentationBindings: z.array(SemanticBindingSchema).default([]),
  interactions: z.array(InteractionSchema).min(1),
  knowledgeCheck: KnowledgeCheckSchema.optional(),
  exercise: ExerciseSchema.optional(),
  references: z.array(ReferenceSchema).max(3).default([]),
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
  knowledgeRefs: z.array(KnowledgeRefSchema).default([]),
  documentationBindings: z.array(SemanticBindingSchema).default([]),
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

export const DependencyBindingSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  mode: z.enum(["real", "repository-mock", "declarative-mock", "blocked"]),
  target: KnowledgeRefSchema.optional(),
  reason: z.string().optional(),
});

export const LabServiceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  recipe: RunRecipeSchema,
  portEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default("PORT"),
  healthUrl: z.string().optional(),
  healthTimeoutMs: z.number().int().min(100).max(120_000).default(30_000),
});

export const IntelligenceValidationSchema = z.object({
  status: z.enum(["pass", "fail"]),
  validator: z.string().min(1),
  validatedAt: z.string(),
  inputFingerprint: z.string().min(1),
  diagnostics: z.array(z.string()).default([]),
});

export const DocumentationInferenceArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  cacheKey: z.string().min(1),
  domain: DocumentationDomainSchema,
  requestId: z.string().min(1),
  evidenceFingerprint: z.string().min(1),
  promptVersion: z.number().int().positive(),
  generator: z.string().min(1),
  generatedAt: z.string(),
  claims: z.array(z.object({
    subjectId: z.string().min(1),
    field: z.string().min(1),
    value: z.json(),
    confidence: z.number().min(0).max(1),
  })).default([]),
  scenarios: z.array(z.object({
    id: z.string().min(1),
    subjectId: z.string().min(1),
    title: z.string().min(1),
    operation: z.string().min(1),
    inputs: z.record(z.string(), z.json()).default({}),
    expected: z.json().optional(),
    requiredCapabilities: z.array(z.string().min(1)).default([]),
    dependencyContractIds: z.array(z.string().min(1)).default([]),
  })).default([]),
  dependencyContracts: z.array(DocumentationDependencyContractSchema).default([]),
  validation: IntelligenceValidationSchema,
});

export const RuntimeProviderFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const RuntimeProviderInvocationSchema = z.object({
  capability: z.string().min(1),
  kind: z.enum(["command", "service-url"]),
  recipe: RunRecipeSchema.optional(),
  serviceId: z.string().optional(),
  pathTemplate: z.string().optional(),
  result: z.enum(["json", "text", "url"]).default("json"),
}).superRefine((value, context) => {
  if (value.kind === "command" && !value.recipe) {
    context.addIssue({ code: "custom", message: "Command runtime invocations require a recipe." });
  }
  if (value.kind === "service-url" && (!value.serviceId || !value.pathTemplate)) {
    context.addIssue({ code: "custom", message: "Service URL runtime invocations require a service and path template." });
  }
});

export const RuntimeProviderArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  cacheKey: z.string().min(1),
  profileId: z.string().min(1),
  domain: DocumentationDomainSchema,
  title: z.string().min(1),
  source: z.enum(["repository", "builtin", "generated"]),
  capabilities: z.array(z.string().min(1)).min(1),
  dependencyFingerprint: z.string().min(1),
  promptVersion: z.number().int().positive(),
  generator: z.string().min(1),
  generatedAt: z.string(),
  files: z.array(RuntimeProviderFileSchema).default([]),
  preparationRecipes: z.array(RunRecipeSchema).default([]),
  services: z.array(LabServiceSchema).default([]),
  invocations: z.array(RuntimeProviderInvocationSchema).default([]),
  validation: IntelligenceValidationSchema,
});

export const TourImpactAssessmentArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  cacheKey: z.string().min(1),
  tourContractFingerprint: z.string().min(1),
  diffFingerprint: z.string().min(1),
  promptVersion: z.number().int().positive(),
  generator: z.string().min(1),
  generatedAt: z.string(),
  pageAssessments: z.array(z.object({
    pageId: z.string().min(1),
    action: z.enum(["reuse", "rebind", "regenerate"]),
    reason: z.string().min(1),
  })).default([]),
  moduleAssessments: z.array(z.object({
    moduleId: z.string().min(1),
    action: z.enum(["reuse", "rebind", "regenerate"]),
    reason: z.string().min(1),
  })).default([]),
  validation: IntelligenceValidationSchema,
});

export const LabEnvironmentSchema = z.object({
  id: z.string().min(1),
  moduleId: z.string().min(1),
  title: z.string().min(1),
  adapterIds: z.array(z.string()).default([]),
  runtimeProfileIds: z.array(z.string()).default([]),
  runtimeProviders: z.array(RuntimeProviderArtifactSchema).default([]),
  editablePaths: z.array(z.string()).default([]),
  preparationRecipes: z.array(RunRecipeSchema).default([]),
  services: z.array(LabServiceSchema).default([]),
  dependencies: z.array(DependencyBindingSchema).default([]),
  readiness: KnowledgeReadinessSchema.default("ready"),
});

export const TourSnapshotSchema = z.object({
  schemaVersion: z.literal(3),
  id: z.string().min(1),
  projectName: z.string().min(1),
  repositoryRoot: z.string().min(1),
  anchor: ProjectAnchorSchema,
  generatedAt: z.string(),
  generator: z.string().default("tourguide"),
  promptVersion: z.number().int().positive().default(3),
  status: z.enum(["draft", "partial", "published"]).default("draft"),
  tracks: z.array(TrackSchema),
  modules: z.array(ModuleSchema),
  pages: z.array(PageSchema),
  coverage: z.array(CoverageEntrySchema).default([]),
  dependencies: z.record(z.string(), z.array(z.string())).default({}),
  knowledgeSnapshotId: z.string().min(1),
  documentationSnapshotId: z.string().optional(),
  knowledgeRefs: z.array(KnowledgeRefSchema).default([]),
  featureJourneys: z.array(FeatureJourneySchema).default([]),
  labEnvironments: z.array(LabEnvironmentSchema).default([]),
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
  editorCommand: z.array(z.string().min(1)).min(1).optional(),
});

export const PageProgressSchema = z.object({
  viewed: z.boolean().default(false),
  demonstrated: z.boolean().default(false),
  exerciseAttempted: z.boolean().default(false),
  verified: z.boolean().default(false),
  completed: z.boolean().default(false),
  blocked: z.boolean().default(false),
  stale: z.boolean().default(false),
  revisit: z.boolean().default(false),
  note: z.string().optional(),
  updatedAt: z.string(),
});

export const ModuleProgressSchema = z.object({
  completed: z.boolean().default(false),
  updatedAt: z.string(),
});

export const ProgressSchema = z.object({
  schemaVersion: z.literal(3).default(3),
  pages: z.record(z.string(), PageProgressSchema).default({}),
  modules: z.record(z.string(), ModuleProgressSchema).default({}),
});

export const GenerationPhaseSchema = z.enum([
  "preparing",
  "planning",
  "drafting",
  "validating",
  "publishing",
  "complete",
]);

export const GenerationDepthSchema = z.enum(["quick", "standard", "deep"]);

export const GenerationJobSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["create", "refresh", "deepen"]).default("create"),
  status: z.enum(["queued", "running", "cancelled", "failed", "partial", "complete"]),
  phase: GenerationPhaseSchema,
  anchor: ProjectAnchorSchema,
  goal: z.string().min(1),
  priorities: z.array(z.string()).default([]),
  model: z.string().optional(),
  depth: GenerationDepthSchema.default("standard"),
  maximumCodexTurns: z.number().int().positive().default(11),
  indexedSourceBytes: z.number().int().nonnegative().default(0),
  filteredSourceBytes: z.number().int().nonnegative().default(0),
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
  knowledgeRefs: z.array(KnowledgeRefSchema).default([]),
});

export const PlannedModuleSchema = z.object({
  id: z.string().min(1),
  trackId: z.string().min(1),
  title: z.string().min(1),
  outcome: z.string().min(1),
  relevance: z.string().min(1),
  prerequisites: z.array(z.string()).default([]),
  surfaces: z.array(z.string()).default([]),
  knowledgeRefs: z.array(KnowledgeRefSchema).default([]),
  gaps: z.array(ModuleGapSchema).default([]),
  pages: z.array(PlannedPageSchema).min(1),
});

export const CurriculumPlanSchema = z.object({
  projectName: z.string().min(1),
  summary: z.string().min(1),
  tracks: z.array(TrackSchema).min(1),
  modules: z.array(PlannedModuleSchema).min(1),
  coverage: z.array(CoverageEntrySchema).min(1),
  knowledgeRefs: z.array(KnowledgeRefSchema).default([]),
  featureJourneys: z.array(FeatureJourneySchema).default([]),
});

const GeneratedEnvironmentEntrySchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

const GeneratedRunRecipeSchema = RunRecipeSchema.omit({ env: true }).extend({
  env: z.array(GeneratedEnvironmentEntrySchema).default([]),
});

const GeneratedVerificationCheckSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exit-code"), expected: z.number().int().default(0) }),
  z.object({ type: z.literal("output"), stream: z.enum(["stdout", "stderr", "combined"]).default("combined"), includes: z.string() }),
  z.object({ type: z.literal("json-subset"), expected: z.string().describe("A JSON-encoded expected value") }),
  z.object({ type: z.literal("http"), status: z.number().int(), bodySubset: z.string().describe("A JSON-encoded expected value").optional() }),
  z.object({ type: z.literal("database-rows"), expected: z.string().describe("A JSON-encoded array of row objects") }),
  z.object({ type: z.literal("file-change"), path: z.string(), includes: z.string().optional() }),
]);

const GeneratedInteractionSchema = z.discriminatedUnion("type", [
  SourceInteractionSchema,
  z.object({ type: z.literal("command"), recipe: GeneratedRunRecipeSchema }),
  BrowserInteractionSchema,
  DataInteractionSchema.omit({ rows: true }).extend({ rows: z.array(z.array(z.string())) }),
  TopologyInteractionSchema,
  ComponentInteractionSchema,
  HttpInteractionSchema,
  DatabaseInteractionSchema,
  FunctionInteractionSchema,
]);

const GeneratedExerciseSchema = ExerciseSchema.omit({ verificationRecipe: true, formatRecipe: true, verificationChecks: true }).extend({
  verificationRecipe: GeneratedRunRecipeSchema.optional(),
  formatRecipe: GeneratedRunRecipeSchema.optional(),
  verificationChecks: z.array(GeneratedVerificationCheckSchema).optional(),
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
export type KnowledgeCatalog = z.infer<typeof KnowledgeCatalogSchema>;
export type KnowledgeReadiness = z.infer<typeof KnowledgeReadinessSchema>;
export type DataModelField = z.infer<typeof DataModelFieldSchema>;
export type DataModelItem = z.infer<typeof DataModelItemSchema>;
export type ApiItem = z.infer<typeof ApiItemSchema>;
export type ComponentProp = z.infer<typeof ComponentPropSchema>;
export type ComponentItem = z.infer<typeof ComponentItemSchema>;
export type CodeDocItem = z.infer<typeof CodeDocItemSchema>;
export type KnowledgeItem = z.infer<typeof KnowledgeItemSchema>;
export type KnowledgeRelationship = z.infer<typeof KnowledgeRelationshipSchema>;
export type RepositoryFileRecord = z.infer<typeof RepositoryFileRecordSchema>;
export type RepositoryKnowledgeSnapshot = z.infer<typeof RepositoryKnowledgeSnapshotSchema>;
export type DocumentationDomain = z.infer<typeof DocumentationDomainSchema>;
export type DocumentationClaim = z.infer<typeof DocumentationClaimSchema>;
export type DocumentationScenario = z.infer<typeof DocumentationScenarioSchema>;
export type DocumentationDependencyContract = z.infer<typeof DocumentationDependencyContractSchema>;
export type DocumentationSubject = z.infer<typeof DocumentationSubjectSchema>;
export type RuntimeProfile = z.infer<typeof RuntimeProfileSchema>;
export type DocumentationInferenceRequest = z.infer<typeof DocumentationInferenceRequestSchema>;
export type LivingDocumentationSnapshot = z.infer<typeof LivingDocumentationSnapshotSchema>;
export type DocumentationChange = z.infer<typeof DocumentationChangeSchema>;
export type DocumentationDiff = z.infer<typeof DocumentationDiffSchema>;
export type IntelligenceValidation = z.infer<typeof IntelligenceValidationSchema>;
export type DocumentationInferenceArtifact = z.infer<typeof DocumentationInferenceArtifactSchema>;
export type RuntimeProviderFile = z.infer<typeof RuntimeProviderFileSchema>;
export type RuntimeProviderInvocation = z.infer<typeof RuntimeProviderInvocationSchema>;
export type RuntimeProviderArtifact = z.infer<typeof RuntimeProviderArtifactSchema>;
export type TourImpactAssessmentArtifact = z.infer<typeof TourImpactAssessmentArtifactSchema>;
export type SemanticBinding = z.infer<typeof SemanticBindingSchema>;
export type KnowledgeRef = z.infer<typeof KnowledgeRefSchema>;
export type ViewerTarget = z.infer<typeof ViewerTargetSchema>;
export type FeatureJourney = z.infer<typeof FeatureJourneySchema>;
export type RunRecipe = z.infer<typeof RunRecipeSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type Exercise = z.infer<typeof ExerciseSchema>;
export type Reference = z.infer<typeof ReferenceSchema>;
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;
export type Page = z.infer<typeof PageSchema>;
export type Module = z.infer<typeof ModuleSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;
export type TourSnapshot = z.infer<typeof TourSnapshotSchema>;
export type ProjectAnchor = z.infer<typeof ProjectAnchorSchema>;
export type DependencyBinding = z.infer<typeof DependencyBindingSchema>;
export type LabService = z.infer<typeof LabServiceSchema>;
export type LabEnvironment = z.infer<typeof LabEnvironmentSchema>;
export type ProjectInventory = z.infer<typeof ProjectInventorySchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;
export type Progress = z.infer<typeof ProgressSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type GenerationDepth = z.infer<typeof GenerationDepthSchema>;
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
