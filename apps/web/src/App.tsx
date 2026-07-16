import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Terminal } from "@xterm/xterm";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { BookOpen, Check, ChevronRight, CircleDot, Code2, ExternalLink, FileCode2, GitBranch, Menu, Play, RotateCcw, Sparkles, TerminalSquare, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { Group, Panel, Separator } from "react-resizable-panels";

import type { EvidenceRef, Interaction, Lesson, Preferences, Progress, ProjectInventory, TourSnapshot } from "@tourguide/core";
import { api, type ProjectPayload } from "./api";

function languageFor(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", go: "go", rs: "rust", json: "json", md: "markdown", yaml: "yaml", yml: "yaml", sql: "sql", toml: "toml" } as Record<string, string>)[extension ?? ""] ?? "plaintext";
}

function SourceView({ interaction, inventory }: { interaction: Extract<Interaction, { type: "source" }>; inventory: ProjectInventory }) {
  const [source, setSource] = useState<{ content: string; dirty: boolean; view: string }>();
  const [view, setView] = useState<"head" | "working">("head");
  useEffect(() => { api.source(interaction.path, view).then(setSource).catch(console.error); }, [interaction.path, view]);
  const isDirty = inventory.dirtyFiles.includes(interaction.path);
  return <div className="workspace-card source-workspace">
    <div className="workspace-toolbar">
      <span><FileCode2 size={15} /> {interaction.path}</span>
      {isDirty && <div className="segmented"><button className={view === "head" ? "active" : ""} onClick={() => setView("head")}>HEAD</button><button className={view === "working" ? "active" : ""} onClick={() => setView("working")}>Local</button></div>}
    </div>
    {isDirty && <div className="live-change"><CircleDot size={14} /> This file has live local changes. The lesson still describes committed HEAD.</div>}
    <Editor height="100%" language={languageFor(interaction.path)} value={source?.content ?? "Loading source…"} theme="vs-dark" options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, lineNumbersMinChars: 3, padding: { top: 16 } }} />
  </div>;
}

function CommandView({ interaction, onExperiment }: { interaction: Extract<Interaction, { type: "command" }>; onExperiment(): void }) {
  const terminalElement = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [running, setRunning] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>(() => Object.fromEntries(interaction.recipe.inputs.map((input) => [input.id, input.default])));
  useEffect(() => setInputs(Object.fromEntries(interaction.recipe.inputs.map((input) => [input.id, input.default]))), [interaction.recipe.id]);
  useEffect(() => {
    if (!terminalElement.current) return;
    const instance = new Terminal({ convertEol: true, fontSize: 13, theme: { background: "#0b0b11", foreground: "#e5e4ef", cursor: "#8e7dff" } });
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
      const result = await api.run(interaction.recipe.id, trusted, inputs);
      if (result.stdout) terminal.current?.write(result.stdout.replaceAll("\n", "\r\n"));
      if (result.stderr) terminal.current?.write(`\x1b[31m${result.stderr.replaceAll("\n", "\r\n")}\x1b[0m`);
      if (result.patch) terminal.current?.write(`\r\n\x1b[36mChanges captured from isolated workspace:\r\n${result.patch.replaceAll("\n", "\r\n")}\x1b[0m`);
      if (result.undeclaredWrites.length) terminal.current?.write(`\r\n\x1b[33mUndeclared writes were isolated and discarded: ${result.undeclaredWrites.join(", ")}\x1b[0m`);
      terminal.current?.writeln(`\r\n\x1b[2mExited ${result.exitCode ?? "by signal"} in ${result.durationMs}ms${result.timedOut ? " (timed out)" : ""}\x1b[0m`);
      onExperiment();
    } catch (error) {
      terminal.current?.writeln(`\r\n\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`);
    } finally { setRunning(false); }
  };
  const capabilities = interaction.recipe.capabilities;
  const needsTrust = capabilities.network === "external" || capabilities.externalSystems.length > 0;
  return <div className="workspace-card terminal-workspace">
    <div className="workspace-toolbar"><span><TerminalSquare size={15} /> {interaction.recipe.title}</span><div className="toolbar-actions">{needsTrust && <label className="trust-toggle"><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} /> trusted</label>}<button className="primary small" disabled={running || (needsTrust && !trusted)} onClick={run}><Play size={14} /> {running ? "Running…" : "Run"}</button></div></div>
    <div className="command-capabilities"><span>writes: {capabilities.writes.length ? capabilities.writes.join(", ") : "none"}</span><span>network: {capabilities.network}</span><span>timeout: {Math.round(interaction.recipe.timeoutMs / 1000)}s</span></div>
    {interaction.recipe.inputs.length > 0 && <div className="recipe-inputs">{interaction.recipe.inputs.map((input) => <label key={input.id}><span>{input.label}</span>{input.type === "select" ? <select value={inputs[input.id]} onChange={(event) => setInputs({ ...inputs, [input.id]: event.target.value })}>{input.options?.map((option) => <option key={option}>{option}</option>)}</select> : <input type={input.type} value={inputs[input.id]} onChange={(event) => setInputs({ ...inputs, [input.id]: event.target.value })} />}</label>)}</div>}
    <div className="terminal" ref={terminalElement} />
  </div>;
}

function DataView({ interaction }: { interaction: Extract<Interaction, { type: "data" }> }) {
  return <div className="workspace-card data-workspace"><div className="workspace-toolbar"><span>{interaction.title}</span></div><div className="table-scroll"><table><thead><tr>{interaction.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{interaction.rows.map((row, index) => <tr key={index}>{interaction.columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div></div>;
}

function TopologyView({ interaction }: { interaction: Extract<Interaction, { type: "topology" }> }) {
  const nodes = interaction.nodes.map((node, index): Node => ({ id: node.id, data: { label: node.label }, position: node.id === "repo" ? { x: 320, y: 20 } : { x: 60 + (index - 1) % 3 * 260, y: 160 + Math.floor((index - 1) / 3) * 120 }, className: `topology-node ${node.kind ?? ""}` }));
  const edges = interaction.edges.map((edge): Edge => ({ ...edge, animated: true }));
  return <div className="workspace-card topology-workspace"><ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false}><Background color="#312f42" gap={24} /><Controls showInteractive={false} /></ReactFlow></div>;
}

function InteractionView({ interaction, inventory, onExperiment }: { interaction: Interaction; inventory: ProjectInventory; onExperiment(): void }) {
  if (interaction.type === "source") return <SourceView interaction={interaction} inventory={inventory} />;
  if (interaction.type === "command") return <CommandView interaction={interaction} onExperiment={onExperiment} />;
  if (interaction.type === "data") return <DataView interaction={interaction} />;
  if (interaction.type === "topology") return <TopologyView interaction={interaction} />;
  return <div className="workspace-card browser-workspace"><div className="workspace-toolbar"><span>{interaction.title ?? "Preview"}</span><a href={interaction.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> open</a></div><iframe src={interaction.url} title={interaction.title ?? "Lesson preview"} sandbox="allow-forms allow-scripts allow-same-origin" /></div>;
}

function PreferencesPanel({ project, onSave }: { project: ProjectPayload; onSave(value: Preferences): Promise<void> }) {
  const [priorities, setPriorities] = useState(project.preferences.priorities);
  const [goals, setGoals] = useState(project.preferences.goals);
  const [goal, setGoal] = useState("");
  const toggle = (id: string) => setPriorities((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <section className="preference-panel">
    <div><span className="eyebrow"><Sparkles size={14} /> learning priorities</span><h2>Where do you want to go next?</h2><p>Local development stays first. Rank the deeper areas relevant to your upcoming work.</p></div>
    <div className="area-grid">{project.inventory.areas.map((area) => <button key={area.id} className={`area-card ${priorities.includes(area.id) ? "selected" : ""}`} onClick={() => toggle(area.id)}><span>{priorities.includes(area.id) ? <Check size={16} /> : <Code2 size={16} />}{area.title}</span><small>{area.reason}</small></button>)}</div>
    {priorities.length > 0 && <div className="priority-ranking"><strong>Ranked focus</strong>{priorities.map((id, index) => { const area = project.inventory.areas.find((candidate) => candidate.id === id); const move = (offset: number) => { const next = [...priorities]; const target = index + offset; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target]!, next[index]!]; setPriorities(next); }; return <div key={id}><span>{index + 1}. {area?.title ?? id}</span><span><button disabled={index === 0} onClick={() => move(-1)}>↑</button><button disabled={index === priorities.length - 1} onClick={() => move(1)}>↓</button></span></div>; })}</div>}
    <div className="goals"><div className="goal-list">{goals.map((item) => <span key={item}>{item}<button aria-label={`Remove ${item}`} onClick={() => setGoals(goals.filter((existing) => existing !== item))}><X size={12} /></button></span>)}</div><div className="goal-entry"><input value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="e.g. prepare for payments on-call" onKeyDown={(event) => { if (event.key === "Enter" && goal.trim()) { setGoals([...goals, goal.trim()]); setGoal(""); } }} /><button onClick={() => { if (goal.trim()) { setGoals([...goals, goal.trim()]); setGoal(""); } }}>Add goal</button></div></div>
    <button className="primary" onClick={() => onSave({ ...project.preferences, priorities, goals })}>Save priorities</button>
  </section>;
}

function EvidenceDrawer({ evidence, onClose }: { evidence: EvidenceRef; onClose(): void }) {
  return <aside className="evidence-drawer"><button className="icon-button close" onClick={onClose}><X /></button><span className={`evidence-kind ${evidence.kind}`}>{evidence.kind}</span><h2>{evidence.label}</h2><p>{evidence.claim}</p><dl>{evidence.path && <><dt>Path</dt><dd>{evidence.path}</dd></>}{evidence.revision && <><dt>Revision</dt><dd>{evidence.revision.slice(0, 12)}</dd></>}{evidence.symbol && <><dt>Symbol</dt><dd>{evidence.symbol}</dd></>}{evidence.contentHash && <><dt>Content hash</dt><dd>{evidence.contentHash.slice(0, 16)}…</dd></>}<dt>Validation</dt><dd>{evidence.validated ? "Validated" : evidence.kind === "inference" ? "Explicit inference" : "Needs validation"}</dd></dl>{evidence.url && <a href={evidence.url} target="_blank" rel="noreferrer">Open reference <ExternalLink size={14} /></a>}</aside>;
}

export function App() {
  const [project, setProject] = useState<ProjectPayload>();
  const [tour, setTour] = useState<TourSnapshot>();
  const [lessonId, setLessonId] = useState<string>();
  const [evidence, setEvidence] = useState<EvidenceRef>();
  const [showPreferences, setShowPreferences] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [interactionIndex, setInteractionIndex] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => { Promise.all([api.project(), api.tour()]).then(([projectValue, tourValue]) => { setProject(projectValue); setTour(tourValue); setLessonId(tourValue.lessons[0]?.id); setShowPreferences(projectValue.preferences.priorities.length === 0 && projectValue.preferences.goals.length === 0); }).catch((reason) => setError(String(reason))); }, []);
  const lesson = tour?.lessons.find((item) => item.id === lessonId);
  const lessonIndex = tour?.lessons.findIndex((item) => item.id === lessonId) ?? 0;

  const updateProgress = useCallback(async (id: string, patch: { viewed?: boolean; experimented?: boolean; revisit?: boolean }) => {
    if (!project) return;
    const current = project.progress.lessons[id] ?? { viewed: false, experimented: false, revisit: false, updatedAt: new Date().toISOString() };
    const progress: Progress = { lessons: { ...project.progress.lessons, [id]: { ...current, ...patch, updatedAt: new Date().toISOString() } } };
    setProject({ ...project, progress });
    await api.progress(progress);
  }, [project]);

  useEffect(() => { if (lessonId) void updateProgress(lessonId, { viewed: true }); }, [lessonId]);
  const selectedInteraction = lesson?.interactions[interactionIndex] ?? lesson?.interactions[0];
  const completedCount = useMemo(() => Object.values(project?.progress.lessons ?? {}).filter((item) => item.viewed).length, [project]);
  if (error) return <main className="fatal"><h1>Tourguide could not start</h1><pre>{error}</pre></main>;
  if (!project || !tour || !lesson) return <main className="loading"><Sparkles /> Mapping the repository…</main>;

  const selectLesson = (id: string) => { setLessonId(id); setInteractionIndex(0); setRailOpen(false); };
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><button className="icon-button mobile-menu" onClick={() => setRailOpen(!railOpen)}><Menu /></button><div className="mark"><GitBranch /></div><div><strong>Tourguide</strong><span>{project.inventory.name}</span></div></div><div className="top-status"><span>{completedCount}/{tour.lessons.length} explored</span><button onClick={() => setShowPreferences(!showPreferences)}><Sparkles size={15} /> Priorities</button></div></header>
    {project.freshness && !project.freshness.fresh && <div className="freshness-banner"><RotateCcw size={15} /><span>Repository HEAD moved from {project.freshness.authoredHead.slice(0, 8)} to {project.freshness.currentHead.slice(0, 8)}.</span><strong>{project.freshness.staleLessonIds.length} lesson{project.freshness.staleLessonIds.length === 1 ? "" : "s"} need review</strong></div>}
    <div className="body">
      <nav className={`lesson-rail ${railOpen ? "open" : ""}`}><div className="rail-summary"><span className="eyebrow">{tour.branch}</span><h2>{tour.projectName}</h2><p>{project.inventory.trackedFileCount} tracked files · {tour.head.slice(0, 8)}</p><div className="progress-track"><i style={{ width: `${tour.lessons.length ? completedCount / tour.lessons.length * 100 : 0}%` }} /></div></div>{tour.tracks.map((track) => <section key={track.id}><h3>{track.title}</h3>{track.lessonIds.map((id, index) => { const item = tour.lessons.find((candidate) => candidate.id === id); if (!item) return null; const state = project.progress.lessons[id]; return <button key={id} className={`lesson-link ${id === lesson.id ? "active" : ""}`} onClick={() => selectLesson(id)}><span className="lesson-number">{state?.experimented ? <Check size={13} /> : index + 1}</span><span>{item.title}<small>{item.estimatedMinutes} min · {item.status}</small></span><ChevronRight size={14} /></button>; })}</section>)}</nav>
      <main className="main"><Group orientation="horizontal"><Panel defaultSize="46%" minSize="30%"><article className="lesson-content"><div className="lesson-meta"><span className="eyebrow">Lesson {lessonIndex + 1} of {tour.lessons.length}</span><span>{lesson.estimatedMinutes} min</span></div><h1>{lesson.title}</h1><p className="objective">{lesson.objective}</p><div className="narrative"><ReactMarkdown rehypePlugins={[rehypeSanitize]}>{lesson.narrative}</ReactMarkdown></div>{lesson.evidence.length > 0 && <div className="evidence-chips">{lesson.evidence.map((item) => <button key={item.id} className={item.kind} onClick={() => setEvidence(item)}><CircleDot size={12} /> {item.label}</button>)}</div>}{lesson.knowledgeCheck && <section className="knowledge-check"><span><BookOpen size={15} /> Try to explain</span><h3>{lesson.knowledgeCheck.prompt}</h3><details><summary>Compare your observation</summary><p>{lesson.knowledgeCheck.expectedObservation}</p></details></section>}{lesson.references.length > 0 && <section className="references"><h3>Go deeper</h3>{lesson.references.map((reference) => <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer">{reference.title}<ExternalLink size={13} /></a>)}</section>}<div className="lesson-nav"><button disabled={lessonIndex <= 0} onClick={() => selectLesson(tour.lessons[lessonIndex - 1]!.id)}>Previous</button><button className="primary" disabled={lessonIndex >= tour.lessons.length - 1} onClick={() => selectLesson(tour.lessons[lessonIndex + 1]!.id)}>Next lesson <ChevronRight size={15} /></button></div></article></Panel><Separator className="resize-handle" /><Panel defaultSize="54%" minSize="35%"><section className="workspace"><div className="workspace-heading"><span>Explore</span><div className="interaction-tabs">{lesson.interactions.map((interaction, index) => <button key={index} className={index === interactionIndex ? "active" : ""} onClick={() => setInteractionIndex(index)}>{interaction.type}</button>)}</div></div>{selectedInteraction && <InteractionView interaction={selectedInteraction} inventory={project.inventory} onExperiment={() => updateProgress(lesson.id, { experimented: true })} />}</section></Panel></Group></main>
    </div>
    {showPreferences && <div className="modal-backdrop" onMouseDown={() => setShowPreferences(false)}><div className="modal" onMouseDown={(event) => event.stopPropagation()}><button className="icon-button close" onClick={() => setShowPreferences(false)}><X /></button><PreferencesPanel project={project} onSave={async (value) => { await api.preferences(value); setProject({ ...project, preferences: value }); setShowPreferences(false); }} /></div></div>}
    {evidence && <><div className="drawer-backdrop" onClick={() => setEvidence(undefined)} /> <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(undefined)} /></>}
  </div>;
}
