import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { buildStarterTour, inspectRepository } from "../packages/core/src/index.js";
import { buildRefreshDraft } from "../packages/server/src/mcp.js";

const exec = promisify(execFile);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("MCP refresh drafts", () => {
  it("preserves deleted evidence as stale and invalid", async () => {
    const root = await mkdtemp(join(tmpdir(), "tourguide-refresh-"));
    temporary.push(root);
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
    await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
    await writeFile(join(root, "README.md"), "# fixture\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const current = await buildStarterTour(await inspectRepository(root));
    const citedPage = current.pages.find((page) => page.evidence.some((evidence) => evidence.path === "README.md"))!;

    await exec("git", ["-C", root, "rm", "README.md"]);
    await exec("git", ["-C", root, "commit", "-m", "remove readme"]);
    const { snapshot, freshness } = await buildRefreshDraft(root, current, "HEAD");
    const refreshed = snapshot.pages.find((page) => page.id === citedPage.id)!;
    const evidence = refreshed.evidence.find((item) => item.path === "README.md")!;

    expect(freshness.stalePageIds).toContain(citedPage.id);
    expect(refreshed.status).toBe("stale");
    expect(evidence.validated).toBe(false);
    expect(evidence.contentHash).toBeUndefined();
    expect(evidence.revision).toBe(snapshot.anchor.commit);
  });
});
