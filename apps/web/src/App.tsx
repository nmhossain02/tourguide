import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Terminal } from "@xterm/xterm";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import {
  BookOpen, Bug, Check, ChevronDown, ChevronRight, CircleDot, Code2, Copy, ExternalLink,
  FileCode2, GitBranch, Menu, Play, RefreshCw, RotateCcw, Sparkles,
  Square, TerminalSquare, X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Group, Panel, Separator } from "react-resizable-panels";

import type {
  EvidenceRef, ExerciseFile, ExerciseSession, Interaction, Page, Preferences,
  Progress, ProjectInventory, RunResult, TourSnapshot,
} from "@tourguide/core";
import { api, type BootstrapPayload, type DiagnosticsPayload } from "./api";

function languageFor(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", go: "go", rs: "rust", json: "json", md: "markdown",
    yaml: "yaml", yml: "yaml", sql: "sql", toml: "toml",
  } as Record<string, string>)[extension ?? ""] ?? "plaintext";
}

function SourceView({ interaction, inventory }: {
  interaction: Extract<Interaction, { type: "source" }>;
  inventory: ProjectInventory;
}) {
  const [source, setSource] = useState<{ content: string; dirty: boolean; view: string }>();
  const [view, setView] = useState<"selected" | "working">("selected");
  useEffect(() => {
    api.source(interaction.path, view).then(setSource).catch(console.error);
  }, [interaction.path, view]);
  const isDirty = inventory.dirtyFiles.includes(interaction.path);
  return <div className="workspace-card source-workspace">
    <div className="workspace-toolbar">
      <span><FileCode2 size={15} /> {interaction.path}</span>
      {isDirty && <div className="segmented">
        <button className={view === "selected" ? "active" : ""} onClick={() => setView("selected")}>Selected</button>
        <button className={view === "working" ? "active" : ""} onClick={() => setView("working")}>Local</button>
      </div>}
    </div>
    {isDirty && <div className="live-change"><CircleDot size={14} /> Local changes are visible on demand; the page remains anchored to its selected commit.</div>}
    <Editor
      height="100%"
      language={languageFor(interaction.path)}
      value={source?.content ?? "Loading source…"}
      theme="vs-dark"
      onMount={(editor) => editor.getDomNode()?.querySelector("textarea")?.setAttribute("name", "source-editor")}
      options={{ ariaLabel: `Source code: ${interaction.path}`, readOnly: true, minimap: { enabled: false }, fontSize: 13, lineNumbersMinChars: 3, padding: { top: 16 } }}
    />
  </div>;
}

function ResultOutput({ result }: { result: RunResult | undefined }) {
  if (!result) return null;
  return <pre className="run-output">{[
    result.stdout,
    result.stderr,
    result.patch ? `\nPatch:\n${result.patch}` : "",
    `\nExited ${result.exitCode ?? "by signal"} in ${result.durationMs}ms${result.timedOut ? " (timed out)" : ""}`,
    result.undeclaredWrites.length ? `\nIsolated undeclared writes: ${result.undeclaredWrites.join(", ")}` : "",
  ].join("")}</pre>;
}

function CommandView({ pageId, interaction, onExperiment }: {
  pageId: string;
  interaction: Extract<Interaction, { type: "command" }>;
  onExperiment(): void;
}) {
  const terminalElement = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [running, setRunning] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(interaction.recipe.inputs.map((input) => [input.id, input.default])),
  );
  useEffect(() => {
    setInputs(Object.fromEntries(interaction.recipe.inputs.map((input) => [input.id, input.default])));
  }, [interaction.recipe.id]);
  useEffect(() => {
    if (!terminalElement.current) return;
    const instance = new Terminal({
      convertEol: true,
      fontSize: 13,
      theme: { background: "#0b0b11", foreground: "#e5e4ef", cursor: "#8e7dff" },
    });
    instance.open(terminalElement.current);
    instance.writeln(`$ ${interaction.recipe.command} ${interaction.recipe.args.join(" ")}`);
    terminal.current = instance;
    return () => instance.dispose();
  }, [interaction.recipe]);
  const run = async () => {
    setRunning(true);
    terminal.current?.clear();
    terminal.current?.writeln(`\x1b[38;5;141m$ ${interaction.recipe.command} ${interaction.recipe.args.join(" ")}\x1b[0m`);
    try {
      const result = await api.run(pageId, interaction.recipe.id, trusted, inputs);
      if (result.stdout) terminal.current?.write(result.stdout.replaceAll("\n", "\r\n"));
      if (result.stderr) terminal.current?.write(`\x1b[31m${result.stderr.replaceAll("\n", "\r\n")}\x1b[0m`);
      if (result.patch) terminal.current?.write(`\r\n\x1b[36mCaptured patch:\r\n${result.patch.replaceAll("\n", "\r\n")}\x1b[0m`);
      terminal.current?.writeln(`\r\n\x1b[2mExited ${result.exitCode ?? "by signal"} in ${result.durationMs}ms\x1b[0m`);
      onExperiment();
    } catch (error) {
      terminal.current?.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`);
    } finally {
      setRunning(false);
    }
  };
  const capabilities = interaction.recipe.capabilities;
  const needsTrust = capabilities.network === "external"
    || capabilities.externalSystems.length > 0
    || capabilities.containers
    || capabilities.writes.some((path) => {
      const normalized = path.replaceAll("\\", "/");
      return !path
        || path.includes("\0")
        || normalized.startsWith("/")
        || /^[A-Za-z]:\//.test(normalized)
        || normalized.split("/").some((part) => part === "..");
    });
  return <div className="workspace-card terminal-workspace">
    <div className="workspace-toolbar">
      <span><TerminalSquare size={15} /> {interaction.recipe.title}</span>
      <div className="toolbar-actions">
        {needsTrust && <label className="trust-toggle"><input type="checkbox" name={`trust-${interaction.recipe.id}`} checked={trusted} onChange={(event) => setTrusted(event.target.checked)} /> trusted</label>}
        <button className="primary small" disabled={running || (needsTrust && !trusted)} onClick={run}><Play size={14} /> {running ? "Running…" : "Run"}</button>
      </div>
    </div>
    <div className="command-capabilities">
      <span>writes: {capabilities.writes.length ? capabilities.writes.join(", ") : "none"}</span>
      <span>network: {capabilities.network}</span>
      <span>timeout: {Math.round(interaction.recipe.timeoutMs / 1000)}s</span>
    </div>
    {interaction.recipe.inputs.length > 0 && <div className="recipe-inputs">
      {interaction.recipe.inputs.map((input) => <label key={input.id}>
        <span>{input.label}</span>
        {input.type === "select"
          ? <select value={inputs[input.id]} onChange={(event) => setInputs({ ...inputs, [input.id]: event.target.value })}>{input.options?.map((option) => <option key={option}>{option}</option>)}</select>
          : <input type={input.type} value={inputs[input.id]} onChange={(event) => setInputs({ ...inputs, [input.id]: event.target.value })} />}
      </label>)}
    </div>}
    <div className="terminal" ref={terminalElement} />
  </div>;
}

function DataView({ interaction }: { interaction: Extract<Interaction, { type: "data" }> }) {
  return <div className="workspace-card data-workspace">
    <div className="workspace-toolbar"><span>{interaction.title}</span></div>
    <div className="table-scroll"><table>
      <thead><tr>{interaction.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>{interaction.rows.map((row, index) => <tr key={index}>{interaction.columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody>
    </table></div>
  </div>;
}

function TopologyView({ interaction }: { interaction: Extract<Interaction, { type: "topology" }> }) {
  const nodes = interaction.nodes.map((node, index): Node => ({
    id: node.id,
    data: { label: node.label },
    position: node.id === "repo"
      ? { x: 320, y: 20 }
      : { x: 60 + (index - 1) % 3 * 260, y: 160 + Math.floor((index - 1) / 3) * 120 },
    className: `topology-node ${node.kind ?? ""}`,
  }));
  const edges = interaction.edges.map((edge): Edge => ({ ...edge, animated: true }));
  return <div className="workspace-card topology-workspace">
    <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false}>
      <Background color="#312f42" gap={24} /><Controls showInteractive={false} />
    </ReactFlow>
  </div>;
}

function InteractionView({ pageId, interaction, inventory, onExperiment }: {
  pageId: string;
  interaction: Interaction;
  inventory: ProjectInventory;
  onExperiment(): void;
}) {
  if (interaction.type === "source") return <SourceView interaction={interaction} inventory={inventory} />;
  if (interaction.type === "command") return <CommandView pageId={pageId} interaction={interaction} onExperiment={onExperiment} />;
  if (interaction.type === "data") return <DataView interaction={interaction} />;
  if (interaction.type === "topology") return <TopologyView interaction={interaction} />;
  return <div className="workspace-card browser-workspace">
    <div className="workspace-toolbar"><span>{interaction.title ?? "Preview"}</span><a href={interaction.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> open</a></div>
    <iframe src={interaction.url} title={interaction.title ?? "Page preview"} sandbox="allow-forms allow-scripts allow-same-origin" />
  </div>;
}

function ExerciseView({ page, onAttempt }: { page: Page; onAttempt(): void }) {
  const exercise = page.exercise!;
  const [session, setSession] = useState<ExerciseSession>();
  const [files, setFiles] = useState<ExerciseFile[]>([]);
  const [activePath, setActivePath] = useState<string>();
  const [content, setContent] = useState("");
  const [result, setResult] = useState<RunResult>();
  const [patch, setPatch] = useState("");
  const [hintCount, setHintCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const installFiles = (next: ExerciseFile[]) => {
    setFiles(next);
    const selected = next.find((file) => file.path === activePath) ?? next[0];
    setActivePath(selected?.path);
    setContent(selected?.content ?? "");
  };
  const begin = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const created = await api.createExercise(page.id);
      setSession(created.session);
      installFiles(created.files);
      onAttempt();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (session && activePath) {
      await api.saveExerciseFile(session.id, activePath, content);
      setFiles((current) => current.map((file) => file.path === activePath ? { ...file, content } : file));
    }
  };
  const run = async (action: "verify" | "format") => {
    if (!session) return;
    setBusy(true);
    setError(undefined);
    try {
      await save();
      setResult(await api.runExercise(session.id, page.id, action));
      if (action === "format") installFiles((await api.exerciseFiles(session.id)).files);
      onAttempt();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const reset = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const value = await api.resetExercise(session.id);
      setSession(value.session);
      installFiles(value.files);
      setResult(undefined);
      setPatch("");
    } finally {
      setBusy(false);
    }
  };
  const exportPatch = async () => {
    if (!session) return;
    await save();
    setPatch((await api.exercisePatch(session.id)).patch);
  };

  return <div className="workspace-card exercise-workspace">
    <div className="workspace-toolbar">
      <span><Code2 size={15} /> {exercise.mode} exercise</span>
      {session && <div className="toolbar-actions">
        {exercise.formatRecipe && <button onClick={() => run("format")} disabled={busy}>Format</button>}
        {exercise.verificationRecipe && <button className="primary small" onClick={() => run("verify")} disabled={busy}><Play size={14} /> Verify</button>}
        <button onClick={reset} disabled={busy}><RotateCcw size={14} /> Reset</button>
      </div>}
    </div>
    <div className="exercise-task">
      <strong>Your task</strong><p>{exercise.task}</p>
      {!session && <button className="primary" onClick={begin} disabled={busy}>{busy ? "Preparing…" : "Start in an isolated workspace"}</button>}
      {error && <p className="inline-error">{error}</p>}
    </div>
    {session && <div className="exercise-body">
      {files.length > 0 && <div className="exercise-editor">
        <div className="file-tabs">{files.map((file) => <button key={file.path} className={file.path === activePath ? "active" : ""} onClick={() => {
          if (activePath) setFiles((current) => current.map((item) => item.path === activePath ? { ...item, content } : item));
          setActivePath(file.path);
          setContent(file.content);
        }}>{file.path}</button>)}</div>
        <Editor height="360px" language={languageFor(activePath ?? "")} value={content} onChange={(value) => setContent(value ?? "")} theme="vs-dark" onMount={(editor) => editor.getDomNode()?.querySelector("textarea")?.setAttribute("name", "exercise-editor")} options={{ ariaLabel: `Exercise file: ${activePath ?? "source"}`, minimap: { enabled: false }, fontSize: 13, padding: { top: 12 } }} />
      </div>}
      <div className="exercise-actions">
        {hintCount < exercise.hints.length && <button onClick={() => setHintCount(hintCount + 1)}>Reveal hint {hintCount + 1}</button>}
        {files.length > 0 && <button onClick={exportPatch}>Export patch</button>}
      </div>
      {exercise.hints.slice(0, hintCount).map((hint, index) => <p className="hint" key={hint}><strong>Hint {index + 1}:</strong> {hint}</p>)}
      <ResultOutput result={result} />
      {patch && <div className="patch-output"><strong>Patch to copy or save</strong><pre>{patch || "No changes yet."}</pre></div>}
      {exercise.solutionExplanation && <details className="solution"><summary>Compare with the solution explanation</summary><p>{exercise.solutionExplanation}</p></details>}
    </div>}
  </div>;
}

function EvidenceDrawer({ evidence, onClose }: { evidence: EvidenceRef; onClose(): void }) {
  return <aside className="evidence-drawer">
    <button className="icon-button close" onClick={onClose}><X /></button>
    <span className={`evidence-kind ${evidence.kind}`}>{evidence.kind}</span>
    <h2>{evidence.label}</h2><p>{evidence.claim}</p>
    <dl>
      {evidence.path && <><dt>Path</dt><dd>{evidence.path}{evidence.lineStart ? `:${evidence.lineStart}` : ""}</dd></>}
      {evidence.revision && <><dt>Revision</dt><dd>{evidence.revision.slice(0, 12)}</dd></>}
      {evidence.symbol && <><dt>Symbol</dt><dd>{evidence.symbol}</dd></>}
      {evidence.contentHash && <><dt>Content hash</dt><dd>{evidence.contentHash.slice(0, 16)}…</dd></>}
      <dt>Validation</dt><dd>{evidence.validated ? "Validated" : evidence.kind === "inference" ? "Explicit inference" : "Needs validation"}</dd>
    </dl>
  </aside>;
}

function GenerationPanel({ data, onStart, onClose, onDiagnostics }: {
  data: BootstrapPayload;
  onStart(input: { ref: string; goal: string; priorities: string[]; model?: string }): Promise<void>;
  onClose?: () => void;
  onDiagnostics?: () => void;
}) {
  const defaultGoal = "Help me become productive in this codebase by teaching its setup, architecture, main execution path, tests, debugging workflow, and a representative safe change.";
  const [goal, setGoal] = useState(data.preferences.goals[0] ?? "");
  const [ref, setRef] = useState(data.inventory.ref);
  const [priorities, setPriorities] = useState(data.preferences.priorities);
  const [model, setModel] = useState(data.defaultModel ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toggle = (id: string) => setPriorities((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onStart({ ref, goal: goal.trim() || defaultGoal, priorities, ...(model.trim() ? { model: model.trim() } : {}) });
      onClose?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return <section className="generation-panel">
    {onClose && <button className="icon-button close" onClick={onClose}><X /></button>}
    <span className="eyebrow"><Sparkles size={14} /> Tourguide</span>
    <h1>Ready for a guided tour?</h1>
    <p>Start with a broad, hands-on tour of this codebase. Add a focus only if there is something specific you need to learn or change.</p>
    <label className="field focus-field"><span>Optional focus</span><textarea value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="For example: show me how an API request reaches persistence." /></label>
    <details className="advanced-setup">
      <summary>Advanced settings <small>{ref.replace(/^refs\/(heads|tags|remotes)\//, "")} · {model || "default model"}</small></summary>
      <div className="setup-row">
        <label className="field"><span>Git branch, tag, or commit</span>
          <input list="tourguide-refs" value={ref} onChange={(event) => setRef(event.target.value)} placeholder="HEAD, main, a tag, or a commit SHA" />
          <datalist id="tourguide-refs">
            <option value="HEAD">HEAD · {data.inventory.head.slice(0, 8)}</option>
            {data.refs.map((item) => <option key={item.name} value={item.name}>{item.name.replace(/^refs\/(heads|tags|remotes)\//, "")} · {item.commit.slice(0, 8)}</option>)}
          </datalist>
        </label>
        <label className="field"><span>Codex model</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Use Codex default" /></label>
      </div>
      {data.inventory.areas.length > 0 && <div className="advanced-priorities"><span className="field-label">Prioritize areas</span><div className="area-grid">{data.inventory.areas.map((area) =>
        <button key={area.id} className={`area-card ${priorities.includes(area.id) ? "selected" : ""}`} onClick={() => toggle(area.id)}>
          <span>{priorities.includes(area.id) ? <Check size={16} /> : <Code2 size={16} />}{area.title}</span><small>{area.reason}</small>
        </button>)}</div></div>}
    </details>
    <div className={`codex-check ${data.codex.status}`}><CircleDot size={15} /><span><strong>Codex: {data.codex.status}</strong>{data.codex.message}</span></div>
    {data.job?.errorCode && <div className="diagnostic-notice">
      <p className="inline-error">Last generation: {data.job.message}</p>
      <button onClick={onDiagnostics}><Bug size={14} /> View diagnostics</button>
    </div>}
    {error && <p className="inline-error">{error}</p>}
    <button className="primary generate-button" disabled={busy || data.codex.status !== "ready"} onClick={submit}>{busy ? "Starting…" : "Start tour"}</button>
  </section>;
}

function DiagnosticsModal({ onClose }: { onClose(): void }) {
  const [payload, setPayload] = useState<DiagnosticsPayload>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api.diagnostics().then(setPayload).catch((reason) => setError(String(reason)));
  }, []);
  const report = payload?.latest ?? payload?.current;
  const text = report ? JSON.stringify(report, null, 2) : "";
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal diagnostics-modal" onMouseDown={(event) => event.stopPropagation()}>
    <button className="icon-button close" onClick={onClose}><X /></button>
    <span className="eyebrow"><Bug size={13} /> Diagnostics</span>
    <h2>{report?.summary ?? "Loading diagnostic report…"}</h2>
    {payload && <p>Saved at <code>{payload.latestPath}</code>. Common credentials are redacted automatically.</p>}
    {error && <p className="inline-error">{error}</p>}
    {report && <>
      <div className="diagnostic-actions"><button className="primary small" onClick={copy}><Copy size={13} /> {copied ? "Copied" : "Copy report"}</button></div>
      <pre>{text}</pre>
    </>}
  </section></div>;
}

function GenerationBanner({ data, onCancel }: { data: BootstrapPayload; onCancel(): void }) {
  const job = data.job!;
  const completed = job.completedModuleIds.length;
  const total = job.plannedModuleIds.length;
  return <div className="generation-banner">
    <RefreshCw size={15} className="spin" />
    <span><strong>{job.phase}</strong> {job.message}</span>
    {total > 0 && <span>{completed}/{total} modules ready</span>}
    <button onClick={onCancel}><Square size={11} /> Cancel</button>
  </div>;
}

function isGenerating(data?: BootstrapPayload) {
  const job = data?.job;
  return Boolean(job && !job.errorCode && !["complete", "cancelled", "failed"].includes(job.status));
}

export function App() {
  const [data, setData] = useState<BootstrapPayload>();
  const [pageId, setPageId] = useState<string>();
  const [evidence, setEvidence] = useState<EvidenceRef>();
  const [railOpen, setRailOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [interactionIndex, setInteractionIndex] = useState(0);
  const [error, setError] = useState<string>();
  const lastEvent = useRef(0);

  useEffect(() => {
    api.bootstrap().then((value) => {
      setData(value);
      lastEvent.current = value.events.at(-1)?.id ?? 0;
      setPageId(value.tour?.pages[0]?.id);
    }).catch((reason) => setError(String(reason)));
  }, []);

  useEffect(() => {
    if (!isGenerating(data)) return;
    const poll = async () => {
      try {
        const update = await api.generationEvents(lastEvent.current);
        if (update.events.length) lastEvent.current = update.events.at(-1)!.id;
        setData((current) => current ? {
          ...current,
          ...(update.job ? { job: update.job } : {}),
          ...(update.tour ? { tour: update.tour } : {}),
          events: [...current.events, ...update.events].slice(-200),
        } : current);
        if (update.tour) setPageId((current) => current && update.tour!.pages.some((page) => page.id === current) ? current : update.tour!.pages[0]?.id);
      } catch (reason) {
        console.error(reason);
      }
    };
    void poll();
    const timer = window.setInterval(poll, 1_000);
    return () => window.clearInterval(timer);
  }, [data?.job?.id, data?.job?.status, data?.job?.errorCode]);

  const tour = data?.tour;
  const orderedPages = useMemo(() => {
    if (!tour) return [];
    return tour.tracks.flatMap((track) => track.moduleIds.flatMap((moduleId) => {
      const module = tour.modules.find((candidate) => candidate.id === moduleId);
      return module?.pageIds.map((id) => tour.pages.find((page) => page.id === id)).filter((page): page is Page => Boolean(page)) ?? [];
    }));
  }, [tour]);
  const page = orderedPages.find((item) => item.id === pageId) ?? orderedPages[0];
  const pageIndex = page ? orderedPages.findIndex((item) => item.id === page.id) : -1;
  const module = page && tour?.modules.find((item) => item.id === page.moduleId);
  const track = module && tour?.tracks.find((item) => item.moduleIds.includes(module.id));

  const updateProgress = useCallback(async (id: string, patch: Partial<Progress["pages"][string]>) => {
    if (!data) return;
    const now = new Date().toISOString();
    const current = data.progress.pages[id] ?? {
      viewed: false, demonstrated: false, exerciseAttempted: false,
      completed: false, revisit: false, updatedAt: now,
    };
    const progress: Progress = {
      schemaVersion: 2,
      pages: { ...data.progress.pages, [id]: { ...current, ...patch, updatedAt: now } },
    };
    setData({ ...data, progress });
    await api.progress(progress);
  }, [data]);
  useEffect(() => {
    if (page && !data?.progress.pages[page.id]?.viewed) void updateProgress(page.id, { viewed: true });
  }, [page?.id, data?.progress.pages[page?.id ?? ""]?.viewed]);

  const selectPage = useCallback((id: string) => {
    setPageId(id);
    setInteractionIndex(0);
    setRailOpen(false);
  }, []);
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, .monaco-editor")) return;
      if (event.key === "ArrowLeft" && pageIndex > 0) selectPage(orderedPages[pageIndex - 1]!.id);
      if (event.key === "ArrowRight" && pageIndex >= 0 && pageIndex < orderedPages.length - 1) selectPage(orderedPages[pageIndex + 1]!.id);
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [orderedPages, pageIndex, selectPage]);

  const startGeneration = async (input: { ref: string; goal: string; priorities: string[]; model?: string }) => {
    const job = await api.startGeneration(input);
    lastEvent.current = 0;
    setData((current) => current ? {
      ...current,
      job,
      events: [],
      preferences: { ...current.preferences, goals: [input.goal], priorities: input.priorities },
    } : current);
  };

  if (error) return <><main className="fatal"><h1>Tourguide could not start</h1><pre>{error}</pre><button onClick={() => setDiagnosticsOpen(true)}><Bug size={14} /> View diagnostics</button><small>You can also run <code>tourguide diagnostics</code> in the repository.</small></main>{diagnosticsOpen && <DiagnosticsModal onClose={() => setDiagnosticsOpen(false)} />}</>;
  if (!data) return <main className="loading"><Sparkles /> Inspecting the repository…</main>;
  if (!tour && !isGenerating(data)) return <><main className="setup-screen"><GenerationPanel data={data} onStart={startGeneration} onDiagnostics={() => setDiagnosticsOpen(true)} /></main>{diagnosticsOpen && <DiagnosticsModal onClose={() => setDiagnosticsOpen(false)} />}</>;
  if (!tour || !page || !module || !track) {
    return <main className="generation-screen">
      <Sparkles size={34} /><h1>Building your curriculum</h1>
      <p>{data.job?.message ?? "Waiting for the first complete module."}</p>
      <div className="generation-log">{data.events.slice(-8).map((event) => <span key={event.id}>{event.message}</span>)}</div>
      {isGenerating(data) && <button onClick={() => api.cancelGeneration()}>Cancel generation</button>}
      {data.job?.errorCode && <button onClick={() => setDiagnosticsOpen(true)}><Bug size={14} /> View diagnostics</button>}
      {diagnosticsOpen && <DiagnosticsModal onClose={() => setDiagnosticsOpen(false)} />}
    </main>;
  }

  const selectedInteraction = page.interactions[interactionIndex] ?? page.interactions[0];
  const completedCount = Object.values(data.progress.pages).filter((state) => state.completed).length;
  const generating = isGenerating(data);
  return <div className={`app-shell ${generating ? "has-generation" : ""}`}>
    <header className="topbar">
      <div className="brand">
        <button className="icon-button mobile-menu" onClick={() => setRailOpen(!railOpen)}><Menu /></button>
        <div className="mark"><GitBranch /></div><div><strong>Tourguide</strong><span>{data.inventory.name}</span></div>
      </div>
      <div className="top-status">
        <span>{completedCount}/{orderedPages.length} completed</span>
        <button onClick={() => setDiagnosticsOpen(true)}><Bug size={15} /> Diagnostics</button>
        <button onClick={() => setGenerateOpen(true)}><Sparkles size={15} /> New tour</button>
      </div>
    </header>
    {generating && <GenerationBanner data={data} onCancel={() => { void api.cancelGeneration(); }} />}
    {data.freshness && !data.freshness.fresh && <div className="freshness-banner">
      <RotateCcw size={15} /><span>HEAD moved from {data.freshness.authoredHead.slice(0, 8)} to {data.freshness.currentHead.slice(0, 8)}.</span>
      <strong>{data.freshness.stalePageIds.length} page{data.freshness.stalePageIds.length === 1 ? "" : "s"} need review</strong>
    </div>}
    <div className="body">
      <nav className={`lesson-rail ${railOpen ? "open" : ""}`}>
        <div className="rail-summary">
          <span className="eyebrow">{tour.anchor.ref.replace(/^refs\/(heads|tags|remotes)\//, "")}</span>
          <h2>{tour.projectName}</h2><p>{tour.anchor.commit.slice(0, 8)} · {tour.status}</p>
          <div className="progress-track"><i style={{ width: `${orderedPages.length ? completedCount / orderedPages.length * 100 : 0}%` }} /></div>
        </div>
        {tour.tracks.map((trackItem) => <section className="track-group" key={trackItem.id}>
          <h3>{trackItem.title}</h3>
          {trackItem.moduleIds.map((moduleId) => {
            const moduleItem = tour.modules.find((candidate) => candidate.id === moduleId);
            if (!moduleItem) return null;
            return <div className="module-group" key={moduleId}>
              <h4><ChevronDown size={13} /> {moduleItem.title}<small>{moduleItem.status}</small></h4>
              {moduleItem.pageIds.map((id, index) => {
                const item = tour.pages.find((candidate) => candidate.id === id);
                if (!item) return null;
                const state = data.progress.pages[id];
                return <button key={id} className={`lesson-link ${id === page.id ? "active" : ""}`} onClick={() => selectPage(id)}>
                  <span className="lesson-number">{state?.completed ? <Check size={13} /> : index + 1}</span>
                  <span>{item.title}<small>{item.kind} · {item.estimatedMinutes} min</small></span><ChevronRight size={14} />
                </button>;
              })}
            </div>;
          })}
        </section>)}
      </nav>
      <main className="main"><Group orientation="horizontal">
        <Panel defaultSize="46%" minSize="30%"><article className="lesson-content">
          <div className="breadcrumb"><span>{track.title}</span><ChevronRight size={12} /><span>{module.title}</span><ChevronRight size={12} /><span>{page.kind}</span></div>
          <div className="lesson-meta"><span className="eyebrow">Page {pageIndex + 1} of {orderedPages.length}</span><span>{page.estimatedMinutes} min</span></div>
          <h1>{page.title}</h1><p className="objective">{page.objective}</p>
          <div className="narrative"><ReactMarkdown rehypePlugins={[rehypeSanitize]}>{page.narrative}</ReactMarkdown></div>
          {page.evidence.length > 0 && <div className="evidence-chips">{page.evidence.map((item) =>
            <button key={item.id} className={item.kind} onClick={() => setEvidence(item)}><CircleDot size={12} /> {item.label}</button>)}</div>}
          {page.knowledgeCheck && <section className="knowledge-check">
            <span><BookOpen size={15} /> Try to explain</span><h3>{page.knowledgeCheck.prompt}</h3>
            <details><summary>Compare your observation</summary><p>{page.knowledgeCheck.expectedObservation}</p></details>
          </section>}
          {page.references.length > 0 && <section className="references"><h3>Go deeper</h3>{page.references.map((reference) =>
            <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer">{reference.title}<ExternalLink size={13} /></a>)}</section>}
          <label className="complete-toggle"><input type="checkbox" name={`complete-${page.id}`} checked={data.progress.pages[page.id]?.completed ?? false} onChange={(event) => updateProgress(page.id, { completed: event.target.checked })} /> Mark this page complete</label>
          <div className="lesson-nav">
            <button disabled={pageIndex <= 0} onClick={() => selectPage(orderedPages[pageIndex - 1]!.id)}>Previous</button>
            <button className="primary" disabled={pageIndex >= orderedPages.length - 1} onClick={() => selectPage(orderedPages[pageIndex + 1]!.id)}>Next page <ChevronRight size={15} /></button>
          </div>
        </article></Panel>
        <Separator className="resize-handle" />
        <Panel defaultSize="54%" minSize="35%"><section className="workspace">
          <div className="workspace-heading"><span>{page.exercise ? "Experiment" : "Explore"}</span>
            {!page.exercise && <div className="interaction-tabs">{page.interactions.map((interaction, index) =>
              <button key={index} className={index === interactionIndex ? "active" : ""} onClick={() => setInteractionIndex(index)}>{interaction.type}</button>)}</div>}
          </div>
          {page.exercise
            ? <ExerciseView key={page.id} page={page} onAttempt={() => updateProgress(page.id, { exerciseAttempted: true })} />
            : selectedInteraction && <InteractionView pageId={page.id} interaction={selectedInteraction} inventory={data.inventory} onExperiment={() => updateProgress(page.id, { demonstrated: true })} />}
        </section></Panel>
      </Group></main>
    </div>
    {generateOpen && <div className="modal-backdrop" onMouseDown={() => setGenerateOpen(false)}><div className="modal generation-modal" onMouseDown={(event) => event.stopPropagation()}>
      <GenerationPanel data={data} onStart={startGeneration} onClose={() => setGenerateOpen(false)} onDiagnostics={() => setDiagnosticsOpen(true)} />
    </div></div>}
    {diagnosticsOpen && <DiagnosticsModal onClose={() => setDiagnosticsOpen(false)} />}
    {evidence && <><div className="drawer-backdrop" onClick={() => setEvidence(undefined)} /><EvidenceDrawer evidence={evidence} onClose={() => setEvidence(undefined)} /></>}
  </div>;
}
