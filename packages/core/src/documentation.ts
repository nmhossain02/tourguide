import { createHash } from "node:crypto";

import { allKnowledgeItems } from "./knowledge.js";
import {
  DocumentationDiffSchema,
  LivingDocumentationSnapshotSchema,
  type DocumentationClaim,
  type DocumentationDiff,
  type DocumentationDomain,
  type DocumentationInferenceRequest,
  type DocumentationInferenceArtifact,
  type DocumentationScenario,
  type DocumentationSubject,
  type EvidenceRef,
  type KnowledgeItem,
  type KnowledgeRef,
  type LivingDocumentationSnapshot,
  type RepositoryKnowledgeSnapshot,
  type RuntimeProfile,
  type SemanticBinding,
  type TourSnapshot,
} from "./schema.js";

export const DOCUMENTATION_RECONCILER_VERSION = "1";
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function hash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function intelligenceFingerprint(value: unknown): string {
  return hash(value);
}

function uniqueEvidence(values: EvidenceRef[]): EvidenceRef[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function evidenceFingerprint(evidence: EvidenceRef[]): string {
  return hash(evidence.map((item) => [item.id, item.contentHash ?? "", item.revision, item.validated]).sort());
}

function domainFor(item: KnowledgeItem): DocumentationDomain {
  if (item.catalog === "data-model") return "data-model";
  if (item.catalog === "api") return "api";
  if (item.catalog === "components") return "component-library";
  if (item.kind === "symbol") return "compute";
  return "general";
}

function capabilitiesFor(item: KnowledgeItem): string[] {
  if (item.catalog === "data-model") return ["data.introspect", "data.query", "data.mutate"];
  if (item.catalog === "api") return ["service.request"];
  if (item.catalog === "components") return ["ui.render", "ui.observe"];
  if (item.kind === "symbol") return ["code.invoke", "runtime.observe"];
  return ["documentation.read"];
}

function jsonValue(value: unknown): JsonValue {
  return value === undefined ? null : JSON.parse(JSON.stringify(value)) as JsonValue;
}

function contractFor(item: KnowledgeItem): Record<string, JsonValue> {
  if (item.catalog === "data-model") return {
    fields: item.fields.map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required,
      primaryKey: field.primaryKey,
      ...(field.references ? { references: field.references } : {}),
    })),
  };
  if (item.catalog === "api") return {
    method: item.method ?? null,
    route: item.route ?? null,
    authentication: item.authentication,
    requestSchema: jsonValue(item.requestSchema),
    responseSchema: jsonValue(item.responseSchema),
  };
  if (item.catalog === "components") return {
    props: item.props.map((prop) => ({
      name: prop.name,
      type: prop.type,
      required: prop.required,
      ...(prop.defaultValue ? { defaultValue: prop.defaultValue } : {}),
    })),
    stories: item.storyIds,
    providers: item.providers,
  };
  return {
    path: item.path ?? null,
    symbol: item.symbol ?? null,
    language: item.language ?? null,
    headings: item.headings,
  };
}

function scenariosFor(item: KnowledgeItem): DocumentationScenario[] {
  const base = {
    subjectId: item.id,
    dependencyContractIds: [],
    origin: "observed" as const,
    evidence: item.evidence,
  };
  if (item.catalog === "components") {
    const stories = item.storyIds.map((storyId) => ({
      ...base,
      id: `scenario:${item.id}:story:${storyId}`,
      title: storyId,
      operation: "render",
      inputs: { storyId, args: {} },
      requiredCapabilities: ["ui.render"],
    }));
    return stories.length ? stories : [{
      ...base,
      id: `scenario:${item.id}:render`,
      title: `Render ${item.title}`,
      operation: "render",
      inputs: { props: {} },
      requiredCapabilities: ["ui.render"],
    }];
  }
  if (item.catalog === "api" && item.kind === "endpoint") return [{
    ...base,
    id: `scenario:${item.id}:request`,
    title: `${item.method ?? "REQUEST"} ${item.route ?? item.title}`,
    operation: "request",
    inputs: {},
    requiredCapabilities: ["service.request"],
  }];
  if (item.catalog === "data-model" && (item.kind === "entity" || item.kind === "table")) return [{
    ...base,
    id: `scenario:${item.id}:inspect`,
    title: `Inspect ${item.title}`,
    operation: "inspect",
    inputs: {},
    requiredCapabilities: ["data.introspect"],
  }];
  if (item.catalog === "code-docs" && item.kind === "symbol") return [{
    ...base,
    id: `scenario:${item.id}:invoke`,
    title: `Invoke ${item.title}`,
    operation: "invoke",
    inputs: { args: [] },
    requiredCapabilities: ["code.invoke"],
  }];
  return [];
}

function inferenceQuestions(subject: DocumentationSubject): string[] {
  if (subject.domain === "component-library") {
    const props = subject.contract.props;
    const providers = subject.contract.providers;
    return Array.isArray(props) && props.length > 0 && Array.isArray(providers) && providers.length > 0
      ? []
      : ["Infer meaningful inputs, required providers, dependencies, and representative UI states that are not explicit in repository documentation."];
  }
  if (subject.domain === "api") {
    return subject.contract.requestSchema !== null && subject.contract.responseSchema !== null
      ? []
      : ["Infer the request, response, error, and side-effect contract from implementation, clients, tests, and documentation."];
  }
  if (subject.domain === "data-model") {
    return ["Explain the domain concept, invariants, lifecycle, and relationships represented by this storage or entity surface."];
  }
  if (subject.domain === "compute") {
    return ["Infer callable inputs, outputs, side effects, dependencies, and useful execution scenarios for this compute surface."];
  }
  return [];
}

function profileFor(
  domain: DocumentationDomain,
  subjects: DocumentationSubject[],
  knowledge: RepositoryKnowledgeSnapshot,
): RuntimeProfile | undefined {
  if (!subjects.length || domain === "general") return undefined;
  const definitions = {
    "component-library": { id: "frontend:main", title: "Frontend component runtime", capabilities: ["ui.render", "ui.observe"], hints: ["generic-react", "repository-preview", "storybook"] },
    api: { id: "api:main", title: "Application API runtime", capabilities: ["service.request"], hints: ["repository-service", "generic-http"] },
    "data-model": { id: "data:application", title: "Application data runtime", capabilities: ["data.introspect", "data.query", "data.mutate"], hints: ["repository-connector", "generic-data-connector"] },
    compute: { id: "compute:main", title: "Application compute runtime", capabilities: ["code.invoke", "runtime.observe"], hints: ["repository-runner", "generic-typescript-worker"] },
  } as const;
  const definition = definitions[domain];
  if (!definition) return undefined;
  const relevantConfiguration = knowledge.files.filter((file) => {
    if (!["configuration", "data"].includes(file.classification)) return false;
    if (domain === "data-model") return file.classification === "configuration" && /(?:package\.json|orm|prisma|sequelize|drizzle|typeorm|database)/i.test(file.path);
    return /(?:package\.json|tsconfig|vite|webpack|next\.config|babel|eslint)/i.test(file.path);
  });
  const evidence = uniqueEvidence(subjects.flatMap((subject) => subject.evidence));
  return {
    id: definition.id,
    domain,
    title: definition.title,
    capabilities: [...definition.capabilities],
    subjectIds: subjects.map((subject) => subject.id),
    providerHints: [...definition.hints],
    evidence,
    dependencyFingerprint: hash([
      domain,
      ...relevantConfiguration.map((file) => [file.path, file.contentHash]),
    ]),
    subjectRegistryFingerprint: hash(subjects.map((subject) => [subject.id, subject.contractFingerprint]).sort()),
    readiness: "ready",
    probeStatus: "unprobed",
  };
}

function repositoryMockContracts(knowledge: RepositoryKnowledgeSnapshot) {
  return knowledge.files
    .filter((file) => !file.excludedReason && /(^|\/)(__mocks__|mocks?|fixtures?|stubs?)(\/|$)/i.test(file.path))
    .map((file) => ({
      id: `dependency:repository-mock:${hash(file.path).slice(0, 12)}`,
      title: file.path,
      kind: "module" as const,
      operations: [],
      mode: "repository-mock" as const,
      subjectIds: [],
      evidence: allKnowledgeItems(knowledge).find((item) => item.path === file.path)?.evidence ?? [],
      reason: "Repository-owned test double or fixture detected by path.",
    }));
}

export function documentationSnapshotId(commit: string): string {
  return `documentation:${commit}:${DOCUMENTATION_RECONCILER_VERSION}`;
}

export function buildLivingDocumentation(
  knowledge: RepositoryKnowledgeSnapshot,
  previous?: LivingDocumentationSnapshot,
): LivingDocumentationSnapshot {
  const items = allKnowledgeItems(knowledge);
  const scenarios = items.flatMap(scenariosFor);
  const scenariosBySubject = new Map<string, DocumentationScenario[]>();
  for (const scenario of scenarios) scenariosBySubject.set(scenario.subjectId, [...(scenariosBySubject.get(scenario.subjectId) ?? []), scenario]);
  const subjects: DocumentationSubject[] = items.map((item) => {
    const contract = contractFor(item);
    return {
      id: item.id,
      domain: domainFor(item),
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      knowledgeItemId: item.id,
      contract,
      contractFingerprint: hash(contract),
      evidenceFingerprint: evidenceFingerprint(item.evidence),
      claimIds: [`claim:${item.id}:summary`, `claim:${item.id}:contract`],
      scenarioIds: (scenariosBySubject.get(item.id) ?? []).map((scenario) => scenario.id),
      dependencyContractIds: [],
      capabilities: capabilitiesFor(item),
      evidence: item.evidence,
      confidence: item.confidence,
      readiness: item.readiness,
    };
  });
  const currentById = new Map(subjects.map((subject) => [subject.id, subject]));
  const previousById = new Map(previous?.subjects.map((subject) => [subject.id, subject]) ?? []);
  const claims: DocumentationClaim[] = subjects.flatMap((subject) => {
    const origin = subject.domain === "general" && subject.kind === "document" ? "repository-doc" as const : "observed" as const;
    return [
      {
        id: `claim:${subject.id}:summary`, subjectId: subject.id, field: "summary", value: subject.summary,
        origin, evidence: subject.evidence, evidenceFingerprint: subject.evidenceFingerprint,
        confidence: subject.confidence, lastConfirmedCommit: knowledge.anchor.commit, status: "valid" as const,
      },
      {
        id: `claim:${subject.id}:contract`, subjectId: subject.id, field: "contract", value: subject.contract,
        origin: "observed" as const, evidence: subject.evidence, evidenceFingerprint: subject.evidenceFingerprint,
        confidence: subject.confidence, lastConfirmedCommit: knowledge.anchor.commit, status: "valid" as const,
      },
    ];
  });
  for (const claim of previous?.claims.filter((candidate) => candidate.origin === "inferred") ?? []) {
    const current = currentById.get(claim.subjectId);
    const prior = previousById.get(claim.subjectId);
    if (!current || !prior) continue;
    claims.push(current.evidenceFingerprint === prior.evidenceFingerprint
      ? claim
      : { ...claim, status: "invalidated" });
  }
  const inferredScenarios = previous?.scenarios.filter((scenario) => {
    if (scenario.origin !== "inferred") return false;
    const current = currentById.get(scenario.subjectId);
    const prior = previousById.get(scenario.subjectId);
    return Boolean(current && prior && current.evidenceFingerprint === prior.evidenceFingerprint);
  }) ?? [];
  for (const scenario of inferredScenarios) {
    if (!scenarios.some((candidate) => candidate.id === scenario.id)) scenarios.push(scenario);
  }
  const questionsByDomain = new Map<DocumentationDomain, Array<{ subject: DocumentationSubject; questions: string[] }>>();
  for (const subject of subjects) {
    const questions = inferenceQuestions(subject);
    if (questions.length) questionsByDomain.set(subject.domain, [...(questionsByDomain.get(subject.domain) ?? []), { subject, questions }]);
  }
  const inferenceRequests: DocumentationInferenceRequest[] = [...questionsByDomain.entries()].map(([domain, entries]) => {
    const evidence = uniqueEvidence(entries.flatMap((entry) => entry.subject.evidence));
    return {
      id: `inference:${domain}:${hash(entries.map((entry) => [entry.subject.id, entry.subject.evidenceFingerprint])).slice(0, 16)}`,
      domain,
      subjectIds: entries.map((entry) => entry.subject.id),
      questions: [...new Set(entries.flatMap((entry) => entry.questions))],
      evidence,
      evidenceFingerprint: evidenceFingerprint(evidence),
      status: "pending",
    };
  });
  const runtimeProfiles = (["data-model", "api", "component-library", "compute"] as DocumentationDomain[])
    .flatMap((domain) => {
      const profile = profileFor(domain, subjects.filter((subject) => subject.domain === domain), knowledge);
      const previousProfile = previous?.runtimeProfiles.find((candidate) => candidate.id === profile?.id);
      return profile ? [{
        ...profile,
        ...(previousProfile?.dependencyFingerprint === profile.dependencyFingerprint
          ? { generatedArtifactRef: previousProfile.generatedArtifactRef, probeStatus: previousProfile.probeStatus }
          : {}),
      }] : [];
    });
  return LivingDocumentationSnapshotSchema.parse({
    schemaVersion: 1,
    id: documentationSnapshotId(knowledge.anchor.commit),
    projectName: knowledge.projectName,
    repositoryRoot: knowledge.repositoryRoot,
    anchor: knowledge.anchor,
    sourceKnowledgeSnapshotId: knowledge.id,
    reconcilerVersion: DOCUMENTATION_RECONCILER_VERSION,
    generatedAt: new Date().toISOString(),
    subjects,
    claims,
    scenarios,
    dependencyContracts: repositoryMockContracts(knowledge),
    runtimeProfiles,
    relationships: knowledge.relationships,
    inferenceRequests,
  });
}

export function applyDocumentationInferenceArtifacts(
  snapshot: LivingDocumentationSnapshot,
  artifacts: DocumentationInferenceArtifact[],
): LivingDocumentationSnapshot {
  const accepted = artifacts.filter((artifact) => artifact.validation.status === "pass");
  if (!accepted.length) return snapshot;
  const subjects = new Map(snapshot.subjects.map((subject) => [subject.id, {
    ...subject,
    claimIds: [...subject.claimIds],
    scenarioIds: [...subject.scenarioIds],
    dependencyContractIds: [...subject.dependencyContractIds],
  }]));
  const replacedClaimKeys = new Set(accepted.flatMap((artifact) => artifact.claims.map((claim) => `${claim.subjectId}:${claim.field}`)));
  const claims: DocumentationClaim[] = snapshot.claims.filter((claim) => (
    claim.origin !== "inferred" || !replacedClaimKeys.has(`${claim.subjectId}:${claim.field}`)
  ));
  const scenarios: DocumentationScenario[] = [...snapshot.scenarios];
  const contracts = [...snapshot.dependencyContracts];

  for (const artifact of accepted) {
    for (const claim of artifact.claims) {
      const subject = subjects.get(claim.subjectId);
      if (!subject) continue;
      const id = `claim:${claim.subjectId}:inferred:${hash(claim.field).slice(0, 12)}`;
      claims.push({
        id,
        subjectId: claim.subjectId,
        field: claim.field,
        value: claim.value,
        origin: "inferred",
        evidence: subject.evidence,
        evidenceFingerprint: subject.evidenceFingerprint,
        confidence: claim.confidence,
        lastConfirmedCommit: snapshot.anchor.commit,
        status: "valid",
      });
      subject.claimIds = [...new Set([...subject.claimIds, id])];
    }
    for (const scenario of artifact.scenarios) {
      const subject = subjects.get(scenario.subjectId);
      if (!subject) continue;
      const inferred: DocumentationScenario = {
        ...scenario,
        origin: "inferred",
        evidence: subject.evidence,
      };
      const index = scenarios.findIndex((candidate) => candidate.id === inferred.id);
      if (index >= 0) scenarios[index] = inferred;
      else scenarios.push(inferred);
      subject.scenarioIds = [...new Set([...subject.scenarioIds, inferred.id])];
    }
    for (const contract of artifact.dependencyContracts) {
      const index = contracts.findIndex((candidate) => candidate.id === contract.id);
      if (index >= 0) contracts[index] = contract;
      else contracts.push(contract);
      for (const subjectId of contract.subjectIds) {
        const subject = subjects.get(subjectId);
        if (subject) subject.dependencyContractIds = [...new Set([...subject.dependencyContractIds, contract.id])];
      }
    }
  }

  const resolvedRequests = new Set(accepted.map((artifact) => artifact.requestId));
  return LivingDocumentationSnapshotSchema.parse({
    ...snapshot,
    subjects: [...subjects.values()],
    claims,
    scenarios,
    dependencyContracts: contracts,
    inferenceRequests: snapshot.inferenceRequests.map((request) => (
      resolvedRequests.has(request.id) ? { ...request, status: "resolved" } : request
    )),
  });
}

export function diffLivingDocumentation(
  previous: LivingDocumentationSnapshot,
  next: LivingDocumentationSnapshot,
): DocumentationDiff {
  const prior = new Map(previous.subjects.map((subject) => [subject.id, subject]));
  const current = new Map(next.subjects.map((subject) => [subject.id, subject]));
  const changes: DocumentationDiff["changes"] = [];
  for (const subject of next.subjects) {
    const before = prior.get(subject.id);
    if (!before) {
      changes.push({ subjectId: subject.id, domain: subject.domain, classification: "additive", reason: "A documented subject was added." });
    } else if (before.contractFingerprint !== subject.contractFingerprint) {
      const removedScenario = before.scenarioIds.some((id) => !subject.scenarioIds.includes(id));
      changes.push({
        subjectId: subject.id,
        domain: subject.domain,
        classification: removedScenario ? "breaking" : "behavioral",
        reason: removedScenario ? "A documented scenario was removed." : "The documented contract changed.",
      });
    } else if (before.evidenceFingerprint !== subject.evidenceFingerprint || before.summary !== subject.summary) {
      changes.push({ subjectId: subject.id, domain: subject.domain, classification: "compatible", reason: "Evidence changed while the documented contract remained compatible." });
    }
  }
  for (const subject of previous.subjects) {
    if (!current.has(subject.id)) changes.push({ subjectId: subject.id, domain: subject.domain, classification: "breaking", reason: "A documented subject was removed." });
  }
  const changedDomains = [...new Set(changes.map((change) => change.domain))];
  const inferenceDomains = [...new Set(next.inferenceRequests
    .filter((request) => changedDomains.includes(request.domain))
    .map((request) => request.domain))];
  return DocumentationDiffSchema.parse({
    fromSnapshotId: previous.id,
    toSnapshotId: next.id,
    changes,
    changedDomains,
    inferenceDomains,
  });
}

export function semanticBindingsForKnowledgeRefs(references: KnowledgeRef[]): SemanticBinding[] {
  return [...new Map(references.map((reference) => [reference.itemId, {
    subjectId: reference.itemId,
    binding: "latest-compatible" as const,
    requiredCapabilities: [],
    concepts: [],
  }])).values()];
}

export function resolveSemanticBinding(snapshot: LivingDocumentationSnapshot, binding: SemanticBinding) {
  const subject = snapshot.subjects.find((candidate) => candidate.id === binding.subjectId);
  if (!subject) return { status: "missing" as const, reason: `Documentation subject ${binding.subjectId} is unavailable.` };
  const scenario = binding.scenarioId
    ? snapshot.scenarios.find((candidate) => candidate.id === binding.scenarioId && candidate.subjectId === subject.id)
    : undefined;
  if (binding.scenarioId && !scenario) return { status: "missing" as const, reason: `Documentation scenario ${binding.scenarioId} is unavailable.` };
  const missingCapabilities = binding.requiredCapabilities.filter((capability) => !subject.capabilities.includes(capability));
  if (missingCapabilities.length) return { status: "incompatible" as const, reason: `Missing capabilities: ${missingCapabilities.join(", ")}.`, subject, scenario };
  return { status: "resolved" as const, subject, scenario };
}

export function findTourDocumentationImpact(tour: TourSnapshot, diff: DocumentationDiff) {
  const material = new Map(diff.changes
    .filter((change) => ["behavioral", "breaking", "ambiguous"].includes(change.classification))
    .map((change) => [change.subjectId, change]));
  const pageIds = tour.pages.filter((page) => page.documentationBindings.some((binding) => material.has(binding.subjectId))).map((page) => page.id);
  const moduleIds = tour.modules.filter((module) => (
    module.documentationBindings.some((binding) => material.has(binding.subjectId))
    || module.pageIds.some((id) => pageIds.includes(id))
  )).map((module) => module.id);
  return {
    pageIds,
    moduleIds,
    requiresAgentAssessment: diff.changes.some((change) => change.classification === "ambiguous" && (
      tour.pages.some((page) => page.documentationBindings.some((binding) => binding.subjectId === change.subjectId))
      || tour.modules.some((module) => module.documentationBindings.some((binding) => binding.subjectId === change.subjectId))
    )),
  };
}

export interface DocumentationUpdatePlan {
  inferenceRequests: DocumentationInferenceRequest[];
  runtimeActions: Array<{
    profileId: string;
    action: "reuse" | "update-registry" | "probe" | "synthesize";
    reason: string;
  }>;
  environmentSynthesisProfileIds: string[];
  requiresTourAssessment: boolean;
}

export function planDocumentationUpdate(
  previous: LivingDocumentationSnapshot | undefined,
  next: LivingDocumentationSnapshot,
  diff: DocumentationDiff | undefined,
  options: {
    adapterResolvedDomains?: DocumentationDomain[];
    failedRuntimeProfileIds?: string[];
    affectedTours?: TourSnapshot[];
  } = {},
): DocumentationUpdatePlan {
  const resolvedDomains = new Set(options.adapterResolvedDomains ?? []);
  const changedDomains = new Set(diff?.changedDomains ?? next.inferenceRequests.map((request) => request.domain));
  const inferenceRequests = next.inferenceRequests.filter((request) => (
    request.status === "pending"
    && changedDomains.has(request.domain)
    && !resolvedDomains.has(request.domain)
  ));
  const failedProfiles = new Set(options.failedRuntimeProfileIds ?? []);
  const previousProfiles = new Map(previous?.runtimeProfiles.map((profile) => [profile.id, profile]) ?? []);
  const runtimeActions = next.runtimeProfiles.map((profile) => {
    const before = previousProfiles.get(profile.id);
    if (failedProfiles.has(profile.id)) return {
      profileId: profile.id,
      action: "synthesize" as const,
      reason: "The deterministic runtime probe failed after relevant evidence changed.",
    };
    if (!before || before.dependencyFingerprint !== profile.dependencyFingerprint) return {
      profileId: profile.id,
      action: "probe" as const,
      reason: before ? "Runtime construction evidence changed." : "The runtime profile has not been validated yet.",
    };
    if (before.subjectRegistryFingerprint !== profile.subjectRegistryFingerprint) return {
      profileId: profile.id,
      action: "update-registry" as const,
      reason: "Documented subjects changed while the reusable runtime contract remained compatible.",
    };
    return {
      profileId: profile.id,
      action: "reuse" as const,
      reason: "Runtime construction evidence and the subject registry are unchanged.",
    };
  });
  const affectedTours = options.affectedTours ?? [];
  const requiresTourAssessment = Boolean(diff && affectedTours.some((tour) => {
    const impact = findTourDocumentationImpact(tour, diff);
    return impact.pageIds.length > 0 || impact.moduleIds.length > 0;
  }));
  return {
    inferenceRequests,
    runtimeActions,
    environmentSynthesisProfileIds: runtimeActions.filter((action) => action.action === "synthesize").map((action) => action.profileId),
    requiresTourAssessment,
  };
}
