"use client";

import { useEffect, useState } from "react";
import { useP2B } from "@/lib/p2b/store";
import { AppShell } from "@/components/p2b/AppShell";
import { ImportView } from "@/components/p2b/ImportView";
import { ProcessingView } from "@/components/p2b/ProcessingView";
import { OverviewView } from "@/components/p2b/OverviewView";
import { EvidenceView } from "@/components/p2b/EvidenceView";
import { PlanView } from "@/components/p2b/PlanView";
import { DatasetView } from "@/components/p2b/DatasetView";
import { ComputeView } from "@/components/p2b/ComputeView";
import { FilesView } from "@/components/p2b/FilesView";
import { ValidationView } from "@/components/p2b/ValidationView";
import { RunsView } from "@/components/p2b/RunsView";
import { SweepsView } from "@/components/p2b/SweepsView";
import { ExportView } from "@/components/p2b/ExportView";
import { SettingsView } from "@/components/p2b/SettingsView";
import type { ViewId } from "@/lib/p2b/types";

/**
 * Paper2Bench — single-surface application.
 * Route contract: everything renders at "/" (the workspace is a state machine, not a URL map).
 */
export default function Home() {
  const view = useP2B((s) => s.view);
  const activeId = useP2B((s) => s.activeProjectId);
  const processing = useP2B((s) => s.processing);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // zustand/persist rehydration guard — avoids SSR/client mismatch
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-label="Loading" />
          <p className="font-display text-sm text-muted-foreground">Paper2Bench</p>
        </div>
      </div>
    );
  }

  const project = activeId ? useP2B.getState().projects[activeId] : null;

  // Import landing has its own full-page chrome (no workspace shell)
  if (view === "import" || (!project && !processing)) {
    return <ImportView />;
  }

  if (view === "processing" && processing) {
    return <ProcessingView />;
  }

  if (!project) {
    return <ImportView />;
  }

  const renderView = (v: ViewId) => {
    switch (v) {
      case "overview":
        return <OverviewView />;
      case "evidence":
        return <EvidenceView />;
      case "plan":
        return <PlanView />;
      case "datasets":
        return <DatasetView />;
      case "compute":
        return <ComputeView />;
      case "files":
        return <FilesView />;
      case "validation":
        return <ValidationView />;
      case "runs":
        return <RunsView />;
      case "sweeps":
        return <SweepsView />;
      case "export":
        return <ExportView />;
      case "settings":
        return <SettingsView />;
      default:
        return <OverviewView />;
    }
  };

  return (
    <AppShell activeView={view}>
      {renderView(view)}
    </AppShell>
  );
}
