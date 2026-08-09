import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { containedPath, recipeRequiresTrustedMode, runRecipeInWorkspace, type RunResult } from "./runtime.js";
import type { KnowledgeItem, LabEnvironment, LabService, Module, RunRecipe, RuntimeProviderArtifact, TourSnapshot, VerificationCheck } from "./schema.js";

const execFileAsync = promisify(execFile);
const MAX_EDITABLE_BYTES = 512 * 1024;
const MAX_SERVICE_LOG_BYTES = 256 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

export type LabSessionStatus = "preparing" | "ready" | "busy" | "failed" | "retained" | "closed";

export interface LabServiceState {
  id: string;
  title: string;
  status: "starting" | "ready" | "failed" | "stopped";
  port: number;
  healthUrl?: string;
  stdout: string;
  stderr: string;
}

export interface LabSession {
  id: string;
  snapshotId: string;
  moduleId: string;
  environmentId: string;
  commit: string;
  workspace: string;
  adapterIds: string[];
  editablePaths: string[];
  dependencyBindings: LabEnvironment["dependencies"];
  mocks: Array<{ id: string; mode: "repository-mock" | "declarative-mock"; label: string }>;
  services: LabServiceState[];
  status: LabSessionStatus;
  retainedBranch?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface LabFile {
  path: string;
  content: string;
}

export interface VerificationResult {
  status: "pass" | "fail" | "inconclusive";
  expected: string;
  observed: string;
  result: RunResult;
  checks: Array<{ type: VerificationCheck["type"]; status: "pass" | "fail" | "inconclusive"; expected: string; observed: string }>;
}

export interface LabAdapterContext {
  root: string;
  snapshot: TourSnapshot;
  module: Module;
  environment: LabEnvironment;
  session: LabSession;
}

export interface LabInvocation {
  item: KnowledgeItem;
  inputs: Record<string, unknown>;
}

export interface LabInvocationResult {
  adapterId: string;
  provenance: "production" | "repository-story" | "tourguide-harness" | "repository-mock" | "declarative-mock";
  value: unknown;
  logs: string[];
}

export interface LabAdapter {
  readonly id: string;
  readonly capabilities?: readonly string[];
  supports?(context: LabAdapterContext, request: LabInvocation): boolean | Promise<boolean>;
  prepare?(context: LabAdapterContext): void | Promise<void>;
  invoke?(context: LabAdapterContext, request: LabInvocation): LabInvocationResult | Promise<LabInvocationResult>;
  close?(context: LabAdapterContext): void | Promise<void>;
}

export class LabAdapterRegistry {
  readonly #adapters = new Map<string, LabAdapter>();

  register(adapter: LabAdapter): this {
    if (this.#adapters.has(adapter.id)) throw new Error(`Lab adapter already registered: ${adapter.id}`);
    this.#adapters.set(adapter.id, adapter);
    return this;
  }

  require(id: string): LabAdapter {
    const adapter = this.#adapters.get(id);
    if (!adapter) throw new Error(`Lab environment requires unavailable adapter: ${id}`);
    return adapter;
  }

  list(): LabAdapter[] {
    return [...this.#adapters.values()];
  }

  async invoke(id: string, context: LabAdapterContext, request: LabInvocation): Promise<LabInvocationResult> {
    const adapter = this.require(id);
    if (!adapter.invoke) throw new Error(`Lab adapter does not support interactive invocation: ${id}`);
    return adapter.invoke(context, request);
  }

  async resolve(capability: string, allowedIds: readonly string[], context: LabAdapterContext, request: LabInvocation): Promise<LabAdapter> {
    for (const id of allowedIds) {
      const adapter = this.require(id);
      if (!adapter.invoke || !adapter.capabilities?.includes(capability)) continue;
      if (!adapter.supports || await adapter.supports(context, request)) return adapter;
    }
    throw new Error(`No prepared runtime provider satisfies capability ${capability}.`);
  }
}

export function defaultLabRegistry(): LabAdapterRegistry {
  return new LabAdapterRegistry()
    .register({ id: "source" })
    .register({ id: "command" })
    .register({ id: "react", capabilities: ["ui.render", "ui.observe"], supports: componentSupport, invoke: componentInvocation })
    .register({ id: "storybook", capabilities: ["ui.render", "ui.observe"], supports: componentSupport, invoke: componentInvocation })
    .register({ id: "function-js", capabilities: ["code.invoke", "runtime.observe"], supports: functionSupport, invoke: functionInvocation })
    .register({ id: "http", capabilities: ["service.request"], supports: httpSupport, invoke: httpInvocation })
    .register({ id: "sqlite", capabilities: ["data.introspect", "data.query", "data.mutate"], supports: sqliteSupport, invoke: sqliteInvocation });
}

function componentSupport(context: LabAdapterContext, request: LabInvocation): boolean {
  return request.item.catalog === "components"
    && Boolean(request.item.storyIds.length)
    && context.session.services.some((service) => /story/i.test(service.id) && service.status === "ready");
}

function functionSupport(_context: LabAdapterContext, request: LabInvocation): boolean {
  return request.item.catalog === "code-docs" && request.item.kind === "symbol" && Boolean(request.item.path && /\.(mjs|cjs|js)$/.test(request.item.path));
}

function selectedHttpService(context: LabAdapterContext, request: LabInvocation): LabServiceState | undefined {
  const ready = context.session.services.filter((service) => service.status === "ready");
  const requestedId = typeof request.inputs.serviceId === "string" ? request.inputs.serviceId : undefined;
  if (requestedId) return ready.find((service) => service.id === requestedId);
  const apiServices = ready.filter((service) => /(?:^|[-_:])(api|http|backend|server)(?:$|[-_:])/i.test(`-${service.id}-`));
  if (apiServices.length === 1) return apiServices[0];
  const nonPreview = ready.filter((service) => !/(?:story|preview|storybook)/i.test(service.id));
  return nonPreview.length === 1 ? nonPreview[0] : undefined;
}

function httpSupport(context: LabAdapterContext, request: LabInvocation): boolean {
  return request.item.catalog === "api" && Boolean(request.item.route) && Boolean(selectedHttpService(context, request));
}

function sqliteSupport(_context: LabAdapterContext, request: LabInvocation): boolean {
  return request.item.catalog === "data-model";
}

async function functionInvocation(context: LabAdapterContext, request: LabInvocation): Promise<LabInvocationResult> {
  const { item } = request;
  if (item.catalog !== "code-docs" || item.kind !== "symbol" || !item.path || !item.symbol) throw new Error("Function interactions require an indexed code symbol.");
  if (!/\.(mjs|cjs|js)$/.test(item.path)) throw new Error("The built-in function harness supports committed JavaScript exports. TypeScript requires a repository-owned runner.");
  const args = Array.isArray(request.inputs.args) ? request.inputs.args : [];
  const script = [
    "const { pathToFileURL } = await import('node:url');",
    "const module = await import(pathToFileURL(process.argv[1]).href);",
    "const fn = module[process.argv[2]] ?? module.default?.[process.argv[2]];",
    "if (typeof fn !== 'function') throw new Error('Export is not callable');",
    "const value = await fn(...JSON.parse(process.argv[3]));",
    "console.log('__TOURGUIDE_RESULT__' + JSON.stringify(value));",
  ].join("\n");
  const result = await runRecipeInWorkspace(context.session.workspace, {
    id: "invoke-function", title: `Invoke ${item.symbol}`, command: process.execPath,
    args: ["--input-type=module", "-e", script, resolve(context.session.workspace, item.path), item.symbol, JSON.stringify(args)],
    cwd: ".", lifecycle: "oneshot", timeoutMs: 30_000, env: {}, inputs: [],
    capabilities: { writes: [], network: "none", secrets: [], containers: false, externalSystems: [] },
    expected: "The export returns a JSON-serializable result.",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || "Function invocation failed.");
  const marker = result.stdout.split("\n").find((line) => line.startsWith("__TOURGUIDE_RESULT__"));
  return { adapterId: "function-js", provenance: "tourguide-harness", value: marker ? JSON.parse(marker.slice("__TOURGUIDE_RESULT__".length)) : null, logs: result.stdout.split("\n").filter((line) => line && !line.startsWith("__TOURGUIDE_RESULT__")) };
}

async function httpInvocation(context: LabAdapterContext, request: LabInvocation): Promise<LabInvocationResult> {
  if (request.item.catalog !== "api" || !request.item.route) throw new Error("HTTP interactions require an indexed API endpoint.");
  const service = selectedHttpService(context, request);
  if (!service) throw new Error("The lab environment has no ready HTTP service.");
  const route = request.item.route.replace(/[{:]([A-Za-z_][\w]*)}?/g, (token, key: string) => key in request.inputs ? encodeURIComponent(String(request.inputs[key])) : token);
  const url = new URL(route, `http://127.0.0.1:${service.port}`);
  if (url.hostname !== "127.0.0.1" || url.port !== String(service.port)) throw new Error("HTTP interactions are restricted to the allocated lab service.");
  const body = request.inputs.body;
  const response = await fetch(url, {
    method: request.item.method ?? "GET",
    ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let value: unknown = text;
  try { value = JSON.parse(text); } catch { /* Non-JSON responses remain text. */ }
  return { adapterId: "http", provenance: "production", value: { status: response.status, headers: Object.fromEntries(response.headers), body: value }, logs: [] };
}

async function sqliteInvocation(context: LabAdapterContext, request: LabInvocation): Promise<LabInvocationResult> {
  const databasePath = safeRelativePath(String(request.inputs.databasePath ?? ""));
  const query = String(request.inputs.query ?? "").trim();
  if (!query) throw new Error("A SQLite query is required.");
  const writable = /^(insert|update|delete|replace|create|drop|alter)\b/i.test(query);
  if (writable && request.inputs.allowWrite !== true) throw new Error("Set allowWrite to true for an explicit guided data mutation.");
  const target = resolve(context.session.workspace, databasePath);
  if (!target.startsWith(`${context.session.workspace}${sep}`)) throw new Error("SQLite path escapes the lab workspace.");
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(target);
  try {
    const statement = database.prepare(query);
    const parameters = Array.isArray(request.inputs.parameters) ? request.inputs.parameters : [];
    const returnsRows = /^(select|pragma|explain|with)\b/i.test(query);
    const value = returnsRows ? statement.all(...parameters) : { changes: statement.run(...parameters).changes };
    return { adapterId: "sqlite", provenance: "production", value, logs: [] };
  } finally {
    database.close();
  }
}

async function componentInvocation(context: LabAdapterContext, request: LabInvocation): Promise<LabInvocationResult> {
  if (request.item.catalog !== "components") throw new Error("Component interactions require an indexed component or story.");
  const service = context.session.services.find((candidate) => /story/i.test(candidate.id) && candidate.status === "ready");
  const requestedStory = String(request.inputs.storyId ?? request.item.storyIds[0] ?? "");
  if (!service || !requestedStory) throw new Error("No repository Storybook service and story ID are available for this component.");
  let storyId = requestedStory;
  try {
    const index = await (await fetch(`http://127.0.0.1:${service.port}/index.json`, { signal: AbortSignal.timeout(5_000) })).json() as { entries?: Record<string, { id?: string; name?: string; importPath?: string }> };
    const matched = Object.values(index.entries ?? {}).find((entry) => entry.id === requestedStory || entry.name === requestedStory || entry.importPath === request.item.path);
    storyId = matched?.id ?? storyId;
  } catch {
    // Older Storybook versions may not expose index.json. Use the declared ID.
  }
  const args = request.inputs.args && typeof request.inputs.args === "object" && !Array.isArray(request.inputs.args) ? request.inputs.args as Record<string, unknown> : {};
  const encodedArgs = Object.entries(args).map(([key, value]) => `${key}:${encodeURIComponent(String(value))}`).join(";");
  const url = `http://127.0.0.1:${service.port}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story${encodedArgs ? `&args=${encodedArgs}` : ""}`;
  return { adapterId: "storybook", provenance: "repository-story", value: { url, args }, logs: [] };
}

function providerRoot(provider: RuntimeProviderArtifact): string {
  const slug = provider.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
  if (!slug) throw new Error("Runtime provider ID cannot be materialized safely.");
  return `.tourguide-runtime/${slug}`;
}

function expandProviderEnvironment(environment: LabEnvironment): LabEnvironment {
  const preparationRecipes = [...environment.preparationRecipes];
  const services = [...environment.services];
  const recipeIds = new Set(preparationRecipes.map((recipe) => recipe.id));
  const serviceIds = new Set(services.map((service) => service.id));
  const runtimeProviders = environment.runtimeProviders ?? [];
  for (const provider of runtimeProviders) {
    if (provider.validation.status !== "pass") continue;
    for (const recipe of provider.preparationRecipes) {
      if (recipeIds.has(recipe.id)) throw new Error(`Duplicate runtime preparation recipe: ${recipe.id}`);
      recipeIds.add(recipe.id);
      preparationRecipes.push(recipe);
    }
    for (const service of provider.services) {
      if (serviceIds.has(service.id)) throw new Error(`Duplicate runtime service: ${service.id}`);
      serviceIds.add(service.id);
      services.push(service);
    }
  }
  return { ...environment, runtimeProviders, preparationRecipes, services };
}

async function materializeRuntimeProviders(workspace: string, providers: RuntimeProviderArtifact[]): Promise<void> {
  for (const provider of providers) {
    if (provider.validation.status !== "pass") continue;
    const root = resolve(workspace, providerRoot(provider));
    for (const file of provider.files) {
      const path = safeRelativePath(file.path);
      const target = resolve(root, path);
      if (!target.startsWith(`${root}${sep}`)) throw new Error("Runtime provider file escapes its provider directory.");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
  }
}

function invocationValues(recipe: RunRecipe, request: LabInvocation): Record<string, string> {
  return Object.fromEntries(recipe.inputs.map((input) => {
    const direct = request.inputs[input.id];
    if (direct !== undefined) return [input.id, typeof direct === "string" ? direct : JSON.stringify(direct)];
    if (input.id === "payload") return [input.id, JSON.stringify(request.inputs)];
    if (input.id === "subject_id") return [input.id, request.item.id];
    if (input.id === "subject_path") return [input.id, request.item.path ?? ""];
    if (input.id === "subject_symbol") return [input.id, request.item.symbol ?? request.item.title];
    return [input.id, input.default];
  }));
}

function runtimeTemplate(value: string, request: LabInvocation): string {
  return value.replace(/\{\{(subject_id|subject_path|subject_symbol|input\.[a-zA-Z0-9_-]+)\}\}/g, (token, key: string) => {
    if (key === "subject_id") return encodeURIComponent(request.item.id);
    if (key === "subject_path") return encodeURIComponent(request.item.path ?? "");
    if (key === "subject_symbol") return encodeURIComponent(request.item.symbol ?? request.item.title);
    const input = request.inputs[key.slice("input.".length)];
    return input === undefined ? token : encodeURIComponent(typeof input === "string" ? input : JSON.stringify(input));
  });
}

async function invokeRuntimeProvider(
  context: LabAdapterContext,
  provider: RuntimeProviderArtifact,
  capability: string,
  request: LabInvocation,
): Promise<LabInvocationResult> {
  const invocation = provider.invocations.find((candidate) => candidate.capability === capability);
  if (!invocation) throw new Error(`Runtime provider ${provider.id} does not declare an invocation for ${capability}.`);
  if (invocation.kind === "service-url") {
    const service = context.session.services.find((candidate) => candidate.id === invocation.serviceId && candidate.status === "ready");
    if (!service) throw new Error(`Runtime provider service ${invocation.serviceId} is not ready.`);
    const path = runtimeTemplate(invocation.pathTemplate!, request);
    const url = new URL(path, `http://127.0.0.1:${service.port}`);
    if (url.hostname !== "127.0.0.1" || url.port !== String(service.port)) throw new Error("Runtime provider URL escapes its allocated service.");
    return { adapterId: provider.id, provenance: "tourguide-harness", value: { url: url.toString() }, logs: [] };
  }
  const result = await runRecipeInWorkspace(context.session.workspace, invocation.recipe!, false, invocationValues(invocation.recipe!, request));
  if (result.undeclaredWrites.length) throw new Error(`Runtime provider wrote outside its declaration: ${result.undeclaredWrites.join(", ")}.`);
  if (result.exitCode !== 0 || result.timedOut) throw new Error(result.stderr || result.stdout || `Runtime provider ${provider.id} failed.`);
  const output = result.stdout.trim();
  let value: unknown = output;
  if (invocation.result === "json") {
    const marked = output.split("\n").find((line) => line.startsWith("__TOURGUIDE_RESULT__"));
    value = JSON.parse(marked ? marked.slice("__TOURGUIDE_RESULT__".length) : output || "null");
  }
  return { adapterId: provider.id, provenance: "tourguide-harness", value, logs: result.stderr.split("\n").filter(Boolean) };
}

function safeRelativePath(path: string): string {
  if (!path || isAbsolute(path) || path.includes("\0")) throw new Error("Lab paths must be relative.");
  const normalized = path.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "" || part === "..")) throw new Error("Lab paths cannot escape the workspace.");
  return normalized;
}

function labWorkspace(root: string, id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid lab session ID.");
  const base = resolve(root, ".tourguide", "workspaces", "labs");
  const workspace = resolve(base, id);
  if (!workspace.startsWith(`${base}${sep}`)) throw new Error("Lab workspace escapes its generated directory.");
  return workspace;
}

async function assertEditable(workspace: string, path: string): Promise<string> {
  const target = resolve(workspace, safeRelativePath(path));
  const rel = relative(workspace, target);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Lab path escapes its workspace.");
  const stat = await lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Only regular, non-symlink files can be edited.");
  if (stat.size > MAX_EDITABLE_BYTES) throw new Error("Lab file is too large for the browser editor.");
  return target;
}

async function addWorktree(root: string, workspace: string, commit: string): Promise<void> {
  await mkdir(resolve(root, ".tourguide", "workspaces", "labs"), { recursive: true });
  await execFileAsync("git", ["-C", root, "worktree", "add", "--detach", workspace, commit]);
}

async function removeWorktree(root: string, workspace: string): Promise<void> {
  await execFileAsync("git", ["-C", root, "worktree", "remove", "--force", workspace]).catch(() => undefined);
  await rm(workspace, { recursive: true, force: true });
}

function environmentFor(snapshot: TourSnapshot, module: Module): LabEnvironment {
  const declared = snapshot.labEnvironments.find((environment) => environment.moduleId === module.id);
  if (declared) return declared;
  const pages = module.pageIds.flatMap((id) => snapshot.pages.filter((page) => page.id === id));
  const interactionTypes = new Set(pages.flatMap((page) => page.interactions.map((interaction) => interaction.type)));
  const adapterIds = [
    ...(interactionTypes.has("source") ? ["source"] : []),
    ...(interactionTypes.has("command") ? ["command"] : []),
    ...(interactionTypes.has("component") ? ["react"] : []),
    ...(interactionTypes.has("function") ? ["function-js"] : []),
    ...(interactionTypes.has("http") ? ["http"] : []),
    ...(interactionTypes.has("database") ? ["sqlite"] : []),
  ];
  return {
    id: `lab-${module.id}`,
    moduleId: module.id,
    title: `${module.title} lab`,
    adapterIds,
    runtimeProfileIds: [],
    runtimeProviders: [],
    editablePaths: [...new Set(pages.flatMap((page) => page.exercise?.allowedPaths ?? []))],
    preparationRecipes: [],
    services: [],
    dependencies: [],
    readiness: "ready",
  };
}

function appendBounded(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString("utf8")}`.slice(-MAX_SERVICE_LOG_BYTES);
}

function containsSubset(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((value, index) => containsSubset(actual[index], value));
  if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return false;
  return Object.entries(expected as Record<string, unknown>).every(([key, value]) => containsSubset((actual as Record<string, unknown>)[key], value));
}

function evaluateCheck(check: VerificationCheck, result: RunResult): VerificationResult["checks"][number] {
  if (check.type === "exit-code") {
    return { type: check.type, status: result.exitCode === check.expected ? "pass" : "fail", expected: `Exit code ${check.expected}`, observed: `Exit code ${result.exitCode ?? "none"}` };
  }
  if (check.type === "output") {
    const output = check.stream === "stdout" ? result.stdout : check.stream === "stderr" ? result.stderr : `${result.stdout}\n${result.stderr}`;
    return { type: check.type, status: output.includes(check.includes) ? "pass" : "fail", expected: `${check.stream} includes ${JSON.stringify(check.includes)}`, observed: output.trim() || "No output" };
  }
  if (check.type === "json-subset") {
    try {
      const actual: unknown = JSON.parse(result.stdout);
      return { type: check.type, status: containsSubset(actual, check.expected) ? "pass" : "fail", expected: JSON.stringify(check.expected), observed: JSON.stringify(actual) };
    } catch {
      return { type: check.type, status: "fail", expected: JSON.stringify(check.expected), observed: "stdout was not valid JSON" };
    }
  }
  if (check.type === "file-change") {
    const changed = result.changedFiles.includes(check.path);
    const contentMatch = !check.includes || result.patch?.includes(check.includes);
    return { type: check.type, status: changed && contentMatch ? "pass" : "fail", expected: `${check.path} changes${check.includes ? ` include ${JSON.stringify(check.includes)}` : ""}`, observed: result.changedFiles.length ? result.changedFiles.join(", ") : "No files changed" };
  }
  return { type: check.type, status: "inconclusive", expected: "A matching interactive adapter result", observed: "This command recipe did not produce the required HTTP or database observation." };
}

async function availablePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address !== "string" ? address.port : 0;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Service exited before its health check passed.");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The service may still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Service health check timed out: ${url}`);
}

async function waitForPort(port: number, timeoutMs: number, child: ChildProcess): Promise<void> {
  const { createConnection } = await import("node:net");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Service exited before binding its allocated port.");
    const connected = await new Promise<boolean>((resolveConnection) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(500);
      socket.once("connect", () => { socket.destroy(); resolveConnection(true); });
      socket.once("timeout", () => { socket.destroy(); resolveConnection(false); });
      socket.once("error", () => resolveConnection(false));
    });
    if (connected) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Service port readiness timed out: ${port}`);
}

function terminate(child: ChildProcess): void {
  if (child.exitCode !== null) return;
  if (process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  } else child.kill("SIGTERM");
}

async function terminateAndWait(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const closed = new Promise<void>((resolveClose) => child.once("close", () => resolveClose()));
  terminate(child);
  const graceful = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 2_000)),
  ]);
  if (!graceful && child.exitCode === null) {
    if (process.platform !== "win32" && child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    } else child.kill("SIGKILL");
    await closed;
  }
}

interface InternalLab {
  session: LabSession;
  snapshot: TourSnapshot;
  module: Module;
  environment: LabEnvironment;
  processes: Map<string, ChildProcess>;
}

export class LabManager {
  readonly #sessions = new Map<string, InternalLab>();
  readonly #moduleSessions = new Map<string, string>();

  constructor(
    readonly root: string,
    readonly registry = defaultLabRegistry(),
    readonly idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  ) {}

  private require(id: string): InternalLab {
    const internal = this.#sessions.get(id);
    if (!internal || internal.session.status === "closed") throw new Error("Lab session not found.");
    if (Date.parse(internal.session.expiresAt) <= Date.now() && internal.session.status !== "retained") {
      void this.close(id);
      throw new Error("Lab session expired.");
    }
    internal.session.updatedAt = new Date().toISOString();
    internal.session.expiresAt = new Date(Date.now() + this.idleTimeoutMs).toISOString();
    return internal;
  }

  private async stopServices(internal: InternalLab): Promise<void> {
    for (const state of internal.session.services) state.status = "stopped";
    await Promise.all([...internal.processes.values()].map(terminateAndWait));
    internal.processes.clear();
    internal.session.services = [];
  }

  get(id: string): LabSession {
    return { ...this.require(id).session };
  }

  list(): LabSession[] {
    return [...this.#sessions.values()].filter((entry) => entry.session.status !== "closed").map((entry) => ({ ...entry.session }));
  }

  async create(snapshot: TourSnapshot, moduleId: string, trusted = false): Promise<{ session: LabSession; files: LabFile[] }> {
    const key = `${snapshot.id}:${moduleId}`;
    const existingId = this.#moduleSessions.get(key);
    if (existingId) {
      const existing = this.#sessions.get(existingId);
      if (existing && !["closed", "failed"].includes(existing.session.status)) return { session: this.get(existingId), files: await this.files(existingId) };
    }
    const module = snapshot.modules.find((candidate) => candidate.id === moduleId);
    if (!module) throw new Error("Unknown lab module.");
    const environment = expandProviderEnvironment(environmentFor(snapshot, module));
    if (environment.readiness === "blocked") throw new Error("This lab environment is blocked.");
    for (const recipe of [...environment.preparationRecipes, ...environment.services.map((service) => service.recipe)]) {
      if (!trusted && recipeRequiresTrustedMode(recipe)) throw new Error("This lab requires explicit trusted-mode approval.");
    }
    const adapters = environment.adapterIds.map((id) => this.registry.require(id));
    const id = randomUUID();
    const workspace = labWorkspace(this.root, id);
    await addWorktree(this.root, workspace, snapshot.anchor.commit);
    const now = new Date();
    const session: LabSession = {
      id,
      snapshotId: snapshot.id,
      moduleId,
      environmentId: environment.id,
      commit: snapshot.anchor.commit,
      workspace,
      adapterIds: environment.adapterIds,
      editablePaths: [...new Set(environment.editablePaths.map(safeRelativePath))],
      dependencyBindings: environment.dependencies,
      mocks: environment.dependencies.flatMap((dependency) => dependency.mode === "repository-mock" || dependency.mode === "declarative-mock" ? [{ id: dependency.id, mode: dependency.mode, label: dependency.label }] : []),
      services: [],
      status: "preparing",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.idleTimeoutMs).toISOString(),
    };
    const internal: InternalLab = { session, snapshot, module, environment, processes: new Map() };
    this.#sessions.set(id, internal);
    this.#moduleSessions.set(key, id);
    const context = { root: this.root, snapshot, module, environment, session };
    try {
      await materializeRuntimeProviders(workspace, environment.runtimeProviders);
      for (const adapter of adapters) await adapter.prepare?.(context);
      for (const recipe of environment.preparationRecipes) {
        const result = await runRecipeInWorkspace(workspace, recipe, trusted);
        if (result.undeclaredWrites.length) {
          throw new Error(`Lab preparation wrote outside its declaration: ${result.undeclaredWrites.join(", ")}.`);
        }
        if (result.exitCode !== 0) throw new Error(`Lab preparation failed: ${recipe.title}\n${result.stderr || result.stdout}`);
      }
      for (const service of environment.services) await this.startService(internal, service);
      session.status = "ready";
      session.updatedAt = new Date().toISOString();
      return { session: { ...session }, files: await this.files(id) };
    } catch (error) {
      session.status = "failed";
      await this.close(id, true);
      throw error;
    }
  }

  private async startService(internal: InternalLab, definition: LabService): Promise<void> {
    if (definition.recipe.lifecycle !== "service") throw new Error(`Lab service ${definition.id} must use service lifecycle.`);
    const port = await availablePort();
    const healthUrl = definition.healthUrl?.replaceAll("{{port}}", String(port));
    const replacePort = (value: string) => value.replaceAll("{{port}}", String(port));
    const state: LabServiceState = { id: definition.id, title: definition.title, status: "starting", port, ...(healthUrl ? { healthUrl } : {}), stdout: "", stderr: "" };
    internal.session.services.push(state);
    const home = resolve(internal.session.workspace, ".tourguide-home");
    await mkdir(home, { recursive: true });
    const child = spawn(definition.recipe.command, definition.recipe.args.map(replacePort), {
      cwd: containedPath(internal.session.workspace, definition.recipe.cwd),
      shell: false,
      detached: process.platform !== "win32",
      env: { PATH: process.env.PATH ?? "", HOME: home, ...Object.fromEntries(Object.entries(definition.recipe.env).map(([key, value]) => [key, replacePort(value)])), [definition.portEnv]: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const spawnFailure = new Promise<never>((_resolve, reject) => {
      child.once("error", (error) => {
        state.status = "failed";
        reject(error);
      });
    });
    internal.processes.set(definition.id, child);
    child.stdout?.on("data", (chunk: Buffer) => { state.stdout = appendBounded(state.stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { state.stderr = appendBounded(state.stderr, chunk); });
    child.once("close", () => { if (state.status !== "stopped") state.status = "failed"; });
    await Promise.race([waitForPort(port, definition.healthTimeoutMs, child), spawnFailure]);
    if (healthUrl) await Promise.race([waitForHealth(healthUrl, definition.healthTimeoutMs, child), spawnFailure]);
    state.status = "ready";
  }

  async files(id: string): Promise<LabFile[]> {
    const internal = this.require(id);
    return Promise.all(internal.session.editablePaths.map(async (path) => ({
      path,
      content: await readFile(await assertEditable(internal.session.workspace, path), "utf8"),
    })));
  }

  async write(id: string, path: string, content: string): Promise<LabFile> {
    const internal = this.require(id);
    const normalized = safeRelativePath(path);
    if (!internal.session.editablePaths.includes(normalized)) throw new Error("This path is not editable in the lab.");
    if (Buffer.byteLength(content) > MAX_EDITABLE_BYTES) throw new Error("Lab file is too large.");
    await writeFile(await assertEditable(internal.session.workspace, normalized), content, "utf8");
    return { path: normalized, content };
  }

  async run(id: string, recipe: RunRecipe, trusted = false, inputs: Record<string, string> = {}): Promise<RunResult> {
    const internal = this.require(id);
    internal.session.status = "busy";
    try {
      return await runRecipeInWorkspace(internal.session.workspace, recipe, trusted, inputs);
    } finally {
      internal.session.status = "ready";
    }
  }

  async verify(id: string, recipe: RunRecipe, trusted = false, inputs: Record<string, string> = {}, checks: VerificationCheck[] = []): Promise<VerificationResult> {
    const result = await this.run(id, recipe, trusted, inputs);
    const evaluated = checks.map((check) => evaluateCheck(check, result));
    const status = result.timedOut || result.signal || evaluated.some((check) => check.status === "inconclusive")
      ? "inconclusive"
      : result.exitCode !== 0 || evaluated.some((check) => check.status === "fail")
        ? "fail"
        : "pass";
    const observed = result.stderr.trim() || result.stdout.trim() || `Process exited ${result.exitCode ?? "without an exit code"}.`;
    return { status, expected: recipe.expected ?? "The verification recipe exits successfully.", observed, result, checks: evaluated };
  }

  async invoke(id: string, adapterId: string, request: LabInvocation): Promise<LabInvocationResult> {
    const internal = this.require(id);
    const context = {
      root: this.root,
      snapshot: internal.snapshot,
      module: internal.module,
      environment: internal.environment,
      session: internal.session,
    };
    return this.registry.invoke(adapterId, context, request);
  }

  async invokeCapability(id: string, capability: string, request: LabInvocation): Promise<LabInvocationResult> {
    const internal = this.require(id);
    const context = {
      root: this.root,
      snapshot: internal.snapshot,
      module: internal.module,
      environment: internal.environment,
      session: internal.session,
    };
    const generated = internal.environment.runtimeProviders.find((provider) => (
      provider.validation.status === "pass"
      && provider.capabilities.includes(capability)
      && provider.invocations.some((invocation) => invocation.capability === capability)
    ));
    if (generated) return invokeRuntimeProvider(context, generated, capability, request);
    const adapter = await this.registry.resolve(capability, internal.environment.adapterIds, context, request);
    return adapter.invoke!(context, request);
  }

  async patch(id: string): Promise<string> {
    const internal = this.require(id);
    const { stdout } = await execFileAsync("git", ["-C", internal.session.workspace, "diff", "--binary"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  }

  async reset(id: string): Promise<{ session: LabSession; files: LabFile[] }> {
    const internal = this.require(id);
    if (internal.session.status === "retained") throw new Error("A retained lab cannot be reset.");
    await this.stopServices(internal);
    await removeWorktree(this.root, internal.session.workspace);
    await addWorktree(this.root, internal.session.workspace, internal.session.commit);
    await materializeRuntimeProviders(internal.session.workspace, internal.environment.runtimeProviders);
    for (const recipe of internal.environment.preparationRecipes) {
      const result = await runRecipeInWorkspace(internal.session.workspace, recipe, false);
      if (result.exitCode !== 0) throw new Error(`Lab reset failed: ${recipe.title}`);
    }
    for (const service of internal.environment.services) await this.startService(internal, service);
    internal.session.status = "ready";
    return { session: this.get(id), files: await this.files(id) };
  }

  async retain(id: string, slug = "experiment"): Promise<LabSession> {
    const internal = this.require(id);
    if (internal.session.status === "retained") return { ...internal.session };
    const safeSlug = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "experiment";
    const branch = `tourguide/${safeSlug}-${id.slice(0, 8)}`;
    await execFileAsync("git", ["-C", internal.session.workspace, "switch", "-c", branch]);
    internal.session.status = "retained";
    internal.session.retainedBranch = branch;
    internal.session.updatedAt = new Date().toISOString();
    await this.stopServices(internal);
    return { ...internal.session };
  }

  async close(id: string, forceRemoveRetained = false): Promise<void> {
    const internal = this.#sessions.get(id);
    if (!internal) return;
    await this.stopServices(internal);
    const context = { root: this.root, snapshot: internal.snapshot, module: internal.module, environment: internal.environment, session: internal.session };
    for (const adapter of internal.environment.adapterIds.map((adapterId) => this.registry.require(adapterId)).reverse()) await adapter.close?.(context);
    const retained = internal.session.status === "retained";
    internal.session.status = "closed";
    this.#moduleSessions.delete(`${internal.snapshot.id}:${internal.module.id}`);
    if (!retained || forceRemoveRetained) await removeWorktree(this.root, internal.session.workspace);
    if (!retained || forceRemoveRetained) this.#sessions.delete(id);
  }

  async sweep(): Promise<void> {
    const expired = [...this.#sessions.values()].filter((entry) => entry.session.status !== "retained" && Date.parse(entry.session.expiresAt) <= Date.now());
    await Promise.all(expired.map((entry) => this.close(entry.session.id)));
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map((id) => this.close(id)));
  }
}
