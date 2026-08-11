import type {
  CodexStatus,
  DiagnosticReport,
  LabFile,
  LabSession,
  LabInvocationResult,
  LivingDocumentationSnapshot,
  FreshnessReport,
  GenerationEvent,
  GenerationDepth,
  GenerationJob,
  Preferences,
  Progress,
  ProjectInventory,
  RepositoryKnowledgeSnapshot,
  KnowledgeCatalog,
  KnowledgeItem,
  KnowledgeRelationship,
  RepositoryRef,
  RunResult,
  TourSnapshot,
  VerificationResult,
} from "@tourguide/core";

export interface BootstrapPayload {
  inventory: ProjectInventory;
  refs: RepositoryRef[];
  codex: CodexStatus;
  tour?: TourSnapshot;
  job?: GenerationJob;
  events: GenerationEvent[];
  preferences: Preferences;
  progress: Progress;
  freshness?: FreshnessReport;
  defaultModel?: string;
}

export interface DiagnosticsPayload {
  latest?: DiagnosticReport;
  latestPath: string;
  current: DiagnosticReport;
}

const queryToken = new URLSearchParams(window.location.search).get("token");
if (queryToken) {
  sessionStorage.setItem("tourguide-token", queryToken);
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("token");
  history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}
const sessionToken = queryToken ?? sessionStorage.getItem("tourguide-token") ?? "";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-tourguide-token", sessionToken);
  const response = await fetch(url, { ...init, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Request failed: ${response.status}`);
  return body as T;
}

const body = (value: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(value),
});

export const api = {
  bootstrap: () => json<BootstrapPayload>("/api/bootstrap"),
  source: (path: string, view: "selected" | "working" = "selected") =>
    json<{ path: string; content: string; dirty: boolean; view: string; revision: string }>(
      `/api/source?path=${encodeURIComponent(path)}&view=${view}`,
    ),
  knowledge: () => json<RepositoryKnowledgeSnapshot>("/api/knowledge"),
  documentation: () => json<LivingDocumentationSnapshot>("/api/documentation"),
  reconcileDocumentation: () => json<{
    documentation: LivingDocumentationSnapshot;
    stats: {
      coldCalls: number;
      cacheHits: number;
      usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number };
    };
  }>("/api/documentation/reconcile", body({ includeRuntimes: true })),
  searchKnowledge: (query: string, catalog?: KnowledgeCatalog) =>
    json<{ snapshotId: string; items: KnowledgeItem[] }>(
      `/api/knowledge/search?q=${encodeURIComponent(query)}${catalog ? `&catalog=${encodeURIComponent(catalog)}` : ""}`,
    ),
  knowledgeItem: (catalog: KnowledgeCatalog, itemId: string) =>
    json<{ snapshotId: string; item: KnowledgeItem; relationships: KnowledgeRelationship[] }>(
      `/api/knowledge/${encodeURIComponent(catalog)}/${encodeURIComponent(itemId)}`,
    ),
  run: (pageId: string, recipeId: string, trusted = false, inputs: Record<string, string> = {}) =>
    json<RunResult>("/api/run", body({ pageId, recipeId, trusted, inputs })),
  preferences: (value: Preferences) => json<Preferences>("/api/preferences", body(value)),
  progress: (value: Progress) => json<Progress>("/api/progress", body(value)),
  startGeneration: (value: { ref: string; goal: string; priorities: string[]; model?: string; depth: GenerationDepth }) =>
    json<GenerationJob>("/api/generation", body(value)),
  generationEvents: (after = 0) =>
    json<{ job?: GenerationJob; events: GenerationEvent[]; tour?: TourSnapshot }>(
      `/api/generation/events?after=${after}`,
    ),
  cancelGeneration: () => json<{ ok: true }>("/api/generation/cancel", body({})),
  diagnostics: () => json<DiagnosticsPayload>("/api/diagnostics"),
  reportClientCrash: (value: { message: string; stack?: string; componentStack?: string; url?: string; userAgent?: string }) =>
    json<{ report: DiagnosticReport; path: string }>("/api/diagnostics/client", body(value)),
  createExercise: (pageId: string) =>
    json<{ session: LabSession; files: LabFile[] }>("/api/exercises", body({ pageId })),
  exerciseFiles: (id: string) => json<{ files: LabFile[] }>(`/api/exercises/${id}/files`),
  saveExerciseFile: (id: string, path: string, content: string) =>
    json<LabFile>(`/api/exercises/${id}/files`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    }),
  runExercise: (id: string, pageId: string, action: "verify" | "format") =>
    json<VerificationResult>(`/api/labs/${id}/verify`, body({ pageId, action })),
  exercisePatch: (id: string) => json<{ patch: string }>(`/api/exercises/${id}/patch`),
  resetExercise: (id: string) =>
    json<{ session: LabSession; files: LabFile[] }>(`/api/exercises/${id}/reset`, body({})),
  retainLab: (id: string, slug: string) => json<LabSession>(`/api/labs/${id}/retain`, body({ slug })),
  invokeLabInteraction: (pageId: string, itemId: string, inputs: Record<string, unknown>) =>
    json<{ session: LabSession; invocation: LabInvocationResult }>("/api/lab-interactions", body({ pageId, itemId, inputs })),
  openEditor: (labId: string, path?: string) => json<{ ok: true; command: string[]; target: string }>("/api/editor/open", body({ labId, path })),
};
