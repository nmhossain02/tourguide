import { randomUUID } from "node:crypto";

import {
  DiagnosticReportSchema,
  TourStore,
  inspectRepositoryAt,
  type CodexStatus,
  type DiagnosticError,
  type DiagnosticReport,
} from "@tourguide/core";

import { TOURGUIDE_VERSION } from "./version.js";

export type DiagnosticTrigger = DiagnosticReport["trigger"];

export interface DiagnosticInput {
  trigger: DiagnosticTrigger;
  summary: string;
  error?: unknown;
  context?: Record<string, unknown>;
  codex?: Pick<CodexStatus, "status" | "version">;
}

const MAX_TEXT = 64 * 1024;

export function redactDiagnosticText(value: string): string {
  return value
    .slice(-MAX_TEXT)
    .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(sk-(?:proj-)?[A-Za-z0-9_-]{12,}|gh[opusr]_[A-Za-z0-9_]{12,})\b/g, "[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*["'])[^"'\s]+/gi, "$1[REDACTED]");
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return redactDiagnosticText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(-100).map((item) => redactValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [
      key,
      /token|password|secret|authorization|api.?key/i.test(key)
        && typeof item !== "number"
        && typeof item !== "boolean"
        ? "[REDACTED]"
        : redactValue(item, depth + 1),
    ]));
  }
  return String(value);
}

function diagnosticError(error: unknown): DiagnosticError {
  if (!(error instanceof Error)) {
    return { name: "UnknownError", message: redactDiagnosticText(String(error)), details: {} };
  }
  const details = "diagnostic" in error && error.diagnostic && typeof error.diagnostic === "object"
    ? redactValue(error.diagnostic) as Record<string, unknown>
    : {};
  return {
    name: error.name,
    message: redactDiagnosticText(error.message),
    ...(error.stack ? { stack: redactDiagnosticText(error.stack) } : {}),
    details,
  };
}

export async function buildDiagnosticReport(
  root: string,
  input: DiagnosticInput,
  store = new TourStore(root),
): Promise<DiagnosticReport> {
  await store.initialize();
  const [inventory, generation] = await Promise.all([
    inspectRepositoryAt(root, "HEAD").catch(() => undefined),
    store.generationJob().catch(() => undefined),
  ]);
  const recentEvents = generation
    ? (await store.generationEvents(generation.id).catch(() => [])).slice(-50)
    : [];
  return DiagnosticReportSchema.parse({
    schemaVersion: 1,
    id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    trigger: input.trigger,
    summary: redactDiagnosticText(input.summary),
    repository: {
      root,
      ...(inventory ? {
        name: inventory.name,
        ref: inventory.ref,
        commit: inventory.head,
        dirtyFiles: inventory.dirtyFiles,
      } : {}),
    },
    runtime: {
      tourguideVersion: TOURGUIDE_VERSION,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    ...(input.codex ? { codex: input.codex } : {}),
    ...(generation ? { generation: redactValue(generation) } : {}),
    recentEvents: redactValue(recentEvents),
    ...(input.error !== undefined ? { error: diagnosticError(input.error) } : {}),
    context: redactValue(input.context ?? {}) as Record<string, unknown>,
  });
}

export async function captureDiagnostic(
  root: string,
  input: DiagnosticInput,
  store = new TourStore(root),
): Promise<{ report: DiagnosticReport; path: string }> {
  const report = await buildDiagnosticReport(root, input, store);
  await store.saveDiagnostic(report);
  return { report, path: store.diagnosticPath() };
}

export function formatDiagnosticReport(report: DiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}
