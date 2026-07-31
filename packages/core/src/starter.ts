import { randomUUID } from "node:crypto";

import { contentHash, readRevisionFile } from "./git.js";
import type { EvidenceRef, Page, ProjectInventory, TourSnapshot } from "./schema.js";

/**
 * Build a deterministic, repository-grounded tour for tests and offline
 * recovery. Normal product generation is performed by the Codex adapter.
 */
export async function buildStarterTour(inventory: ProjectInventory): Promise<TourSnapshot> {
  const sourcePath = inventory.trackedFiles.includes("README.md")
    ? "README.md"
    : (inventory.manifests[0] ?? inventory.trackedFiles[0]);
  const sourceContent = sourcePath
    ? await readRevisionFile(inventory.root, inventory.head, sourcePath).catch(() => "")
    : "";
  const sourceEvidence: EvidenceRef[] = sourcePath ? [{
    id: "repository-entrypoint",
    kind: "source",
    label: sourcePath,
    claim: "This tracked file is a useful starting point for understanding the repository.",
    path: sourcePath,
    revision: inventory.head,
    contentHash: contentHash(sourceContent),
    validated: true,
  }] : [];
  const moduleId = "repository-foundations";
  const commandCapabilities = {
    writes: [],
    network: "none" as const,
    secrets: [],
    containers: false,
    externalSystems: [],
  };

  const pages: Page[] = [
    {
      id: "orient-repository",
      moduleId,
      kind: "orientation",
      title: "Orient yourself in the repository",
      objective: "Recognize the selected revision and the files that define the development workflow.",
      estimatedMinutes: 3,
      narrative: `Tourguide found **${inventory.trackedFileCount} tracked files** at commit \`${inventory.head.slice(0, 8)}\`. Start with repository-owned documentation and manifests: they are the best evidence of how the authors expect the project to be developed.`,
      status: "ready",
      prerequisites: [],
      evidence: sourceEvidence,
      interactions: sourcePath
        ? [{ type: "source", path: sourcePath, editable: false }]
        : [{ type: "data", title: "Repository inventory", columns: ["metric", "value"], rows: [{ metric: "Tracked files", value: inventory.trackedFileCount }] }],
      knowledgeCheck: {
        prompt: "Which evidence should you consult before inventing a setup command?",
        expectedObservation: "Prefer repository-owned documentation, manifests, and task definitions.",
      },
      references: [],
    },
    {
      id: "understand-revision-anchor",
      moduleId,
      kind: "concept",
      title: "Separate the tour from your working tree",
      objective: "Explain why pages describe a selected commit rather than uncommitted files.",
      estimatedMinutes: 3,
      narrative: `This tour is anchored to \`${inventory.ref}\` at \`${inventory.head.slice(0, 8)}\`. Your working tree currently has **${inventory.dirtyFiles.length} local change${inventory.dirtyFiles.length === 1 ? "" : "s"}**. Those changes can be reported as freshness information, but they do not silently rewrite canonical explanations.`,
      status: "ready",
      prerequisites: ["orient-repository"],
      evidence: [{ id: "selected-revision", kind: "runtime", label: "Selected Git revision", claim: "The tour is anchored to an immutable commit.", revision: inventory.head, validated: true }],
      interactions: [{
        type: "data",
        title: "Two views of the repository",
        columns: ["view", "purpose"],
        rows: [
          { view: "Selected commit", purpose: "Stable lesson evidence and exercises" },
          { view: "Working tree", purpose: "Freshness notices and ongoing work" },
        ],
      }, ...(sourcePath ? [{ type: "source" as const, path: sourcePath, editable: false }] : [])],
      knowledgeCheck: {
        prompt: "Would an uncommitted edit automatically regenerate this page?",
        expectedObservation: "No. The page remains anchored to the selected commit.",
      },
      references: [],
    },
    {
      id: "map-development-surfaces",
      moduleId,
      kind: "walkthrough",
      title: "Map the development surfaces",
      objective: "Identify which parts of the codebase deserve deeper learning tracks.",
      estimatedMinutes: 4,
      narrative: "A shallow inventory reveals likely learning areas before deep analysis. Use this map to form a question about the codebase, then follow only the surfaces that help answer it.",
      status: "ready",
      prerequisites: ["orient-repository"],
      evidence: sourceEvidence,
      interactions: [{
        type: "topology",
        nodes: [
          { id: "repo", label: inventory.name, kind: "repository" },
          ...inventory.areas.map((area) => ({ id: area.id, label: area.title, kind: "area" })),
        ],
        edges: inventory.areas.map((area) => ({ id: `repo-${area.id}`, source: "repo", target: area.id })),
      }, ...(sourcePath ? [{ type: "source" as const, path: sourcePath, editable: false }] : [])],
      knowledgeCheck: {
        prompt: "Which surface is most relevant to the work you need to do first?",
        expectedObservation: "Choose based on an upcoming task instead of trying to learn every directory at once.",
      },
      references: [],
    },
    {
      id: "explore-recent-history",
      moduleId,
      kind: "demo",
      title: "Change the window on recent history",
      objective: "Vary an input and observe how the repository story changes.",
      estimatedMinutes: 3,
      narrative: "Commit history exposes the vocabulary and active seams of a codebase. Change the number of commits and compare the story at different zoom levels.",
      status: "ready",
      prerequisites: ["orient-repository"],
      evidence: [{ id: "git-history", kind: "history", label: "Recent commits", claim: "Commit subjects are read from the selected revision.", revision: inventory.head, validated: true }],
      interactions: [{
        type: "command",
        recipe: {
          id: "git-recent-history",
          title: "Inspect recent commits",
          command: "git",
          args: ["log", "--oneline", "--decorate", "-n", "{{count}}"],
          cwd: ".",
          lifecycle: "oneshot",
          timeoutMs: 10_000,
          env: {},
          inputs: [{ id: "count", label: "Commit count", type: "select", default: "5", options: ["1", "3", "5", "10", "20"] }],
          capabilities: commandCapabilities,
          expected: "Larger windows reveal more historical context; smaller windows emphasize current work.",
        },
      }],
      knowledgeCheck: {
        prompt: "What changed when you widened the history window?",
        expectedObservation: "Additional commit subjects reveal recurring areas or vocabulary.",
      },
      references: [],
    },
    {
      id: "diagnose-local-state",
      moduleId,
      kind: "exercise",
      title: "Diagnose the local state",
      objective: "Read Git status and distinguish the selected commit from local changes.",
      estimatedMinutes: 4,
      narrative: "Now inspect the working state yourself. Before running the command, predict which line identifies the branch and where local modifications will appear.",
      status: "ready",
      prerequisites: ["understand-revision-anchor"],
      evidence: [{ id: "git-status-evidence", kind: "runtime", label: "Git status", claim: "Git reports branch and working-tree state independently.", revision: inventory.head, validated: true }],
      interactions: [{
        type: "command",
        recipe: {
          id: "git-status",
          title: "Show working tree status",
          command: "git",
          args: ["status", "--short", "--branch"],
          cwd: ".",
          lifecycle: "oneshot",
          timeoutMs: 10_000,
          env: {},
          inputs: [],
          capabilities: commandCapabilities,
          expected: "The first line identifies the checked-out state; later lines identify changes inside the isolated exercise workspace.",
        },
      }],
      exercise: {
        mode: "diagnose",
        task: "Run the status recipe and explain how the branch/revision line differs from file-change lines.",
        allowedPaths: [],
        hints: ["Look at the two-character status column before each changed path."],
        verificationRecipe: {
          id: "verify-git-status",
          title: "Verify repository state",
          command: "git",
          args: ["status", "--short", "--branch"],
          cwd: ".",
          lifecycle: "oneshot",
          timeoutMs: 10_000,
          env: {},
          inputs: [],
          capabilities: commandCapabilities,
          expected: "Git reports a detached exercise worktree and any changes made inside it.",
        },
        expectedObservation: "The header describes the checked-out revision; file rows describe workspace changes.",
        reset: "fresh-worktree",
      },
      references: [],
    },
    {
      id: "choose-your-next-track",
      moduleId,
      kind: "recap",
      title: "Choose the next question",
      objective: "Turn repository orientation into a concrete learning goal.",
      estimatedMinutes: 2,
      narrative: "You now have a stable revision, a surface map, and a way to inspect history and local state. A useful next track starts with a task-shaped question: where a request enters, how data moves, how behavior is tested, or how a change reaches production.",
      status: "ready",
      prerequisites: ["map-development-surfaces", "explore-recent-history", "diagnose-local-state"],
      evidence: sourceEvidence,
      interactions: [{
        type: "data",
        title: "Question starters",
        columns: ["goal", "question"],
        rows: [
          { goal: "Change behavior", question: "Where does the relevant request enter and what calls it next?" },
          { goal: "Debug", question: "Which tests and logs expose this path?" },
          { goal: "Ship", question: "Which build and deployment surfaces own the change?" },
        ],
      }],
      knowledgeCheck: {
        prompt: "What is one task-shaped question you want the generated tour to answer?",
        expectedObservation: "The question should connect a concrete goal to code, runtime behavior, or delivery.",
      },
      references: [],
    },
  ];

  return {
    schemaVersion: 2,
    id: randomUUID(),
    projectName: inventory.name,
    repositoryRoot: inventory.root,
    anchor: { ref: inventory.ref, commit: inventory.head },
    generatedAt: new Date().toISOString(),
    generator: "tourguide-starter",
    promptVersion: 2,
    status: "published",
    tracks: [{
      id: "core",
      title: "Repository foundations",
      summary: "Orient yourself, inspect the repository, and choose a useful next question.",
      kind: "core",
      priority: 0,
      moduleIds: [moduleId],
    }],
    modules: [{
      id: moduleId,
      title: "Repository foundations",
      outcome: "Navigate the repository at a stable revision and frame a useful next learning goal.",
      relevance: "Every deeper codebase tour depends on a shared map and stable evidence.",
      estimatedMinutes: pages.reduce((total, page) => total + page.estimatedMinutes, 0),
      prerequisites: [],
      pageIds: pages.map((page) => page.id),
      surfaces: [sourcePath, ...inventory.manifests].filter((path): path is string => Boolean(path)).slice(0, 8),
      gaps: [],
      status: "ready",
    }],
    pages,
    coverage: [
      { capability: "orientation", status: "covered", moduleIds: [moduleId] },
      { capability: "setup", status: "omitted", moduleIds: [], reason: "The deterministic starter does not infer setup commands." },
      { capability: "run", status: "omitted", moduleIds: [], reason: "The deterministic starter does not execute the application." },
      { capability: "architecture", status: "omitted", moduleIds: [], reason: "A goal-driven generated track is needed for architecture depth." },
      { capability: "data and state", status: "not-applicable", moduleIds: [], reason: "No data architecture is inferred by the deterministic starter." },
      { capability: "test", status: "omitted", moduleIds: [], reason: "The deterministic starter does not infer a representative test." },
      { capability: "debug", status: "covered", moduleIds: [moduleId] },
      { capability: "change workflow", status: "omitted", moduleIds: [], reason: "The deterministic starter does not author code changes." },
      { capability: "delivery and operations", status: "omitted", moduleIds: [], reason: "The deterministic starter does not infer delivery behavior." },
    ],
    dependencies: Object.fromEntries(pages.map((page) => [page.id, page.prerequisites])),
  };
}
