import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { promisify } from "node:util";

import {
  DOCUMENTATION_RECONCILER_VERSION,
  DocumentationInferenceArtifactSchema,
  LabManager,
  RuntimeProviderArtifactSchema,
  TourSnapshotSchema,
  TourImpactAssessmentArtifactSchema,
  TourStore,
  applyDocumentationInferenceArtifacts,
  buildLivingDocumentation,
  findTourDocumentationImpact,
  intelligenceFingerprint,
  recipeRequiresTrustedMode,
  type DocumentationDiff,
  type DocumentationInferenceArtifact,
  type LabService,
  type KnowledgeItem,
  type LivingDocumentationSnapshot,
  type ProjectInventory,
  type RepositoryKnowledgeSnapshot,
  type RunRecipe,
  type RuntimeProfile,
  type RuntimeProviderArtifact,
  type TourImpactAssessmentArtifact,
  type TourSnapshot,
} from "@tourguide/core";
import { z } from "zod";

import { CodexExecRunner, type CodexExecResult } from "./codex-exec.js";

const execFileAsync = promisify(execFile);
export const DOCUMENTATION_INFERENCE_PROMPT_VERSION = 1;
export const RUNTIME_SYNTHESIS_PROMPT_VERSION = 1;
export const TOUR_IMPACT_PROMPT_VERSION = 1;

const InferenceClaimProposalSchema = z.object({
  subjectId: z.string().min(1),
  field: z.string().min(1),
  value: z.json(),
  confidence: z.number().min(0).max(1),
});

const InferenceScenarioProposalSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  title: z.string().min(1),
  operation: z.string().min(1),
  inputs: z.record(z.string(), z.json()).default({}),
  expected: z.json().optional(),
  requiredCapabilities: z.array(z.string()).default([]),
  dependencyContractIds: z.array(z.string()).default([]),
});

const InferenceDependencyProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["http", "module", "function", "data", "environment", "time", "randomness"]),
  operations: z.array(z.string()).default([]),
  mode: z.enum(["real", "repository-mock", "declarative-mock", "generated-mock", "blocked"]),
  subjectIds: z.array(z.string()).default([]),
  reason: z.string().optional(),
});

export const DocumentationInferenceBatchSchema = z.object({
  results: z.array(z.object({
    requestId: z.string().min(1),
    claims: z.array(InferenceClaimProposalSchema).default([]),
    scenarios: z.array(InferenceScenarioProposalSchema).default([]),
    dependencyContracts: z.array(InferenceDependencyProposalSchema).default([]),
  })).default([]),
});

const EnvironmentEntrySchema = z.object({ name: z.string().min(1), value: z.string() });
const RuntimeRecipeProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwdMode: z.enum(["repository", "provider"]).default("repository"),
  lifecycle: z.enum(["oneshot", "service"]).default("oneshot"),
  timeoutMs: z.number().int().min(100).max(900_000).default(60_000),
  env: z.array(EnvironmentEntrySchema).default([]),
  inputs: z.array(z.object({
    id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    label: z.string().min(1),
    type: z.enum(["text", "number", "select"]).default("text"),
    default: z.string().default(""),
    options: z.array(z.string()).optional(),
  })).default([]),
  capabilities: z.object({
    writes: z.array(z.string()).default([]),
    network: z.enum(["none", "loopback", "external"]).default("none"),
    secrets: z.array(z.string()).default([]),
    containers: z.boolean().default(false),
    externalSystems: z.array(z.string()).default([]),
  }),
  expected: z.string().optional(),
});

const RuntimeServiceProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  recipe: RuntimeRecipeProposalSchema,
  portEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).default("PORT"),
  healthUrl: z.string().optional(),
  healthTimeoutMs: z.number().int().min(100).max(120_000).default(30_000),
});

export const RuntimeSynthesisBatchSchema = z.object({
  providers: z.array(z.object({
    profileId: z.string().min(1),
    title: z.string().min(1),
    capabilities: z.array(z.string().min(1)).min(1),
    files: z.array(z.object({ path: z.string().min(1), content: z.string() })).default([]),
    preparationRecipes: z.array(RuntimeRecipeProposalSchema).default([]),
    services: z.array(RuntimeServiceProposalSchema).default([]),
    invocations: z.array(z.object({
      capability: z.string().min(1),
      kind: z.enum(["command", "service-url"]),
      recipe: RuntimeRecipeProposalSchema.optional(),
      serviceId: z.string().optional(),
      pathTemplate: z.string().optional(),
      result: z.enum(["json", "text", "url"]).default("json"),
    })).default([]),
  })).default([]),
});

export const TourImpactProposalSchema = z.object({
  pages: z.array(z.object({
    pageId: z.string().min(1),
    action: z.enum(["reuse", "rebind", "regenerate"]),
    reason: z.string().min(1),
  })).default([]),
  modules: z.array(z.object({
    moduleId: z.string().min(1),
    action: z.enum(["reuse", "rebind", "regenerate"]),
    reason: z.string().min(1),
  })).default([]),
});

type Runner = Pick<CodexExecRunner, "run">;

export interface IntelligenceStats {
  coldCalls: number;
  cacheHits: number;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
}

export interface DocumentationReconciliationResult {
  documentation: LivingDocumentationSnapshot;
  artifacts: DocumentationInferenceArtifact[];
  stats: IntelligenceStats;
}

function successful<T extends { validation: { status: string; inputFingerprint: string } }>(artifact: T | undefined, fingerprint: string): artifact is T {
  return artifact?.validation.status === "pass" && artifact.validation.inputFingerprint === fingerprint;
}

function inferenceCacheKey(request: LivingDocumentationSnapshot["inferenceRequests"][number]): string {
  return intelligenceFingerprint({
    kind: "documentation-inference",
    promptVersion: DOCUMENTATION_INFERENCE_PROMPT_VERSION,
    reconcilerVersion: DOCUMENTATION_RECONCILER_VERSION,
    domain: request.domain,
    subjectIds: request.subjectIds,
    questions: request.questions,
    evidenceFingerprint: request.evidenceFingerprint,
  });
}

function runtimeCacheKey(profile: RuntimeProfile): string {
  return intelligenceFingerprint({
    kind: "runtime-provider",
    promptVersion: RUNTIME_SYNTHESIS_PROMPT_VERSION,
    profileId: profile.id,
    capabilities: profile.capabilities,
    dependencyFingerprint: profile.dependencyFingerprint,
  });
}

function tourContractFingerprint(tour: TourSnapshot): string {
  return intelligenceFingerprint({
    tracks: tour.tracks.map(({ id, moduleIds }) => ({ id, moduleIds })),
    modules: tour.modules.map(({ id, outcome, pageIds, documentationBindings }) => ({ id, outcome, pageIds, documentationBindings })),
    pages: tour.pages.map(({ id, moduleId, kind, objective, narrative, documentationBindings }) => ({ id, moduleId, kind, objective, narrative, documentationBindings })),
  });
}

async function withRevisionWorkspace<T>(root: string, commit: string, key: string, work: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = join(root, ".tourguide", "cache", "intelligence", "workspaces", `${key.slice(0, 16)}-${randomUUID()}`);
  await mkdir(join(root, ".tourguide", "cache", "intelligence", "workspaces"), { recursive: true });
  await rm(cwd, { recursive: true, force: true });
  await execFileAsync("git", ["-C", root, "worktree", "add", "--detach", cwd, commit]);
  try {
    return await work(cwd);
  } finally {
    await execFileAsync("git", ["-C", root, "worktree", "remove", "--force", cwd]).catch(() => undefined);
    await rm(cwd, { recursive: true, force: true });
  }
}

function inferencePrompt(snapshot: LivingDocumentationSnapshot, requestIds: string[]): string {
  const requests = snapshot.inferenceRequests.filter((request) => requestIds.includes(request.id));
  const subjectIds = new Set(requests.flatMap((request) => request.subjectIds));
  const subjects = snapshot.subjects.filter((subject) => subjectIds.has(subject.id));
  return `You are updating Tourguide's living executable documentation for commit ${snapshot.anchor.commit}.

Inspect repository documentation, implementation, tests, clients, fixtures, and configuration. Return only facts that help answer the supplied requests. Inference is allowed, but every result must refer to an existing subject ID. Do not restate already explicit contracts. Prefer repository mocks before proposing declarative or generated mocks.

Requests:
${JSON.stringify(requests, null, 2)}

Subjects:
${JSON.stringify(subjects, null, 2)}

For each request, return its exact requestId. Claims use stable semantic field names. Scenarios must be executable descriptions. Dependency contract IDs and scenario IDs must be stable and scoped to their subject.`;
}

function validateInference(
  snapshot: LivingDocumentationSnapshot,
  request: LivingDocumentationSnapshot["inferenceRequests"][number],
  result: z.output<typeof DocumentationInferenceBatchSchema>["results"][number] | undefined,
  cacheKey: string,
): DocumentationInferenceArtifact {
  const allowed = new Set(request.subjectIds);
  const diagnostics: string[] = [];
  if (!result) diagnostics.push("Codex omitted this inference request.");
  for (const claim of result?.claims ?? []) if (!allowed.has(claim.subjectId)) diagnostics.push(`Unknown claim subject ${claim.subjectId}.`);
  for (const scenario of result?.scenarios ?? []) if (!allowed.has(scenario.subjectId)) diagnostics.push(`Unknown scenario subject ${scenario.subjectId}.`);
  for (const contract of result?.dependencyContracts ?? []) {
    for (const subjectId of contract.subjectIds) if (!allowed.has(subjectId)) diagnostics.push(`Unknown dependency subject ${subjectId}.`);
  }
  const evidenceBySubject = new Map(snapshot.subjects.map((subject) => [subject.id, subject.evidence]));
  const generatedAt = new Date().toISOString();
  return DocumentationInferenceArtifactSchema.parse({
    schemaVersion: 1,
    id: `documentation-inference:${cacheKey}`,
    cacheKey,
    domain: request.domain,
    requestId: request.id,
    evidenceFingerprint: request.evidenceFingerprint,
    promptVersion: DOCUMENTATION_INFERENCE_PROMPT_VERSION,
    generator: "codex-exec",
    generatedAt,
    claims: result?.claims ?? [],
    scenarios: result?.scenarios ?? [],
    dependencyContracts: (result?.dependencyContracts ?? []).map((contract) => ({
      ...contract,
      evidence: [...new Map(contract.subjectIds.flatMap((subjectId) => evidenceBySubject.get(subjectId) ?? []).map((item) => [item.id, item])).values()],
    })),
    validation: {
      status: diagnostics.length ? "fail" : "pass",
      validator: "documentation-inference-v1",
      validatedAt: generatedAt,
      inputFingerprint: cacheKey,
      diagnostics,
    },
  });
}

function domainPrimaryCapability(profile: RuntimeProfile): string {
  if (profile.domain === "component-library") return "ui.render";
  if (profile.domain === "api") return "service.request";
  if (profile.domain === "data-model") return "data.query";
  return "code.invoke";
}

function deterministicProvider(profile: RuntimeProfile, inventory: ProjectInventory, documentation: LivingDocumentationSnapshot): RuntimeProviderArtifact | undefined {
  const subjects = documentation.subjects.filter((subject) => profile.subjectIds.includes(subject.id));
  const supports = profile.domain === "component-library"
    ? Boolean(inventory.commands.storybook && subjects.some((subject) => Array.isArray(subject.contract.stories) && subject.contract.stories.length))
    : profile.domain === "api"
      ? Boolean(inventory.commands.dev && /(?:server|api|backend|node)/i.test(inventory.commands.dev))
      : profile.domain === "data-model"
        ? subjects.some((subject) => subject.kind === "table" && subject.evidence.some((item) => item.path?.endsWith(".sql")))
        : subjects.filter((subject) => subject.kind === "symbol").every((subject) => /\.(mjs|cjs|js)$/.test(String(subject.contract.path ?? "")));
  if (!supports || !subjects.length) return undefined;
  const cacheKey = runtimeCacheKey(profile);
  const generatedAt = new Date().toISOString();
  return RuntimeProviderArtifactSchema.parse({
    schemaVersion: 1,
    id: `runtime-provider:builtin:${profile.id}`,
    cacheKey,
    profileId: profile.id,
    domain: profile.domain,
    title: `Repository provider for ${profile.title}`,
    source: "builtin",
    capabilities: profile.capabilities,
    dependencyFingerprint: profile.dependencyFingerprint,
    promptVersion: RUNTIME_SYNTHESIS_PROMPT_VERSION,
    generator: "tourguide-deterministic",
    generatedAt,
    files: [],
    preparationRecipes: [],
    services: [],
    invocations: [],
    validation: {
      status: "pass",
      validator: "deterministic-provider-probe-v1",
      validatedAt: generatedAt,
      inputFingerprint: cacheKey,
      diagnostics: [],
    },
  });
}

function runtimePrompt(documentation: LivingDocumentationSnapshot, profiles: RuntimeProfile[]): string {
  const subjectIds = new Set(profiles.flatMap((profile) => profile.subjectIds));
  return `You are synthesizing reusable Tourguide runtime providers for commit ${documentation.anchor.commit}.

Repository-owned runners, preview systems, services, test helpers, and mocks are preferred. Generate the smallest durable harness only where repository facilities are insufficient. Providers run in a disposable Git worktree with an isolated HOME and loopback-only networking. Do not request secrets, containers, external systems, external networking, or writes outside the provider directory.

Profiles:
${JSON.stringify(profiles, null, 2)}

Subjects and scenarios:
${JSON.stringify({
  subjects: documentation.subjects.filter((subject) => subjectIds.has(subject.id)),
  scenarios: documentation.scenarios.filter((scenario) => subjectIds.has(scenario.subjectId)),
  dependencies: documentation.dependencyContracts.filter((contract) => contract.subjectIds.some((subjectId) => subjectIds.has(subjectId))),
}, null, 2)}

Return one provider per profile using its exact profileId. A provider may create files inside its own directory, run preparation commands, start loopback services, and declare capability invocations. Command invocations receive reserved inputs named payload, subject_id, subject_path, and subject_symbol. Emit JSON directly or on a line prefixed __TOURGUIDE_RESULT__. Service URL paths may use {{subject_id}}, {{subject_path}}, {{subject_symbol}}, and {{input.NAME}} placeholders.`;
}

type RuntimeRecipeProposal = z.output<typeof RuntimeRecipeProposalSchema>;

function normalizeRecipe(value: RuntimeRecipeProposal, providerRoot: string): RunRecipe {
  const cwd = value.cwdMode === "provider" ? providerRoot : ".";
  const writes = value.capabilities.writes.map((path) => value.cwdMode === "provider" ? posix.join(providerRoot, path) : path);
  return {
    id: value.id,
    title: value.title,
    command: value.command,
    args: value.args,
    cwd,
    lifecycle: value.lifecycle,
    timeoutMs: value.timeoutMs,
    env: Object.fromEntries(value.env.map((entry) => [entry.name, entry.value])),
    inputs: value.inputs,
    capabilities: { ...value.capabilities, writes },
    ...(value.expected ? { expected: value.expected } : {}),
  };
}

function safeProviderPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return Boolean(path) && !normalized.startsWith("/") && !normalized.split("/").some((part) => !part || part === "..");
}

function validateRuntimeProposal(
  profile: RuntimeProfile,
  proposal: z.output<typeof RuntimeSynthesisBatchSchema>["providers"][number] | undefined,
  cacheKey: string,
): RuntimeProviderArtifact {
  const id = `runtime-provider:generated:${profile.id}:${cacheKey.slice(0, 12)}`;
  const root = `.tourguide-runtime/${id.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 64)}`;
  const diagnostics: string[] = [];
  if (!proposal) diagnostics.push("Codex omitted this runtime profile.");
  for (const path of proposal?.files.map((file) => file.path) ?? []) if (!safeProviderPath(path)) diagnostics.push(`Unsafe provider file path ${path}.`);
  const preparationRecipes = (proposal?.preparationRecipes ?? []).map((recipe) => normalizeRecipe(recipe, root));
  const services: LabService[] = (proposal?.services ?? []).map((service) => ({
    ...service,
    recipe: normalizeRecipe({ ...service.recipe, lifecycle: "service" }, root),
  }));
  const invocations = (proposal?.invocations ?? []).map((invocation) => ({
    capability: invocation.capability,
    kind: invocation.kind,
    ...(invocation.recipe ? { recipe: normalizeRecipe({ ...invocation.recipe, lifecycle: "oneshot" }, root) } : {}),
    ...(invocation.serviceId ? { serviceId: invocation.serviceId } : {}),
    ...(invocation.pathTemplate ? { pathTemplate: invocation.pathTemplate } : {}),
    result: invocation.result,
  }));
  const recipes = [...preparationRecipes, ...services.map((service) => service.recipe), ...invocations.flatMap((invocation) => invocation.recipe ? [invocation.recipe] : [])];
  for (const recipe of recipes) if (recipeRequiresTrustedMode(recipe)) diagnostics.push(`Recipe ${recipe.id} requests capabilities unavailable to generated providers.`);
  const primary = domainPrimaryCapability(profile);
  if (!proposal?.capabilities.includes(primary)) diagnostics.push(`Provider does not cover primary capability ${primary}.`);
  if (!invocations.some((invocation) => invocation.capability === primary)) diagnostics.push(`Provider has no invocation for ${primary}.`);
  for (const invocation of invocations) {
    if (invocation.kind === "command" && !invocation.recipe) diagnostics.push(`Command invocation ${invocation.capability} has no recipe.`);
    if (invocation.kind === "service-url" && (!invocation.serviceId || !invocation.pathTemplate)) diagnostics.push(`Service invocation ${invocation.capability} is incomplete.`);
    if (invocation.serviceId && !services.some((service) => service.id === invocation.serviceId)) diagnostics.push(`Invocation references unknown service ${invocation.serviceId}.`);
  }
  const generatedAt = new Date().toISOString();
  return RuntimeProviderArtifactSchema.parse({
    schemaVersion: 1,
    id,
    cacheKey,
    profileId: profile.id,
    domain: profile.domain,
    title: proposal?.title ?? `Unavailable provider for ${profile.title}`,
    source: "generated",
    capabilities: proposal?.capabilities ?? [primary],
    dependencyFingerprint: profile.dependencyFingerprint,
    promptVersion: RUNTIME_SYNTHESIS_PROMPT_VERSION,
    generator: "codex-exec",
    generatedAt,
    files: proposal?.files ?? [],
    preparationRecipes,
    services,
    invocations,
    validation: {
      status: diagnostics.length ? "fail" : "pass",
      validator: "runtime-provider-manifest-v1",
      validatedAt: generatedAt,
      inputFingerprint: cacheKey,
      diagnostics,
    },
  });
}

function runtimeWithArtifacts(documentation: LivingDocumentationSnapshot, artifacts: RuntimeProviderArtifact[]): LivingDocumentationSnapshot {
  const byProfile = new Map(artifacts.filter((artifact) => artifact.validation.status === "pass").map((artifact) => [artifact.profileId, artifact]));
  return {
    ...documentation,
    runtimeProfiles: documentation.runtimeProfiles.map((profile) => {
      const artifact = byProfile.get(profile.id);
      return artifact ? { ...profile, generatedArtifactRef: artifact.cacheKey, probeStatus: "pass" as const } : profile;
    }),
  };
}

function probeItem(documentation: LivingDocumentationSnapshot, profile: RuntimeProfile): KnowledgeItem {
  const subject = documentation.subjects.find((candidate) => profile.subjectIds.includes(candidate.id));
  if (!subject) throw new Error(`Runtime profile ${profile.id} has no representative subject.`);
  const base = {
    id: subject.knowledgeItemId,
    title: subject.title,
    summary: subject.summary,
    path: subject.evidence.find((evidence) => evidence.path)?.path,
    symbol: subject.evidence.find((evidence) => evidence.symbol)?.symbol,
    contentHash: subject.evidenceFingerprint,
    confidence: subject.confidence,
    readiness: subject.readiness,
    evidence: subject.evidence,
    adapterId: "living-documentation",
    tags: [subject.domain],
  };
  if (profile.domain === "component-library") return { ...base, catalog: "components", kind: "component", props: [], storyIds: [], providers: [] };
  if (profile.domain === "api") return {
    ...base,
    catalog: "api",
    kind: "endpoint",
    method: typeof subject.contract.method === "string" ? subject.contract.method : "GET",
    route: typeof subject.contract.route === "string" ? subject.contract.route : "/",
    authentication: [],
  };
  if (profile.domain === "data-model") return { ...base, catalog: "data-model", kind: "table", fields: [] };
  return { ...base, catalog: "code-docs", kind: "symbol", language: "TypeScript", headings: [] };
}

async function probeGeneratedProvider(
  root: string,
  documentation: LivingDocumentationSnapshot,
  profile: RuntimeProfile,
  artifact: RuntimeProviderArtifact,
): Promise<RuntimeProviderArtifact> {
  if (artifact.validation.status === "fail") return artifact;
  const item = probeItem(documentation, profile);
  const moduleId = "runtime-probe";
  const tour = TourSnapshotSchema.parse({
    schemaVersion: 3,
    id: `runtime-probe:${artifact.cacheKey}`,
    projectName: documentation.projectName,
    repositoryRoot: root,
    anchor: documentation.anchor,
    generatedAt: new Date().toISOString(),
    generator: "tourguide-runtime-probe",
    promptVersion: 3,
    status: "draft",
    tracks: [{ id: "probe", title: "Probe", summary: "Runtime probe", kind: "core", priority: 0, moduleIds: [moduleId] }],
    modules: [{
      id: moduleId,
      title: "Runtime probe",
      outcome: "Validate a generated provider.",
      relevance: "Generated providers are reusable only after execution succeeds.",
      estimatedMinutes: 1,
      prerequisites: [],
      pageIds: ["runtime-probe-page"],
      surfaces: [],
      knowledgeRefs: [],
      documentationBindings: [],
      gaps: [],
      status: "ready",
    }],
    pages: [{
      id: "runtime-probe-page",
      moduleId,
      kind: "demo",
      title: "Runtime probe",
      objective: "Validate the provider.",
      estimatedMinutes: 1,
      narrative: "Automated provider validation.",
      status: "ready",
      prerequisites: [],
      evidence: [],
      knowledgeRefs: [],
      documentationBindings: [],
      interactions: [{ type: "data", title: "Probe", columns: [], rows: [] }],
      references: [],
    }],
    coverage: [],
    dependencies: {},
    knowledgeSnapshotId: documentation.sourceKnowledgeSnapshotId,
    documentationSnapshotId: documentation.id,
    knowledgeRefs: [],
    featureJourneys: [],
    labEnvironments: [{
      id: "runtime-probe-environment",
      moduleId,
      title: "Runtime probe environment",
      adapterIds: [],
      runtimeProfileIds: [profile.id],
      runtimeProviders: [artifact],
      editablePaths: [],
      preparationRecipes: [],
      services: [],
      dependencies: [],
      readiness: "ready",
    }],
  });
  const manager = new LabManager(root, undefined, 60_000);
  const diagnostics: string[] = [];
  try {
    const { session } = await manager.create(tour, moduleId);
    const result = await manager.invokeCapability(session.id, domainPrimaryCapability(profile), { item, inputs: {} });
    if (result.value && typeof result.value === "object" && "url" in result.value) {
      const response = await fetch(String((result.value as { url: unknown }).url), { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) diagnostics.push(`Provider URL probe returned HTTP ${response.status}.`);
    }
  } catch (error) {
    diagnostics.push(error instanceof Error ? error.message : String(error));
  } finally {
    await manager.shutdown();
  }
  return RuntimeProviderArtifactSchema.parse({
    ...artifact,
    validation: {
      status: diagnostics.length ? "fail" : "pass",
      validator: "runtime-provider-probe-v1",
      validatedAt: new Date().toISOString(),
      inputFingerprint: artifact.cacheKey,
      diagnostics,
    },
  });
}

export class IntelligenceCoordinator {
  readonly #flights = new Map<string, Promise<unknown>>();

  constructor(
    readonly root: string,
    readonly store = new TourStore(root),
    readonly runner: Runner = new CodexExecRunner(),
    readonly model?: string,
  ) {}

  private singleFlight<T>(key: string, work: () => Promise<T>): Promise<T> {
    const existing = this.#flights.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const flight = work().finally(() => this.#flights.delete(key));
    this.#flights.set(key, flight);
    return flight;
  }

  async reconcileDocumentation(
    knowledge: RepositoryKnowledgeSnapshot,
    previous?: LivingDocumentationSnapshot,
    signal?: AbortSignal,
  ): Promise<DocumentationReconciliationResult> {
    const base = buildLivingDocumentation(knowledge, previous);
    const artifacts: DocumentationInferenceArtifact[] = [];
    const missing: Array<{ request: LivingDocumentationSnapshot["inferenceRequests"][number]; cacheKey: string }> = [];
    let cacheHits = 0;
    for (const request of base.inferenceRequests.filter((candidate) => candidate.status === "pending")) {
      const cacheKey = inferenceCacheKey(request);
      const cached = await this.store.documentationInferenceArtifact(cacheKey);
      if (successful(cached, cacheKey)) {
        artifacts.push(cached);
        cacheHits += 1;
      } else missing.push({ request, cacheKey });
    }
    let generated: CodexExecResult<z.output<typeof DocumentationInferenceBatchSchema>> | undefined;
    if (missing.length) {
      const batchKey = intelligenceFingerprint(missing.map(({ cacheKey }) => cacheKey));
      generated = await this.singleFlight(`documentation:${batchKey}`, () => withRevisionWorkspace(
        this.root,
        knowledge.anchor.commit,
        batchKey,
        (cwd) => this.runner.run({
          cwd,
          prompt: inferencePrompt(base, missing.map(({ request }) => request.id)),
          schema: DocumentationInferenceBatchSchema,
          ...(this.model ? { model: this.model } : {}),
          ...(signal ? { signal } : {}),
        }),
      )) as CodexExecResult<z.output<typeof DocumentationInferenceBatchSchema>>;
      for (const { request, cacheKey } of missing) {
        const result = generated.value.results.find((candidate) => candidate.requestId === request.id);
        const artifact = validateInference(base, request, result, cacheKey);
        await this.store.saveDocumentationInferenceArtifact(artifact);
        if (artifact.validation.status === "pass") artifacts.push(artifact);
      }
    }
    const documentation = applyDocumentationInferenceArtifacts(base, artifacts);
    await this.store.saveDocumentation(documentation);
    return {
      documentation,
      artifacts,
      stats: {
        coldCalls: missing.length ? 1 : 0,
        cacheHits,
        usage: missing.length ? generated!.usage : { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      },
    };
  }

  async resolveRuntimeProviders(
    documentation: LivingDocumentationSnapshot,
    inventory: ProjectInventory,
    signal?: AbortSignal,
  ): Promise<{ documentation: LivingDocumentationSnapshot; artifacts: RuntimeProviderArtifact[]; stats: IntelligenceStats }> {
    const artifacts: RuntimeProviderArtifact[] = [];
    const missing: Array<{ profile: RuntimeProfile; cacheKey: string }> = [];
    let cacheHits = 0;
    for (const profile of documentation.runtimeProfiles) {
      const cacheKey = runtimeCacheKey(profile);
      const cached = await this.store.runtimeProviderArtifact(cacheKey);
      if (successful(cached, cacheKey)) {
        artifacts.push(cached);
        cacheHits += 1;
        continue;
      }
      const deterministic = deterministicProvider(profile, inventory, documentation);
      if (deterministic) {
        await this.store.saveRuntimeProviderArtifact(deterministic);
        artifacts.push(deterministic);
      } else missing.push({ profile, cacheKey });
    }
    let generated: CodexExecResult<z.output<typeof RuntimeSynthesisBatchSchema>> | undefined;
    if (missing.length) {
      const batchKey = intelligenceFingerprint(missing.map(({ cacheKey }) => cacheKey));
      generated = await this.singleFlight(`runtime:${batchKey}`, () => withRevisionWorkspace(
        this.root,
        documentation.anchor.commit,
        batchKey,
        (cwd) => this.runner.run({
          cwd,
          prompt: runtimePrompt(documentation, missing.map(({ profile }) => profile)),
          schema: RuntimeSynthesisBatchSchema,
          ...(this.model ? { model: this.model } : {}),
          ...(signal ? { signal } : {}),
        }),
      )) as CodexExecResult<z.output<typeof RuntimeSynthesisBatchSchema>>;
      for (const { profile, cacheKey } of missing) {
        const proposal = generated.value.providers.find((candidate) => candidate.profileId === profile.id);
        const proposed = validateRuntimeProposal(profile, proposal, cacheKey);
        const artifact = await probeGeneratedProvider(this.root, documentation, profile, proposed);
        await this.store.saveRuntimeProviderArtifact(artifact);
        if (artifact.validation.status === "pass") artifacts.push(artifact);
      }
    }
    const next = runtimeWithArtifacts(documentation, artifacts);
    await this.store.saveDocumentation(next);
    return {
      documentation: next,
      artifacts,
      stats: {
        coldCalls: missing.length ? 1 : 0,
        cacheHits,
        usage: generated?.usage ?? { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      },
    };
  }

  async assessTourImpact(
    tour: TourSnapshot,
    diff: DocumentationDiff,
    documentation: LivingDocumentationSnapshot,
    signal?: AbortSignal,
  ): Promise<{ artifact?: TourImpactAssessmentArtifact; stats: IntelligenceStats }> {
    const impact = findTourDocumentationImpact(tour, diff);
    if (!impact.pageIds.length && !impact.moduleIds.length) return { stats: { coldCalls: 0, cacheHits: 0, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } } };
    const contractFingerprint = tourContractFingerprint(tour);
    const diffFingerprint = intelligenceFingerprint(diff.changes.filter((change) => (
      impact.pageIds.some((pageId) => tour.pages.find((page) => page.id === pageId)?.documentationBindings.some((binding) => binding.subjectId === change.subjectId))
      || impact.moduleIds.some((moduleId) => tour.modules.find((module) => module.id === moduleId)?.documentationBindings.some((binding) => binding.subjectId === change.subjectId))
    )));
    const cacheKey = intelligenceFingerprint({
      kind: "tour-impact",
      promptVersion: TOUR_IMPACT_PROMPT_VERSION,
      contractFingerprint,
      diffFingerprint,
    });
    const cached = await this.store.tourImpactArtifact(cacheKey);
    if (successful(cached, cacheKey)) return { artifact: cached, stats: { coldCalls: 0, cacheHits: 1, usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 } } };
    const generated = await this.singleFlight(`tour-impact:${cacheKey}`, () => withRevisionWorkspace(
      this.root,
      documentation.anchor.commit,
      cacheKey,
      (cwd) => this.runner.run({
        cwd,
        prompt: `Assess whether this Tourguide content remains semantically correct after a documentation change.

Prefer reuse when prose and exercises remain correct, rebind when only evidence identifiers or compatible scenarios changed, and regenerate only when teaching content or verification is no longer accurate. Assess every supplied page and module exactly once.

Documentation changes:
${JSON.stringify(diff.changes, null, 2)}

Affected tour content:
${JSON.stringify({
  pages: tour.pages.filter((page) => impact.pageIds.includes(page.id)),
  modules: tour.modules.filter((module) => impact.moduleIds.includes(module.id)),
  currentSubjects: documentation.subjects.filter((subject) => diff.changes.some((change) => change.subjectId === subject.id)),
}, null, 2)}`,
        schema: TourImpactProposalSchema,
        ...(this.model ? { model: this.model } : {}),
        ...(signal ? { signal } : {}),
      }),
    )) as CodexExecResult<z.output<typeof TourImpactProposalSchema>>;
    const diagnostics: string[] = [];
    const pageIds = new Set(impact.pageIds);
    const moduleIds = new Set(impact.moduleIds);
    for (const assessment of generated.value.pages) if (!pageIds.has(assessment.pageId)) diagnostics.push(`Unknown assessed page ${assessment.pageId}.`);
    for (const assessment of generated.value.modules) if (!moduleIds.has(assessment.moduleId)) diagnostics.push(`Unknown assessed module ${assessment.moduleId}.`);
    for (const id of pageIds) if (!generated.value.pages.some((assessment) => assessment.pageId === id)) diagnostics.push(`Missing page assessment ${id}.`);
    for (const id of moduleIds) if (!generated.value.modules.some((assessment) => assessment.moduleId === id)) diagnostics.push(`Missing module assessment ${id}.`);
    const generatedAt = new Date().toISOString();
    const artifact = TourImpactAssessmentArtifactSchema.parse({
      schemaVersion: 1,
      id: `tour-impact:${cacheKey}`,
      cacheKey,
      tourContractFingerprint: contractFingerprint,
      diffFingerprint,
      promptVersion: TOUR_IMPACT_PROMPT_VERSION,
      generator: "codex-exec",
      generatedAt,
      pageAssessments: generated.value.pages,
      moduleAssessments: generated.value.modules,
      validation: {
        status: diagnostics.length ? "fail" : "pass",
        validator: "tour-impact-v1",
        validatedAt: generatedAt,
        inputFingerprint: cacheKey,
        diagnostics,
      },
    });
    await this.store.saveTourImpactArtifact(artifact);
    return {
      ...(artifact.validation.status === "pass" ? { artifact } : {}),
      stats: { coldCalls: 1, cacheHits: 0, usage: generated.usage },
    };
  }
}
