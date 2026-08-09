import type { Page, TourSnapshot } from "@tourguide/core";
import type { GenerationDepth } from "@tourguide/core";

import type { BootstrapPayload } from "./api";

export interface GenerationInput {
  ref: string;
  goal: string;
  priorities: string[];
  model?: string;
  depth: GenerationDepth;
}

const EDITOR_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  go: "go",
  rs: "rust",
  json: "json",
  md: "markdown",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  toml: "toml",
};

const FINISHED_GENERATION_STATUSES = new Set(["complete", "cancelled", "failed"]);

export function isGenerating(data?: BootstrapPayload) {
  const job = data?.job;
  return Boolean(job && !job.errorCode && !FINISHED_GENERATION_STATUSES.has(job.status));
}

export function getOrderedPages(tour?: TourSnapshot): Page[] {
  if (!tour) return [];

  const modulesById = new Map(tour.modules.map((module) => [module.id, module]));
  const pagesById = new Map(tour.pages.map((page) => [page.id, page]));

  return tour.tracks.flatMap((track) =>
    track.moduleIds.flatMap((moduleId) => {
      const module = modulesById.get(moduleId);
      return module?.pageIds.flatMap((pageId) => {
        const page = pagesById.get(pageId);
        return page ? [page] : [];
      }) ?? [];
    }),
  );
}

export function editorLanguageForPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return EDITOR_LANGUAGES[extension] ?? "plaintext";
}

export function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export function errorText(reason: unknown) {
  return String(reason);
}
