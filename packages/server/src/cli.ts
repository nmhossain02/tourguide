import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

import { TourStore, findRepositoryRoot, inspectRepositoryAt } from "@tourguide/core";
import open from "open";

import { CodexExecRunner } from "./codex-exec.js";
import { captureDiagnostic, formatDiagnosticReport } from "./diagnostics.js";
import { startMcpServer } from "./mcp.js";
import { startWebServer } from "./web-server.js";

const execFileAsync = promisify(execFile);
const commands = new Set(["open", "serve", "status", "doctor", "diagnostics", "clean", "mcp"]);
const usage = `Usage:
  tourguide [repository] [--ref <branch|tag|commit>] [--model <model>]
  tourguide <open|serve|status|doctor|diagnostics|clean|mcp> [repository] [options]

With no command, Tourguide opens the browser for the current directory.`;

interface CliOptions {
  command: string;
  path: string;
  ref: string;
  model?: string;
}

let diagnosticRoot: string | undefined;
let handlingCrash = false;

function installCrashHandlers(root: string): void {
  const handle = async (error: unknown, origin: string) => {
    if (handlingCrash) return;
    handlingCrash = true;
    const captured = await captureDiagnostic(root, {
      trigger: "process",
      summary: `Tourguide terminated after ${origin}.`,
      error,
      context: { origin },
    }).catch(() => undefined);
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    if (captured) console.error(`Diagnostic report: ${captured.path}`);
    process.exit(1);
  };
  process.once("uncaughtException", (error) => { void handle(error, "an uncaught exception"); });
  process.once("unhandledRejection", (error) => { void handle(error, "an unhandled rejection"); });
}

function parseArgs(args: string[]): CliOptions | undefined {
  if (args.includes("--help") || args.includes("-h") || args[0] === "help") return undefined;
  let command = "open";
  let index = 0;
  if (args[0] && commands.has(args[0])) {
    command = args[0];
    index = 1;
  }
  let path: string | undefined;
  let ref = "HEAD";
  let model: string | undefined;
  while (index < args.length) {
    const value = args[index]!;
    if (value === "--ref") {
      ref = args[++index] ?? "";
      if (!ref) throw new Error("--ref requires a branch, tag, or commit.");
    } else if (value === "--model") {
      model = args[++index] ?? "";
      if (!model) throw new Error("--model requires a model name.");
    } else if (value.startsWith("-")) {
      throw new Error(`Unknown option: ${value}`);
    } else if (!path) {
      path = value;
    } else {
      throw new Error(`Unexpected argument: ${value}`);
    }
    index += 1;
  }
  return { command, path: path ?? process.cwd(), ref, ...(model ? { model } : {}) };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    console.log(usage);
    return;
  }
  if (options.command === "mcp") {
    await startMcpServer(options.path);
    return;
  }

  let root: string;
  try {
    root = await findRepositoryRoot(options.path);
  } catch {
    console.error(`Tourguide requires a Git repository: ${options.path}`);
    process.exitCode = 1;
    return;
  }
  diagnosticRoot = root;
  installCrashHandlers(root);

  if (options.command === "diagnostics") {
    const store = new TourStore(root);
    await store.initialize();
    let report = await store.latestDiagnostic();
    if (!report) {
      const job = await store.generationJob();
      const captured = await captureDiagnostic(root, {
        trigger: "manual",
        summary: job?.errorCode
          ? `Diagnostic snapshot for failed generation: ${job.message}`
          : "Manual Tourguide diagnostic snapshot.",
        ...(job?.errorCode ? { error: new Error(job.message) } : {}),
        codex: await new CodexExecRunner().status(),
      }, store);
      report = captured.report;
    }
    console.log(formatDiagnosticReport(report));
    console.error(`Diagnostic report: ${store.diagnosticPath()}`);
    return;
  }

  if (options.command === "status") {
    const store = new TourStore(root);
    console.log(JSON.stringify({
      inventory: await inspectRepositoryAt(root, options.ref),
      tour: await store.current(),
      generation: await store.generationJob(),
      preferences: await store.preferences(),
      codex: await new CodexExecRunner().status(),
    }, null, 2));
    return;
  }
  if (options.command === "doctor") {
    const codex = await new CodexExecRunner().status();
    const checks = await Promise.all([
      access(root).then(() => ({ name: "repository", ok: true })).catch(() => ({ name: "repository", ok: false })),
      Promise.resolve({ name: "node", ok: Number(process.versions.node.split(".")[0]) >= 22, detail: process.version }),
      Promise.all([
        inspectRepositoryAt(root, options.ref),
        execFileAsync("git", ["--version"], { encoding: "utf8" }),
      ]).then(([inventory, version]) => ({
        name: "git",
        ok: true,
        detail: `${version.stdout.trim()}; ${options.ref} ${inventory.head.slice(0, 8)}`,
      })).catch((error) => ({ name: "git", ok: false, detail: String(error) })),
      Promise.resolve({ name: "codex", ok: codex.status === "ready", detail: `${codex.version ?? "not found"}; ${codex.message}` }),
    ]);
    console.log(JSON.stringify(checks, null, 2));
    if (checks.some((check) => !check.ok)) process.exitCode = 1;
    return;
  }
  if (options.command === "clean") {
    const store = new TourStore(root);
    await store.cleanGenerated();
    console.log(`Cleaned generated Tourguide data in ${root}`);
    return;
  }

  const server = await startWebServer(root, 0, {
    ref: options.ref,
    ...(options.model ? { model: options.model } : {}),
  });
  console.log(`Tourguide is running at ${server.url}`);
  if (options.command === "open") await open(server.url);
  const close = async () => {
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

main().catch(async (error) => {
  const captured = diagnosticRoot
    ? await captureDiagnostic(diagnosticRoot, {
        trigger: "startup",
        summary: "Tourguide failed to start.",
        error,
      }).catch(() => undefined)
    : undefined;
  console.error(error instanceof Error ? error.message : error);
  if (captured) console.error(`Diagnostic report: ${captured.path}`);
  process.exitCode = 1;
});
