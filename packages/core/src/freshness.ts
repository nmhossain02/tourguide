import { changedFilesBetween } from "./git.js";
import type { TourSnapshot } from "./schema.js";

export interface FreshnessReport {
  currentHead: string;
  authoredHead: string;
  changedFiles: string[];
  stalePageIds: string[];
  staleModuleIds: string[];
  /** @deprecated Use stalePageIds. */
  staleLessonIds: string[];
  fresh: boolean;
  historyAvailable: boolean;
  reason?: string;
}

/** Determine which pages need review without changing the immutable snapshot. */
export async function assessFreshness(root: string, snapshot: TourSnapshot, currentHead: string): Promise<FreshnessReport> {
  const authoredHead = snapshot.anchor.commit;
  let historyAvailable = true;
  const changedFiles = authoredHead === currentHead
    ? []
    : await changedFilesBetween(root, authoredHead, currentHead).catch(() => {
      historyAvailable = false;
      return [];
    });
  const changed = new Set(changedFiles);
  const stale = new Set(
    snapshot.pages
      .filter((page) => page.evidence.some((evidence) => evidence.path && changed.has(evidence.path)))
      .map((page) => page.id),
  );
  if (!historyAvailable) for (const page of snapshot.pages) stale.add(page.id);

  // A page that builds on stale material also needs review, even if its own
  // cited files did not change.
  let added = true;
  while (added) {
    added = false;
    for (const page of snapshot.pages) {
      const dependencies = new Set([...(snapshot.dependencies[page.id] ?? []), ...page.prerequisites]);
      if (!stale.has(page.id) && [...dependencies].some((id) => stale.has(id))) {
        stale.add(page.id);
        added = true;
      }
    }
  }
  const staleModuleIds = snapshot.modules
    .filter((module) => module.pageIds.some((id) => stale.has(id)))
    .map((module) => module.id);

  return {
    currentHead,
    authoredHead,
    changedFiles,
    stalePageIds: [...stale],
    staleModuleIds,
    staleLessonIds: [...stale],
    fresh: authoredHead === currentHead,
    historyAvailable,
    ...(!historyAvailable ? { reason: "The authored commit is unavailable or cannot be compared; review every page." } : {}),
  };
}
