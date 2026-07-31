import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { CodexStatusSchema, CurriculumPlanSchema, GeneratedModuleSchema, TourStore } from "../packages/core/src/index.js";
import {
  CodexExecFailure,
  CodexExecRunner,
  codexOutputSchema,
  normalizeCodexOutput,
} from "../packages/server/src/codex-exec.js";
import { captureDiagnostic } from "../packages/server/src/diagnostics.js";

const exec = promisify(execFile);
const temporary: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tourguide-diagnostics-"));
  temporary.push(root);
  await exec("git", ["init", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
  await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
  await writeFile(join(root, "README.md"), "# fixture\n");
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "commit", "-m", "initial"]);
  return root;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("diagnostic reports", () => {
  it("persists actionable context and redacts common credentials", async () => {
    const root = await repository();
    const store = new TourStore(root);
    await store.initialize();
    const createdAt = new Date().toISOString();
    await store.saveGenerationJob({
      id: "failed-job",
      action: "create",
      status: "failed",
      phase: "planning",
      anchor: { ref: "HEAD", commit: (await exec("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim() },
      goal: "Learn the fixture",
      priorities: [],
      plannedModuleIds: [],
      completedModuleIds: [],
      message: "authorization: Bearer stored-job-secret",
      errorCode: "engine",
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      startedAt: createdAt,
      updatedAt: createdAt,
    });
    await store.appendGenerationEvent({
      jobId: "failed-job",
      type: "error",
      message: "https://localhost/failure?token=stored-event-secret",
      createdAt,
    });
    const error = new CodexExecFailure(
      "Codex failed at https://localhost/?token=super-secret-token",
      { stderr: "authorization: Bearer hidden-value", apiKey: "also-hidden" },
    );
    const captured = await captureDiagnostic(root, {
      trigger: "generation",
      summary: "Generation failed while planning.",
      error,
      context: { phase: "planning" },
    }, store);
    const text = await readFile(captured.path, "utf8");
    expect(text).toContain("Generation failed while planning");
    expect(text).toContain("planning");
    expect(text).not.toContain("super-secret-token");
    expect(text).not.toContain("hidden-value");
    expect(text).not.toContain("also-hidden");
    expect(text).not.toContain("stored-job-secret");
    expect(text).not.toContain("stored-event-secret");
    expect(captured.report.generation?.message).toContain("[REDACTED]");
    expect(captured.report.recentEvents[0]?.message).toContain("[REDACTED]");
    expect((await store.latestDiagnostic())?.id).toBe(captured.report.id);
  });

  it("keeps Codex JSONL error output when exec exits unsuccessfully", async () => {
    const root = await repository();
    const executable = join(root, "failing-codex.mjs");
    await writeFile(executable, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("codex-cli 0.146.0"); process.exit(0); }
if (args[0] === "login" && args[1] === "status") { console.log("Logged in"); process.exit(0); }
if (args[0] === "exec" && args[1] === "--help") { console.log("--output-schema --json"); process.exit(0); }
console.log(JSON.stringify({ type: "error", message: "The selected model is unavailable." }));
process.exit(1);
`, "utf8");
    await chmod(executable, 0o755);
    const runner = new CodexExecRunner(executable);
    let failure: unknown;
    try {
      await runner.run({ cwd: root, prompt: "test", schema: CodexStatusSchema });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CodexExecFailure);
    expect((failure as Error).message).toContain("The selected model is unavailable.");
    expect((failure as CodexExecFailure).diagnostic).toMatchObject({ exitCode: 1 });
  });
});

describe("Codex structured output schemas", () => {
  it("converts every object to the strict response-format subset", () => {
    const schemas = [codexOutputSchema(CurriculumPlanSchema), codexOutputSchema(GeneratedModuleSchema)];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      const record = value as Record<string, unknown>;
      expect(record).not.toHaveProperty("default");
      expect(record).not.toHaveProperty("propertyNames");
      expect(record).not.toHaveProperty("oneOf");
      expect(record.format).not.toBe("uri");
      if (record.type === "object") {
        const properties = record.properties as Record<string, unknown>;
        expect(record.additionalProperties).toBe(false);
        expect(record.required).toEqual(Object.keys(properties));
      }
      if (record.properties && typeof record.properties === "object") Object.values(record.properties).forEach(visit);
      if (record.items) visit(record.items);
      if (record.anyOf) visit(record.anyOf);
      if (record.$defs && typeof record.$defs === "object") Object.values(record.$defs).forEach(visit);
    };
    schemas.forEach(visit);
    const coverage = schemas[0].properties as Record<string, any>;
    expect(coverage.coverage.items.properties.reason.anyOf).toContainEqual({ type: "null" });
  });

  it("removes nullable placeholders before Zod applies optional defaults", () => {
    expect(normalizeCodexOutput({ reason: null, nested: { value: null, keep: true } })).toEqual({ nested: { keep: true } });
  });
});
