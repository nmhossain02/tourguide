import { randomUUID } from "node:crypto";

import { contentHash, readHeadFile } from "./git.js";
import type { ProjectInventory, TourSnapshot } from "./schema.js";

export async function buildStarterTour(inventory: ProjectInventory): Promise<TourSnapshot> {
  const sourcePath = inventory.trackedFiles.includes("README.md")
    ? "README.md"
    : (inventory.manifests[0] ?? inventory.trackedFiles[0]);
  const sourceContent = sourcePath ? await readHeadFile(inventory.root, sourcePath).catch(() => "") : "";
  const sourceEvidence = sourcePath ? [{
    id: "repository-entrypoint",
    kind: "source" as const,
    label: sourcePath,
    claim: "This tracked file is a useful starting point for understanding the repository.",
    path: sourcePath,
    revision: inventory.head,
    contentHash: contentHash(sourceContent),
    validated: true,
  }] : [];

  const lessons = [
    {
      id: "orient-repository",
      objectiveId: "local-dev.repository-map",
      title: "Orient yourself in the repository",
      objective: "Recognize the repository root, current revision, and the files that define its development workflow.",
      estimatedMinutes: 4,
      narrative: `Tourguide found **${inventory.trackedFileCount} tracked files** at commit \`${inventory.head.slice(0, 8)}\`. Start with the repository's own documentation and manifests: they are the most reliable description of how its authors expect the project to be developed.`,
      status: "ready" as const,
      prerequisites: [],
      evidence: sourceEvidence,
      interactions: sourcePath ? [{ type: "source" as const, path: sourcePath, editable: false }] : [{
        type: "data" as const,
        title: "Repository inventory",
        columns: ["metric", "value"],
        rows: [{ metric: "Tracked files", value: inventory.trackedFileCount }],
      }],
      knowledgeCheck: {
        prompt: "Which file would you consult first before inventing a new setup command?",
        expectedObservation: "Prefer repository-owned documentation, manifests, and task definitions.",
      },
      references: [],
    },
    {
      id: "inspect-local-state",
      objectiveId: "local-dev.working-state",
      title: "Inspect the local working state",
      objective: "Distinguish committed behavior from local changes without letting temporary edits rewrite the tour.",
      estimatedMinutes: 3,
      narrative: `Canonical lessons describe committed **HEAD**. Tourguide currently sees **${inventory.dirtyFiles.length} local change${inventory.dirtyFiles.length === 1 ? "" : "s"}**; referenced changes appear as notifications and diffs, not rewritten explanations.`,
      status: "ready" as const,
      prerequisites: ["orient-repository"],
      evidence: [{
        id: "git-head",
        kind: "runtime" as const,
        label: "Git HEAD and status",
        claim: "The tour is anchored to the current committed revision.",
        revision: inventory.head,
        validated: true,
      }],
      interactions: [{
        type: "command" as const,
        recipe: {
          id: "git-status",
          title: "Show working tree status",
          command: "git",
          args: ["status", "--short", "--branch"],
          cwd: ".",
          lifecycle: "oneshot" as const,
          timeoutMs: 10_000,
          env: {},
          inputs: [],
          capabilities: { writes: [], network: "none" as const, secrets: [], containers: false, externalSystems: [] },
          expected: "The first line identifies the branch; later lines identify local changes.",
        },
      }],
      knowledgeCheck: {
        prompt: "Would an uncommitted edit automatically regenerate this lesson?",
        expectedObservation: "No. It receives a live-change notification while the canonical lesson stays anchored to HEAD.",
      },
      references: [],
    },
    {
      id: "map-development-surfaces",
      objectiveId: "local-dev.detected-surfaces",
      title: "Map the detected development surfaces",
      objective: "Identify which parts of the codebase deserve deeper learning tracks.",
      estimatedMinutes: 5,
      narrative: "A shallow inventory identifies likely learning areas before an agent performs deep analysis. Prioritize only the parts relevant to your role; Tourguide will keep the remaining areas as optional outlines.",
      status: "ready" as const,
      prerequisites: ["orient-repository"],
      evidence: inventory.manifests.slice(0, 6).map((path, index) => ({
        id: `manifest-${index}`,
        kind: "config" as const,
        label: path,
        claim: "This manifest contributes to development-workflow discovery.",
        path,
        revision: inventory.head,
        validated: true,
      })),
      interactions: [{
        type: "topology" as const,
        nodes: [
          { id: "repo", label: inventory.name, kind: "repository" },
          ...inventory.areas.map((area) => ({ id: area.id, label: area.title, kind: "area" })),
        ],
        edges: inventory.areas.map((area) => ({ id: `repo-${area.id}`, source: "repo", target: area.id })),
      }],
      knowledgeCheck: {
        prompt: "Which one or two areas are most relevant to what you need to do first?",
        expectedObservation: "Choose based on your upcoming work rather than trying to generate every possible track immediately.",
      },
      references: [],
    },
    {
      id: "explore-recent-history",
      objectiveId: "local-dev.history",
      title: "Change the window on recent history",
      objective: "Vary an input and observe how the repository story changes.",
      estimatedMinutes: 3,
      narrative: "Commit history often reveals the vocabulary and active seams of a codebase. Change the number of commits below and compare the story at different zoom levels.",
      status: "ready" as const,
      prerequisites: ["orient-repository"],
      evidence: [{ id: "git-history", kind: "history" as const, label: "Recent commits", claim: "Recent commit subjects are read directly from Git HEAD.", revision: inventory.head, validated: true }],
      interactions: [{
        type: "command" as const,
        recipe: {
          id: "git-recent-history", title: "Inspect recent commits", command: "git",
          args: ["log", "--oneline", "--decorate", "-n", "{{count}}"], cwd: ".", lifecycle: "oneshot" as const,
          timeoutMs: 10_000, env: {},
          inputs: [{ id: "count", label: "Commit count", type: "select" as const, default: "5", options: ["1", "3", "5", "10", "20"] }],
          capabilities: { writes: [], network: "none" as const, secrets: [], containers: false, externalSystems: [] },
          expected: "Larger windows reveal more historical context; smaller windows emphasize current work.",
        },
      }],
      knowledgeCheck: { prompt: "What changed when you widened the history window?", expectedObservation: "You should see additional commit subjects and may notice recurring areas or vocabulary." },
      references: [],
    },
  ];

  return {
    schemaVersion: 1,
    id: randomUUID(),
    projectName: inventory.name,
    repositoryRoot: inventory.root,
    head: inventory.head,
    branch: inventory.branch,
    generatedAt: new Date().toISOString(),
    generator: "tourguide-starter",
    status: "published",
    tracks: [{
      id: "local-development",
      title: "Local development",
      summary: "Start, inspect, test, and debug the application locally.",
      kind: "core",
      priority: 0,
      lessonIds: lessons.map((lesson) => lesson.id),
    }],
    lessons,
    dependencies: {
      "inspect-local-state": ["orient-repository"],
      "map-development-surfaces": ["orient-repository"],
      "explore-recent-history": ["orient-repository"],
    },
  };
}
