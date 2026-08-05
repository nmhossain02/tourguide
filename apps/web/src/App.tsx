import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EvidenceRef, Progress } from "@tourguide/core";
import { api, type BootstrapPayload } from "./api";
import {
  DiagnosticsModal,
  FatalScreen,
  GenerationBanner,
  GenerationPanel,
  GenerationScreen,
  LoadingScreen,
} from "./components/GenerationViews";
import {
  EvidenceDrawer,
  FreshnessBanner,
  TopBar,
  TourContent,
} from "./components/TourView";
import { errorMessage, getOrderedPages, isGenerating, type GenerationInput } from "./tour";

const POLL_INTERVAL_MS = 1_000;
const MAX_VISIBLE_EVENTS = 200;

export function App() {
  const [data, setData] = useState<BootstrapPayload>();
  const [pageId, setPageId] = useState<string>();
  const [evidence, setEvidence] = useState<EvidenceRef>();
  const [railOpen, setRailOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [interactionIndex, setInteractionIndex] = useState(0);
  const [error, setError] = useState<string>();
  const lastEventId = useRef(0);

  useEffect(() => {
    api.bootstrap()
      .then((bootstrap) => {
        setData(bootstrap);
        lastEventId.current = bootstrap.events.at(-1)?.id ?? 0;
        setPageId(bootstrap.tour?.pages[0]?.id);
      })
      .catch((reason) => setError(errorMessage(reason)));
  }, []);

  useEffect(() => {
    if (!isGenerating(data)) return;

    const pollGeneration = async () => {
      try {
        const update = await api.generationEvents(lastEventId.current);
        if (update.events.length > 0) {
          lastEventId.current = update.events.at(-1)!.id;
        }

        setData((current) => current ? {
          ...current,
          ...(update.job ? { job: update.job } : {}),
          ...(update.tour ? { tour: update.tour } : {}),
          events: [...current.events, ...update.events].slice(-MAX_VISIBLE_EVENTS),
        } : current);

        if (update.tour) {
          setPageId((current) => (
            current && update.tour!.pages.some((page) => page.id === current)
              ? current
              : update.tour!.pages[0]?.id
          ));
        }
      } catch (reason) {
        console.error(reason);
      }
    };

    void pollGeneration();
    const timer = window.setInterval(pollGeneration, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [data?.job?.id, data?.job?.status, data?.job?.errorCode]);

  const tour = data?.tour;
  const orderedPages = useMemo(() => getOrderedPages(tour), [tour]);
  const page = orderedPages.find((candidate) => candidate.id === pageId) ?? orderedPages[0];
  const pageIndex = page ? orderedPages.findIndex((candidate) => candidate.id === page.id) : -1;
  const module = page && tour?.modules.find((candidate) => candidate.id === page.moduleId);
  const track = module && tour?.tracks.find((candidate) => candidate.moduleIds.includes(module.id));

  const updateProgress = useCallback(async (
    id: string,
    patch: Partial<Progress["pages"][string]>,
  ) => {
    if (!data) return;

    const now = new Date().toISOString();
    const currentPageProgress = data.progress.pages[id] ?? {
      viewed: false,
      demonstrated: false,
      exerciseAttempted: false,
      completed: false,
      revisit: false,
      updatedAt: now,
    };
    const progress: Progress = {
      schemaVersion: 2,
      pages: {
        ...data.progress.pages,
        [id]: { ...currentPageProgress, ...patch, updatedAt: now },
      },
    };

    setData({ ...data, progress });
    await api.progress(progress);
  }, [data]);

  useEffect(() => {
    if (page && !data?.progress.pages[page.id]?.viewed) {
      void updateProgress(page.id, { viewed: true });
    }
  }, [page?.id, data?.progress.pages[page?.id ?? ""]?.viewed, updateProgress]);

  const selectPage = useCallback((id: string) => {
    setPageId(id);
    setInteractionIndex(0);
    setRailOpen(false);
  }, []);

  useEffect(() => {
    const navigateWithArrowKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, .monaco-editor")) return;

      if (event.key === "ArrowLeft" && pageIndex > 0) {
        selectPage(orderedPages[pageIndex - 1]!.id);
      }
      if (event.key === "ArrowRight" && pageIndex >= 0 && pageIndex < orderedPages.length - 1) {
        selectPage(orderedPages[pageIndex + 1]!.id);
      }
    };

    window.addEventListener("keydown", navigateWithArrowKeys);
    return () => window.removeEventListener("keydown", navigateWithArrowKeys);
  }, [orderedPages, pageIndex, selectPage]);

  const startGeneration = async (input: GenerationInput) => {
    const job = await api.startGeneration(input);
    lastEventId.current = 0;
    setData((current) => current ? {
      ...current,
      job,
      events: [],
      preferences: {
        ...current.preferences,
        goals: [input.goal],
        priorities: input.priorities,
      },
    } : current);
  };

  const diagnosticsModal = diagnosticsOpen
    ? <DiagnosticsModal onClose={() => setDiagnosticsOpen(false)} />
    : null;

  if (error) {
    return (
      <>
        <FatalScreen error={error} onDiagnostics={() => setDiagnosticsOpen(true)} />
        {diagnosticsModal}
      </>
    );
  }

  if (!data) return <LoadingScreen />;

  if (!tour && !isGenerating(data)) {
    return (
      <>
        <main className="setup-screen">
          <GenerationPanel
            data={data}
            onStart={startGeneration}
            onDiagnostics={() => setDiagnosticsOpen(true)}
          />
        </main>
        {diagnosticsModal}
      </>
    );
  }

  if (!tour || !page || !module || !track) {
    return (
      <>
        <GenerationScreen data={data} onDiagnostics={() => setDiagnosticsOpen(true)} />
        {diagnosticsModal}
      </>
    );
  }

  const completedCount = Object.values(data.progress.pages).filter((state) => state.completed).length;
  const generating = isGenerating(data);

  return (
    <div className={`app-shell ${generating ? "has-generation" : ""}`}>
      <TopBar
        projectName={data.inventory.name}
        completedCount={completedCount}
        pageCount={orderedPages.length}
        onToggleRail={() => setRailOpen((open) => !open)}
        onDiagnostics={() => setDiagnosticsOpen(true)}
        onNewTour={() => setGenerateOpen(true)}
      />
      {generating && (
        <GenerationBanner data={data} onCancel={() => { void api.cancelGeneration(); }} />
      )}
      {data.freshness && !data.freshness.fresh && <FreshnessBanner freshness={data.freshness} />}
      <TourContent
        data={data}
        tour={tour}
        page={page}
        module={module}
        track={track}
        orderedPages={orderedPages}
        pageIndex={pageIndex}
        interactionIndex={interactionIndex}
        railOpen={railOpen}
        onSelectPage={selectPage}
        onSelectInteraction={setInteractionIndex}
        onOpenEvidence={setEvidence}
        onUpdateProgress={updateProgress}
      />
      {generateOpen && (
        <div className="modal-backdrop" onMouseDown={() => setGenerateOpen(false)}>
          <div className="modal generation-modal" onMouseDown={(event) => event.stopPropagation()}>
            <GenerationPanel
              data={data}
              onStart={startGeneration}
              onClose={() => setGenerateOpen(false)}
              onDiagnostics={() => setDiagnosticsOpen(true)}
            />
          </div>
        </div>
      )}
      {diagnosticsModal}
      {evidence && (
        <>
          <div className="drawer-backdrop" onClick={() => setEvidence(undefined)} />
          <EvidenceDrawer evidence={evidence} onClose={() => setEvidence(undefined)} />
        </>
      )}
    </div>
  );
}
