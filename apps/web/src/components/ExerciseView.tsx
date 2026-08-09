import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { CheckCircle2, Code2, Copy, Download, GitBranch, Play, RotateCcw, XCircle } from "lucide-react";

import type { LabFile, LabSession, Page, VerificationResult } from "@tourguide/core";
import { api } from "../api";
import { editorLanguageForPath, errorMessage } from "../tour";

interface BrowserLabState {
  session?: LabSession;
  files: LabFile[];
  activePath?: string;
  content: string;
  patch: string;
}

const browserLabs = new Map<string, BrowserLabState>();

function ResultOutput({ verification }: { verification: VerificationResult | undefined }) {
  if (!verification) return null;
  const result = verification.result;

  const output = [
    result.stdout,
    result.stderr,
    result.patch ? `\nPatch:\n${result.patch}` : "",
    `\nExited ${result.exitCode ?? "by signal"} in ${result.durationMs}ms${result.timedOut ? " (timed out)" : ""}`,
    result.undeclaredWrites.length
      ? `\nIsolated undeclared writes: ${result.undeclaredWrites.join(", ")}`
      : "",
  ].join("");

  return <section className={`verification-result ${verification.status}`}>
    <header>{verification.status === "pass" ? <CheckCircle2 /> : <XCircle />}<div><strong>{verification.status}</strong><span>Expected: {verification.expected}</span><span>Observed: {verification.observed}</span></div></header>
    <details><summary>Raw command output</summary><pre className="run-output">{output}</pre></details>
  </section>;
}

export function ExerciseView({ page, onAttempt, onVerified }: { page: Page; onAttempt(): void; onVerified(): void }) {
  const exercise = page.exercise!;
  const cached = browserLabs.get(page.moduleId);
  const [session, setSession] = useState<LabSession | undefined>(cached?.session);
  const [files, setFiles] = useState<LabFile[]>(cached?.files ?? []);
  const [activePath, setActivePath] = useState<string | undefined>(cached?.activePath);
  const [content, setContent] = useState(cached?.content ?? "");
  const [verification, setVerification] = useState<VerificationResult>();
  const [patch, setPatch] = useState(cached?.patch ?? "");
  const [hintCount, setHintCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    browserLabs.set(page.moduleId, {
      ...(session ? { session } : {}),
      files,
      ...(activePath ? { activePath } : {}),
      content,
      patch,
    });
  }, [page.moduleId, session, files, activePath, content, patch]);

  useEffect(() => {
    if (!session || !activePath) return;
    const timer = window.setTimeout(() => {
      void api.saveExerciseFile(session.id, activePath, content).then(() => {
        setFiles((current) => current.map((file) => file.path === activePath ? { ...file, content } : file));
      }).catch((reason) => setError(errorMessage(reason)));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [session?.id, activePath, content]);

  const installFiles = (nextFiles: LabFile[]) => {
    setFiles(nextFiles);
    const selectedFile = nextFiles.find((file) => file.path === activePath) ?? nextFiles[0];
    setActivePath(selectedFile?.path);
    setContent(selectedFile?.content ?? "");
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
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!session || !activePath) return;

    await api.saveExerciseFile(session.id, activePath, content);
    setFiles((current) => current.map((file) => (
      file.path === activePath ? { ...file, content } : file
    )));
  };

  const run = async (action: "verify" | "format") => {
    if (!session) return;

    setBusy(true);
    setError(undefined);
    try {
      await save();
      const nextVerification = await api.runExercise(session.id, page.id, action);
      setVerification(nextVerification);
      if (action === "verify" && nextVerification.status === "pass") onVerified();
      if (action === "format") {
        installFiles((await api.exerciseFiles(session.id)).files);
      }
      onAttempt();
    } catch (reason) {
      setError(errorMessage(reason));
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
      setVerification(undefined);
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

  const keepOnBranch = async () => {
    if (!session) return;
    await save();
    setSession(await api.retainLab(session.id, page.id));
  };

  const openEditor = async () => {
    if (!session) return;
    try { await api.openEditor(session.id, activePath); } catch (reason) { setError(errorMessage(reason)); }
  };

  const copyPatch = async () => {
    await navigator.clipboard.writeText(patch);
  };

  const downloadPatch = () => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([patch], { type: "text/x-diff" }));
    link.download = `${page.id}.patch`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const selectFile = (file: LabFile) => {
    if (activePath) {
      setFiles((current) => current.map((item) => (
        item.path === activePath ? { ...item, content } : item
      )));
    }
    setActivePath(file.path);
    setContent(file.content);
  };

  return (
    <div className="workspace-card exercise-workspace">
      <div className="workspace-toolbar">
        <span><Code2 size={15} /> {exercise.mode} exercise</span>
        {session && (
          <div className="toolbar-actions">
            {exercise.formatRecipe && <button onClick={() => run("format")} disabled={busy}>Format</button>}
            {exercise.verificationRecipe && (
              <button className="primary small" onClick={() => run("verify")} disabled={busy}>
                <Play size={14} /> Verify
              </button>
            )}
            {session.status !== "retained" && <button onClick={reset} disabled={busy}><RotateCcw size={14} /> Reset</button>}
            {session.status !== "retained" && <button onClick={keepOnBranch} disabled={busy}><GitBranch size={14} /> Keep on branch</button>}
            <button onClick={openEditor} disabled={busy}><Code2 size={14} /> Open editor</button>
          </div>
        )}
      </div>
      <div className="exercise-task">
        <strong>Your task</strong>
        <p>{exercise.task}</p>
        {!session && (
          <button className="primary" onClick={begin} disabled={busy}>
            {busy ? "Preparing…" : "Start in an isolated workspace"}
          </button>
        )}
        {error && <p className="inline-error">{error}</p>}
      </div>
      {session && (
        <div className="exercise-body">
          {files.length > 0 && (
            <div className="exercise-editor">
              <div className="file-tabs">
                {files.map((file) => (
                  <button
                    key={file.path}
                    className={file.path === activePath ? "active" : ""}
                    onClick={() => selectFile(file)}
                  >
                    {file.path}
                  </button>
                ))}
              </div>
              <Editor
                height="360px"
                language={editorLanguageForPath(activePath ?? "")}
                value={content}
                onChange={(value) => setContent(value ?? "")}
                theme="vs-dark"
                onMount={(editor) => editor.getDomNode()?.querySelector("textarea")?.setAttribute("name", "exercise-editor")}
                options={{
                  ariaLabel: `Exercise file: ${activePath ?? "source"}`,
                  minimap: { enabled: false },
                  fontSize: 13,
                  padding: { top: 12 },
                }}
              />
            </div>
          )}
          <div className="exercise-actions">
            {hintCount < exercise.hints.length && (
              <button onClick={() => setHintCount((current) => current + 1)}>Reveal hint {hintCount + 1}</button>
            )}
            {files.length > 0 && <button onClick={exportPatch}>Export patch</button>}
            {session.retainedBranch && <span className="retained-branch"><GitBranch size={13} /> Kept on {session.retainedBranch}</span>}
          </div>
          {exercise.hints.slice(0, hintCount).map((hint, index) => (
            <p className="hint" key={hint}><strong>Hint {index + 1}:</strong> {hint}</p>
          ))}
          <ResultOutput verification={verification} />
          {patch && (
            <div className="patch-output">
              <strong>Patch to copy or save</strong>
              <div className="patch-actions"><button onClick={copyPatch}><Copy size={13} /> Copy</button><button onClick={downloadPatch}><Download size={13} /> Download</button></div>
              <pre>{patch || "No changes yet."}</pre>
            </div>
          )}
          {exercise.solutionExplanation && (
            <details className="solution">
              <summary>Compare with the solution explanation</summary>
              <p>{exercise.solutionExplanation}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
