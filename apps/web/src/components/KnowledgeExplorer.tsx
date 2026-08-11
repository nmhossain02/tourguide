import { useDeferredValue, useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { Box, Braces, Cpu, Database, FileCode2, RefreshCw, Search, X } from "lucide-react";

import type {
  KnowledgeCatalog,
  KnowledgeItem,
  LivingDocumentationSnapshot,
  RepositoryKnowledgeSnapshot,
  ViewerTarget,
} from "@tourguide/core";
import { api } from "../api";
import { editorLanguageForPath } from "../tour";

type ExplorerView = KnowledgeCatalog | "compute";

const CATALOGS: Array<{ id: ExplorerView; label: string; description: string; icon: typeof Database }> = [
  { id: "data-model", label: "Data model", description: "Tables, fields, migrations, and fixtures", icon: Database },
  { id: "api", label: "API", description: "Services, endpoints, and contracts", icon: Braces },
  { id: "components", label: "Components", description: "React exports, props, and stories", icon: Box },
  { id: "compute", label: "Compute", description: "Callable exports, handlers, and execution scenarios", icon: Cpu },
  { id: "code-docs", label: "Code map & docs", description: "Every indexed path, documentation, and relationships", icon: FileCode2 },
];

function itemsFor(snapshot: RepositoryKnowledgeSnapshot, catalog: ExplorerView): KnowledgeItem[] {
  switch (catalog) {
    case "data-model": return snapshot.catalogs.dataModel;
    case "api": return snapshot.catalogs.api;
    case "components": return snapshot.catalogs.components;
    case "compute": return snapshot.catalogs.codeDocs.filter((item) => item.kind === "symbol");
    case "code-docs": return snapshot.catalogs.codeDocs.filter((item) => item.kind !== "symbol");
  }
}

function Detail({ item, snapshot, documentation, onSelect }: {
  item: KnowledgeItem;
  snapshot: RepositoryKnowledgeSnapshot;
  documentation?: LivingDocumentationSnapshot;
  onSelect(item: KnowledgeItem): void;
}) {
  const [source, setSource] = useState<string>();
  useEffect(() => {
    setSource(undefined);
    if (item.path) api.source(item.path).then((result) => setSource(result.content)).catch(() => setSource("Source is unavailable."));
  }, [item.path]);
  const byId = useMemo(() => new Map(itemsFor(snapshot, "data-model")
    .concat(itemsFor(snapshot, "api"), itemsFor(snapshot, "components"), itemsFor(snapshot, "code-docs"))
    .map((candidate) => [candidate.id, candidate])), [snapshot]);
  const relationships = snapshot.relationships.filter((relationship) => relationship.sourceId === item.id || relationship.targetId === item.id);
  const subject = documentation?.subjects.find((candidate) => candidate.knowledgeItemId === item.id);
  const claims = subject ? documentation?.claims.filter((claim) => claim.subjectId === subject.id) ?? [] : [];
  const scenarios = subject ? documentation?.scenarios.filter((scenario) => scenario.subjectId === subject.id) ?? [] : [];
  const runtimeProfiles = subject ? documentation?.runtimeProfiles.filter((profile) => profile.subjectIds.includes(subject.id)) ?? [] : [];

  return (
    <article className="knowledge-detail">
      <header>
        <div>
          <span className="eyebrow">{item.catalog} / {item.kind}</span>
          <h2>{item.title}</h2>
          <p>{item.summary || "Indexed repository knowledge."}</p>
        </div>
        <span className={`readiness ${item.readiness}`}>{item.readiness.replaceAll("-", " ")}</span>
      </header>
      <dl className="knowledge-metadata">
        {item.path && <><dt>Source</dt><dd>{item.path}{item.symbol ? `#${item.symbol}` : ""}</dd></>}
        <dt>Adapter</dt><dd>{item.adapterId}</dd>
        <dt>Confidence</dt><dd>{Math.round(item.confidence * 100)}%</dd>
        <dt>Content</dt><dd>{item.contentHash.slice(0, 16)}</dd>
      </dl>
      {subject && (
        <section className="knowledge-section">
          <h3>Living documentation</h3>
          <p><strong>{subject.domain}</strong> subject with {claims.filter((claim) => claim.status === "valid").length} valid claims and {scenarios.length} executable scenario{scenarios.length === 1 ? "" : "s"}.</p>
          {scenarios.length > 0 && <ul>{scenarios.map((scenario) => <li key={scenario.id}><strong>{scenario.title}</strong> · {scenario.operation} · {scenario.requiredCapabilities.join(", ")}</li>)}</ul>}
          {runtimeProfiles.length > 0 && <p><strong>Runtime:</strong> {runtimeProfiles.map((profile) => `${profile.title} (${profile.probeStatus})`).join(", ")}</p>}
          {claims.some((claim) => claim.origin === "inferred") && <p><strong>Inference:</strong> {claims.filter((claim) => claim.origin === "inferred" && claim.status === "valid").length} evidence-backed inferred claims remain valid.</p>}
        </section>
      )}
      {item.catalog === "data-model" && (
        <section className="knowledge-section">
          <h3>Fields</h3>
          {item.fields.length ? (
            <table><thead><tr><th>Name</th><th>Type</th><th>Constraints</th><th>References</th></tr></thead>
              <tbody>{item.fields.map((field) => <tr key={field.name}><td>{field.name}</td><td>{field.type}</td><td>{[field.primaryKey && "primary key", field.required && "required"].filter(Boolean).join(", ") || "optional"}</td><td>{field.references ?? ""}</td></tr>)}</tbody>
            </table>
          ) : <p>No structured fields were extracted.</p>}
        </section>
      )}
      {item.catalog === "api" && (
        <section className="knowledge-section api-contract">
          <h3>{item.method ?? "Service"} {item.route ?? item.title}</h3>
          <p><strong>Authentication:</strong> {item.authentication.length ? item.authentication.join(", ") : "No operation-level requirement declared"}</p>
          <div><div><h4>Request</h4><pre>{JSON.stringify(item.requestSchema ?? {}, null, 2)}</pre></div><div><h4>Responses</h4><pre>{JSON.stringify(item.responseSchema ?? {}, null, 2)}</pre></div></div>
        </section>
      )}
      {item.catalog === "components" && (
        <section className="knowledge-section">
          <h3>Props and render readiness</h3>
          {item.props.length ? <table><thead><tr><th>Prop</th><th>Type</th><th>Required</th></tr></thead><tbody>{item.props.map((prop) => <tr key={prop.name}><td>{prop.name}</td><td>{prop.type}</td><td>{prop.required ? "Yes" : "No"}</td></tr>)}</tbody></table> : <p>No named props were extracted.</p>}
          <p>{item.storyIds.length ? `${item.storyIds.length} repository stories detected.` : "No directly linked repository story was indexed."}</p>
        </section>
      )}
      {item.catalog === "code-docs" && item.headings.length > 0 && (
        <section className="knowledge-section"><h3>Document outline</h3><ol>{item.headings.map((heading, index) => <li key={`${heading}-${index}`}>{heading}</li>)}</ol></section>
      )}
      {relationships.length > 0 && (
        <section className="knowledge-section">
          <h3>Connected knowledge</h3>
          <div className="relationship-list">{relationships.map((relationship) => {
            const neighbor = byId.get(relationship.sourceId === item.id ? relationship.targetId : relationship.sourceId);
            return neighbor ? <button key={relationship.id} onClick={() => onSelect(neighbor)}><span>{relationship.kind}</span>{neighbor.title}<small>{neighbor.catalog}</small></button> : null;
          })}</div>
        </section>
      )}
      {item.path && (
        <section className="knowledge-source">
          <h3>Selected revision source</h3>
          <Editor
            height="420px"
            language={editorLanguageForPath(item.path)}
            value={source ?? "Loading source..."}
            theme="vs-dark"
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, padding: { top: 14 }, ariaLabel: `Source code: ${item.path}` }}
          />
        </section>
      )}
    </article>
  );
}

export function KnowledgeExplorer({ onClose, initialTarget }: { onClose(): void; initialTarget?: ViewerTarget }) {
  const [snapshot, setSnapshot] = useState<RepositoryKnowledgeSnapshot>();
  const [documentation, setDocumentation] = useState<LivingDocumentationSnapshot>();
  const [error, setError] = useState<string>();
  const [updating, setUpdating] = useState(false);
  const [updateSummary, setUpdateSummary] = useState<string>();
  const [catalog, setCatalog] = useState<ExplorerView>(initialTarget?.catalog ?? "code-docs");
  const [selectedId, setSelectedId] = useState(initialTarget?.itemId);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  useEffect(() => {
    Promise.all([api.knowledge(), api.documentation()])
      .then(([nextKnowledge, nextDocumentation]) => { setSnapshot(nextKnowledge); setDocumentation(nextDocumentation); })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  const items = useMemo(() => snapshot ? itemsFor(snapshot, catalog) : [], [snapshot, catalog]);
  const filtered = useMemo(() => items.filter((item) => !deferredQuery || `${item.title} ${item.summary} ${item.path ?? ""} ${item.tags.join(" ")}`.toLowerCase().includes(deferredQuery)).slice(0, 300), [items, deferredQuery]);
  const selected = snapshot
    ? items.find((item) => item.id === selectedId) ?? filtered[0]
    : undefined;
  const selectItem = (item: KnowledgeItem) => {
    setCatalog(item.catalog === "code-docs" && item.kind === "symbol" ? "compute" : item.catalog);
    setSelectedId(item.id);
  };
  const updateDocumentation = async () => {
    setUpdating(true);
    setError(undefined);
    setUpdateSummary(undefined);
    try {
      const result = await api.reconcileDocumentation();
      setDocumentation(result.documentation);
      setUpdateSummary(result.stats.coldCalls
        ? `${result.stats.coldCalls} focused Codex call${result.stats.coldCalls === 1 ? "" : "s"}; ${result.stats.cacheHits} validated artifacts reused.`
        : `Documentation is current; ${result.stats.cacheHits} validated artifacts reused with no Codex call.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="knowledge-overlay" role="dialog" aria-modal="true" aria-label="Explore codebase">
      <header className="knowledge-header">
        <div><span className="eyebrow">Repository knowledge</span><h1>Explore {snapshot?.projectName ?? "codebase"}</h1>{updateSummary && <small className="documentation-update-summary" role="status">{updateSummary}</small>}</div>
        <div className="knowledge-search"><Search size={16} /><input name="knowledge-search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the selected catalog" aria-label="Search repository knowledge" /></div>
        <button className="documentation-update" onClick={updateDocumentation} disabled={updating} title="Update inferred documentation and run missing runtime probes for this trusted repository"><RefreshCw size={15} className={updating ? "spin" : ""} /> {updating ? "Updating..." : "Update and probe"}</button>
        <button className="icon-button" onClick={onClose} aria-label="Close codebase explorer"><X /></button>
      </header>
      <nav className="catalog-tabs" aria-label="Knowledge catalogs">
        {CATALOGS.map((entry) => {
          const Icon = entry.icon;
          const count = snapshot ? itemsFor(snapshot, entry.id).length : 0;
          return <button key={entry.id} className={catalog === entry.id ? "active" : ""} onClick={() => { setCatalog(entry.id); setSelectedId(undefined); }}><Icon size={18} /><span>{entry.label}<small>{entry.description}</small></span><strong>{count}</strong></button>;
        })}
      </nav>
      {error ? <div className="knowledge-state inline-error">{error}</div> : !snapshot ? <div className="knowledge-state">Indexing the selected commit...</div> : (
        <div className="knowledge-body">
          <aside className="knowledge-list">
            <div className="knowledge-list-summary"><strong>{filtered.length}{filtered.length < items.length ? ` of ${items.length}` : ""}</strong> visible items</div>
            {filtered.map((item) => <button key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)}><span>{item.title}</span><small>{item.path ?? item.kind}</small><i className={item.readiness}>{item.readiness.replace("needs-", "")}</i></button>)}
            {!filtered.length && <p>No items match this search.</p>}
          </aside>
          <main className="knowledge-main">{selected ? <Detail item={selected} snapshot={snapshot} {...(documentation ? { documentation } : {})} onSelect={selectItem} /> : <div className="knowledge-state">This catalog has no indexed items yet.</div>}</main>
        </div>
      )}
    </div>
  );
}
