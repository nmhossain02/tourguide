import { contentHash, readRevisionFile } from "./git.js";
import type { Page, TourSnapshot } from "./schema.js";

export interface ValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function cyclic(ids: string[], dependencies: Record<string, string[]>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const found = (dependencies[id] ?? []).some(visit);
    visiting.delete(id);
    visited.add(id);
    return found;
  };
  return ids.some(visit);
}

function validateExercise(page: Page, errors: string[]) {
  if (page.kind === "exercise" && !page.exercise) errors.push(`Exercise page ${page.id} needs exercise metadata.`);
  if (page.exercise && page.kind !== "exercise") errors.push(`Non-exercise page ${page.id} cannot contain exercise metadata.`);
  if (!page.exercise) return;
  if (page.exercise.hints.length === 0) errors.push(`Exercise ${page.id} needs at least one hint.`);
  if (page.exercise.mode === "patch" && page.exercise.allowedPaths.length === 0) {
    errors.push(`Patch exercise ${page.id} needs at least one allowed path.`);
  }
  if (page.exercise.mode === "patch" && !page.exercise.verificationRecipe) {
    errors.push(`Patch exercise ${page.id} needs a verification recipe.`);
  }
  for (const recipe of [page.exercise.verificationRecipe, page.exercise.formatRecipe].filter(Boolean)) {
    for (const path of recipe!.capabilities.writes) {
      if (!page.exercise.allowedPaths.some((allowed) =>
        allowed === path || (allowed.endsWith("/**") && path.startsWith(allowed.slice(0, -3))))) {
        errors.push(`Exercise recipe ${recipe!.id} writes outside the allowlist: ${path}.`);
      }
    }
  }
  for (const interaction of page.interactions) {
    if (interaction.type === "source" && interaction.editable && !page.exercise.allowedPaths.includes(interaction.path)) {
      errors.push(`Editable source ${interaction.path} in ${page.id} must be an allowed exercise path.`);
    }
  }
}

function validateLineRange(
  label: string,
  lineStart: number | undefined,
  lineEnd: number | undefined,
  maximum: number,
  errors: string[],
) {
  if (lineStart !== undefined && lineStart > maximum) errors.push(`${label} starts after the end of its file (${maximum} lines).`);
  if (lineEnd !== undefined && lineEnd > maximum) errors.push(`${label} ends after the end of its file (${maximum} lines).`);
  if (lineStart !== undefined && lineEnd !== undefined && lineStart > lineEnd) errors.push(`${label} has a reversed line range.`);
}

export async function validateSnapshot(
  snapshot: TourSnapshot,
  root: string,
  options: { partial?: boolean } = {},
): Promise<ValidationReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const moduleIds = new Set(snapshot.modules.map((module) => module.id));
  const pageIds = new Set(snapshot.pages.map((page) => page.id));
  const moduleRoute = snapshot.tracks.flatMap((track) => track.moduleIds);
  const modulePosition = new Map(moduleRoute.map((id, index) => [id, index]));
  const pageRoute = moduleRoute.flatMap((id) => snapshot.modules.find((module) => module.id === id)?.pageIds ?? []);
  const pagePosition = new Map(pageRoute.map((id, index) => [id, index]));

  if (snapshot.tracks.length === 0) errors.push("Snapshot has no tracks.");
  if (snapshot.modules.length === 0) errors.push("Snapshot has no modules.");
  if (moduleIds.size !== snapshot.modules.length) errors.push("Module IDs must be unique.");
  if (pageIds.size !== snapshot.pages.length) errors.push("Page IDs must be unique.");
  if (new Set(snapshot.tracks.map((track) => track.id)).size !== snapshot.tracks.length) errors.push("Track IDs must be unique.");
  if (new Set(snapshot.tracks.map((track) => track.priority)).size !== snapshot.tracks.length) errors.push("Track priorities must be unique.");
  if (snapshot.tracks[0]?.kind !== "core" || snapshot.tracks[0]?.priority !== 0) errors.push("The first track must be core at priority 0.");
  if (snapshot.tracks.some((track, index) => index > 0 && track.priority <= snapshot.tracks[index - 1]!.priority)) {
    errors.push("Tracks must be ordered by ascending priority.");
  }

  const moduleAssignments = new Map<string, number>();
  for (const track of snapshot.tracks) {
    for (const id of track.moduleIds) {
      if (!moduleIds.has(id)) errors.push(`Track ${track.id} references missing module ${id}.`);
      moduleAssignments.set(id, (moduleAssignments.get(id) ?? 0) + 1);
    }
  }

  const pageAssignments = new Map<string, number>();
  for (const module of snapshot.modules) {
    if (moduleAssignments.get(module.id) !== 1) errors.push(`Module ${module.id} must belong to exactly one track.`);
    for (const prerequisite of module.prerequisites) {
      if (!moduleIds.has(prerequisite)) errors.push(`Module ${module.id} has missing prerequisite ${prerequisite}.`);
      if (prerequisite === module.id) errors.push(`Module ${module.id} cannot depend on itself.`);
      if ((modulePosition.get(prerequisite) ?? -1) >= (modulePosition.get(module.id) ?? Number.MAX_SAFE_INTEGER)) {
        errors.push(`Module prerequisite ${prerequisite} must appear before ${module.id}.`);
      }
    }
    for (const id of module.pageIds) {
      if (!pageIds.has(id)) {
        if (!options.partial || module.status !== "planned") {
          errors.push(`Module ${module.id} references missing page ${id}.`);
        }
      } else {
        pageAssignments.set(id, (pageAssignments.get(id) ?? 0) + 1);
      }
    }
    const pages = module.pageIds
      .map((id) => snapshot.pages.find((page) => page.id === id))
      .filter((page): page is Page => Boolean(page));
    const estimate = pages.reduce((total, page) => total + page.estimatedMinutes, 0);
    if (pages.length > 0 && module.estimatedMinutes !== estimate) {
      errors.push(`Module ${module.id} estimate must equal its page estimates (${estimate}).`);
    }
    if (module.status === "ready") {
      if (!pages.some((page) => page.kind === "demo") && !module.gaps.some((gap) => /demo|runtime|behavior/i.test(gap.area))) {
        errors.push(`Ready module ${module.id} needs a demonstration page or an explicit gap.`);
      }
      if (!pages.some((page) => page.kind === "exercise") && !module.gaps.some((gap) => /exercise|change|synthesis/i.test(gap.area))) {
        errors.push(`Ready module ${module.id} needs a synthesis exercise or an explicit gap.`);
      }
      if (pages.length < 6 || pages.length > 15) warnings.push(`Module ${module.id} has ${pages.length} pages; normal modules have 6–15.`);
    }
    if (!options.partial && module.status !== "ready") errors.push(`Module ${module.id} must be ready before final publication.`);
  }

  for (const page of snapshot.pages) {
    if (!moduleIds.has(page.moduleId)) errors.push(`Page ${page.id} references missing module ${page.moduleId}.`);
    if (pageAssignments.get(page.id) !== 1) errors.push(`Page ${page.id} must belong to exactly one module.`);
    if (!options.partial && page.status !== "ready") errors.push(`Page ${page.id} must be ready before final publication.`);
    const words = page.narrative.trim().split(/\s+/).filter(Boolean).length;
    if (words > 350) errors.push(`Page ${page.id} exceeds 350 narrative words.`);
    else if (words > 180) warnings.push(`Page ${page.id} exceeds the recommended 180 narrative words.`);
    for (const prerequisite of page.prerequisites) {
      if (!pageIds.has(prerequisite)) errors.push(`Page ${page.id} has missing prerequisite ${prerequisite}.`);
      if (prerequisite === page.id) errors.push(`Page ${page.id} cannot depend on itself.`);
      if ((pagePosition.get(prerequisite) ?? -1) >= (pagePosition.get(page.id) ?? Number.MAX_SAFE_INTEGER)) {
        errors.push(`Page prerequisite ${prerequisite} must appear before ${page.id}.`);
      }
    }
    if (page.status === "ready" && page.evidence.some((evidence) => !evidence.validated && evidence.kind !== "inference")) {
      errors.push(`Ready page ${page.id} contains unvalidated evidence.`);
    }
    for (const interaction of page.interactions) {
      if (interaction.type === "command" && !interaction.recipe.expected) {
        errors.push(`Command recipe ${interaction.recipe.id} needs an expected observation.`);
      }
      if (interaction.type === "source" && interaction.editable && page.exercise?.mode !== "patch") {
        errors.push(`Editable source interaction in ${page.id} is only valid for patch exercises.`);
      }
      if (interaction.type === "source") {
        try {
          const content = await readRevisionFile(root, snapshot.anchor.commit, interaction.path);
          validateLineRange(
            `Source interaction ${interaction.path} in ${page.id}`,
            interaction.lineStart,
            interaction.lineEnd,
            Math.max(1, content.split(/\r?\n/).length),
            errors,
          );
        } catch {
          errors.push(`Source interaction ${interaction.path} in ${page.id} cannot be read at the snapshot commit.`);
        }
      }
      if (interaction.type === "data") {
        if (interaction.columns.length === 0 || interaction.rows.length === 0) {
          errors.push(`Data interaction in ${page.id} needs columns and rows.`);
        }
        for (const [index, row] of interaction.rows.entries()) {
          const missing = interaction.columns.filter((column) => !(column in row));
          if (missing.length > 0) errors.push(`Data interaction row ${index + 1} in ${page.id} is missing: ${missing.join(", ")}.`);
        }
      }
    }
    if (["concept", "walkthrough", "demo", "exercise"].includes(page.kind)
      && !page.interactions.some((interaction) => interaction.type === "source" || interaction.type === "command")) {
      errors.push(`${page.kind} page ${page.id} needs a source or command interaction.`);
    }
    validateExercise(page, errors);
    for (const evidence of page.evidence.filter((item) => item.path)) {
      if (evidence.revision !== snapshot.anchor.commit) {
        errors.push(`Evidence ${evidence.id} must anchor to snapshot commit ${snapshot.anchor.commit}.`);
      }
      if (!evidence.contentHash) {
        errors.push(`Evidence ${evidence.id} needs a content hash.`);
        continue;
      }
      try {
        const content = await readRevisionFile(root, snapshot.anchor.commit, evidence.path!);
        validateLineRange(
          `Evidence ${evidence.id}`,
          evidence.lineStart,
          evidence.lineEnd,
          Math.max(1, content.split(/\r?\n/).length),
          errors,
        );
        if (contentHash(content) !== evidence.contentHash) errors.push(`Evidence ${evidence.id} hash does not match ${evidence.path}.`);
      } catch {
        errors.push(`Evidence ${evidence.id} cannot read ${evidence.path} at the snapshot commit.`);
      }
    }
  }

  const core = snapshot.tracks.find((track) => track.kind === "core");
  if (core) {
    const coreModules = new Set(core.moduleIds);
    const silent = snapshot.coverage.filter((entry) =>
      entry.status === "covered" && entry.moduleIds.every((id) => !coreModules.has(id)));
    if (silent.length > 0) warnings.push("Some coverage entries do not map to the core track.");
    for (const entry of snapshot.coverage) {
      if (entry.status !== "covered" && !entry.reason) errors.push(`Coverage gap ${entry.capability} needs a reason.`);
      if (entry.status === "covered" && entry.moduleIds.length === 0) errors.push(`Covered capability ${entry.capability} needs a module.`);
      for (const id of entry.moduleIds) if (!moduleIds.has(id)) errors.push(`Coverage ${entry.capability} references missing module ${id}.`);
    }
    const normalizedCoverage = new Set(snapshot.coverage.map((entry) => entry.capability.toLowerCase().replace(/[^a-z]/g, "")));
    for (const capability of [
      "orientation", "setup", "run", "architecture", "data and state",
      "test", "debug", "change workflow", "delivery and operations",
    ]) {
      if (!normalizedCoverage.has(capability.replace(/[^a-z]/g, ""))) {
        errors.push(`Core coverage must explicitly address ${capability}.`);
      }
    }
  }

  const moduleDependencies = Object.fromEntries(snapshot.modules.map((module) => [module.id, module.prerequisites]));
  if (cyclic(snapshot.modules.map((module) => module.id), moduleDependencies)) errors.push("Module prerequisites must not contain a cycle.");
  if (cyclic(snapshot.pages.map((page) => page.id), snapshot.dependencies)) errors.push("Page prerequisites must not contain a cycle.");
  return { valid: errors.length === 0, errors, warnings };
}
