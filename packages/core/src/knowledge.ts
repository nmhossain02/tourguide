import { createHash } from "node:crypto";
import { extname, posix } from "node:path";

import { parse as parseYaml } from "yaml";

import { contentHash, readRevisionFile } from "./git.js";
import {
  RepositoryKnowledgeSnapshotSchema,
  type ApiItem,
  type CodeDocItem,
  type ComponentItem,
  type DataModelItem,
  type EvidenceRef,
  type KnowledgeCatalog,
  type KnowledgeItem,
  type KnowledgeRelationship,
  type ProjectInventory,
  type RepositoryFileRecord,
  type RepositoryKnowledgeSnapshot,
  type TourSnapshot,
} from "./schema.js";

export const KNOWLEDGE_ANALYZER_VERSION = "1";
const MAX_INDEXED_BYTES = 512 * 1024;

export interface KnowledgeAdapterContext {
  inventory: ProjectInventory;
  files: ReadonlyMap<string, string>;
  records: readonly RepositoryFileRecord[];
  itemId(catalog: KnowledgeCatalog, path: string, symbol?: string): string;
  evidence(path: string, claim: string, symbol?: string): EvidenceRef[];
}

export interface KnowledgeAdapterOutput {
  items: KnowledgeItem[];
  relationships?: KnowledgeRelationship[];
}

export interface KnowledgeAdapter {
  readonly id: string;
  readonly version: string;
  analyze(context: KnowledgeAdapterContext): KnowledgeAdapterOutput | Promise<KnowledgeAdapterOutput>;
}

export class KnowledgeAdapterRegistry {
  readonly #adapters = new Map<string, KnowledgeAdapter>();

  register(adapter: KnowledgeAdapter): this {
    if (this.#adapters.has(adapter.id)) throw new Error(`Knowledge adapter already registered: ${adapter.id}`);
    this.#adapters.set(adapter.id, adapter);
    return this;
  }

  list(): KnowledgeAdapter[] {
    return [...this.#adapters.values()];
  }

  async analyze(context: KnowledgeAdapterContext): Promise<KnowledgeAdapterOutput> {
    const outputs = await Promise.all(this.list().map((adapter) => adapter.analyze(context)));
    return {
      items: outputs.flatMap((output) => output.items),
      relationships: outputs.flatMap((output) => output.relationships ?? []),
    };
  }
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function itemId(catalog: KnowledgeCatalog, path: string, symbol = ""): string {
  const readable = (symbol || posix.basename(path, extname(path)))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36) || "item";
  return `${catalog}:${readable}:${shortHash(`${path}#${symbol}`)}`;
}

export function knowledgeSnapshotId(commit: string, analyzerVersion = KNOWLEDGE_ANALYZER_VERSION): string {
  return `knowledge:${commit}:${analyzerVersion}`;
}

function languageFor(path: string): string | undefined {
  const extension = extname(path).toLowerCase();
  return ({
    ".ts": "TypeScript", ".tsx": "TypeScript React", ".js": "JavaScript", ".jsx": "JavaScript React",
    ".mjs": "JavaScript", ".cjs": "JavaScript", ".json": "JSON", ".yaml": "YAML", ".yml": "YAML",
    ".md": "Markdown", ".mdx": "MDX", ".sql": "SQL", ".py": "Python", ".go": "Go", ".rs": "Rust",
    ".css": "CSS", ".scss": "SCSS", ".html": "HTML", ".sh": "Shell", ".toml": "TOML",
  } as Record<string, string>)[extension];
}

function classificationFor(path: string): RepositoryFileRecord["classification"] {
  if (/(^|\/)(dist|build|coverage|vendor)(\/|$)|\.min\.(js|css)$/.test(path)) return "generated";
  if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|pdf|zip|gz)$/i.test(path)) return "asset";
  if (/(^|\/)(__tests__|test|tests|spec|e2e)(\/|$)|\.(test|spec)\.[^.]+$/.test(path)) return "test";
  if (/(^|\/)(docs?|adr)(\/|$)|(^|\/)(readme|contributing|architecture)(\.|$)/i.test(path) || /\.mdx?$/.test(path)) return "documentation";
  if (/\.sql$|(^|\/)(migrations|fixtures|seeds|schema)(\/|$)/.test(path)) return "data";
  if (/^\.github\/workflows\/|(^|\/)(deploy|infra|k8s|terraform)(\/|$)|Dockerfile|compose\.ya?ml|\.tf$/.test(path)) return "delivery";
  if (/(^|\/)(package\.json|tsconfig[^/]*\.json|vite\.config\.|vitest\.config\.|eslint|prettier|Makefile|Justfile|\.env\.example)/.test(path)) return "configuration";
  if (languageFor(path)) return "source";
  return "unknown";
}

function exclusionReason(path: string, content: string): string | undefined {
  if (Buffer.byteLength(content) > MAX_INDEXED_BYTES) return `File exceeds the ${MAX_INDEXED_BYTES} byte indexing limit.`;
  if (content.includes("\0")) return "Binary content is not indexed.";
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(path)) return "Dependency lockfile is recorded but not expanded.";
  if (classificationFor(path) === "asset") return "Binary or presentation asset is recorded but not expanded.";
  if (classificationFor(path) === "generated") return "Generated output is recorded but not expanded.";
  return undefined;
}

function evidenceFor(inventory: ProjectInventory, records: ReadonlyMap<string, RepositoryFileRecord>, path: string, claim: string, symbol?: string): EvidenceRef[] {
  const record = records.get(path);
  if (!record) return [];
  return [{
    id: `evidence:${shortHash(`${path}:${symbol ?? ""}:${claim}`)}`,
    kind: classificationFor(path) === "documentation" ? "documentation" : "source",
    label: symbol ? `${path}#${symbol}` : path,
    claim,
    path,
    revision: inventory.head,
    symbol,
    contentHash: record.contentHash,
    validated: true,
  }];
}

function headings(content: string): string[] {
  return [...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]!.trim()).slice(0, 100);
}

function fileKind(path: string): CodeDocItem["kind"] {
  if (/(^|\/)package\.json$/.test(path)) return "package";
  const classification = classificationFor(path);
  if (classification === "documentation") return "document";
  if (classification === "test") return "test";
  if (classification === "configuration") return "config";
  if (classification === "delivery") return "delivery";
  return "file";
}

function resolveImport(sourcePath: string, specifier: string, files: ReadonlyMap<string, string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = posix.normalize(posix.join(posix.dirname(sourcePath), specifier));
  const candidates = [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"].map((suffix) => `${base}${suffix}`), ...["index.ts", "index.tsx", "index.js", "index.jsx"].map((name) => posix.join(base, name))];
  return candidates.find((candidate) => files.has(candidate));
}

const codeDocsAdapter: KnowledgeAdapter = {
  id: "code-docs",
  version: "1",
  analyze(context) {
    const items: CodeDocItem[] = [];
    const relationships: KnowledgeRelationship[] = [];
    for (const record of context.records) {
      if (record.excludedReason) continue;
      const content = context.files.get(record.path) ?? "";
      const id = context.itemId("code-docs", record.path);
      items.push({
        id,
        catalog: "code-docs",
        kind: fileKind(record.path),
        title: record.path,
        summary: headings(content)[0] ?? `${record.classification} file`,
        path: record.path,
        contentHash: record.contentHash,
        adapterId: "code-docs",
        tags: [record.classification, ...(record.language ? [record.language] : [])],
        language: record.language,
        headings: headings(content),
        evidence: context.evidence(record.path, "This tracked file exists at the indexed revision."),
        readiness: "ready",
        confidence: 1,
      });
      if (/\.[cm]?[jt]sx?$/.test(record.path)) {
        for (const match of content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
          const symbol = match[1]!;
          const symbolId = context.itemId("code-docs", record.path, symbol);
          items.push({
            id: symbolId, catalog: "code-docs", kind: "symbol", title: symbol,
            summary: `Exported symbol from ${record.path}.`, path: record.path, symbol,
            contentHash: contentHash(`${symbol}:${content}`), adapterId: "code-docs", tags: ["export", record.language ?? "code"],
            language: record.language, headings: [], evidence: context.evidence(record.path, `Exports ${symbol}.`, symbol),
            readiness: "ready", confidence: 0.9,
          });
          relationships.push({
            id: `relationship:${shortHash(`${id}:contains:${symbolId}`)}`, sourceId: id, targetId: symbolId,
            kind: "contains", evidence: context.evidence(record.path, `Contains the ${symbol} export.`, symbol),
          });
        }
        const imports = [...content.matchAll(/(?:import[^"']*from\s*|require\s*\()\s*["']([^"']+)["']/g)];
        for (const match of imports) {
          const targetPath = resolveImport(record.path, match[1]!, context.files);
          if (!targetPath) continue;
          const targetId = context.itemId("code-docs", targetPath);
          relationships.push({
            id: `relationship:${shortHash(`${id}:imports:${targetId}`)}`,
            sourceId: id,
            targetId,
            kind: "imports",
            evidence: context.evidence(record.path, `Imports ${targetPath}.`),
          });
        }
      }
    }
    return { items, relationships };
  },
};

function parseSqlFields(body: string) {
  return body.split(",").flatMap((raw) => {
    const line = raw.trim().replace(/--.*$/s, "");
    if (!line || /^(primary|foreign|unique|constraint|check)\b/i.test(line)) return [];
    const match = /^(?:["`\[]?)([\w-]+)(?:["`\]]?)\s+([^\s,]+)/.exec(line);
    if (!match) return [];
    return [{
      name: match[1]!,
      type: match[2]!,
      required: /\bnot\s+null\b/i.test(line),
      primaryKey: /\bprimary\s+key\b/i.test(line),
      references: /\breferences\s+["`\[]?([\w.-]+)/i.exec(line)?.[1],
    }];
  });
}

const dataModelAdapter: KnowledgeAdapter = {
  id: "sql-data-model",
  version: "1",
  analyze(context) {
    const items: DataModelItem[] = [];
    const relationships: KnowledgeRelationship[] = [];
    for (const [path, content] of context.files) {
      if (!/\.sql$/i.test(path)) continue;
      for (const match of content.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`\[]?([\w.-]+)["`\]]?\s*\(([\s\S]*?)\)\s*;/gi)) {
        const table = match[1]!;
        const id = context.itemId("data-model", path, table);
        const fields = parseSqlFields(match[2]!);
        items.push({
          id,
          catalog: "data-model",
          kind: "table",
          title: table,
          summary: `Table with ${fields.length} indexed fields.`,
          path,
          symbol: table,
          contentHash: contentHash(match[0]),
          adapterId: "sql-data-model",
          tags: ["sql", "table"],
          fields,
          evidence: context.evidence(path, `Defines the ${table} table.`, table),
          readiness: "ready",
          confidence: 1,
        });
        for (const field of fields) {
          if (!field.references) continue;
          const target = items.find((item) => item.title === field.references)?.id ?? context.itemId("data-model", path, field.references);
          relationships.push({
            id: `relationship:${shortHash(`${id}:references:${target}:${field.name}`)}`,
            sourceId: id,
            targetId: target,
            kind: "references",
            label: field.name,
            evidence: context.evidence(path, `${table}.${field.name} references ${field.references}.`),
          });
        }
      }
      if (/(^|\/)(migrations?|fixtures?|seeds?)(\/|$)/i.test(path)) {
        const kind = /fixtures?|seeds?/i.test(path) ? "fixture" as const : "migration" as const;
        items.push({
          id: context.itemId("data-model", path), catalog: "data-model", kind,
          title: path, summary: `${kind} SQL`, path, contentHash: contentHash(content),
          adapterId: "sql-data-model", tags: ["sql", kind], fields: [],
          evidence: context.evidence(path, `Provides a database ${kind}.`), readiness: "ready", confidence: 1,
        });
      }
    }
    return { items, relationships };
  },
};

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

const openApiAdapter: KnowledgeAdapter = {
  id: "openapi",
  version: "1",
  analyze(context) {
    const items: ApiItem[] = [];
    for (const [path, content] of context.files) {
      if (!/(^|[._-])openapi|swagger/i.test(posix.basename(path)) || !/\.(json|ya?ml)$/i.test(path)) continue;
      let document: Record<string, unknown> | undefined;
      try {
        document = objectRecord(/\.json$/i.test(path) ? JSON.parse(content) : parseYaml(content));
      } catch {
        continue;
      }
      const paths = objectRecord(document?.paths);
      if (!paths) continue;
      for (const [route, routeValue] of Object.entries(paths)) {
        const routeRecord = objectRecord(routeValue);
        if (!routeRecord) continue;
        for (const method of ["get", "post", "put", "patch", "delete", "options", "head"]) {
          const operation = objectRecord(routeRecord[method]);
          if (!operation) continue;
          const operationId = typeof operation.operationId === "string" ? operation.operationId : `${method.toUpperCase()} ${route}`;
          const security = Array.isArray(operation.security) ? operation.security.flatMap((entry) => Object.keys(objectRecord(entry) ?? {})) : [];
          items.push({
            id: context.itemId("api", path, operationId), catalog: "api", kind: "endpoint",
            title: operationId, summary: typeof operation.summary === "string" ? operation.summary : `${method.toUpperCase()} ${route}`,
            path, symbol: operationId, contentHash: contentHash(JSON.stringify(operation)), adapterId: "openapi",
            tags: [method.toUpperCase(), "OpenAPI"], method: method.toUpperCase(), route, authentication: security,
            requestSchema: operation.requestBody, responseSchema: operation.responses,
            evidence: context.evidence(path, `Declares ${method.toUpperCase()} ${route}.`, operationId), readiness: "needs-setup", confidence: 1,
          });
        }
      }
    }
    return { items };
  },
};

const codeRouteAdapter: KnowledgeAdapter = {
  id: "code-routes",
  version: "1",
  analyze(context) {
    const items: ApiItem[] = [];
    const relationships: KnowledgeRelationship[] = [];
    for (const [path, content] of context.files) {
      if (!/\.[cm]?[jt]s$/.test(path)) continue;
      for (const match of content.matchAll(/\b(?:app|router|server|fastify)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/gi)) {
        const method = match[1]!.toUpperCase();
        const route = match[2]!;
        const title = `${method} ${route}`;
        const id = context.itemId("api", path, title);
        const fileId = context.itemId("code-docs", path);
        items.push({
          id, catalog: "api", kind: "endpoint", title, summary: `Code-defined ${method} route.`,
          path, symbol: title, contentHash: contentHash(match[0]), adapterId: "code-routes", tags: [method, "code route"],
          method, route, authentication: [], evidence: context.evidence(path, `Registers ${method} ${route}.`, title),
          readiness: "needs-setup", confidence: 0.8,
        });
        relationships.push({
          id: `relationship:${shortHash(`${fileId}:serves:${id}`)}`, sourceId: fileId, targetId: id,
          kind: "serves", evidence: context.evidence(path, `Serves ${method} ${route}.`, title),
        });
      }
    }
    return { items, relationships };
  },
};

function componentProps(content: string, component: string) {
  const named = new RegExp(`(?:interface|type)\\s+${component}Props\\s*(?:=)?\\s*[{]([\\s\\S]*?)[}]`).exec(content)?.[1];
  if (!named) return [];
  return named.split(/[;\n]/).flatMap((line) => {
    const match = /^\s*([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+?)\s*$/.exec(line);
    return match ? [{ name: match[1]!, type: match[3]!, required: !match[2] }] : [];
  });
}

const reactAdapter: KnowledgeAdapter = {
  id: "react-components",
  version: "1",
  analyze(context) {
    const items: ComponentItem[] = [];
    const relationships: KnowledgeRelationship[] = [];
    const storiesByComponent = new Map<string, Array<{ id: string; story: string; path: string }>>();
    for (const [path, content] of context.files) {
      if (!/\.stories\.[jt]sx?$/.test(path)) continue;
      const importMatch = /import\s*{?\s*([A-Z][\w$]*)[^}]*}?\s*from\s*["']([^"']+)["']/.exec(content);
      if (!importMatch) continue;
      const component = importMatch[1]!;
      const componentPath = resolveImport(path, importMatch[2]!, context.files);
      if (!componentPath) continue;
      for (const match of content.matchAll(/export\s+const\s+([A-Z][\w$]*)\s*=/g)) {
        const story = match[1]!;
        const id = context.itemId("components", path, story);
        const componentId = context.itemId("components", componentPath, component);
        items.push({
          id, catalog: "components", kind: "story", title: `${component}.${story}`,
          summary: `Repository-owned Storybook story for ${component}.`, path, symbol: story,
          contentHash: contentHash(`${story}:${content}`), adapterId: "react-components", tags: ["React", "Storybook"],
          props: [], storyIds: [story], providers: [], evidence: context.evidence(path, `Defines the ${story} story for ${component}.`, story),
          readiness: "ready", confidence: 0.95,
        });
        storiesByComponent.set(componentId, [...(storiesByComponent.get(componentId) ?? []), { id, story, path }]);
        relationships.push({
          id: `relationship:${shortHash(`${id}:renders:${componentId}`)}`, sourceId: id, targetId: componentId,
          kind: "renders", evidence: context.evidence(path, `${story} renders ${component}.`, story),
        });
      }
    }
    for (const [path, content] of context.files) {
      if (!/\.[jt]sx$/.test(path) || /\.stories\.[jt]sx?$/.test(path)) continue;
      const names = new Set<string>();
      for (const match of content.matchAll(/export\s+(?:default\s+)?(?:function|class|const)\s+([A-Z][\w$]*)/g)) names.add(match[1]!);
      for (const component of names) {
        const id = context.itemId("components", path, component);
        const stories = storiesByComponent.get(id) ?? [];
        const hasStory = stories.length > 0;
        items.push({
          id, catalog: "components", kind: "component",
          title: component, summary: hasStory ? "React component with a repository story." : "Exported React component.",
          path, symbol: component, contentHash: contentHash(`${component}:${content}`), adapterId: "react-components",
          tags: ["React", ...(hasStory ? ["Storybook"] : [])], props: componentProps(content, component), storyIds: stories.map((story) => story.story), providers: [],
          evidence: context.evidence(path, `Exports the ${component} component.`, component),
          readiness: hasStory ? "ready" : "needs-setup", confidence: 0.95,
        });
      }
    }
    return { items, relationships };
  },
};

export function defaultKnowledgeRegistry(): KnowledgeAdapterRegistry {
  return new KnowledgeAdapterRegistry()
    .register(codeDocsAdapter)
    .register(dataModelAdapter)
    .register(openApiAdapter)
    .register(codeRouteAdapter)
    .register(reactAdapter);
}

async function mapConcurrent<T, R>(values: readonly T[], concurrency: number, work: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await work(values[index]!);
    }
  }));
  return results;
}

export async function buildRepositoryKnowledge(
  inventory: ProjectInventory,
  registry = defaultKnowledgeRegistry(),
): Promise<RepositoryKnowledgeSnapshot> {
  const indexed = await mapConcurrent(inventory.trackedFiles, 16, async (path) => {
    let content = "";
    try {
      content = await readRevisionFile(inventory.root, inventory.head, path);
    } catch {
      return { record: { path, size: 0, contentHash: contentHash(""), classification: "unknown", excludedReason: "The file could not be read at the selected revision." } satisfies RepositoryFileRecord };
    }
    const reason = exclusionReason(path, content);
    const record: RepositoryFileRecord = {
      path,
      language: languageFor(path),
      size: Buffer.byteLength(content),
      contentHash: contentHash(content),
      classification: classificationFor(path),
      ...(reason ? { excludedReason: reason } : {}),
    };
    return { record, ...(reason ? {} : { content }) };
  });
  const records = indexed.map((entry) => entry.record);
  const files = new Map(indexed.flatMap((entry) => entry.content === undefined ? [] : [[entry.record.path, entry.content] as const]));
  const recordMap = new Map(records.map((record) => [record.path, record]));
  const context: KnowledgeAdapterContext = {
    inventory,
    files,
    records,
    itemId,
    evidence: (path, claim, symbol) => evidenceFor(inventory, recordMap, path, claim, symbol),
  };
  const output = await registry.analyze(context);
  const uniqueItems = new Map(output.items.map((item) => [item.id, item]));
  const knownIds = new Set(uniqueItems.keys());
  const relationships = (output.relationships ?? [])
    .filter((relationship) => knownIds.has(relationship.sourceId) && knownIds.has(relationship.targetId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const items = [...uniqueItems.values()].sort((a, b) => a.id.localeCompare(b.id));
  return RepositoryKnowledgeSnapshotSchema.parse({
    schemaVersion: 1,
    id: knowledgeSnapshotId(inventory.head),
    projectName: inventory.name,
    repositoryRoot: inventory.root,
    anchor: { ref: inventory.ref, commit: inventory.head },
    analyzerVersion: KNOWLEDGE_ANALYZER_VERSION,
    generatedAt: new Date().toISOString(),
    files: records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    catalogs: {
      dataModel: items.filter((item): item is DataModelItem => item.catalog === "data-model"),
      api: items.filter((item): item is ApiItem => item.catalog === "api"),
      components: items.filter((item): item is ComponentItem => item.catalog === "components"),
      codeDocs: items.filter((item): item is CodeDocItem => item.catalog === "code-docs"),
    },
    relationships,
    exclusions: records.flatMap((record) => record.excludedReason ? [{ path: record.path, reason: record.excludedReason }] : []),
  });
}

export function allKnowledgeItems(snapshot: RepositoryKnowledgeSnapshot): KnowledgeItem[] {
  return [...snapshot.catalogs.dataModel, ...snapshot.catalogs.api, ...snapshot.catalogs.components, ...snapshot.catalogs.codeDocs];
}

export function findKnowledgeItem(snapshot: RepositoryKnowledgeSnapshot, catalog: KnowledgeCatalog, id: string): KnowledgeItem | undefined {
  return allKnowledgeItems(snapshot).find((item) => item.catalog === catalog && item.id === id);
}

export function searchKnowledge(snapshot: RepositoryKnowledgeSnapshot, query: string, catalog?: KnowledgeCatalog): KnowledgeItem[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return allKnowledgeItems(snapshot)
    .filter((item) => !catalog || item.catalog === catalog)
    .filter((item) => terms.every((term) => `${item.title} ${item.summary} ${item.path ?? ""} ${item.symbol ?? ""} ${item.tags.join(" ")}`.toLowerCase().includes(term)))
    .slice(0, 100);
}

export interface RepositoryKnowledgeDiff {
  changedItemIds: string[];
  addedItemIds: string[];
  removedItemIds: string[];
  changedRelationshipIds: string[];
}

export function diffRepositoryKnowledge(previous: RepositoryKnowledgeSnapshot, current: RepositoryKnowledgeSnapshot): RepositoryKnowledgeDiff {
  const before = new Map(allKnowledgeItems(previous).map((item) => [item.id, item.contentHash]));
  const after = new Map(allKnowledgeItems(current).map((item) => [item.id, item.contentHash]));
  const addedItemIds = [...after.keys()].filter((id) => !before.has(id));
  const removedItemIds = [...before.keys()].filter((id) => !after.has(id));
  const changedItemIds = [...new Set([
    ...addedItemIds,
    ...removedItemIds,
    ...[...after].filter(([id, hash]) => before.has(id) && before.get(id) !== hash).map(([id]) => id),
  ])].sort();
  const beforeRelationships = new Map(previous.relationships.map((relationship) => [relationship.id, JSON.stringify(relationship)]));
  const afterRelationships = new Map(current.relationships.map((relationship) => [relationship.id, JSON.stringify(relationship)]));
  const changedRelationshipIds = [...new Set([
    ...[...beforeRelationships.keys()].filter((id) => !afterRelationships.has(id)),
    ...[...afterRelationships].filter(([id, value]) => beforeRelationships.get(id) !== value).map(([id]) => id),
  ])].sort();
  return { changedItemIds, addedItemIds: addedItemIds.sort(), removedItemIds: removedItemIds.sort(), changedRelationshipIds };
}

export interface TourKnowledgeDependents {
  tour: boolean;
  moduleIds: string[];
  pageIds: string[];
  journeyIds: string[];
  labEnvironmentIds: string[];
}

export function findTourKnowledgeDependents(tour: TourSnapshot, changedItemIds: Iterable<string>): TourKnowledgeDependents {
  const changed = new Set(changedItemIds);
  const referencesChanged = (references: Array<{ itemId: string }>) => references.some((reference) => changed.has(reference.itemId));
  const tourChanged = referencesChanged(tour.knowledgeRefs);
  const moduleIds = tour.modules.filter((module) => tourChanged || referencesChanged(module.knowledgeRefs)).map((module) => module.id);
  const staleModules = new Set(moduleIds);
  const pageIds = tour.pages.filter((page) => tourChanged
    || staleModules.has(page.moduleId)
    || referencesChanged(page.knowledgeRefs)
    || page.interactions.some((interaction) => (
      (interaction.type === "component" || interaction.type === "http" || interaction.type === "database" || interaction.type === "function")
      && changed.has(interaction.target.itemId)
    ))).map((page) => page.id);
  return {
    tour: tourChanged,
    moduleIds,
    pageIds,
    journeyIds: tour.featureJourneys.filter((journey) => journey.steps.some((step) => changed.has(step.target.itemId))).map((journey) => journey.id),
    labEnvironmentIds: tour.labEnvironments.filter((environment) => environment.dependencies.some((dependency) => dependency.target && changed.has(dependency.target.itemId))).map((environment) => environment.id),
  };
}
