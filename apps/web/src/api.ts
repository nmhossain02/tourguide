import type {
  CodexStatus,
  DiagnosticReport,
  ExerciseFile,
  ExerciseSession,
  FreshnessReport,
  GenerationEvent,
  GenerationJob,
  Preferences,
  Progress,
  ProjectInventory,
  RepositoryRef,
  RunResult,
  TourSnapshot,
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
  run: (recipeId: string, trusted = false, inputs: Record<string, string> = {}) =>
    json<RunResult>("/api/run", body({ recipeId, trusted, inputs })),
  preferences: (value: Preferences) => json<Preferences>("/api/preferences", body(value)),
  progress: (value: Progress) => json<Progress>("/api/progress", body(value)),
  startGeneration: (value: { ref: string; goal: string; priorities: string[]; model?: string }) =>
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
    json<{ session: ExerciseSession; files: ExerciseFile[] }>("/api/exercises", body({ pageId })),
  exerciseFiles: (id: string) => json<{ files: ExerciseFile[] }>(`/api/exercises/${id}/files`),
  saveExerciseFile: (id: string, path: string, content: string) =>
    json<ExerciseFile>(`/api/exercises/${id}/files`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, content }),
    }),
  runExercise: (id: string, pageId: string, action: "verify" | "format") =>
    json<RunResult>(`/api/exercises/${id}/run`, body({ pageId, action })),
  exercisePatch: (id: string) => json<{ patch: string }>(`/api/exercises/${id}/patch`),
  resetExercise: (id: string) =>
    json<{ session: ExerciseSession; files: ExerciseFile[] }>(`/api/exercises/${id}/reset`, body({})),
};
