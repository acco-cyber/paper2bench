"use client";

import { useState } from "react";
import { useTheme } from "next-themes";
import { useP2B } from "@/lib/p2b/store";
import { unresolvedCriticalCount, conflictCount, reviewedCriticalCount } from "@/lib/p2b/semantics";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  BarChart3,
  BookOpenCheck,
  Boxes,
  Cpu,
  Database,
  FileDown,
  FileCheck2,
  FlaskConical,
  FolderTree,
  LayoutDashboard,
  ListChecks,
  Moon,
  Plus,
  ScrollText,
  Settings2,
  ShieldAlert,
  Sun,
} from "lucide-react";
import type { ViewId } from "@/lib/p2b/types";
import { cn } from "@/lib/utils";

const NAV: { id: ViewId; label: string; icon: React.ReactNode; group: string }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" />, group: "Workspace" },
  { id: "evidence", label: "Evidence ledger", icon: <BookOpenCheck className="h-4 w-4" />, group: "Workspace" },
  { id: "plan", label: "Reproduction plan", icon: <ListChecks className="h-4 w-4" />, group: "Workspace" },
  { id: "datasets", label: "Dataset audit", icon: <Database className="h-4 w-4" />, group: "Workspace" },
  { id: "compute", label: "Compute estimate", icon: <Cpu className="h-4 w-4" />, group: "Workspace" },
  { id: "files", label: "Project files", icon: <FolderTree className="h-4 w-4" />, group: "Build" },
  { id: "validation", label: "Validation", icon: <FileCheck2 className="h-4 w-4" />, group: "Build" },
  { id: "runs", label: "Runs & results", icon: <FlaskConical className="h-4 w-4" />, group: "Verify" },
  { id: "sweeps", label: "Sweep analytics", icon: <BarChart3 className="h-4 w-4" />, group: "Verify" },
  { id: "export", label: "Export & share", icon: <FileDown className="h-4 w-4" />, group: "Verify" },
  { id: "settings", label: "Settings & privacy", icon: <Settings2 className="h-4 w-4" />, group: "Verify" },
];

function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  // CSS-driven icon: no mounted-state needed, no hydration mismatch.
  const isDark = resolvedTheme === "dark";
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="h-9 w-9 border-border bg-card"
          >
            <Sun className="hidden h-4 w-4 dark:block" />
            <Moon className="h-4 w-4 dark:hidden" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{isDark ? "Light mode" : "Dark mode"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AppShell({
  children,
  activeView,
}: {
  children: React.ReactNode;
  activeView: ViewId;
}) {
  const activeId = useP2B((s) => s.activeProjectId);
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const setView = useP2B((s) => s.setView);
  const [navOpen, setNavOpen] = useState(false);

  const crit = project ? reviewedCriticalCount(project.claims) : { reviewed: 0, total: 0 };
  const blockers = project ? unresolvedCriticalCount(project.claims) : 0;
  const conflicts = project ? conflictCount(project.claims) : 0;

  const badgeFor = (id: ViewId): string | null => {
    if (!project) return null;
    if (id === "evidence") {
      const n = unresolvedCriticalCount(project.claims) + conflictCount(project.claims);
      return n ? String(n) : null;
    }
    if (id === "runs") return project.runs.length ? String(project.runs.length) : null;
    if (id === "plan") return project.tasks.length ? `${project.tasks.filter((t) => t.status === "done").length}/${project.tasks.length}` : null;
    return null;
  };

  const go = (v: ViewId) => {
    setView(v);
    setNavOpen(false);
  };

  return (
    <div className="flex min-h-screen w-full">
      {/* Sidebar — black in light mode, true black in dark */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform lg:static lg:translate-x-0",
          navOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-label="Primary navigation"
      >
        <button
          onClick={() => go("import")}
          className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4 text-left"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <ScrollText className="h-4.5 w-4.5" />
          </span>
          <span>
            <span className="block font-display text-[15px] font-bold leading-tight">Paper2Bench</span>
            <span className="block text-[10.5px] uppercase tracking-widest text-sidebar-foreground/50">
              evidence · plan · verify
            </span>
          </span>
        </button>

        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Workspace views">
          {["Workspace", "Build", "Verify"].map((group) => (
            <div key={group} className="mb-3">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                {group}
              </p>
              {NAV.filter((n) => n.group === group).map((n) => {
                const active = activeView === n.id;
                const badge = badgeFor(n.id);
                return (
                  <button
                    key={n.id}
                    onClick={() => go(n.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "mb-0.5 flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13.5px] transition-colors",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_2px_0_0_var(--sidebar-primary)]"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    )}
                  >
                    <span className={active ? "text-sidebar-primary" : ""}>{n.icon}</span>
                    <span className="flex-1 text-left">{n.label}</span>
                    {badge ? (
                      <span className="rounded-full bg-sidebar-primary/20 px-1.5 py-0.5 text-[10.5px] font-semibold text-sidebar-primary">
                        {badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <Button
            onClick={() => go("import")}
            className="w-full gap-2 bg-sidebar-primary font-medium text-sidebar-primary-foreground hover:bg-sidebar-primary/90"
            size="sm"
          >
            <Plus className="h-4 w-4" /> New paper
          </Button>
          <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[10.5px] text-sidebar-foreground/45">
            <Boxes className="h-3 w-3" /> Local-first · no account required
          </p>
        </div>
      </aside>

      {navOpen ? (
        <button
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      {/* Main column */}
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 lg:hidden"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <LayoutDashboard className="h-4 w-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold leading-tight">
                {project ? project.paper.title : "Paper2Bench"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {project
                  ? `${project.paper.source_kind.toUpperCase()} · hash ${project.paper.source_version.slice(0, 10)} · Local-only mode`
                  : "Evidence-first reproduction workspace"}
              </p>
            </div>

            {project ? (
              <button
                onClick={() => go("evidence")}
                className="hidden items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground sm:flex"
                title="Critical claims reviewed"
              >
                <ListChecks className="h-3.5 w-3.5 text-primary" />
                <span>
                  {crit.reviewed}/{crit.total} critical reviewed
                </span>
                {blockers + conflicts > 0 ? (
                  <span className="flex items-center gap-1 rounded-full bg-destructive/12 px-1.5 py-0.5 text-[10.5px] font-semibold text-destructive">
                    <ShieldAlert className="h-3 w-3" /> {blockers + conflicts}
                  </span>
                ) : null}
              </button>
            ) : null}

            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-8">{children}</main>

        <footer className="mt-auto border-t border-border bg-card/60">
          <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-2 px-4 py-3 text-[11.5px] text-muted-foreground lg:px-8">
            <p>
              Paper2Bench v1.0 — extraction can check evidence, not truth. Verify anchors before trusting values.
            </p>
            <p>Local-first · data stays in your browser · no code execution on server</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
