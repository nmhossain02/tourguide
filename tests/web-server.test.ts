import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { TourStore, buildStarterTour, inspectRepository, type RunRecipe } from "../packages/core/src/index.js";
import { startWebServer, type WebServerHandle } from "../packages/server/src/web-server.js";

const exec = promisify(execFile);
const temporary: string[] = [];
const servers: WebServerHandle[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("web command execution", () => {
  it("resolves duplicate recipe IDs within the requested page", async () => {
    const root = await mkdtemp(join(tmpdir(), "tourguide-web-"));
    temporary.push(root);
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.email", "tests@tourguide.local"]);
    await exec("git", ["-C", root, "config", "user.name", "Tourguide Tests"]);
    await writeFile(join(root, "README.md"), "# fixture\n");
    await exec("git", ["-C", root, "add", "."]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const tour = await buildStarterTour(await inspectRepository(root));
    const commandPages = tour.pages.filter((page) => page.interactions.some((interaction) => interaction.type === "command"));
    expect(commandPages).toHaveLength(2);
    for (const [index, page] of commandPages.entries()) {
      page.interactions = page.interactions.map((interaction) => interaction.type === "command"
        ? {
            ...interaction,
            recipe: {
              ...interaction.recipe,
              id: "duplicate-recipe",
              command: process.execPath,
              args: ["-e", `console.log('page-${index + 1}')`],
            } satisfies RunRecipe,
          }
        : interaction);
    }
    const store = new TourStore(root);
    await store.initialize();
    await store.publish(tour);
    const server = await startWebServer(root);
    servers.push(server);
    const launched = new URL(server.url);
    const response = await fetch(new URL("/api/run", launched), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tourguide-token": launched.searchParams.get("token")!,
      },
      body: JSON.stringify({ pageId: commandPages[1]!.id, recipeId: "duplicate-recipe" }),
    });

    expect(response.status).toBe(200);
    expect((await response.json() as { stdout: string }).stdout.trim()).toBe("page-2");
  });
});
