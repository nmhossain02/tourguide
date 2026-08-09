import { useEffect, useState } from "react";
import {
  Bug,
  Check,
  CircleDot,
  Code2,
  Copy,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from "lucide-react";

import type { BootstrapPayload, DiagnosticsPayload } from "../api";
import type { GenerationDepth } from "@tourguide/core";
import { api } from "../api";
import { errorMessage, errorText, isGenerating, type GenerationInput } from "../tour";

const DEFAULT_GOAL = "Help me become productive in this codebase by teaching its setup, architecture, main execution path, tests, debugging workflow, and a representative safe change.";

export function GenerationPanel({
  data,
  onStart,
  onClose,
  onDiagnostics,
}: {
  data: BootstrapPayload;
  onStart(input: GenerationInput): Promise<void>;
  onClose?: () => void;
  onDiagnostics?: () => void;
}) {
  const [goal, setGoal] = useState(data.preferences.goals[0] ?? "");
  const [ref, setRef] = useState(data.inventory.ref);
  const [priorities, setPriorities] = useState(data.preferences.priorities);
  const [model, setModel] = useState(data.defaultModel ?? "");
  const [depth, setDepth] = useState<GenerationDepth>("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const togglePriority = (id: string) => {
    setPriorities((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await onStart({
        ref,
        goal: goal.trim() || DEFAULT_GOAL,
        priorities,
        depth,
        ...(model.trim() ? { model: model.trim() } : {}),
      });
      onClose?.();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const shortRef = ref.replace(/^refs\/(heads|tags|remotes)\//, "");

  return (
    <section className="generation-panel">
      {onClose && <button className="icon-button close" onClick={onClose}><X /></button>}
      <span className="eyebrow"><Sparkles size={14} /> Tourguide</span>
      <h1>Ready for a guided tour?</h1>
      <p>
        Start with a broad, hands-on tour of this codebase. Add a focus only if there is something specific you need
        to learn or change.
      </p>
      <label className="field focus-field">
        <span>Optional focus</span>
        <textarea
          name="tour-focus"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="For example: show me how an API request reaches persistence."
        />
      </label>
      <div className="depth-picker" aria-label="Generation depth">
        {([
          ["quick", "Quick", "Up to 2 modules / 7 Codex turns"],
          ["standard", "Standard", "Up to 4 modules / 11 Codex turns"],
          ["deep", "Deep", "Up to 8 modules / 19 Codex turns"],
        ] as const).map(([id, label, detail]) => <button key={id} className={depth === id ? "active" : ""} onClick={() => setDepth(id)}><strong>{label}</strong><small>{detail}</small></button>)}
      </div>
      <details className="advanced-setup">
        <summary>Advanced settings <small>{shortRef} · {model || "default model"}</small></summary>
        <div className="setup-row">
          <label className="field">
            <span>Git branch, tag, or commit</span>
            <input
              name="tour-ref"
              list="tourguide-refs"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              placeholder="HEAD, main, a tag, or a commit SHA"
            />
            <datalist id="tourguide-refs">
              <option value="HEAD">HEAD · {data.inventory.head.slice(0, 8)}</option>
              {data.refs.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name.replace(/^refs\/(heads|tags|remotes)\//, "")} · {item.commit.slice(0, 8)}
                </option>
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Codex model</span>
            <input
              name="codex-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Use Codex default"
            />
          </label>
        </div>
        {data.inventory.areas.length > 0 && (
          <div className="advanced-priorities">
            <span className="field-label">Prioritize areas</span>
            <div className="area-grid">
              {data.inventory.areas.map((area) => {
                const selected = priorities.includes(area.id);
                return (
                  <button
                    key={area.id}
                    className={`area-card ${selected ? "selected" : ""}`}
                    onClick={() => togglePriority(area.id)}
                  >
                    <span>{selected ? <Check size={16} /> : <Code2 size={16} />}{area.title}</span>
                    <small>{area.reason}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </details>
      <div className={`codex-check ${data.codex.status}`}>
        <CircleDot size={15} />
        <span><strong>Codex: {data.codex.status}</strong>{data.codex.message}</span>
      </div>
      <div className="generation-consent">
        <span><strong>Model</strong>{model || "Codex default"}</span>
        <span><strong>Commit</strong>{ref === data.inventory.ref ? data.inventory.head.slice(0, 12) : ref}</span>
        <span><strong>Indexed paths</strong>{data.inventory.trackedFileCount}</span>
        <span><strong>Maximum turns</strong>{depth === "quick" ? 7 : depth === "deep" ? 19 : 11}</span>
      </div>
      <p className="generation-runtime-note">Generation may execute repository or generated runtime probes in a disposable worktree with an isolated HOME and loopback-only declared networking. Only use this with repositories you trust.</p>
      {data.job?.errorCode && (
        <div className="diagnostic-notice">
          <p className="inline-error">Last generation: {data.job.message}</p>
          <button onClick={onDiagnostics}><Bug size={14} /> View diagnostics</button>
        </div>
      )}
      {error && <p className="inline-error">{error}</p>}
      <button
        className="primary generate-button"
        disabled={busy || data.codex.status !== "ready"}
        onClick={submit}
      >
        {busy ? "Starting…" : "Start tour"}
      </button>
    </section>
  );
}

export function DiagnosticsModal({ onClose }: { onClose(): void }) {
  const [payload, setPayload] = useState<DiagnosticsPayload>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.diagnostics().then(setPayload).catch((reason) => setError(errorText(reason)));
  }, []);

  const report = payload?.latest ?? payload?.current;
  const reportText = report ? JSON.stringify(report, null, 2) : "";
  const copyReport = async () => {
    await navigator.clipboard.writeText(reportText);
    setCopied(true);
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal diagnostics-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button close" onClick={onClose}><X /></button>
        <span className="eyebrow"><Bug size={13} /> Diagnostics</span>
        <h2>{report?.summary ?? "Loading diagnostic report…"}</h2>
        {payload && <p>Saved at <code>{payload.latestPath}</code>. Common credentials are redacted automatically.</p>}
        {error && <p className="inline-error">{error}</p>}
        {report && (
          <>
            <div className="diagnostic-actions">
              <button className="primary small" onClick={copyReport}>
                <Copy size={13} /> {copied ? "Copied" : "Copy report"}
              </button>
            </div>
            <pre>{reportText}</pre>
          </>
        )}
      </section>
    </div>
  );
}

export function GenerationBanner({ data, onCancel }: { data: BootstrapPayload; onCancel(): void }) {
  const job = data.job!;
  const completedModules = job.completedModuleIds.length;
  const totalModules = job.plannedModuleIds.length;

  return (
    <div className="generation-banner">
      <RefreshCw size={15} className="spin" />
      <span><strong>{job.phase}</strong> {job.message}</span>
      {totalModules > 0 && <span>{completedModules}/{totalModules} modules ready</span>}
      <span>{job.usage.inputTokens + job.usage.outputTokens} tokens · max {job.maximumCodexTurns} turns</span>
      <button onClick={onCancel}><Square size={11} /> Cancel</button>
    </div>
  );
}

export function FatalScreen({ error, onDiagnostics }: { error: string; onDiagnostics(): void }) {
  return (
    <main className="fatal">
      <h1>Tourguide could not start</h1>
      <pre>{error}</pre>
      <button onClick={onDiagnostics}><Bug size={14} /> View diagnostics</button>
      <small>You can also run <code>tourguide diagnostics</code> in the repository.</small>
    </main>
  );
}

export function LoadingScreen() {
  return <main className="loading"><Sparkles /> Inspecting the repository…</main>;
}

export function GenerationScreen({ data, onDiagnostics, onExplore }: { data: BootstrapPayload; onDiagnostics(): void; onExplore(): void }) {
  return (
    <main className="generation-screen">
      <Sparkles size={34} />
      <h1>Building your curriculum</h1>
      <p>{data.job?.message ?? "Waiting for the first complete module."}</p>
      <div className="generation-log">
        {data.events.slice(-8).map((event) => <span key={event.id}>{event.message}</span>)}
      </div>
      <button onClick={onExplore}><Code2 size={14} /> Explore indexed codebase</button>
      {isGenerating(data) && <button onClick={() => api.cancelGeneration()}>Cancel generation</button>}
      {data.job?.errorCode && <button onClick={onDiagnostics}><Bug size={14} /> View diagnostics</button>}
    </main>
  );
}
