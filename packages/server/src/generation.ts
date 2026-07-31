import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  CurriculumPlanSchema,
  GeneratedModuleSchema,
  GenerationJobSchema,
  TourSnapshotSchema,
  TourStore,
  contentHash,
  inspectRepositoryAt,
  readRevisionFile,
  validateSnapshot,
  type CurriculumPlan,
  type GeneratedModule,
  type GenerationJob,
  type Interaction,
  type Page,
  type ProjectInventory,
  type RunRecipe,
  type TourSnapshot,
} from "@tourguide/core";

import { CodexExecRunner, type CodexUsage } from "./codex-exec.js";
import { captureDiagnostic, redactDiagnosticText } from "./diagnostics.js";

const execFileAsync = promisify(execFile);
const MAX_SOURCE_FILE_BYTES = 768 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 30 * 1024 * 1024;
const MAX_EXERCISE_FILE_BYTES = 512 * 1024;

const BINARY_EXTENSIONS = new Set([
  ".7z", ".avi", ".bin", ".bmp", ".class", ".db", ".dll", ".dylib", ".eot", ".exe",
  ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg", ".lockb", ".mov", ".mp3", ".mp4",
  ".o", ".otf", ".pdf", ".png", ".pyc", ".so", ".tar", ".ttf", ".webm", ".webp", ".woff",
  ".woff2", ".zip",
]);

function excludedSource(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return (
    lower.startsWith(".git/")
    || lower.startsWith(".tourguide/")
    || lower.startsWith("node_modules/")
    || lower.includes("/node_modules/")
    || BINARY_EXTENSIONS.has(extension)
    || /^\.env(?:\.|$)/.test(name)
    || /(?:^|[-_.])(credential|credentials|private[-_.]?key|secret|secrets|token|tokens)(?:[-_.]|$)/.test(name)
    || /\.(?:key|p12|pfx|pem)$/.test(name)
  );
}

async function createGenerationWorkspace(inventory: ProjectInventory, jobId: string): Promise<{ path: string; excluded: string[] }> {
  const path = join(inventory.root, ".tourguide", "cache", "generation", jobId, "repository");
  await mkdir(path, { recursive: true });
  const excluded: string[] = [];
  let total = 0;
  for (const sourcePath of inventory.trackedFiles) {
    if (excludedSource(sourcePath)) {
      excluded.push(sourcePath);
      continue;
    }
    let content: string;
    try {
      content = await readRevisionFile(inventory.root, inventory.head, sourcePath);
    } catch {
      excluded.push(sourcePath);
      continue;
    }
    const size = Buffer.byteLength(content, "utf8");
    if (size > MAX_SOURCE_FILE_BYTES || total + size > MAX_SOURCE_TOTAL_BYTES || content.includes("\0")) {
      excluded.push(sourcePath);
      continue;
    }
    total += size;
    const target = join(path, sourcePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await writeFile(join(path, ".tourguide-generation-context.md"), [
    "# Tourguide generation context",
    "",
    `Repository: ${inventory.name}`,
    `Selected ref: ${inventory.ref}`,
    `Selected commit: ${inventory.head}`,
    `Tracked files at commit: ${inventory.trackedFileCount}`,
    `Files omitted from this filtered generation copy: ${excluded.length}`,
    "",
    "This is a disposable, filtered copy. Inspect it freely. Do not assume omitted files are absent from the real repository.",
    "",
  ].join("\n"), "utf8");
  await execFileAsync("git", ["init", "-q", path]);
  await execFileAsync("git", ["-C", path, "config", "user.name", "Tourguide"]);
  await execFileAsync("git", ["-C", path, "config", "user.email", "tourguide@localhost"]);
  await execFileAsync("git", ["-C", path, "add", "--all"]);
  await execFileAsync("git", ["-C", path, "commit", "-q", "-m", `Selected source ${inventory.head}`]);
  return { path, excluded };
}

function planPrompt(inventory: ProjectInventory, goal: string, priorities: string[]): string {
  return `You are the curriculum architect for an interactive tour of this software package.

Inspect the repository thoroughly. Build a curriculum with the pacing of go.dev/tour: small atomic pages, but enough adjacent pages to develop real depth. This is a software package, so ground every module in the selected repository and teach authentic paths through code, configuration, tests, runtime behavior, and delivery.

Learner goal:
${goal}

Learner priorities:
${priorities.length ? priorities.map((item) => `- ${item}`).join("\n") : "- Infer the most useful priorities from the goal."}

Selected source:
- repository: ${inventory.name}
- ref: ${inventory.ref}
- commit: ${inventory.head}

Requirements:
- Produce one core track at priority 0 plus one selected, goal-driven track when the goal warrants it.
- A normal module has 6–15 ordered pages and follows context, structure, flow, behavior, failure, change, recap.
- Each normal module plans at least one demo and one synthesis exercise.
- Coverage must contain exactly one entry for each of these capability names: orientation, setup, run, architecture, data and state, test, debug, change workflow, delivery and operations.
- Every uncovered capability must be explicitly not-applicable, blocked, or omitted with a reason.
- Tracks are learner routes, not directory listings. Modules teach capabilities or subsystems.
- Page IDs, module IDs, and track IDs must be globally unique, stable kebab-case identifiers.
- Track moduleIds and each module trackId must agree.
- Keep the scope achievable: broad core onboarding plus the single most relevant goal-driven path.

Return only the structured curriculum plan requested by the output schema.`;
}

function modulePrompt(plan: CurriculumPlan, planned: CurriculumPlan["modules"][number], inventory: ProjectInventory): string {
  return `Continue authoring the Tourguide curriculum. Draft one complete module from the approved plan.

Selected commit: ${inventory.head}
Module plan:
${JSON.stringify(planned, null, 2)}

Whole curriculum context:
${JSON.stringify({
    summary: plan.summary,
    tracks: plan.tracks.map((track) => ({ id: track.id, title: track.title, moduleIds: track.moduleIds })),
    modules: plan.modules.map((module) => ({ id: module.id, title: module.title, outcome: module.outcome })),
  }, null, 2)}

Teaching requirements:
- Return exactly the planned page IDs, in the planned order, and the exact moduleId.
- Each page is an atomic 1–5 minute step with roughly 40–180 words; never exceed 350 words.
- Pages form one continuous explanation through a representative code or runtime spine, not isolated file summaries.
- Every page has at least one authentic interaction.
- Concept, walkthrough, demo, and exercise pages use source or command evidence, not generic prose alone.
- Source paths must exist in this repository. Cite material claims with evidence and useful line ranges.
- Source and evidence line ranges must be ascending and within the referenced file.
- Mark evidence validated only when you actually inspected or ran it. Use inference evidence for clearly labeled deductions.
- Command recipes use an executable plus argv, never a shell command string. Declare writes and expected observations.
- Command recipe env is a list of unique name/value entries. File writes must be repository-relative paths; describe containers or other external mutation under capabilities instead.
- Data interactions declare columns once and encode each row as a same-length array of cell strings in that column order.
- Demos ask the learner to predict, vary, run, and observe meaningful behavior.
- Exercises have an observable task, progressive hints, reset behavior, and verification when feasible.
- Patch exercises may edit only explicitly listed tracked text files and their recipe writes must remain inside those paths.
- Use a safe trace, diagnose, observe, or design exercise when a patch would need secrets, network, containers, or external systems.
- Do not invent runtime output. Record blocked or unavailable experiments honestly in the narrative and evidence.

Return only the structured module requested by the output schema.`;
}

function moduleRepairPrompt(planned: CurriculumPlan["modules"][number], error: string): string {
  return `Repair the previously generated Tourguide module and return the complete corrected module.

The previous response passed the output schema, but failed repository-aware normalization or validation:
${error}

Repair requirements:
- Return the exact moduleId ${planned.id}.
- Return exactly these page IDs in this order: ${planned.pages.map((page) => page.id).join(", ")}.
- Preserve accurate, useful material from the previous response while correcting every reported defect.
- Reinspect repository files when needed; never invent paths, line ranges, commands, or observations.
- Every concept, walkthrough, demo, and exercise page must have a source or command interaction, or path-backed source evidence that can ground it.
- Source and evidence ranges must be ascending and within the referenced file.
- Command env values use name/value entry arrays, and data table rows use cell arrays matching their declared columns.

Return only the complete structured module requested by the output schema.`;
}

function normalizedTracks(plan: CurriculumPlan) {
  const byTrack = new Map<string, string[]>();
  for (const module of plan.modules) {
    byTrack.set(module.trackId, [...(byTrack.get(module.trackId) ?? []), module.id]);
  }
  return plan.tracks.map((track) => ({ ...track, moduleIds: byTrack.get(track.id) ?? [] }));
}

function draftFromPlan(plan: CurriculumPlan, inventory: ProjectInventory, id: string): TourSnapshot {
  const plannedPageIds = new Set<string>();
  const plannedModuleIds = new Set(plan.modules.map((module) => module.id));
  for (const module of plan.modules) {
    if ((module.pages.length < 6 || module.pages.length > 15)
      && !module.gaps.some((gap) => /scope|curriculum|page|length/i.test(gap.area))) {
      throw new Error(`Planned module ${module.id} has ${module.pages.length} pages without an explicit scope gap.`);
    }
    if (!module.pages.some((page) => page.kind === "demo")
      && !module.gaps.some((gap) => /demo|runtime|behavior/i.test(gap.area))) {
      throw new Error(`Planned module ${module.id} has no demonstration or explicit gap.`);
    }
    if (!module.pages.some((page) => page.kind === "exercise")
      && !module.gaps.some((gap) => /exercise|change|synthesis/i.test(gap.area))) {
      throw new Error(`Planned module ${module.id} has no synthesis exercise or explicit gap.`);
    }
    for (const page of module.pages) {
      if (plannedPageIds.has(page.id)) throw new Error(`Curriculum repeats page ID ${page.id}.`);
      plannedPageIds.add(page.id);
    }
  }
  const tracks = normalizedTracks(plan);
  const knownTracks = new Set(tracks.map((track) => track.id));
  for (const module of plan.modules) {
    if (!knownTracks.has(module.trackId)) throw new Error(`Module ${module.id} references unknown track ${module.trackId}.`);
  }
  return TourSnapshotSchema.parse({
    schemaVersion: 2,
    id,
    projectName: plan.projectName,
    repositoryRoot: inventory.root,
    anchor: { ref: inventory.ref, commit: inventory.head },
    generatedAt: new Date().toISOString(),
    generator: "tourguide-codex-exec",
    promptVersion: 2,
    status: "draft",
    tracks,
    modules: plan.modules.map((module) => ({
      id: module.id,
      title: module.title,
      outcome: module.outcome,
      relevance: module.relevance,
      estimatedMinutes: module.pages.length * 3,
      prerequisites: module.prerequisites.filter((prerequisite) => plannedModuleIds.has(prerequisite)),
      pageIds: module.pages.map((page) => page.id),
      surfaces: module.surfaces.filter((path) => inventory.trackedFiles.includes(path)),
      gaps: module.gaps,
      status: "planned",
    })),
    pages: [],
    coverage: plan.coverage,
    dependencies: {},
  });
}

async function normalizeModule(
  generated: GeneratedModule,
  planned: CurriculumPlan["modules"][number],
  inventory: ProjectInventory,
): Promise<Page[]> {
  if (generated.moduleId !== planned.id) throw new Error(`Codex returned module ${generated.moduleId}; expected ${planned.id}.`);
  const generatedById = new Map(generated.pages.map((page) => [page.id, page]));
  const expectedIds = planned.pages.map((page) => page.id);
  if (generatedById.size !== expectedIds.length || expectedIds.some((id) => !generatedById.has(id))) {
    throw new Error(`Module ${planned.id} must return exactly its ${expectedIds.length} planned pages.`);
  }
  const tracked = new Set(inventory.trackedFiles);
  const excluded = new Set(inventory.excludedFiles);
  const { stdout: treeOutput } = await execFileAsync(
    "git",
    ["-C", inventory.root, "ls-tree", "-r", "-z", inventory.head],
    { encoding: "utf8" },
  );
  const modes = new Map(treeOutput.split("\0").filter(Boolean).map((entry) => {
    const separator = entry.indexOf("\t");
    return [entry.slice(separator + 1), entry.slice(0, entry.indexOf(" "))];
  }));
  const contents = new Map<string, string>();
  const source = async (path: string) => {
    const cached = contents.get(path);
    if (cached !== undefined) return cached;
    const content = await readRevisionFile(inventory.root, inventory.head, path);
    contents.set(path, content);
    return content;
  };
  return Promise.all(expectedIds.map(async (id) => {
    const page = generatedById.get(id)!;
    const interactions = await Promise.all(page.interactions.map(async (interaction): Promise<Interaction> => {
      if (interaction.type === "source" && (!tracked.has(interaction.path) || excluded.has(interaction.path))) {
        throw new Error(`Page ${id} references unavailable source ${interaction.path}.`);
      }
      if (interaction.type === "source") return normalizeRange(interaction, await source(interaction.path));
      if (interaction.type === "command") return { ...interaction, recipe: normalizeRecipe(interaction.recipe) };
      if (interaction.type === "data") return {
        ...interaction,
        rows: interaction.rows.map((row) => Object.fromEntries(
          interaction.columns.map((column, index) => [column, row[index] ?? ""]),
        )),
      };
      return interaction;
    }));
    const evidence = await Promise.all(page.evidence.map(async (item) => {
      if (!item.path) {
        return {
          ...item,
          kind: item.validated === true ? item.kind : "inference" as const,
          revision: inventory.head,
          validated: item.validated === true,
        };
      }
      if (!tracked.has(item.path) || excluded.has(item.path)) {
        throw new Error(`Evidence ${item.id} references unavailable path ${item.path}.`);
      }
      const content = await source(item.path);
      return {
        ...normalizeRange(item, content),
        revision: inventory.head,
        contentHash: contentHash(content),
        validated: true,
      };
    }));
    const needsGrounding = ["concept", "walkthrough", "demo", "exercise"].includes(page.kind)
      && !interactions.some((interaction) => interaction.type === "source" || interaction.type === "command");
    const grounding = needsGrounding ? evidence.find((item) => item.path) : undefined;
    if (needsGrounding && !grounding?.path) {
      throw new Error(`${page.kind} page ${page.id} needs source evidence or a command interaction.`);
    }
    const groundedInteractions: Interaction[] = grounding?.path ? [
      ...interactions,
      {
        type: "source",
        path: grounding.path,
        editable: false,
        ...(grounding.lineStart ? { lineStart: grounding.lineStart } : {}),
        ...(grounding.lineEnd ? { lineEnd: grounding.lineEnd } : {}),
      },
    ] : interactions;
    let exercise: Page["exercise"];
    if (page.exercise) {
      const { verificationRecipe, formatRecipe, ...rest } = page.exercise;
      for (const path of page.exercise.allowedPaths) {
        if (!tracked.has(path) || excluded.has(path)) {
          throw new Error(`Exercise ${id} allows unavailable path ${path}.`);
        }
        if (!modes.get(path)?.startsWith("100")) {
          throw new Error(`Exercise ${id} path ${path} must be a regular, non-symlink file.`);
        }
        const content = await source(path);
        if (content.includes("\0")) throw new Error(`Exercise ${id} path ${path} must be a text file.`);
        if (Buffer.byteLength(content, "utf8") > MAX_EXERCISE_FILE_BYTES) {
          throw new Error(`Exercise ${id} path ${path} is too large for the browser editor.`);
        }
      }
      exercise = {
        ...rest,
        ...(verificationRecipe ? { verificationRecipe: normalizeRecipe(verificationRecipe) } : {}),
        ...(formatRecipe ? { formatRecipe: normalizeRecipe(formatRecipe) } : {}),
      };
    }
    const { evidence: _generatedEvidence, interactions: _generatedInteractions, exercise: _generatedExercise, ...rest } = page;
    return {
      ...rest,
      moduleId: planned.id,
      status: "ready" as const,
      evidence,
      interactions: groundedInteractions,
      ...(exercise ? { exercise } : {}),
    };
  }));
}

function addUsage(current: GenerationJob["usage"], added: CodexUsage): GenerationJob["usage"] {
  return {
    inputTokens: current.inputTokens + added.inputTokens,
    cachedInputTokens: current.cachedInputTokens + added.cachedInputTokens,
    outputTokens: current.outputTokens + added.outputTokens,
  };
}

function removeUnknownPrerequisitesFromPages(pages: Page[], plan: CurriculumPlan): Page[] {
  const pageIds = new Set(plan.modules.flatMap((module) => module.pages.map((page) => page.id)));
  return pages.map((page) => ({
    ...page,
    prerequisites: page.prerequisites.filter((prerequisite) => pageIds.has(prerequisite)),
  }));
}

type GeneratedRecipe = Omit<RunRecipe, "env"> & { env: Array<{ name: string; value: string }> };

function normalizeRecipe(recipe: GeneratedRecipe): RunRecipe {
  return {
    ...recipe,
    env: Object.fromEntries(recipe.env.map((entry) => [entry.name, entry.value])),
  };
}

function normalizeRange<T extends { lineStart?: number | undefined; lineEnd?: number | undefined }>(value: T, content: string): T {
  if (value.lineStart === undefined && value.lineEnd === undefined) return value;
  const maximum = Math.max(1, content.split(/\r?\n/).length);
  const clamp = (line: number | undefined) => line === undefined ? undefined : Math.min(maximum, Math.max(1, line));
  let start = clamp(value.lineStart);
  let end = clamp(value.lineEnd);
  if (start !== undefined && end !== undefined && start > end) [start, end] = [end, start];
  return {
    ...value,
    ...(start !== undefined ? { lineStart: start } : {}),
    ...(end !== undefined ? { lineEnd: end } : {}),
  };
}

export interface StartGenerationInput {
  ref?: string;
  goal: string;
  priorities?: string[];
  model?: string;
}

export class TourGenerator {
  private active: { jobId: string; controller: AbortController } | undefined;

  constructor(
    readonly root: string,
    readonly store = new TourStore(root),
    readonly runner = new CodexExecRunner(),
  ) {}

  async start(input: StartGenerationInput): Promise<GenerationJob> {
    if (this.active) throw new Error("A tour generation job is already running.");
    const inventory = await inspectRepositoryAt(this.root, input.ref ?? "HEAD");
    const status = await this.runner.status();
    if (status.status !== "ready") throw new Error(status.message);
    const now = new Date().toISOString();
    const job = GenerationJobSchema.parse({
      id: randomUUID(),
      action: "create",
      status: "queued",
      phase: "preparing",
      anchor: { ref: inventory.ref, commit: inventory.head },
      goal: input.goal,
      priorities: input.priorities ?? [],
      ...(input.model ? { model: input.model } : {}),
      codexVersion: status.version,
      message: "Preparing a filtered copy of the selected commit.",
      startedAt: now,
      updatedAt: now,
    });
    await this.store.initialize();
    await this.store.saveGenerationJob(job);
    await this.store.appendGenerationEvent({
      jobId: job.id,
      type: "status",
      message: job.message,
      createdAt: now,
    });
    const controller = new AbortController();
    this.active = { jobId: job.id, controller };
    void this.generate(job, inventory, controller.signal).finally(() => {
      if (this.active?.jobId === job.id) this.active = undefined;
    });
    return job;
  }

  async cancel(): Promise<void> {
    if (!this.active) throw new Error("No tour generation job is running.");
    this.active.controller.abort();
  }

  private async save(job: GenerationJob, patch: Partial<GenerationJob>): Promise<GenerationJob> {
    const next = GenerationJobSchema.parse({ ...job, ...patch, updatedAt: new Date().toISOString() });
    await this.store.saveGenerationJob(next);
    return next;
  }

  private async event(job: GenerationJob, type: "status" | "module-ready" | "message" | "error" | "complete", message: string, moduleId?: string) {
    await this.store.appendGenerationEvent({
      jobId: job.id,
      type,
      message,
      ...(moduleId ? { moduleId } : {}),
      createdAt: new Date().toISOString(),
    });
  }

  private async generate(initial: GenerationJob, inventory: ProjectInventory, signal: AbortSignal): Promise<void> {
    let job = initial;
    let workspace: string | undefined;
    let snapshot: TourSnapshot | undefined;
    try {
      job = await this.save(job, { status: "running", phase: "preparing" });
      const prepared = await createGenerationWorkspace(inventory, job.id);
      workspace = prepared.path;
      const generationInventory = { ...inventory, excludedFiles: prepared.excluded };
      await this.event(job, "status", `Prepared ${inventory.trackedFileCount - prepared.excluded.length} source files; omitted ${prepared.excluded.length} sensitive, binary, or oversized files.`);

      job = await this.save(job, { phase: "planning", message: "Designing tracks, coverage, and module sequences." });
      await this.event(job, "status", job.message);
      const planResult = await this.runner.run({
        cwd: workspace,
        prompt: planPrompt(generationInventory, job.goal, job.priorities),
        schema: CurriculumPlanSchema,
        ...(job.model ? { model: job.model } : {}),
        signal,
      });
      await this.store.saveGenerationArtifact(job.id, "plan", planResult.value);
      snapshot = draftFromPlan(planResult.value, generationInventory, randomUUID());
      const planReport = await validateSnapshot(snapshot, this.root, { partial: true });
      if (!planReport.valid) throw new Error(`Curriculum plan failed validation:\n${planReport.errors.join("\n")}`);
      await this.store.saveDraft(snapshot);
      job = await this.save(job, {
        threadId: planResult.threadId,
        snapshotId: snapshot.id,
        plannedModuleIds: planResult.value.modules.map((module) => module.id),
        usage: addUsage(job.usage, planResult.usage),
        phase: "drafting",
        message: `Planned ${planResult.value.modules.length} modules. Drafting the first module.`,
      });
      await this.event(job, "status", job.message);

      for (const planned of planResult.value.modules) {
        if (signal.aborted) throw new Error("Tour generation was cancelled.");
        job = await this.save(job, {
          phase: "drafting",
          currentModuleId: planned.id,
          message: `Drafting ${planned.title}.`,
        });
        await this.event(job, "status", job.message, planned.id);
        if (!snapshot) throw new Error("Generation lost its curriculum snapshot.");
        const baseSnapshot = snapshot;
        let candidate: TourSnapshot | undefined;
        let repairReason: string | undefined;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const generated = await this.runner.run({
            cwd: workspace,
            prompt: attempt === 0
              ? modulePrompt(planResult.value, planned, generationInventory)
              : moduleRepairPrompt(planned, repairReason ?? "The module failed validation."),
            schema: GeneratedModuleSchema,
            ...(job.model ? { model: job.model } : {}),
            ...(job.threadId ? { threadId: job.threadId } : {}),
            signal,
          });
          job = await this.save(job, {
            threadId: generated.threadId ?? job.threadId,
            usage: addUsage(job.usage, generated.usage),
          });
          await this.store.saveGenerationArtifact(
            job.id,
            attempt === 0 ? `module-${planned.id}` : `module-${planned.id}-repair`,
            generated.value,
          );
          try {
            const pages = removeUnknownPrerequisitesFromPages(
              await normalizeModule(generated.value, planned, generationInventory),
              planResult.value,
            );
            const replacement = new Set(pages.map((page) => page.id));
            const allPages = [...baseSnapshot.pages.filter((page) => !replacement.has(page.id)), ...pages];
            const next = TourSnapshotSchema.parse({
              ...baseSnapshot,
              pages: allPages,
              modules: baseSnapshot.modules.map((module) => module.id === planned.id
                ? {
                    ...module,
                    pageIds: pages.map((page) => page.id),
                    estimatedMinutes: pages.reduce((total, page) => total + page.estimatedMinutes, 0),
                    status: "ready",
                  }
                : module),
              dependencies: Object.fromEntries(allPages.map((page) => [page.id, page.prerequisites])),
              status: "partial",
            });
            const report = await validateSnapshot(next, this.root, { partial: true });
            if (!report.valid) throw new Error(`Generated module failed validation:\n${report.errors.join("\n")}`);
            candidate = next;
            break;
          } catch (error) {
            if (attempt === 1) throw error;
            repairReason = error instanceof Error ? error.message : String(error);
            job = await this.save(job, {
              message: `Repairing ${planned.title} after validation failed.`,
            });
            await this.event(job, "status", `${job.message}\n${repairReason}`, planned.id);
          }
        }
        if (!candidate) throw new Error(`Could not produce a valid ${planned.title} module.`);
        snapshot = candidate;
        job = await this.save(job, {
          completedModuleIds: [...job.completedModuleIds, planned.id],
          status: "partial",
          message: `${planned.title} is ready.`,
        });
        await this.store.publishPartial(snapshot);
        await this.event(job, "module-ready", job.message, planned.id);
      }

      job = await this.save(job, { status: "running", phase: "validating", message: "Validating the complete tour." });
      await this.event(job, "status", job.message);
      const report = await validateSnapshot(snapshot, this.root);
      if (!report.valid) throw new Error(`Tour failed publication validation:\n${report.errors.join("\n")}`);
      job = await this.save(job, { phase: "publishing", message: "Publishing the complete tour." });
      await this.store.publish(snapshot);
      job = await this.save(job, { status: "complete", phase: "complete", message: "Tour generation is complete." });
      await this.event(job, "complete", job.message);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = redactDiagnosticText(rawMessage);
      const cancelled = signal.aborted || /cancelled/i.test(rawMessage);
      const partial = Boolean(snapshot?.pages.length);
      const failurePhase = job.phase;
      job = await this.save(job, {
        status: cancelled ? "cancelled" : partial ? "partial" : "failed",
        phase: partial ? "publishing" : job.phase,
        message,
        errorCode: cancelled ? "cancelled" : /login|auth/i.test(message) ? "auth" : /usage|limit|quota/i.test(message) ? "usage" : /validation/i.test(message) ? "validation" : "engine",
      });
      await this.event(job, cancelled ? "status" : "error", message);
      if (!cancelled) {
        await captureDiagnostic(this.root, {
          trigger: "generation",
          summary: `Tour generation failed during ${failurePhase}.`,
          error,
          context: {
            jobId: job.id,
            phase: failurePhase,
            currentModuleId: job.currentModuleId,
            partialSnapshotAvailable: partial,
          },
          codex: { status: "error", ...(job.codexVersion ? { version: job.codexVersion } : {}) },
        }, this.store).catch(() => undefined);
      }
    } finally {
      if (workspace) await rm(join(inventory.root, ".tourguide", "cache", "generation", job.id), { recursive: true, force: true });
    }
  }
}
