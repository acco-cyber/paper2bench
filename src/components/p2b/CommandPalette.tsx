"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import {
  BarChart3,
  BookOpenCheck,
  Boxes,
  Cpu,
  Database,
  FileCheck2,
  FileDown,
  FlaskConical,
  FolderTree,
  Layers,
  LayoutDashboard,
  ListChecks,
  Moon,
  Plus,
  ScrollText,
  Settings2,
  Sun,
  Wrench,
} from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { useP2B } from "@/lib/p2b/store";
import { readinessScore } from "@/lib/p2b/insights";
import type { ViewId } from "@/lib/p2b/types";

/**
 * Global command palette (⌘K / Ctrl+K).
 * One surface for navigation, cross-project search and every power action —
 * keyboard-first, fully accessible, no mouse required.
 */

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setView = useP2B((s) => s.setView);
  const activeId = useP2B((s) => s.activeProjectId);
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const projects = useP2B((s) => s.projects);
  const { resolvedTheme, setTheme } = useTheme();

  const projectList = useMemo(() => Object.values(projects), [projects]);

  const go = (v: ViewId) => {
    setView(v);
    onOpenChange(false);
  };

  const run = (fn: () => void) => {
    fn();
    onOpenChange(false);
  };

  const NAV_ITEMS: { id: ViewId; label: string; icon: React.ReactNode }[] = [
    { id: "projects", label: "All projects", icon: <Layers className="h-4 w-4" /> },
    { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: "evidence", label: "Evidence ledger", icon: <BookOpenCheck className="h-4 w-4" /> },
    { id: "plan", label: "Reproduction plan", icon: <ListChecks className="h-4 w-4" /> },
    { id: "datasets", label: "Dataset audit", icon: <Database className="h-4 w-4" /> },
    { id: "compute", label: "Compute estimate", icon: <Cpu className="h-4 w-4" /> },
    { id: "files", label: "Project files", icon: <FolderTree className="h-4 w-4" /> },
    { id: "validation", label: "Validation", icon: <FileCheck2 className="h-4 w-4" /> },
    { id: "runs", label: "Runs & results", icon: <FlaskConical className="h-4 w-4" /> },
    { id: "sweeps", label: "Sweep analytics", icon: <BarChart3 className="h-4 w-4" /> },
    { id: "export", label: "Export & share", icon: <FileDown className="h-4 w-4" /> },
    { id: "settings", label: "Settings & privacy", icon: <Settings2 className="h-4 w-4" /> },
  ];

  const searchClaim = (claimId: string) => {
    useP2B.setState({ selectedClaimId: claimId });
    go("evidence");
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search views, projects, claims, tasks, runs…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No results — try a claim id like “learning_rate”.</CommandEmpty>

        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map((n) => (
            <CommandItem key={n.id} value={`go ${n.label}`} onSelect={() => go(n.id)}>
              <span className="text-primary">{n.icon}</span>
              {n.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {projectList.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Projects (${projectList.length})`}>
              {projectList.map((p) => {
                const r = readinessScore(p);
                return (
                  <CommandItem
                    key={p.id}
                    value={`project ${p.paper.title} ${p.id}`}
                    onSelect={() =>
                      run(() => useP2B.setState({ activeProjectId: p.id, view: "overview" }))
                    }
                  >
                    <ScrollText className="h-4 w-4 text-primary" />
                    <span className="flex-1 truncate">{p.paper.title}</span>
                    {p.id === activeId ? (
                      <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">open</span>
                    ) : null}
                    <span className="ml-2 font-mono text-[11px] text-muted-foreground">{r.total}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        ) : null}

        {project ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Search this project — ${project.paper.title.slice(0, 48)}`}>
              {project.claims
                .filter((c) => c.value !== null || c.evidence_status === "conflicting")
                .slice(0, 40)
                .map((c) => (
                  <CommandItem
                    key={c.claim_id}
                    value={`claim ${c.claim_id} ${c.label}`}
                    onSelect={() => searchClaim(c.claim_id)}
                  >
                    <BookOpenCheck className="h-4 w-4 text-muted-foreground" />
                    <span className="font-mono text-[12px]">{c.claim_id}</span>
                    <span className="ml-2 truncate text-muted-foreground">{c.label}</span>
                  </CommandItem>
                ))}
              {project.tasks.slice(0, 20).map((t) => (
                <CommandItem key={t.task_id} value={`task ${t.title}`} onSelect={() => go("plan")}>
                  <ListChecks className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{t.title}</span>
                </CommandItem>
              ))}
              {project.runs.slice(0, 10).map((r) => (
                <CommandItem key={r.run_id} value={`run ${r.run_id} ${r.label ?? ""}`} onSelect={() => go("runs")}>
                  <FlaskConical className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-[12px]">{r.run_id}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="action new paper import" onSelect={() => go("import")}>
            <Plus className="h-4 w-4 text-primary" /> New paper…
          </CommandItem>
          {project ? (
            <>
              <CommandItem value="action generate plan" onSelect={() => run(() => useP2B.getState().generatePlan(project.id, "main_result"))}>
                <ListChecks className="h-4 w-4 text-primary" /> Generate reproduction plan
              </CommandItem>
              <CommandItem
                value="action generate scaffold"
                onSelect={() => run(() => useP2B.getState().generateScaffold(project.id, project.scaffold?.framework ?? "pytorch", project.scaffold?.scope ?? "baseline_target"))}
              >
                <Wrench className="h-4 w-4 text-primary" /> Generate project scaffold
              </CommandItem>
              <CommandItem value="action run validation" onSelect={() => run(() => useP2B.getState().validate(project.id))}>
                <FileCheck2 className="h-4 w-4 text-primary" /> Run validation
              </CommandItem>
            </>
          ) : null}
          <CommandItem
            value="action toggle theme dark light"
            onSelect={() =>
              run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
            }
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4 text-primary" />
            ) : (
              <Moon className="h-4 w-4 text-primary" />
            )}
            Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
          </CommandItem>
          <CommandItem value="action load guided example demo" onSelect={() => run(() => useP2B.getState().loadDemo())}>
            <Boxes className="h-4 w-4 text-primary" /> Load guided example
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
