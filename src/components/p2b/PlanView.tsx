"use client";

import { useState } from "react";
import { useP2B } from "@/lib/p2b/store";
import type { PlanPreset } from "@/lib/p2b/planner";
import type { ProtocolTask, TaskStatus } from "@/lib/p2b/types";
import { SectionHeading, StatusPill, EmptyState } from "./bits";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { formatValue } from "@/lib/p2b/semantics";
import { Link2, Play, ShieldAlert, Wand2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PRESETS: { id: PlanPreset; label: string; desc: string }[] = [
  { id: "smoke_only", label: "Smoke test only", desc: "Environment + model + loss + synthetic smoke. No dataset, no eval." },
  { id: "main_result", label: "Main result", desc: "Full chain to compare the headline metric." },
  { id: "main_plus_ablations", label: "Main result (base set)", desc: "Same base chain; add ablation tasks manually as needed." },
  { id: "full_paper", label: "Full paper reproduction", desc: "Main chain + ablation table rows." },
];

const TASK_STATUS_META: Record<TaskStatus, { label: string; tone: string }> = {
  not_started: { label: "Not started", tone: "muted" },
  in_progress: { label: "In progress", tone: "neutral" },
  blocked: { label: "Blocked", tone: "bad" },
  needs_review: { label: "Needs review", tone: "warn" },
  done: { label: "Done", tone: "good" },
  not_applicable: { label: "N/A", tone: "muted" },
};

const PHASES: ProtocolTask["phase"][] = [
  "data",
  "environment",
  "model",
  "loss",
  "training",
  "evaluation",
  "comparison",
  "report",
];

/** Screen F — reproduction plan: a work queue, not an opaque Gantt. */
export function PlanView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const generatePlan = useP2B((s) => s.generatePlan);
  const setTaskStatus = useP2B((s) => s.setTaskStatus);
  const setView = useP2B((s) => s.setView);
  const [preset, setPreset] = useState<PlanPreset>("main_result");
  const [ownerDraft, setOwnerDraft] = useState<Record<string, string>>({});

  if (!project) return null;

  const claimById = new Map(project.claims.map((c) => [c.claim_id, c]));

  const generate = () => {
    generatePlan(project.id, preset);
    toast({
      title: "Reproduction plan generated",
      description: "Tasks carry dependencies, claim references and acceptance criteria. Presets never imply the scope is sufficient for every paper.",
    });
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Reproduction plan"
        desc="Ordered, dependency-aware tasks mapped to evidence claims. Tasks cannot hide their prerequisites — marking a task done while prerequisites are open records a justified override via the note."
      />

      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Scope preset</p>
        <div className="grid gap-2 md:grid-cols-4">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={cn(
                "rounded-lg border p-3 text-left text-[12.5px] transition-colors",
                preset === p.id
                  ? "border-primary bg-primary/8 font-medium"
                  : "border-border hover:border-primary/40"
              )}
              aria-pressed={preset === p.id}
            >
              <span className="block font-semibold">{p.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{p.desc}</span>
            </button>
          ))}
        </div>
        <Button onClick={generate} className="mt-3 gap-2">
          <Wand2 className="h-4 w-4" /> {project.tasks.length ? "Regenerate plan" : "Generate plan"}
        </Button>
        {project.tasks.length ? (
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            Regenerating resets task states — export notes first if you need them.
          </p>
        ) : null}
      </div>

      {project.tasks.length === 0 ? (
        <EmptyState
          icon={<ListChecksIcon />}
          title="No plan yet"
          hint="Pick a scope preset and generate. Every critical task will link to the claims that motivated it."
        />
      ) : (
        <div className="space-y-5">
          {PHASES.map((phase) => {
            const tasks = project.tasks.filter((t) => t.phase === phase);
            if (!tasks.length) return null;
            return (
              <div key={phase}>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {phase}
                </p>
                <div className="space-y-2">
                  {tasks.map((t) => {
                    const depOpen = t.dependencies
                      .map((d) => project.tasks.find((x) => x.task_id === d))
                      .filter((x) => x && x.status !== "done" && x.status !== "not_applicable");
                    return (
                      <div key={t.task_id} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[13.5px] font-semibold">{t.title}</p>
                            <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{t.description}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill tone={TASK_STATUS_META[t.status].tone}>{TASK_STATUS_META[t.status].label}</StatusPill>
                            <Select
                              value={t.status}
                              onValueChange={(v) => {
                                if ((v === "done") && depOpen.length > 0) {
                                  const note = window.prompt(
                                    `Dependencies not complete: ${depOpen.map((d) => d!.title).join(", ")}. Record a justified override note:`
                                  );
                                  if (note === null) return;
                                  setTaskStatus(project.id, t.task_id, "done", note);
                                } else {
                                  setTaskStatus(project.id, t.task_id, v as TaskStatus);
                                }
                              }}
                            >
                              <SelectTrigger className="h-8 w-[130px]" aria-label={`Set status for ${t.title}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(TASK_STATUS_META).map(([k, v]) => (
                                  <SelectItem key={k} value={k}>
                                    {v.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 text-[12px] md:grid-cols-3">
                          <div className="rounded-lg bg-muted/60 p-2.5">
                            <p className="font-semibold text-muted-foreground">Acceptance criteria</p>
                            <p className="mt-0.5 leading-snug">{t.acceptance_criteria}</p>
                          </div>
                          <div className="rounded-lg bg-muted/60 p-2.5">
                            <p className="font-semibold text-muted-foreground">Depends on</p>
                            {t.dependencies.length ? (
                              <ul className="mt-0.5 space-y-0.5">
                                {t.dependencies.map((d) => {
                                  const dt = project.tasks.find((x) => x.task_id === d);
                                  return (
                                    <li key={d} className="leading-snug">
                                      {dt?.title ?? d}
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="mt-0.5">—</p>
                            )}
                          </div>
                          <div className="rounded-lg bg-muted/60 p-2.5">
                            <p className="font-semibold text-muted-foreground">Claim refs · effort/risk</p>
                            {t.claim_refs.length ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {t.claim_refs.slice(0, 6).map((r) => (
                                  <button
                                    key={r}
                                    onClick={() => {
                                      useP2B.setState({ selectedClaimId: r });
                                      setView("evidence");
                                    }}
                                    className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10.5px] text-primary hover:bg-primary/20"
                                    title={`Open claim ${r}`}
                                  >
                                    <Link2 className="h-3 w-3" /> {r}
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-0.5">generic task</p>
                            )}
                            <p className="mt-1.5 text-muted-foreground">
                              {t.effort} · {t.risk} risk
                            </p>
                          </div>
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <Input
                            placeholder="Owner (optional)"
                            value={ownerDraft[t.task_id] ?? t.owner ?? ""}
                            onChange={(e) => setOwnerDraft((s) => ({ ...s, [t.task_id]: e.target.value }))}
                            onBlur={(e) => {
                              const p = useP2B.getState();
                              const proj = p.activeProjectId ? p.projects[p.activeProjectId] : null;
                              if (!proj) return;
                              useP2B.setState({
                                projects: {
                                  ...p.projects,
                                  [proj.id]: {
                                    ...proj,
                                    tasks: proj.tasks.map((x) =>
                                      x.task_id === t.task_id ? { ...x, owner: e.target.value || null } : x
                                    ),
                                  },
                                },
                              });
                            }}
                            className="h-8 w-40 text-[12px]"
                          />
                          {depOpen.length ? (
                            <span className="flex items-center gap-1 text-[11px] text-[var(--warning)]">
                              <ShieldAlert className="h-3 w-3" /> {depOpen.length} prerequisite(s) open
                            </span>
                          ) : null}
                          {t.note ? (
                            <span className="text-[11px] text-muted-foreground">note: {t.note}</span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Unresolved claims feeding the plan */}
      {project.claims.some((c) => c.impact === "critical" && (c.evidence_status === "unspecified" || c.evidence_status === "conflicting")) ? (
        <div className="rounded-xl border border-amber-warm/50 bg-[color-mix(in_srgb,var(--amber-warm)_9%,transparent)] p-4 text-[12.5px]">
          <p className="mb-1.5 font-semibold text-[var(--warning)]">Unresolved critical claims feeding these tasks</p>
          <ul className="list-disc space-y-1 pl-5">
            {project.claims
              .filter((c) => c.impact === "critical" && (c.evidence_status === "unspecified" || c.evidence_status === "conflicting"))
              .map((c) => (
                <li key={c.claim_id}>
                  <code className="font-mono text-[11.5px]">{c.field_path}</code> — {c.evidence_status}
                  {c.value !== null ? `, current display: ${formatValue(c.value, c.unit)}` : ""}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ListChecksIcon() {
  return <Play className="h-8 w-8" />;
}
