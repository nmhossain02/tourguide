import { useState } from "react";
import Editor from "@monaco-editor/react";
import { Code2, Play, RotateCcw } from "lucide-react";

import type { ExerciseFile, ExerciseSession, Page, RunResult } from "@tourguide/core";
import { api } from "../api";
import { editorLanguageForPath, errorMessage } from "../tour";

function ResultOutput({ result }: { result: RunResult | undefined }) {
  if (!result) return null;

  const output = [
    result.stdout,
    result.stderr,
    result.patch ? `\nPatch:\n${result.patch}` : "",
    `\nExited ${result.exitCode ?? "by signal"} in ${result.durationMs}ms${result.timedOut ? " (timed out)" : ""}`,
    result.undeclaredWrites.length
      ? `\nIsolated undeclared writes: ${result.undeclaredWrites.join(", ")}`
      : "",
  ].join("");

  return <pre className="run-output">{output}</pre>;
}

export function ExerciseView({ page, onAttempt }: { page: Page; onAttempt(): void }) {
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

  const installFiles = (nextFiles: ExerciseFile[]) => {
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
      setResult(await api.runExercise(session.id, page.id, action));
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

  const selectFile = (file: ExerciseFile) => {
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
            <button onClick={reset} disabled={busy}><RotateCcw size={14} /> Reset</button>
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
          </div>
          {exercise.hints.slice(0, hintCount).map((hint, index) => (
            <p className="hint" key={hint}><strong>Hint {index + 1}:</strong> {hint}</p>
          ))}
          <ResultOutput result={result} />
          {patch && (
            <div className="patch-output">
              <strong>Patch to copy or save</strong>
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
