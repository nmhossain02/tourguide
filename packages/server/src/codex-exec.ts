import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

import {
  CodexStatusSchema,
  type CodexStatus,
} from "@tourguide/core";
import { z } from "zod";

const execFileAsync = promisify(execFile);

export interface CodexUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface CodexExecResult<T> {
  value: T;
  threadId?: string;
  usage: CodexUsage;
  messages: string[];
}

export interface CodexExecRequest<T extends z.ZodType> {
  cwd: string;
  prompt: string;
  schema: T;
  model?: string;
  threadId?: string;
  signal?: AbortSignal;
  onMessage?: (message: string) => void;
}

export class CodexExecFailure extends Error {
  readonly diagnostic: Record<string, unknown>;

  constructor(message: string, diagnostic: Record<string, unknown>) {
    super(message);
    this.name = "CodexExecFailure";
    this.diagnostic = diagnostic;
  }
}

function parseVersion(value: string): { major: number; minor: number; patch: number } | undefined {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : undefined;
}

function supportedVersion(value: string): boolean {
  const parsed = parseVersion(value);
  return Boolean(parsed && (parsed.major > 0 || parsed.minor >= 60));
}

function emptyUsage(): CodexUsage {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
}

function numberAt(value: unknown, names: string[]): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  for (const name of names) if (typeof record[name] === "number") return record[name];
  return 0;
}

function eventMessage(event: Record<string, unknown>): string | undefined {
  const item = event.item;
  if (item && typeof item === "object") {
    const text = (item as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  const message = event.message;
  return typeof message === "string" && message.trim() ? message.trim() : undefined;
}

type JsonSchema = Record<string, unknown>;

function nullable(schema: JsonSchema): JsonSchema {
  const variants = Array.isArray(schema.anyOf) ? schema.anyOf : undefined;
  if (variants?.some((item) => item && typeof item === "object" && (item as JsonSchema).type === "null")) return schema;
  return { anyOf: [schema, { type: "null" }] };
}

function strictSchemaNode(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(strictSchemaNode);
  if (!input || typeof input !== "object") return input;
  const source = input as JsonSchema;
  const output: JsonSchema = {};
  for (const [key, value] of Object.entries(source)) {
    if (["$schema", "default", "propertyNames"].includes(key)) continue;
    if (key === "oneOf") {
      output.anyOf = strictSchemaNode(value);
      continue;
    }
    if (key === "format" && value === "uri") continue;
    if (key === "additionalProperties") continue;
    output[key] = strictSchemaNode(value);
  }
  const isObject = source.type === "object" || "properties" in source || "additionalProperties" in source;
  if (isObject) {
    const properties = source.properties && typeof source.properties === "object"
      ? source.properties as Record<string, unknown>
      : {};
    const originallyRequired = new Set(Array.isArray(source.required) ? source.required.filter((item): item is string => typeof item === "string") : []);
    output.type = "object";
    output.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => {
      const converted = strictSchemaNode(value) as JsonSchema;
      return [key, originallyRequired.has(key) ? converted : nullable(converted)];
    }));
    output.required = Object.keys(properties);
    output.additionalProperties = false;
  }
  return output;
}

export function codexOutputSchema(schema: z.ZodType): JsonSchema {
  return strictSchemaNode(z.toJSONSchema(schema)) as JsonSchema;
}

export function normalizeCodexOutput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCodexOutput);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== null)
    .map(([key, item]) => [key, normalizeCodexOutput(item)]));
}

export class CodexExecRunner {
  constructor(readonly executable = process.env.TOURGUIDE_CODEX_BIN || "codex") {}

  async status(): Promise<CodexStatus> {
    let version = "";
    try {
      const result = await execFileAsync(this.executable, ["--version"], { encoding: "utf8", timeout: 10_000 });
      version = result.stdout.trim() || result.stderr.trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return CodexStatusSchema.parse({
          status: "missing",
          message: "Codex CLI was not found on PATH. Install Codex and sign in before generating a tour.",
        });
      }
      return CodexStatusSchema.parse({ status: "error", message: `Could not run Codex CLI: ${String(error)}` });
    }
    if (!supportedVersion(version)) {
      return CodexStatusSchema.parse({
        status: "unsupported",
        version,
        message: "This Codex CLI is too old for structured exec sessions. Update Codex and try again.",
      });
    }
    try {
      const help = await execFileAsync(this.executable, ["exec", "--help"], { encoding: "utf8", timeout: 10_000 });
      if (!help.stdout.includes("--output-schema") || !help.stdout.includes("--json")) {
        return CodexStatusSchema.parse({
          status: "unsupported",
          version,
          message: "This Codex CLI does not expose the structured exec options Tourguide needs.",
        });
      }
      const auth = await execFileAsync(this.executable, ["login", "status"], { encoding: "utf8", timeout: 10_000 });
      return CodexStatusSchema.parse({
        status: "ready",
        version,
        auth: `${auth.stdout}${auth.stderr}`.trim(),
        message: "Codex CLI is installed and authenticated.",
      });
    } catch (error) {
      const detail = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`.trim();
      return CodexStatusSchema.parse({
        status: "unauthenticated",
        version,
        ...(detail ? { auth: detail } : {}),
        message: "Codex CLI is installed but not signed in. Run `codex login`, then retry.",
      });
    }
  }

  async run<T extends z.ZodType>(request: CodexExecRequest<T>): Promise<CodexExecResult<z.output<T>>> {
    const scratch = await mkdtemp(join(tmpdir(), "tourguide-codex-"));
    const schemaPath = join(scratch, "output.schema.json");
    const outputPath = join(scratch, "result.json");
    await writeFile(schemaPath, `${JSON.stringify(codexOutputSchema(request.schema), null, 2)}\n`, "utf8");

    const common = [
      "--ignore-user-config",
      "--ignore-rules",
      "--output-schema", schemaPath,
      "--json",
      "-o", outputPath,
      ...(request.model ? ["--model", request.model] : []),
    ];
    const args = request.threadId
      ? ["exec", "resume", ...common, request.threadId, "-"]
      : [
          "exec",
          ...common,
          "--sandbox", "read-only",
          "-C", request.cwd,
          "-c", "approval_policy=\"never\"",
          "-c", "web_search=\"disabled\"",
          "-c", "shell_environment_policy.inherit=\"core\"",
          "-",
        ];
    const usage = emptyUsage();
    const messages: string[] = [];
    let threadId = request.threadId;
    let stderr = "";
    let stdout = "";
    let stdoutBuffer = "";

    const consumeLine = (line: string) => {
      if (!line.trim()) return;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === "thread.started" && typeof event.thread_id === "string") threadId = event.thread_id;
        const eventUsage = event.usage;
        if (eventUsage && typeof eventUsage === "object") {
          usage.inputTokens = Math.max(usage.inputTokens, numberAt(eventUsage, ["input_tokens", "inputTokens"]));
          usage.cachedInputTokens = Math.max(usage.cachedInputTokens, numberAt(eventUsage, ["cached_input_tokens", "cachedInputTokens"]));
          usage.outputTokens = Math.max(usage.outputTokens, numberAt(eventUsage, ["output_tokens", "outputTokens"]));
        }
        const message = eventMessage(event);
        if (message) {
          messages.push(message);
          request.onMessage?.(message);
        }
      } catch {
        messages.push(line.trim());
      }
    };

    try {
      await new Promise<void>((resolveRun, rejectRun) => {
        const child = spawn(this.executable, args, {
          cwd: request.cwd,
          shell: false,
          detached: process.platform !== "win32",
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const stop = () => {
          if (process.platform !== "win32" && child.pid) {
            try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
          } else child.kill("SIGTERM");
        };
        request.signal?.addEventListener("abort", stop, { once: true });
        if (request.signal?.aborted) stop();
        child.once("error", (error) => rejectRun(new CodexExecFailure(
          `Could not start Codex exec: ${error.message}`,
          { executable: this.executable, args, code: (error as NodeJS.ErrnoException).code },
        )));
        child.stderr.on("data", (chunk: Buffer) => {
          stderr = `${stderr}${chunk.toString("utf8")}`.slice(-1_048_576);
        });
        child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          stdout = `${stdout}${text}`.slice(-1_048_576);
          stdoutBuffer += text;
          const lines = stdoutBuffer.split("\n");
          stdoutBuffer = lines.pop() ?? "";
          for (const line of lines) consumeLine(line);
        });
        child.stdin.end(request.prompt);
        child.once("close", (code, signal) => {
          request.signal?.removeEventListener("abort", stop);
          if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
          if (request.signal?.aborted) return rejectRun(new Error("Tour generation was cancelled."));
          if (code === 0) resolveRun();
          else {
            const detail = stderr.trim() || messages.at(-1) || stdout.trim() || "no diagnostic output";
            rejectRun(new CodexExecFailure(`Codex exec failed (${signal ?? code}): ${detail}`, {
              executable: this.executable,
              args,
              exitCode: code,
              signal,
              stderr: stderr.trim(),
              stdout: stdout.trim(),
              messages: messages.slice(-20),
            }));
          }
        });
      });
      const raw = JSON.parse(await readFile(outputPath, "utf8"));
      const parsed = request.schema.parse(normalizeCodexOutput(raw));
      return {
        value: parsed,
        usage,
        messages,
        ...(threadId ? { threadId } : {}),
      };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}
