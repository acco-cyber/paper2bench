"use client";

import { useMemo, useState } from "react";
import { useP2B } from "@/lib/p2b/store";
import { compareAll } from "@/lib/p2b/comparison";
import { SectionHeading, StatusPill, EmptyState } from "./bits";
import {
  BarChart3,
  Trophy,
  OctagonAlert,
  TrendingUp,
} from "lucide-react";
import { downloadText } from "@/lib/p2b/exporter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

/**
 * Screen L — sweep dashboard. Every chart answers a concrete question and has an
 * accessible data-table alternative. Charts only render from imported history —
 * nothing is synthesized for display.
 */

const LINE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function SweepsView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const [selectedMetric, setSelectedMetric] = useState<string | null>(null);

  const comparison = useMemo(() => (project ? compareAll(project) : []), [project]);

  if (!project) return null;

  const runsWithHistory = project.runs.filter((r) => r.history && Object.keys(r.history).length > 0);
  const metricNames = Array.from(
    new Set(runsWithHistory.flatMap((r) => Object.keys(r.history ?? {})))
  );
  const activeMetric = selectedMetric && metricNames.includes(selectedMetric) ? selectedMetric : metricNames[0] ?? null;

  const historySeries = activeMetric
    ? runsWithHistory
        .map((r, i) => ({ run: r, points: r.history?.[activeMetric] ?? [], color: LINE_COLORS[i % LINE_COLORS.length] }))
        .filter((s) => s.points.length > 0)
    : [];

  // Best-run card (under the declared rule: metric direction, only runs with provenance)
  const eligible = project.runs.filter((r) => r.config_hash && r.code_commit);
  const bestRun = (() => {
    if (!eligible.length || !project.reported_metrics.length) return null;
    const rm = project.reported_metrics[0];
    const target = rm.name.toLowerCase();
    const withMetric = eligible
      .map((r) => ({ run: r, m: r.metrics.find((x) => x.name.toLowerCase().includes(target)) }))
      .filter((x) => x.m);
    if (!withMetric.length) return null;
    withMetric.sort((a, b) =>
      rm.direction === "maximize" ? b.m!.value - a.m!.value : a.m!.value - b.m!.value
    );
    return { rm, ...withMetric[0] };
  })();

  const discrepancies = comparison.filter((r) => r.mismatches.length > 0);

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Sweep analytics"
        desc="Charts render only from imported history — never synthesized for display. Each chart has a data-table alternative for accessibility."
      />

      {project.runs.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="h-8 w-8" />}
          title="Nothing to plot yet"
          hint="Import run manifests (with optional per-step history arrays) in Runs & results. Plots need at least one run with history."
        />
      ) : (
        <>
          {/* Metric curves */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[13px] font-semibold">
                <TrendingUp className="h-4 w-4 text-primary" /> Metric curves — how do runs progress over steps?
              </p>
              {metricNames.length > 1 ? (
                <div className="flex gap-1.5">
                  {metricNames.map((m) => (
                    <button
                      key={m}
                      onClick={() => setSelectedMetric(m)}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11.5px]",
                        activeMetric === m ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground"
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {historySeries.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-[12.5px] text-muted-foreground">
                No imported history arrays for this metric. Curves appear when runs include a{" "}
                <code className="font-mono">history</code> field; the run table below remains the
                authoritative comparison.
              </p>
            ) : (
              <>
                <LineChart
                  series={historySeries.map((s) => ({
                    label: s.run.run_id,
                    color: s.color,
                    points: s.points.map((p) => ({ x: p.step, y: p.value })),
                  }))}
                  xLabel="step"
                  yLabel={activeMetric ?? ""}
                />
                <details className="mt-3">
                  <summary className="cursor-pointer text-[12px] font-medium text-primary">
                    Data table alternative (accessibility)
                  </summary>
                  <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-[11.5px]">
                      <thead className="bg-muted/60">
                        <tr>
                          <th className="px-2 py-1.5 text-left">step</th>
                          {historySeries.map((s) => (
                            <th key={s.run.run_id} className="px-2 py-1.5 text-left">{s.run.run_id}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {historySeries[0].points.map((_, ri) => (
                          <tr key={ri} className="border-t border-border/50">
                            <td className="px-2 py-1 font-mono">{historySeries[0].points[ri].step}</td>
                            {historySeries.map((s) => (
                              <td key={s.run.run_id} className="px-2 py-1 font-mono">
                                {s.points[ri]?.value ?? "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </div>

          {/* Run comparison table */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[13px] font-semibold">Run comparison — which conditions and metrics differ?</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const header = "run_id,label,seed,metrics,code_commit,config_hash,dataset_fingerprint";
                  const rows = project.runs.map((r) =>
                    [
                      r.run_id,
                      JSON.stringify(r.label ?? ""),
                      r.seed ?? "",
                      JSON.stringify(r.metrics),
                      r.code_commit ?? "",
                      r.config_hash ?? "",
                      r.dataset_fingerprint ?? "",
                    ].join(",")
                  );
                  downloadText([header, ...rows].join("\n"), "run_comparison.csv", "text/csv");
                  toast({ title: "Run comparison exported as CSV" });
                }}
              >
                Export CSV
              </Button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[12.5px]">
                <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4 font-semibold">Run</th>
                    <th className="py-2 pr-4 font-semibold">Seed</th>
                    <th className="py-2 pr-4 font-semibold">Metrics</th>
                    <th className="py-2 pr-4 font-semibold">Config</th>
                    <th className="py-2 font-semibold">Dataset</th>
                  </tr>
                </thead>
                <tbody>
                  {project.runs.map((r) => (
                    <tr key={r.run_id} className="border-b border-border/40">
                      <td className="py-2 pr-4 font-mono">{r.run_id}</td>
                      <td className="py-2 pr-4 font-mono">{r.seed ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono text-[11.5px]">
                        {r.metrics.map((m) => `${m.name}=${m.value}`).join(", ")}
                      </td>
                      <td className="py-2 pr-4 font-mono text-[11.5px]">{r.config_hash ?? "—"}</td>
                      <td className="py-2 font-mono text-[11.5px]">{r.dataset_fingerprint ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Best run */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                <Trophy className="h-4 w-4 text-primary" /> Best run under the declared rule
              </p>
              {bestRun ? (
                <div className="rounded-lg bg-muted/50 p-3 text-[12.5px]">
                  <p className="font-mono font-semibold">{bestRun.run.run_id}</p>
                  <p className="mt-1">
                    {bestRun.rm.name} = <strong>{bestRun.m!.value}</strong> ({bestRun.rm.direction}, rule: {bestRun.rm.aggregation})
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    seed {bestRun.run.seed ?? "—"} · config {bestRun.run.config_hash} · commit {bestRun.run.code_commit}
                  </p>
                  <p className="mt-1.5 text-[11.5px] text-[var(--warning)]">
                    Eligibility requires config hash + commit. Correlation shown here is not causation.
                  </p>
                </div>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">
                  No eligible run yet — a run qualifies when its manifest includes a config hash and code commit.
                </p>
              )}
            </div>

            {/* Discrepancy panel */}
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                <OctagonAlert className="h-4 w-4 text-destructive" /> Discrepancy panel — which protocol conditions do not match?
              </p>
              {discrepancies.length ? (
                <ul className="max-h-56 space-y-2 overflow-y-auto text-[12px]">
                  {discrepancies.map((d, i) => (
                    <li key={i} className="rounded-lg bg-muted/50 p-2.5 leading-snug">
                      <strong>{d.metric}{d.run_id ? ` / ${d.run_id}` : ""}</strong>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                        {d.mismatches.map((m, j) => (
                          <li key={j}>{m}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">No mismatches detected in current comparisons.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LineChart({
  series,
  xLabel,
  yLabel,
}: {
  series: { label: string; color: string; points: { x: number; y: number }[] }[];
  xLabel: string;
  yLabel: string;
}) {
  const W = 720;
  const H = 260;
  const PAD = { l: 46, r: 14, t: 12, b: 30 };
  const all = series.flatMap((s) => s.points);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys) * 0.98;
  const yMax = Math.max(...ys) * 1.02;
  const sx = (x: number) => PAD.l + ((x - xMin) / Math.max(1e-9, xMax - xMin)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => H - PAD.b - ((y - yMin) / Math.max(1e-9, yMax - yMin)) * (H - PAD.t - PAD.b);
  const yTicks = 4;

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Metric curves for ${yLabel} over ${xLabel}. Data table available below.`}
      >
        {/* gridlines */}
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const y = yMin + ((yMax - yMin) * i) / yTicks;
          return (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(y)} y2={sy(y)} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD.l - 6} y={sy(y) + 3} textAnchor="end" fontSize="9.5" fill="var(--muted-foreground)">
                {y.toFixed(1)}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <g key={s.label}>
            <polyline
              fill="none"
              stroke={s.color}
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
            />
            {s.points.map((p, i) => (
              <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="2.6" fill={s.color} />
            ))}
          </g>
        ))}
        <text x={W / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">
          {xLabel}
        </text>
        <text x={10} y={H / 2} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)" transform={`rotate(-90 10 ${H / 2})`}>
          {yLabel}
        </text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-3">
        {series.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[11.5px]">
            <span className="h-2 w-4 rounded-sm" style={{ background: s.color }} />
            <span className="font-mono">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
