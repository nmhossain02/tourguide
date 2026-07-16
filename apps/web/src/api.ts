import type { FreshnessReport, Preferences, Progress, ProjectInventory, TourSnapshot } from "@tourguide/core";

export interface ProjectPayload {
  inventory: ProjectInventory;
  preferences: Preferences;
  progress: Progress;
  freshness?: FreshnessReport;
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

export const api = {
  project: () => json<ProjectPayload>("/api/project"),
  tour: () => json<TourSnapshot>("/api/tour"),
  source: (path: string, view: "head" | "working" = "head") => json<{ path: string; content: string; dirty: boolean; view: string }>(`/api/source?path=${encodeURIComponent(path)}&view=${view}`),
  run: (recipeId: string, trusted = false, inputs: Record<string, string> = {}) => json<{ exitCode: number | null; stdout: string; stderr: string; durationMs: number; timedOut: boolean; isolated: boolean; patch?: string; changedFiles: string[]; undeclaredWrites: string[] }>("/api/run", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipeId, trusted, inputs }),
  }),
  preferences: (value: Preferences) => json<Preferences>("/api/preferences", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
  }),
  progress: (value: Progress) => json<Progress>("/api/progress", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
  }),
};
