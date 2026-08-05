import { useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { Terminal } from "@xterm/xterm";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { CircleDot, ExternalLink, FileCode2, Play, TerminalSquare } from "lucide-react";

import type { Interaction, ProjectInventory } from "@tourguide/core";
import { api } from "../api";
import { editorLanguageForPath } from "../tour";

type SourceInteraction = Extract<Interaction, { type: "source" }>;
type CommandInteraction = Extract<Interaction, { type: "command" }>;
type DataInteraction = Extract<Interaction, { type: "data" }>;
type TopologyInteraction = Extract<Interaction, { type: "topology" }>;

function SourceView({
  interaction,
  inventory,
}: {
  interaction: SourceInteraction;
  inventory: ProjectInventory;
}) {
  const [source, setSource] = useState<{ content: string; dirty: boolean; view: string }>();
  const [view, setView] = useState<"selected" | "working">("selected");
  const isDirty = inventory.dirtyFiles.includes(interaction.path);

  useEffect(() => {
    api.source(interaction.path, view).then(setSource).catch(console.error);
  }, [interaction.path, view]);

  return (
    <div className={`workspace-card source-workspace${isDirty ? " has-live-change" : ""}`}>
      <div className="workspace-toolbar">
        <span><FileCode2 size={15} /> {interaction.path}</span>
        {isDirty && (
          <div className="segmented">
            <button className={view === "selected" ? "active" : ""} onClick={() => setView("selected")}>
              Selected
            </button>
            <button className={view === "working" ? "active" : ""} onClick={() => setView("working")}>
              Local
            </button>
          </div>
        )}
      </div>
      {isDirty && (
        <div className="live-change">
          <CircleDot size={14} /> Local changes are visible on demand; the page remains anchored to its selected commit.
        </div>
      )}
      <Editor
        height="100%"
        language={editorLanguageForPath(interaction.path)}
        value={source?.content ?? "Loading source…"}
        theme="vs-dark"
        onMount={(editor) => editor.getDomNode()?.querySelector("textarea")?.setAttribute("name", "source-editor")}
        options={{
          ariaLabel: `Source code: ${interaction.path}`,
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbersMinChars: 3,
          padding: { top: 16 },
        }}
      />
    </div>
  );
}

function initialInputs(interaction: CommandInteraction) {
  return Object.fromEntries(interaction.recipe.inputs.map((input) => [input.id, input.default]));
}

function commandText(interaction: CommandInteraction) {
  return `${interaction.recipe.command} ${interaction.recipe.args.join(" ")}`.trim();
}

function requiresTrust(interaction: CommandInteraction) {
  const { capabilities } = interaction.recipe;
  return capabilities.network === "external"
    || capabilities.externalSystems.length > 0
    || capabilities.containers
    || capabilities.writes.some((path) => {
      const normalized = path.replaceAll("\\", "/");
      return !path
        || path.includes("\0")
        || normalized.startsWith("/")
        || /^[A-Za-z]:\//.test(normalized)
        || normalized.split("/").includes("..");
    });
}

function CommandView({
  pageId,
  interaction,
  onExperiment,
}: {
  pageId: string;
  interaction: CommandInteraction;
  onExperiment(): void;
}) {
  const terminalElement = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const [running, setRunning] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [inputs, setInputs] = useState<Record<string, string>>(() => initialInputs(interaction));
  const needsTrust = requiresTrust(interaction);
  const capabilities = interaction.recipe.capabilities;

  useEffect(() => {
    setInputs(initialInputs(interaction));
  }, [interaction.recipe.id]);

  useEffect(() => {
    if (!terminalElement.current) return;

    const instance = new Terminal({
      convertEol: true,
      fontSize: 13,
      theme: { background: "#0b0b11", foreground: "#e5e4ef", cursor: "#8e7dff" },
    });
    instance.open(terminalElement.current);
    terminalElement.current.querySelector("textarea")?.setAttribute("name", "terminal-input");
    instance.writeln(`$ ${commandText(interaction)}`);
    terminal.current = instance;

    return () => instance.dispose();
  }, [interaction.recipe]);

  const run = async () => {
    setRunning(true);
    terminal.current?.clear();
    terminal.current?.writeln(`\x1b[38;5;141m$ ${commandText(interaction)}\x1b[0m`);

    try {
      const result = await api.run(pageId, interaction.recipe.id, trusted, inputs);
      if (result.stdout) terminal.current?.write(result.stdout.replaceAll("\n", "\r\n"));
      if (result.stderr) terminal.current?.write(`\x1b[31m${result.stderr.replaceAll("\n", "\r\n")}\x1b[0m`);
      if (result.patch) {
        terminal.current?.write(`\r\n\x1b[36mCaptured patch:\r\n${result.patch.replaceAll("\n", "\r\n")}\x1b[0m`);
      }
      terminal.current?.writeln(`\r\n\x1b[2mExited ${result.exitCode ?? "by signal"} in ${result.durationMs}ms\x1b[0m`);
      onExperiment();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      terminal.current?.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
    } finally {
      setRunning(false);
    }
  };

  const updateInput = (id: string, value: string) => {
    setInputs((current) => ({ ...current, [id]: value }));
  };

  return (
    <div className={`workspace-card terminal-workspace${interaction.recipe.inputs.length ? " has-inputs" : ""}`}>
      <div className="workspace-toolbar">
        <span><TerminalSquare size={15} /> {interaction.recipe.title}</span>
        <div className="toolbar-actions">
          {needsTrust && (
            <label className="trust-toggle">
              <input
                type="checkbox"
                name={`trust-${interaction.recipe.id}`}
                checked={trusted}
                onChange={(event) => setTrusted(event.target.checked)}
              />
              trusted
            </label>
          )}
          <button className="primary small" disabled={running || (needsTrust && !trusted)} onClick={run}>
            <Play size={14} /> {running ? "Running…" : "Run"}
          </button>
        </div>
      </div>
      <div className="command-capabilities">
        <span>writes: {capabilities.writes.length ? capabilities.writes.join(", ") : "none"}</span>
        <span>network: {capabilities.network}</span>
        <span>timeout: {Math.round(interaction.recipe.timeoutMs / 1_000)}s</span>
      </div>
      {interaction.recipe.inputs.length > 0 && (
        <div className="recipe-inputs">
          {interaction.recipe.inputs.map((input) => (
            <label key={input.id}>
              <span>{input.label}</span>
              {input.type === "select" ? (
                <select value={inputs[input.id]} onChange={(event) => updateInput(input.id, event.target.value)}>
                  {input.options?.map((option) => <option key={option}>{option}</option>)}
                </select>
              ) : (
                <input
                  type={input.type}
                  value={inputs[input.id]}
                  onChange={(event) => updateInput(input.id, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      )}
      <div className="terminal" ref={terminalElement} />
    </div>
  );
}

function DataView({ interaction }: { interaction: DataInteraction }) {
  return (
    <div className="workspace-card data-workspace">
      <div className="workspace-toolbar"><span>{interaction.title}</span></div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>{interaction.columns.map((column) => <th key={column}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {interaction.rows.map((row, index) => (
              <tr key={index}>
                {interaction.columns.map((column) => <td key={column}>{String(row[column] ?? "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopologyView({ interaction }: { interaction: TopologyInteraction }) {
  const nodes = interaction.nodes.map((node, index): Node => ({
    id: node.id,
    data: { label: node.label },
    position: node.id === "repo"
      ? { x: 320, y: 20 }
      : { x: 60 + ((index - 1) % 3) * 260, y: 160 + Math.floor((index - 1) / 3) * 120 },
    className: `topology-node ${node.kind ?? ""}`,
  }));
  const edges = interaction.edges.map((edge): Edge => ({ ...edge, animated: true }));

  return (
    <div className="workspace-card topology-workspace">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} nodesConnectable={false}>
        <Background color="#312f42" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function InteractionView({
  pageId,
  interaction,
  inventory,
  onExperiment,
}: {
  pageId: string;
  interaction: Interaction;
  inventory: ProjectInventory;
  onExperiment(): void;
}) {
  switch (interaction.type) {
    case "source":
      return <SourceView interaction={interaction} inventory={inventory} />;
    case "command":
      return <CommandView pageId={pageId} interaction={interaction} onExperiment={onExperiment} />;
    case "data":
      return <DataView interaction={interaction} />;
    case "topology":
      return <TopologyView interaction={interaction} />;
    case "browser":
      return (
        <div className="workspace-card browser-workspace">
          <div className="workspace-toolbar">
            <span>{interaction.title ?? "Preview"}</span>
            <a href={interaction.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> open</a>
          </div>
          <iframe
            src={interaction.url}
            title={interaction.title ?? "Page preview"}
            sandbox="allow-forms allow-scripts allow-same-origin"
          />
        </div>
      );
  }
}
