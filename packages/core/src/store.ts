import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parsePreferences, parseProgress, parseSnapshot } from "./migration.js";
import { buildRepositoryKnowledge } from "./knowledge.js";
import { buildLivingDocumentation } from "./documentation.js";
import { inspectRepositoryAt } from "./git.js";
import {
  ExerciseSessionSchema,
  DiagnosticReportSchema,
  GenerationEventSchema,
  GenerationJobSchema,
  PreferencesSchema,
  ProgressSchema,
  TourSnapshotSchema,
  RepositoryKnowledgeSnapshotSchema,
  LivingDocumentationSnapshotSchema,
  DocumentationInferenceArtifactSchema,
  RuntimeProviderArtifactSchema,
  TourImpactAssessmentArtifactSchema,
  type ExerciseSession,
  type DiagnosticReport,
  type GenerationEvent,
  type GenerationJob,
  type Preferences,
  type Progress,
  type TourSnapshot,
  type RepositoryKnowledgeSnapshot,
  type LivingDocumentationSnapshot,
  type DocumentationInferenceArtifact,
  type RuntimeProviderArtifact,
  type TourImpactAssessmentArtifact,
} from "./schema.js";

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export class TourStore {
  readonly base: string;

  constructor(readonly root: string) {
    this.base = join(root, ".tourguide");
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(join(this.base, "cache", "drafts"), { recursive: true }),
      mkdir(join(this.base, "cache", "snapshots"), { recursive: true }),
      mkdir(join(this.base, "cache", "jobs"), { recursive: true }),
      mkdir(join(this.base, "cache", "knowledge"), { recursive: true }),
      mkdir(join(this.base, "cache", "documentation"), { recursive: true }),
      mkdir(join(this.base, "cache", "intelligence", "documentation"), { recursive: true }),
      mkdir(join(this.base, "cache", "intelligence", "runtime"), { recursive: true }),
      mkdir(join(this.base, "cache", "intelligence", "tour-impact"), { recursive: true }),
      mkdir(join(this.base, "cache", "migrations"), { recursive: true }),
      mkdir(join(this.base, "diagnostics"), { recursive: true }),
      mkdir(join(this.base, "state", "exercises"), { recursive: true }),
      mkdir(join(this.base, "workspaces", "exercises"), { recursive: true }),
    ]);
    await this.ensureGitExclude();
  }

  private async ensureGitExclude(): Promise<void> {
    const exclude = join(this.root, ".git", "info", "exclude");
    try {
      const current = await readFile(exclude, "utf8");
      if (!current.split("\n").includes("/.tourguide/")) {
        await writeFile(exclude, `${current}${current.endsWith("\n") ? "" : "\n"}/.tourguide/\n`);
      }
    } catch {
      // Linked worktrees use a .git file. The generated directory remains
      // untracked and Tourguide never stages it.
    }
  }

  private async parsedSnapshot(path: string): Promise<TourSnapshot | undefined> {
    const value = await readJson(path);
    if (value === undefined) return undefined;
    let parsed = parseSnapshot(value);
    if (parsed.migrated) {
      await atomicJson(join(this.base, "cache", "migrations", `snapshot-legacy-${Date.now()}.json`), value);
      try {
        const inventory = await inspectRepositoryAt(this.root, parsed.snapshot.anchor.commit);
        const knowledge = await buildRepositoryKnowledge(inventory);
        const documentation = buildLivingDocumentation(knowledge);
        const codeByPath = new Map(knowledge.catalogs.codeDocs.filter((item) => item.kind === "file" || item.kind === "document" || item.kind === "config" || item.kind === "test" || item.kind === "delivery" || item.kind === "package").map((item) => [item.path, item]));
        const pages = parsed.snapshot.pages.map((page) => ({
          ...page,
          knowledgeRefs: [...new Map([
            ...page.knowledgeRefs,
            ...page.evidence.flatMap((evidence) => {
              const item = evidence.path ? codeByPath.get(evidence.path) : undefined;
              return item ? [{ catalog: item.catalog, itemId: item.id, contentHash: item.contentHash }] : [];
            }),
          ].map((reference) => [reference.itemId, reference])).values()],
        }));
        const modules = parsed.snapshot.modules.map((module) => ({
          ...module,
          knowledgeRefs: [...new Map(pages.filter((page) => page.moduleId === module.id).flatMap((page) => page.knowledgeRefs).map((reference) => [reference.itemId, reference])).values()],
        }));
        const snapshot = TourSnapshotSchema.parse({
          ...parsed.snapshot,
          knowledgeSnapshotId: knowledge.id,
          documentationSnapshotId: documentation.id,
          knowledgeRefs: [...new Map(modules.flatMap((module) => module.knowledgeRefs).map((reference) => [reference.itemId, reference])).values()],
          modules,
          pages,
        });
        await this.saveKnowledge(knowledge);
        await this.saveDocumentation(documentation);
        parsed = { snapshot, migrated: true };
      } catch {
        // Preserve the migrated tour even when its historical commit cannot be indexed locally.
      }
      await atomicJson(path, parsed.snapshot);
      await atomicJson(join(this.base, "cache", "snapshots", `${parsed.snapshot.id}.json`), parsed.snapshot);
    }
    return parsed.snapshot;
  }

  async current(): Promise<TourSnapshot | undefined> {
    return this.parsedSnapshot(join(this.base, "cache", "current.json"));
  }

  async snapshot(id: string): Promise<TourSnapshot | undefined> {
    return this.parsedSnapshot(join(this.base, "cache", "snapshots", `${id}.json`));
  }

  async knowledge(id: string): Promise<RepositoryKnowledgeSnapshot | undefined> {
    const value = await readJson(join(this.base, "cache", "knowledge", `${encodeURIComponent(id)}.json`));
    return value === undefined ? undefined : RepositoryKnowledgeSnapshotSchema.parse(value);
  }

  async saveKnowledge(value: RepositoryKnowledgeSnapshot): Promise<void> {
    const parsed = RepositoryKnowledgeSnapshotSchema.parse(value);
    await atomicJson(join(this.base, "cache", "knowledge", `${encodeURIComponent(parsed.id)}.json`), parsed);
  }

  async documentation(id: string): Promise<LivingDocumentationSnapshot | undefined> {
    const value = await readJson(join(this.base, "cache", "documentation", `${encodeURIComponent(id)}.json`));
    return value === undefined ? undefined : LivingDocumentationSnapshotSchema.parse(value);
  }

  async saveDocumentation(value: LivingDocumentationSnapshot): Promise<void> {
    const parsed = LivingDocumentationSnapshotSchema.parse(value);
    await atomicJson(join(this.base, "cache", "documentation", `${encodeURIComponent(parsed.id)}.json`), parsed);
  }

  async documentationInferenceArtifact(cacheKey: string): Promise<DocumentationInferenceArtifact | undefined> {
    const value = await readJson(join(this.base, "cache", "intelligence", "documentation", `${encodeURIComponent(cacheKey)}.json`));
    return value === undefined ? undefined : DocumentationInferenceArtifactSchema.parse(value);
  }

  async saveDocumentationInferenceArtifact(value: DocumentationInferenceArtifact): Promise<void> {
    const parsed = DocumentationInferenceArtifactSchema.parse(value);
    await atomicJson(join(this.base, "cache", "intelligence", "documentation", `${encodeURIComponent(parsed.cacheKey)}.json`), parsed);
  }

  async runtimeProviderArtifact(cacheKey: string): Promise<RuntimeProviderArtifact | undefined> {
    const value = await readJson(join(this.base, "cache", "intelligence", "runtime", `${encodeURIComponent(cacheKey)}.json`));
    return value === undefined ? undefined : RuntimeProviderArtifactSchema.parse(value);
  }

  async saveRuntimeProviderArtifact(value: RuntimeProviderArtifact): Promise<void> {
    const parsed = RuntimeProviderArtifactSchema.parse(value);
    await atomicJson(join(this.base, "cache", "intelligence", "runtime", `${encodeURIComponent(parsed.cacheKey)}.json`), parsed);
  }

  async tourImpactArtifact(cacheKey: string): Promise<TourImpactAssessmentArtifact | undefined> {
    const value = await readJson(join(this.base, "cache", "intelligence", "tour-impact", `${encodeURIComponent(cacheKey)}.json`));
    return value === undefined ? undefined : TourImpactAssessmentArtifactSchema.parse(value);
  }

  async saveTourImpactArtifact(value: TourImpactAssessmentArtifact): Promise<void> {
    const parsed = TourImpactAssessmentArtifactSchema.parse(value);
    await atomicJson(join(this.base, "cache", "intelligence", "tour-impact", `${encodeURIComponent(parsed.cacheKey)}.json`), parsed);
  }

  async saveDraft(snapshot: TourSnapshot): Promise<void> {
    await atomicJson(
      join(this.base, "cache", "drafts", `${snapshot.id}.json`),
      TourSnapshotSchema.parse(snapshot),
    );
  }

  async loadDraft(id: string): Promise<TourSnapshot | undefined> {
    return this.parsedSnapshot(join(this.base, "cache", "drafts", `${id}.json`));
  }

  async publishPartial(snapshot: TourSnapshot): Promise<void> {
    const parsed = TourSnapshotSchema.parse({ ...snapshot, status: "partial" });
    await Promise.all([
      atomicJson(join(this.base, "cache", "current.json"), parsed),
      atomicJson(join(this.base, "cache", "snapshots", `${parsed.id}.json`), parsed),
      this.saveDraft(parsed),
    ]);
  }

  async publish(snapshot: TourSnapshot): Promise<void> {
    const parsed = TourSnapshotSchema.parse({ ...snapshot, status: "published" });
    await Promise.all([
      atomicJson(join(this.base, "cache", "current.json"), parsed),
      atomicJson(join(this.base, "cache", "snapshots", `${parsed.id}.json`), parsed),
      this.saveDraft(parsed),
    ]);
  }

  async preferences(): Promise<Preferences> {
    return parsePreferences(await readJson(join(this.base, "state", "preferences.json")));
  }

  async savePreferences(value: Preferences): Promise<void> {
    await atomicJson(join(this.base, "state", "preferences.json"), PreferencesSchema.parse(value));
  }

  async progress(): Promise<Progress> {
    const path = join(this.base, "state", "progress.json");
    const value = await readJson(path);
    const parsed = parseProgress(value);
    if (parsed.migrated && value !== undefined) {
      await atomicJson(join(this.base, "cache", "migrations", `progress-v1-${Date.now()}.json`), value);
      await atomicJson(path, parsed.progress);
    }
    return parsed.progress;
  }

  async saveProgress(value: Progress): Promise<void> {
    await atomicJson(join(this.base, "state", "progress.json"), ProgressSchema.parse(value));
  }

  async generationJob(): Promise<GenerationJob | undefined> {
    const value = await readJson(join(this.base, "state", "generation.json"));
    return value === undefined ? undefined : GenerationJobSchema.parse(value);
  }

  async saveGenerationJob(value: GenerationJob): Promise<void> {
    const parsed = GenerationJobSchema.parse(value);
    await Promise.all([
      atomicJson(join(this.base, "state", "generation.json"), parsed),
      atomicJson(join(this.base, "cache", "jobs", `${parsed.id}.json`), parsed),
    ]);
  }

  async generationEvents(jobId: string): Promise<GenerationEvent[]> {
    const value = await readJson(join(this.base, "cache", "jobs", `${jobId}.events.json`));
    return Array.isArray(value) ? value.map((event) => GenerationEventSchema.parse(event)) : [];
  }

  async appendGenerationEvent(event: Omit<GenerationEvent, "id">): Promise<GenerationEvent> {
    const events = await this.generationEvents(event.jobId);
    const parsed = GenerationEventSchema.parse({ ...event, id: (events.at(-1)?.id ?? 0) + 1 });
    await atomicJson(
      join(this.base, "cache", "jobs", `${event.jobId}.events.json`),
      [...events.slice(-499), parsed],
    );
    return parsed;
  }

  async saveGenerationArtifact(jobId: string, name: string, value: unknown): Promise<string> {
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`Invalid generation artifact name: ${name}`);
    const path = join(this.base, "cache", "jobs", `${jobId}.${name}.json`);
    await atomicJson(path, value);
    return path;
  }

  diagnosticPath(id = "latest"): string {
    return join(this.base, "diagnostics", `${id}.json`);
  }

  async latestDiagnostic(): Promise<DiagnosticReport | undefined> {
    const value = await readJson(this.diagnosticPath());
    return value === undefined ? undefined : DiagnosticReportSchema.parse(value);
  }

  async saveDiagnostic(value: DiagnosticReport): Promise<DiagnosticReport> {
    const parsed = DiagnosticReportSchema.parse(value);
    await Promise.all([
      atomicJson(this.diagnosticPath(), parsed),
      atomicJson(this.diagnosticPath(parsed.id), parsed),
    ]);
    return parsed;
  }

  async saveExerciseSession(value: ExerciseSession): Promise<void> {
    const parsed = ExerciseSessionSchema.parse(value);
    await atomicJson(join(this.base, "state", "exercises", `${parsed.id}.json`), parsed);
  }

  async exerciseSession(id: string): Promise<ExerciseSession | undefined> {
    const value = await readJson(join(this.base, "state", "exercises", `${id}.json`));
    return value === undefined ? undefined : ExerciseSessionSchema.parse(value);
  }

  async removeExerciseSession(id: string): Promise<void> {
    await rm(join(this.base, "state", "exercises", `${id}.json`), { force: true });
  }

  async cleanGenerated(): Promise<void> {
    await Promise.all([
      rm(join(this.base, "cache"), { recursive: true, force: true }),
      rm(join(this.base, "workspaces"), { recursive: true, force: true }),
      rm(join(this.base, "state", "generation.json"), { force: true }),
      rm(join(this.base, "state", "exercises"), { recursive: true, force: true }),
    ]);
    await this.initialize();
  }
}
