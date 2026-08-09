import { Group, Panel, Separator } from "react-resizable-panels";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileCode2,
  GitBranch,
  Menu,
  RotateCcw,
  Sparkles,
  Bug,
  X,
} from "lucide-react";

import type {
  EvidenceRef,
  Module as TourModule,
  Page,
  Progress,
  TourSnapshot,
  Track,
  ViewerTarget,
} from "@tourguide/core";
import type { BootstrapPayload } from "../api";
import { ExerciseView } from "./ExerciseView";
import { InteractionView } from "./InteractionView";

interface TourContentProps {
  data: BootstrapPayload;
  tour: TourSnapshot;
  page: Page;
  module: TourModule;
  track: Track;
  orderedPages: Page[];
  pageIndex: number;
  interactionIndex: number;
  railOpen: boolean;
  onSelectPage(id: string): void;
  onSelectInteraction(index: number): void;
  onOpenEvidence(evidence: EvidenceRef): void;
  onOpenKnowledge(target: ViewerTarget): void;
  onUpdateProgress(id: string, patch: Partial<Progress["pages"][string]>): void;
}

export function TopBar({
  projectName,
  completedCount,
  pageCount,
  onToggleRail,
  onDiagnostics,
  onNewTour,
  onExplore,
}: {
  projectName: string;
  completedCount: number;
  pageCount: number;
  onToggleRail(): void;
  onDiagnostics(): void;
  onNewTour(): void;
  onExplore(): void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <button className="icon-button mobile-menu" onClick={onToggleRail}><Menu /></button>
        <div className="mark"><GitBranch /></div>
        <div><strong>Tourguide</strong><span>{projectName}</span></div>
      </div>
      <div className="top-status">
        <span>{completedCount}/{pageCount} completed</span>
        <button className="prominent" onClick={onExplore}><FileCode2 size={15} /> Explore codebase</button>
        <button onClick={onDiagnostics}><Bug size={15} /> Diagnostics</button>
        <button onClick={onNewTour}><Sparkles size={15} /> New tour</button>
      </div>
    </header>
  );
}

export function FreshnessBanner({ freshness }: { freshness: NonNullable<BootstrapPayload["freshness"]> }) {
  const staleCount = freshness.stalePageIds.length;
  return (
    <div className="freshness-banner">
      <RotateCcw size={15} />
      <span>HEAD moved from {freshness.authoredHead.slice(0, 8)} to {freshness.currentHead.slice(0, 8)}.</span>
      <strong>{staleCount} page{staleCount === 1 ? "" : "s"} need review</strong>
    </div>
  );
}

function LessonRail({
  data,
  tour,
  selectedPage,
  orderedPages,
  open,
  onSelectPage,
}: {
  data: BootstrapPayload;
  tour: TourSnapshot;
  selectedPage: Page;
  orderedPages: Page[];
  open: boolean;
  onSelectPage(id: string): void;
}) {
  const completedCount = Object.values(data.progress.pages).filter((state) => state.completed).length;
  const progressPercent = orderedPages.length ? (completedCount / orderedPages.length) * 100 : 0;
  const shortRef = tour.anchor.ref.replace(/^refs\/(heads|tags|remotes)\//, "");

  return (
    <nav className={`lesson-rail ${open ? "open" : ""}`}>
      <div className="rail-summary">
        <span className="eyebrow">{shortRef}</span>
        <h2>{tour.projectName}</h2>
        <p>{tour.anchor.commit.slice(0, 8)} · {tour.status}</p>
        <div className="progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
      </div>
      {tour.tracks.map((track) => (
        <section className="track-group" key={track.id}>
          <h3>{track.title}</h3>
          {track.moduleIds.map((moduleId) => {
            const module = tour.modules.find((candidate) => candidate.id === moduleId);
            if (!module) return null;

            return (
              <div className="module-group" key={moduleId}>
                <h4><ChevronDown size={13} /> {module.title}<small>{module.status}</small></h4>
                {module.pageIds.map((pageId, index) => {
                  const page = tour.pages.find((candidate) => candidate.id === pageId);
                  if (!page) return null;

                  const progress = data.progress.pages[pageId];
                  return (
                    <button
                      key={pageId}
                      className={`lesson-link ${pageId === selectedPage.id ? "active" : ""}`}
                      onClick={() => onSelectPage(pageId)}
                    >
                      <span className="lesson-number">{progress?.completed ? <Check size={13} /> : index + 1}</span>
                      <span>{page.title}<small>{page.kind} · {page.estimatedMinutes} min</small></span>
                      <ChevronRight size={14} />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </section>
      ))}
    </nav>
  );
}

function LessonContent({
  data,
  page,
  module,
  track,
  orderedPages,
  pageIndex,
  onSelectPage,
  onOpenEvidence,
  onOpenKnowledge,
  onUpdateProgress,
}: Omit<TourContentProps, "tour" | "interactionIndex" | "railOpen" | "onSelectInteraction">) {
  const pageProgress = data.progress.pages[page.id];

  return (
    <article className="lesson-content">
      <div className="breadcrumb">
        <span>{track.title}</span>
        <ChevronRight size={12} />
        <span>{module.title}</span>
        <ChevronRight size={12} />
        <span>{page.kind}</span>
      </div>
      <div className="lesson-meta">
        <span className="eyebrow">Page {pageIndex + 1} of {orderedPages.length}</span>
        <span>{page.estimatedMinutes} min</span>
      </div>
      <h1>{page.title}</h1>
      <p className="objective">{page.objective}</p>
      <div className="narrative">
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{page.narrative}</ReactMarkdown>
      </div>
      {page.evidence.length > 0 && (
        <div className="evidence-chips">
          {page.evidence.map((item) => (
            <button key={item.id} className={item.kind} onClick={() => onOpenEvidence(item)}>
              <CircleDot size={12} /> {item.label}
            </button>
          ))}
        </div>
      )}
      {page.knowledgeCheck && (
        <section className="knowledge-check">
          <span><BookOpen size={15} /> Try to explain</span>
          <h3>{page.knowledgeCheck.prompt}</h3>
          <details>
            <summary>Compare your observation</summary>
            <p>{page.knowledgeCheck.expectedObservation}</p>
          </details>
        </section>
      )}
      {page.references.length > 0 && (
        <section className="references">
          <h3>Go deeper</h3>
          {page.references.map((reference) => (
            reference.type === "external"
              ? <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer">{reference.title}<ExternalLink size={13} /></a>
              : reference.type === "source"
                ? <button key={reference.title} onClick={() => onOpenKnowledge(reference.target)}>{reference.title}<FileCode2 size={13} /></button>
                : <button key={reference.path} onClick={() => onOpenEvidence({ id: `reference-${reference.path}`, kind: "documentation", label: reference.title, claim: "Repository-owned documentation reference.", path: reference.path, contentHash: reference.contentHash, validated: Boolean(reference.contentHash) })}>{reference.title}<BookOpen size={13} /></button>
          ))}
        </section>
      )}
      <label className="complete-toggle">
        <input
          type="checkbox"
          name={`complete-${page.id}`}
          checked={pageProgress?.completed ?? false}
          onChange={(event) => onUpdateProgress(page.id, { completed: event.target.checked })}
        />
        Mark this page complete
      </label>
      <div className="lesson-nav">
        <button
          disabled={pageIndex <= 0}
          onClick={() => onSelectPage(orderedPages[pageIndex - 1]!.id)}
        >
          Previous
        </button>
        <button
          className="primary"
          disabled={pageIndex >= orderedPages.length - 1}
          onClick={() => onSelectPage(orderedPages[pageIndex + 1]!.id)}
        >
          Next page <ChevronRight size={15} />
        </button>
      </div>
    </article>
  );
}

function Workspace({
  data,
  page,
  interactionIndex,
  onSelectInteraction,
  onUpdateProgress,
  onOpenKnowledge,
}: Pick<TourContentProps, "data" | "page" | "interactionIndex" | "onSelectInteraction" | "onUpdateProgress" | "onOpenKnowledge">) {
  const selectedInteraction = page.interactions[interactionIndex] ?? page.interactions[0];

  return (
    <section className="workspace">
      <div className="workspace-heading">
        <span>{page.exercise ? "Experiment" : "Explore"}</span>
        {!page.exercise && (
          <div className="interaction-tabs">
            {page.interactions.map((interaction, index) => (
              <button
                key={index}
                className={index === interactionIndex ? "active" : ""}
                onClick={() => onSelectInteraction(index)}
              >
                {interaction.type}
              </button>
            ))}
          </div>
        )}
      </div>
      {page.exercise ? (
        <ExerciseView
          key={page.id}
          page={page}
          onAttempt={() => onUpdateProgress(page.id, { exerciseAttempted: true })}
          onVerified={() => onUpdateProgress(page.id, { verified: true })}
        />
      ) : selectedInteraction ? (
        <InteractionView
          pageId={page.id}
          interaction={selectedInteraction}
          inventory={data.inventory}
          onExperiment={() => onUpdateProgress(page.id, { demonstrated: true })}
          onOpenKnowledge={onOpenKnowledge}
        />
      ) : null}
    </section>
  );
}

export function TourContent(props: TourContentProps) {
  return (
    <div className="body">
      <LessonRail
        data={props.data}
        tour={props.tour}
        selectedPage={props.page}
        orderedPages={props.orderedPages}
        open={props.railOpen}
        onSelectPage={props.onSelectPage}
      />
      <main className="main">
        <Group orientation="horizontal">
          <Panel defaultSize="46%" minSize="30%">
            <LessonContent
              data={props.data}
              page={props.page}
              module={props.module}
              track={props.track}
              orderedPages={props.orderedPages}
              pageIndex={props.pageIndex}
              onSelectPage={props.onSelectPage}
              onOpenEvidence={props.onOpenEvidence}
              onOpenKnowledge={props.onOpenKnowledge}
              onUpdateProgress={props.onUpdateProgress}
            />
          </Panel>
          <Separator className="resize-handle" />
          <Panel defaultSize="54%" minSize="35%">
            <Workspace
              data={props.data}
              page={props.page}
              interactionIndex={props.interactionIndex}
              onSelectInteraction={props.onSelectInteraction}
              onUpdateProgress={props.onUpdateProgress}
              onOpenKnowledge={props.onOpenKnowledge}
            />
          </Panel>
        </Group>
      </main>
    </div>
  );
}

export function EvidenceDrawer({ evidence, onClose }: { evidence: EvidenceRef; onClose(): void }) {
  return (
    <aside className="evidence-drawer">
      <button className="icon-button close" onClick={onClose}><X /></button>
      <span className={`evidence-kind ${evidence.kind}`}>{evidence.kind}</span>
      <h2>{evidence.label}</h2>
      <p>{evidence.claim}</p>
      <dl>
        {evidence.path && (
          <>
            <dt>Path</dt>
            <dd>{evidence.path}{evidence.lineStart ? `:${evidence.lineStart}` : ""}</dd>
          </>
        )}
        {evidence.revision && <><dt>Revision</dt><dd>{evidence.revision.slice(0, 12)}</dd></>}
        {evidence.symbol && <><dt>Symbol</dt><dd>{evidence.symbol}</dd></>}
        {evidence.contentHash && <><dt>Content hash</dt><dd>{evidence.contentHash.slice(0, 16)}…</dd></>}
        <dt>Validation</dt>
        <dd>
          {evidence.validated
            ? "Validated"
            : evidence.kind === "inference"
              ? "Explicit inference"
              : "Needs validation"}
        </dd>
      </dl>
    </aside>
  );
}
