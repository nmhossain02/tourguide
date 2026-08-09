import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import { TourStore, buildRepositoryKnowledge, buildStarterTour, inspectRepository } from "../packages/core/src/index.js";
import { startWebServer, type WebServerHandle } from "../packages/server/src/web-server.js";

const exec = promisify(execFile);
let root = "";
let server: WebServerHandle;

test.beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tourguide-e2e-"));
  await exec("git", ["init", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.email", "e2e@tourguide.local"]);
  await exec("git", ["-C", root, "config", "user.name", "Tourguide E2E"]);
  await mkdir(join(root, "src", "components"), { recursive: true });
  await mkdir(join(root, "db", "migrations"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Fixture workbench\n\nA small full-stack fixture.\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "tourguide-e2e-fixture" }));
  await writeFile(join(root, "src", "components", "Button.tsx"), "export interface ButtonProps { label: string }\nexport function Button(props: ButtonProps) { return <button>{props.label}</button> }\n");
  await writeFile(join(root, "src", "components", "Button.stories.tsx"), "import { Button } from './Button';\nexport default { component: Button };\nexport const Primary = { args: { label: 'Save' } };\n");
  await writeFile(join(root, "db", "migrations", "001.sql"), "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);\n");
  await writeFile(join(root, "openapi.yaml"), "openapi: 3.1.0\ninfo: { title: Fixture, version: 1.0.0 }\npaths:\n  /notes:\n    get:\n      operationId: listNotes\n      responses: { '200': { description: OK } }\n");
  await exec("git", ["-C", root, "add", "."]);
  await exec("git", ["-C", root, "commit", "-m", "fixture"]);
  server = await startWebServer(root);
});

test.afterAll(async () => {
  await server?.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("newcomer explores all catalogs and completes an isolated contribution loop", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(server.url);

  await expect(page.getByRole("button", { name: "Explore codebase" })).toBeVisible();
  await page.getByRole("button", { name: "Explore codebase" }).click();
  await expect(page.getByRole("dialog", { name: "Explore codebase" })).toBeVisible();
  for (const catalog of ["Data model", "API", "Components", "Compute", "Code map & docs"]) {
    await page.getByRole("button", { name: new RegExp(`^${catalog}`) }).click();
    await expect(page.locator(".knowledge-list > button").first()).toBeVisible();
  }
  await page.getByLabel("Search repository knowledge").fill("Fixture workbench");
  await expect(page.getByRole("button", { name: /README\.md/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileTabs = await page.locator(".catalog-tabs button").evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(mobileTabs.every((height) => height >= 44)).toBe(true);
  await page.getByRole("button", { name: "Close codebase explorer" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });

  const inventory = await inspectRepository(root);
  const tour = await buildStarterTour(inventory);
  const knowledge = await buildRepositoryKnowledge(inventory);
  const button = knowledge.catalogs.components.find((item) => item.title === "Button" && item.kind === "component")!;
  const componentPage = tour.pages[0]!;
  componentPage.knowledgeRefs = [{ catalog: button.catalog, itemId: button.id, contentHash: button.contentHash }];
  componentPage.interactions.push({
    type: "component",
    target: { catalog: button.catalog, itemId: button.id, contentHash: button.contentHash },
    inputs: [],
  });
  const exercise = tour.pages.find((candidate) => candidate.kind === "exercise")!;
  exercise.exercise = {
    ...exercise.exercise!, mode: "patch", allowedPaths: ["README.md", "package.json"],
    verificationRecipe: {
      id: "verify-readme", title: "Verify README", command: process.execPath,
      args: ["-e", "const f=require('fs');process.exit(f.readFileSync('README.md','utf8').includes('changed')&&f.readFileSync('package.json','utf8').includes('changed-package')?0:1)"],
      cwd: ".", lifecycle: "oneshot", timeoutMs: 3_000, env: {}, inputs: [],
      capabilities: { writes: [], network: "none", secrets: [], containers: false, externalSystems: [] },
      expected: "Both edited files contain their changes.",
    },
  };
  tour.labEnvironments = [{
    id: "e2e-lab",
    moduleId: componentPage.moduleId,
    title: "E2E lab",
    adapterIds: ["source", "command"],
    runtimeProfileIds: ["frontend:main"],
    runtimeProviders: [{
      schemaVersion: 1,
      id: "e2e-component-provider",
      cacheKey: "e2e-component-provider-v1",
      profileId: "frontend:main",
      domain: "component-library",
      title: "E2E generated component provider",
      source: "generated",
      capabilities: ["ui.render", "ui.observe"],
      dependencyFingerprint: "e2e-dependencies-v1",
      promptVersion: 1,
      generator: "e2e-fixture",
      generatedAt: new Date().toISOString(),
      files: [{
        path: "server.mjs",
        content: "import{createServer}from'node:http';createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});res.end(req.url==='/health'?'ok':'<button>Rendered component</button>')}).listen(Number(process.env.PORT),'127.0.0.1');\n",
      }],
      preparationRecipes: [],
      services: [{
        id: "e2e-component-preview",
        title: "E2E component preview",
        recipe: {
          id: "e2e-component-preview",
          title: "E2E component preview",
          command: process.execPath,
          args: ["server.mjs"],
          cwd: ".tourguide-runtime/e2e-component-provider",
          lifecycle: "service",
          timeoutMs: 30_000,
          env: {},
          inputs: [],
          capabilities: { writes: [], network: "loopback", secrets: [], containers: false, externalSystems: [] },
        },
        portEnv: "PORT",
        healthUrl: "http://127.0.0.1:{{port}}/health",
        healthTimeoutMs: 5_000,
      }],
      invocations: [{
        capability: "ui.render",
        kind: "service-url",
        serviceId: "e2e-component-preview",
        pathTemplate: "/preview?subject={{subject_symbol}}",
        result: "url",
      }],
      validation: {
        status: "pass",
        validator: "e2e-runtime-probe",
        validatedAt: new Date().toISOString(),
        inputFingerprint: "e2e-component-provider-v1",
        diagnostics: [],
      },
    }],
    editablePaths: ["README.md", "package.json"],
    preparationRecipes: [],
    services: [],
    dependencies: [],
    readiness: "ready",
  }];
  const store = new TourStore(root);
  await store.initialize();
  await store.saveKnowledge(knowledge);
  await store.publish(tour);
  await page.reload();

  await page.getByRole("button", { name: new RegExp(componentPage.title) }).click();
  await page.getByRole("button", { name: /^component$/i }).click();
  await page.getByRole("button", { name: "Run interaction" }).click();
  await expect(page.locator(".invocation-output")).toContainText("e2e-component-provider");
  await expect(page.frameLocator(".invocation-output iframe").getByRole("button", { name: "Rendered component" })).toBeVisible();

  await page.getByRole("button", { name: new RegExp(exercise.title) }).click();
  await page.getByRole("button", { name: "Start in an isolated workspace" }).click();
  const editor = page.locator(".exercise-editor .monaco-editor");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type("# changed");
  await page.getByRole("button", { name: "package.json", exact: true }).click();
  await editor.click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type('{"name":"changed-package"}');
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.locator(".verification-result.pass")).toContainText("Both edited files contain their changes");
  await expect.poll(async () => (await store.progress()).pages[exercise.id]).toMatchObject({ exerciseAttempted: true, verified: true });
  await page.getByRole("button", { name: "Export patch" }).click();
  await expect(page.locator(".patch-output")).toContainText("changed");
  await page.getByRole("button", { name: "Keep on branch" }).click();
  await expect(page.locator(".retained-branch")).toContainText("tourguide/");

  expect(await readFile(join(root, "README.md"), "utf8")).toContain("Fixture workbench");
  expect((await exec("git", ["-C", root, "branch", "--show-current"])).stdout.trim()).toBe("main");
  expect(consoleErrors).toEqual([]);
});
