"use client";

import { useP2B } from "@/lib/p2b/store";
import { conflictCount, evidenceCoverage, isBlocker, reviewedCriticalCount, unresolvedCriticalCount } from "@/lib/p2b/semantics";
import { StatusPill, SectionHeading } from "./bits";
import { Button } from "@/components/ui/button";
import type { ViewId } from "@/lib/p2b/types";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Database,
  FlaskConical,
  FolderTree,
  ListChecks,
  OctagonAlert,
  ShieldAlert,
} from "lucide-react";
import { timeAgo } from "./format";

/** Screen C — project overview: orient, then point at the next most useful action. */
export function OverviewView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const setView = useP2B((s) => s.setView);

  if (!project) return null;
  const crit = reviewedCriticalCount(project.claims);
  const blockers = unresolvedCriticalCount(project.claims);
  const conflicts = conflictCount(project.claims);
  const coverage = evidenceCoverage(project.claims);

  const cards: {
    id: ViewId;
    icon: React.ReactNode;
    title: string;
    status: string;
    tone: string;
    next: string;
  }[] = [
    {
      id: "evidence",
      icon: <BookOpenCheck className="h-4 w-4" />,
      title: "Evidence ledger",
      status: `${project.claims.filter((c) => c.value !== null).length} populated / ${project.claims.length} claims`,
      tone: conflicts ? "bad" : "good",
      next: conflicts ? `${conflicts} conflict(s) to resolve` : blockers ? `${blockers} blocker(s)` : "all reviewed claims accepted or corrected",
    },
    {
      id: "plan",
      icon: <ListChecks className="h-4 w-4" />,
      title: "Reproduction plan",
      status: project.tasks.length ? `${project.tasks.filter((t) => t.status === "done").length}/${project.tasks.length} tasks done` : "not generated",
      tone: project.tasks.length ? "good" : "muted",
      next: project.tasks.length ? "update task states as you implement" : "generate from reviewed claims",
    },
    {
      id: "files",
      icon: <FolderTree className="h-4 w-4" />,
      title: "Project scaffold",
      status: project.scaffold ? `${project.scaffold.files.length} files (${project.scaffold.framework})` : "not generated",
      tone: project.scaffold ? "good" : "muted",
      next: project.scaffold ? (project.provisional ? "provisional — unresolved criticals" : "validate or export") : "generate after review",
    },
    {
      id: "runs",
      icon: <FlaskConical className="h-4 w-4" />,
      title: "Runs & results",
      status: `${project.runs.length} run(s) recorded`,
      tone: project.runs.length ? "neutral" : "muted",
      next: project.runs.length ? "compare reported vs measured" : "import a run manifest after training",
    },
  ];

  const nextAction: { label: string; view: ViewId; detail: string } | null = (() => {
    if (conflicts)
      return {
        label: `Resolve ${conflicts} conflicting claim${conflicts > 1 ? "s" : ""}`,
        view: "evidence",
        detail: "Competing source values exist. The config cannot be trusted until resolved explicitly.",
      };
    if (blockers)
      return {
        label: `Review ${blockers} unresolved critical claim${blockers > 1 ? "s" : ""}`,
        view: "evidence",
        detail: "Critical unknowns directly change training results — decide or accept them knowingly.",
      };
    if (!project.tasks.length)
      return {
        label: "Generate the reproduction plan",
        view: "plan",
        detail: "Ordered tasks with dependencies and acceptance criteria, mapped to claims.",
      };
    if (!project.scaffold)
      return {
        label: "Generate the project scaffold",
        view: "files",
        detail: "Deterministic PyTorch / Hugging Face files with provenance comments.",
      };
    if (!project.validation)
      return {
        label: "Run scaffold validation",
        view: "validation",
        detail: "Config, static and traceability checks (executable checks stay honestly blocked in-browser).",
      };
    if (!project.runs.length)
      return {
        label: "Import run records",
        view: "runs",
        detail: "JSONL/CSV manifests; then compare reported vs measured under protocol criteria.",
      };
    return null;
  })();

  const warnings: string[] = [];
  if (project.coverage?.image_only_pages.length)
    warnings.push(`${project.coverage.image_only_pages.length} page(s) appear image-only — their text was not extracted.`);
  if (project.paper.extraction_scope === "abstract_only")
    warnings.push("Extraction ran on abstract/metadata only — hyperparameters and setup need the full-text PDF.");
  if (project.provisional) warnings.push("Scaffold was generated with unresolved critical claims — exported artifacts are marked provisional.");
  project.claims.filter(isBlocker).slice(0, 3).forEach((c) =>
    warnings.push(`Blocker: \`${c.field_path}\` is ${c.evidence_status}.`)
  );

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Project overview"
        desc={`${project.paper.source_kind.toUpperCase()} · source ${project.paper.source_url || "local file"} · processed ${timeAgo(project.paper.retrieved_at)} · parser: ${project.coverage?.parser ?? "n/a"}`}
      />

      {/* Status strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Critical claims reviewed", value: `${crit.reviewed}/${crit.total}`, tone: crit.reviewed === crit.total ? "good" : "warn", icon: <BookOpenCheck className="h-4 w-4" /> },
          { label: "Unresolved conflicts", value: String(conflicts), tone: conflicts ? "bad" : "good", icon: <OctagonAlert className="h-4 w-4" /> },
          { label: "Blockers", value: String(blockers), tone: blockers ? "bad" : "good", icon: <ShieldAlert className="h-4 w-4" /> },
          { label: "Evidence coverage", value: `${Math.round(coverage * 100)}%`, tone: coverage > 0.9 ? "good" : "warn", icon: <Database className="h-4 w-4" /> },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11.5px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <span className="text-muted-foreground">{s.icon}</span>
            </div>
            <p className="mt-1.5 font-display text-2xl font-semibold">{s.value}</p>
            <div className="mt-1.5">
              <StatusPill tone={s.tone}>
                {s.tone === "good" ? "healthy" : s.tone === "bad" ? "needs action" : "in progress"}
              </StatusPill>
            </div>
          </div>
        ))}
      </div>

      {/* Next action */}
      {nextAction ? (
        <button
          onClick={() => setView(nextAction.view)}
          className="flex w-full items-center gap-4 rounded-xl border border-primary/40 bg-primary/6 p-4 text-left transition-colors hover:bg-primary/12"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ArrowRight className="h-4.5 w-4.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10.5px] font-semibold uppercase tracking-widest text-primary">
              Recommended next action
            </span>
            <span className="block text-[14.5px] font-semibold">{nextAction.label}</span>
            <span className="block text-[12.5px] text-muted-foreground">{nextAction.detail}</span>
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] p-4">
          <Activity className="h-5 w-5 text-[var(--success)]" />
          <p className="text-[13.5px]">
            <strong>All caught up.</strong> Review claims, keep tasks moving, and import run manifests as you train.
          </p>
        </div>
      )}

      {/* Work cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.id}
            onClick={() => setView(c.id)}
            className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">{c.icon}</span>
              <StatusPill tone={c.tone}>{c.status}</StatusPill>
            </div>
            <p className="mt-3 text-[13.5px] font-semibold">{c.title}</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">{c.next}</p>
          </button>
        ))}
      </div>

      {/* Warnings */}
      {warnings.length ? (
        <div className="rounded-xl border border-amber-warm/50 bg-[color-mix(in_srgb,var(--amber-warm)_9%,transparent)] p-4">
          <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--warning)]">
            <AlertTriangle className="h-4 w-4" /> Warnings — read before generating anything
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-foreground/85">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Recent activity */}
      <div>
        <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h3>
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {project.activity.slice(0, 8).map((a, i) => (
            <li key={i} className="flex items-baseline gap-3 px-4 py-2.5">
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{timeAgo(a.at)}</span>
              <span className="text-[12.5px] leading-snug">{a.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
