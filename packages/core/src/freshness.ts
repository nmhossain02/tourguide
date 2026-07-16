import { changedFilesBetween } from "./git.js";
import type { TourSnapshot } from "./schema.js";

export interface FreshnessReport {
  currentHead: string;
  authoredHead: string;
  changedFiles: string[];
  staleLessonIds: string[];
  fresh: boolean;
}

/** Determine which lessons need review without changing the immutable snapshot. */
export async function assessFreshness(root: string, snapshot: TourSnapshot, currentHead: string): Promise<FreshnessReport> {
  const changedFiles = snapshot.head === currentHead
    ? []
    : await changedFilesBetween(root, snapshot.head, currentHead).catch(() => []);
  const changed = new Set(changedFiles);
  const stale = new Set(
    snapshot.lessons
      .filter((lesson) => lesson.evidence.some((evidence) => evidence.path && changed.has(evidence.path)))
      .map((lesson) => lesson.id),
  );

  // A lesson that builds on stale material also needs review, even if its own
  // cited files did not change.
  let added = true;
  while (added) {
    added = false;
    for (const lesson of snapshot.lessons) {
      const dependencies = new Set([...(snapshot.dependencies[lesson.id] ?? []), ...lesson.prerequisites]);
      if (!stale.has(lesson.id) && [...dependencies].some((id) => stale.has(id))) {
        stale.add(lesson.id);
        added = true;
      }
    }
  }

  return {
    currentHead,
    authoredHead: snapshot.head,
    changedFiles,
    staleLessonIds: [...stale],
    fresh: snapshot.head === currentHead,
  };
}
