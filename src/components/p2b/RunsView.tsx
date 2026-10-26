"use client";

import { useMemo, useRef, useState } from "react";
import { useP2B } from "@/lib/p2b/store";
import { compareAll, REPRO_STATE_LABELS, REPRO_STATE_TONE, projectStatus } from "@/lib/p2b/comparison";
import { parseRunsCsv, parseRunsJsonl } from "@/lib/p2b/extract-heuristic";
import type { ReproductionState } from "@/lib/p2b/types";
import { SectionHeading, StatusPill, EmptyState } from "./bits";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FlaskConical, Info, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "./format";

/** Screen K — runs & result comparison with protocol-mismatch visibility. */
export function RunsView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const importRuns = useP2B((s) => s.importRuns);
  const addAssessment = useP2B((s) => s.addAssessment);
  const [paste, setPaste] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [assessTarget, setAssessTarget] = useState<string | null>(null); // `${metricId}|${runId}`
  const [assessStatus, setAssessStatus] = useState<ReproductionState>("needs_verification");
  const [assessNote, setAssessNote] = useState("");
  const [confirmCriteria, setConfirmCriteria] = useState(false);

  const comparison = useMemo(() => (project ? compareAll(project) : []), [project]);
  const status = useMemo(() => (project ? projectStatus(project) : null), [project]);

  if (!project) return null;

  const doImport = (text: string, kind: "jsonl" | "csv") => {
    const res = kind === "jsonl" ? parseRunsJsonl(text) : parseRunsCsv(text);
    if (res.errors.length) {
      toast({
        title: `Imported ${res.runs.length} run(s) with ${res.errors.length} problem line(s)`,
        description: res.errors.slice(0, 3).join(" · "),
        variant: res.runs.length ? "default" : "destructive",
      });
    } else if (res.runs.length === 0) {
      toast({ title: "No runs found", description: "Expected one JSON object per line with metrics.", variant: "destructive" });
      return;
    } else {
      toast({ title: `Imported ${res.runs.length} run manifest(s)`, description: "Metric records map to run provenance fields." });
    }
    if (res.runs.length) importRuns(project.id, res.runs);
    setPaste("");
  };

  const targetKey = assessTarget;
  const targetRow = targetKey ? comparison.find((r) => `${r.reported_metric_id}|${r.run_id ?? ""}` === targetKey) : null;

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Runs & results"
        desc="Reported (paper) and measured (your runs) values live in separate panels and are never conflated. 'Reproduction criteria passed' requires your explicit protocol confirmation."
        right={
          status ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null
        }
      />

      {status ? (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-[12.5px] text-muted-foreground">{status.detail}</p>
      ) : null}

      {/* Import */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
          <Upload className="h-4 w-4 text-primary" /> Import run manifests (JSONL or CSV)
        </p>
        <Tabs defaultValue="jsonl">
          <TabsList className="bg-muted">
            <TabsTrigger value="jsonl">Paste JSONL</TabsTrigger>
            <TabsTrigger value="file">Upload file</TabsTrigger>
          </TabsList>
          <TabsContent value="jsonl" className="mt-3 space-y-2">
            <Textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'{"run_id":"run_1","seed":42,"config_hash":"abc123","dataset_fingerprint":"ds-sha…","metrics":[{"name":"BLEU","value":27.9,"split":"newstest2014"}]}\n{"run_id":"run_2","bleu":28.2,"seed":7}'}
              className="code-pane min-h-[110px]"
              aria-label="Paste JSONL run manifests"
            />
            <Button size="sm" onClick={() => doImport(paste, "jsonl")} disabled={!paste.trim()}>
              Parse & import
            </Button>
          </TabsContent>
          <TabsContent value="file" className="mt-3">
            <input
              ref={fileRef}
              type="file"
              accept=".jsonl,.json,.csv,.txt"
              className="block w-full rounded-lg border border-dashed border-input p-3 text-[12.5px] file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                void f.text().then((t) => doImport(t, f.name.endsWith(".csv") ? "csv" : "jsonl"));
              }}
            />
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              MLflow-style exports map into the common manifest schema; missing fields stay explicit.
            </p>
          </TabsContent>
        </Tabs>
      </div>

      {/* Run table */}
      {project.runs.length === 0 ? (
        <EmptyState
          icon={<FlaskConical className="h-8 w-8" />}
          title="No runs recorded"
          hint="Train locally with the generated scaffold (it writes a manifest), then import the JSONL here. Nothing is claimed until you do."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Run</th>
                  <th className="px-4 py-2.5 font-semibold">Seed</th>
                  <th className="px-4 py-2.5 font-semibold">Metrics</th>
                  <th className="px-4 py-2.5 font-semibold">Provenance</th>
                  <th className="px-4 py-2.5 font-semibold">Finished</th>
                </tr>
              </thead>
              <tbody>
                {project.runs.map((r) => (
                  <tr key={r.run_id} className="border-b border-border/60">
                    <td className="px-4 py-3">
                      <p className="font-mono text-[12.5px] font-semibold">{r.run_id}</p>
                      {r.label ? <p className="max-w-[260px] truncate text-[11.5px] text-muted-foreground">{r.label}</p> : null}
                      {r.is_example ? (
                        <span className="mt-1 inline-block rounded bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warning)]">
                          EXAMPLE — not a real execution
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12.5px]">{r.seed ?? "—"}</td>
                    <td className="px-4 py-3">
                      {r.metrics.map((m) => (
                        <p key={m.name} className="font-mono text-[12px]">
                          {m.name}: <strong>{m.value}</strong>
                          {m.split ? <span className="text-muted-foreground"> @{m.split}</span> : null}
                        </p>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-[11.5px] text-muted-foreground">
                      <p>commit: {r.code_commit ?? "—"}</p>
                      <p>config: {r.config_hash ?? "—"}</p>
                      <p>dataset: {r.dataset_fingerprint ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-[11.5px] text-muted-foreground">{fmtDateTime(r.finished_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reported vs measured */}
      {project.reported_metrics.length ? (
        <div>
          <p className="mb-2 text-[13px] font-semibold">Reported vs measured</p>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[13px]">
                <thead className="border-b border-border bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Metric</th>
                    <th className="px-4 py-2.5 font-semibold">Reported (paper)</th>
                    <th className="px-4 py-2.5 font-semibold">Measured (run)</th>
                    <th className="px-4 py-2.5 font-semibold">Abs Δ</th>
                    <th className="px-4 py-2.5 font-semibold">Rel Δ</th>
                    <th className="px-4 py-2.5 font-semibold">Assessment</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((r) => {
                    const key = `${r.reported_metric_id}|${r.run_id ?? ""}`;
                    const existing = project.assessments.find(
                      (a) => a.reported_metric_id === r.reported_metric_id && a.run_id === r.run_id
                    );
                    const shown = existing?.status ?? r.suggested_state;
                    return (
                      <tr key={key} className="border-b border-border/60 align-top">
                        <td className="px-4 py-3 font-medium">{r.metric}</td>
                        <td className="px-4 py-3">
                          <p className="font-mono text-[12.5px] font-semibold">{r.reported}</p>
                          <p className="max-w-[220px] text-[11px] text-muted-foreground">{r.reportedSource}</p>
                          <p className="text-[11px] text-muted-foreground">{r.reportedAggregation}</p>
                        </td>
                        <td className="px-4 py-3">
                          {r.measured !== null ? (
                            <>
                              <p className="font-mono text-[12.5px] font-semibold">
                                {r.measured}
                                {r.is_example_run ? <span className="ml-1.5 rounded bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] px-1 text-[9.5px] font-bold text-[var(--warning)]">EXAMPLE</span> : null}
                              </p>
                              <p className="font-mono text-[11px] text-muted-foreground">{r.run_id}</p>
                            </>
                          ) : (
                            <span className="text-[12px] italic text-muted-foreground">no run measures this</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12.5px]">
                          {r.abs_delta !== null ? (
                            <span className={r.abs_delta === 0 ? "" : Math.abs(r.abs_delta) <= 0.35 ? "text-[var(--success)]" : "text-destructive"}>
                              {r.abs_delta > 0 ? "+" : ""}
                              {r.abs_delta}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[12.5px]">
                          {r.rel_delta_meaningful && r.rel_delta !== null
                            ? `${(r.rel_delta * 100).toFixed(1)}%`
                            : <span className="text-[11px] text-muted-foreground" title="Relative delta is meaningless for zero/signed metrics">n/a</span>}
                        </td>
                        <td className="px-4 py-3">
                          <StatusPill tone={REPRO_STATE_TONE[shown]}>{REPRO_STATE_LABELS[shown]}</StatusPill>
                          {r.mismatches.length ? (
                            <ul className="mt-1.5 max-w-[280px] space-y-1 text-[11px] leading-snug text-[var(--warning)]">
                              {r.mismatches.slice(0, 3).map((m, i) => (
                                <li key={i}>• {m}</li>
                              ))}
                            </ul>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {r.run_id ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAssessTarget(key);
                                setAssessStatus(existing?.status ?? r.suggested_state);
                                setAssessNote(existing?.reviewer_note ?? "");
                                setConfirmCriteria(existing?.criteria_confirmed_by_user ?? false);
                              }}
                            >
                              Assess
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Absolute difference is the default. Relative difference is shown only when the reported baseline is positive and nonzero — it is meaningless for zero or signed metrics.
          </p>
        </div>
      ) : null}

      {/* Assessment dialog */}
      <Dialog open={Boolean(targetRow)} onOpenChange={(o) => !o && setAssessTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Assess reproduction status</DialogTitle>
            <DialogDescription>
              {targetRow ? (
                <>
                  {targetRow.metric}: reported <strong>{targetRow.reported}</strong> vs measured{" "}
                  <strong>{targetRow.measured}</strong> (abs Δ {targetRow.abs_delta}).
                  {targetRow.mismatches.length ? ` ${targetRow.mismatches.length} protocol mismatch(es) recorded.` : ""}
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(REPRO_STATE_LABELS) as ReproductionState[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setAssessStatus(s)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left text-[12px] transition-colors",
                    assessStatus === s ? "border-primary bg-primary/10 font-medium" : "border-border hover:border-primary/40"
                  )}
                  aria-pressed={assessStatus === s}
                >
                  {REPRO_STATE_LABELS[s]}
                </button>
              ))}
            </div>
            {assessStatus === "criteria_passed" ? (
              <label className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={confirmCriteria}
                  onChange={(e) => setConfirmCriteria(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I confirm the declared protocol criteria passed (same dataset/split, metric definition,
                  model variant, seed policy, checkpoint selection) and evidence is attached. Without this
                  confirmation the state is downgraded — Paper2Bench never awards “passed” automatically.
                </span>
              </label>
            ) : null}
            <Textarea
              placeholder="Reviewer note (stored with the assessment)"
              value={assessNote}
              onChange={(e) => setAssessNote(e.target.value)}
              className="min-h-[70px]"
            />
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                if (!targetRow) return;
                addAssessment(project.id, targetRow, assessStatus, assessNote, confirmCriteria);
                if (assessStatus === "criteria_passed" && !confirmCriteria) {
                  toast({ title: "Downgraded to needs verification", description: "criteria_passed requires your explicit confirmation." });
                } else {
                  toast({ title: `Assessment saved: ${REPRO_STATE_LABELS[assessStatus]}` });
                }
                setAssessTarget(null);
              }}
            >
              Save assessment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
