"use client";

import { useMemo, useState } from "react";
import { useP2B } from "@/lib/p2b/store";
import { compareAll, REPRO_STATE_LABELS } from "@/lib/p2b/comparison";
import { exportProjectZip, buildReproductionReport, evidenceToMarkdown, downloadText } from "@/lib/p2b/exporter";
import { scanSecrets } from "@/lib/p2b/validation";
import { unresolvedCriticalCount, conflictCount } from "@/lib/p2b/semantics";
import { SectionHeading, StatusPill, EmptyState } from "./bits";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Eye, FileDown, FileText, Lock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { fmtDateTime } from "./format";

/** Screen M — export & share: preview contents, blockers, stale state, secret scan, share-safely review. */
export function ExportView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const settings = useP2B((s) => s.settings);
  const [busy, setBusy] = useState(false);
  const [scanned, setScanned] = useState<ReturnType<typeof scanSecrets> | null>(null);

  const blockers = project ? unresolvedCriticalCount(project.claims) : 0;
  const conflicts = project ? conflictCount(project.claims) : 0;
  const staleAfterValidation = useMemo(() => {
    if (!project?.validation || !project?.scaffold) return false;
    return project.activity.some(
      (a) => a.kind === "claim_edited" && new Date(a.at) > new Date(project.validation!.ran_at)
    );
  }, [project]);

  const contents = useMemo(() => {
    if (!project) return [];
    const rows: { label: string; detail: string; ok: boolean }[] = [
      { label: "Project scaffold", detail: project.scaffold ? `${project.scaffold.files.length} files (${project.scaffold.framework})` : "not generated", ok: Boolean(project.scaffold) },
      { label: "Evidence ledger", detail: `${project.claims.length} claims (JSON/CSV/MD)`, ok: project.claims.length > 0 },
      { label: "Reported metrics", detail: `${project.reported_metrics.length} entries with sources`, ok: project.reported_metrics.length > 0 },
      { label: "Run manifests", detail: project.runs.length ? `${project.runs.length} run(s)` : "none imported", ok: true },
      { label: "Validation report", detail: project.validation ? `ran ${fmtDateTime(project.validation.ran_at)}` : "not run", ok: Boolean(project.validation) },
      { label: "Reproduction report", detail: "Markdown with provenance, deviations, limitations", ok: true },
    ];
    return rows;
  }, [project]);

  if (!project) return null;

  const runScan = () => {
    const texts = [
      ...(project.scaffold?.files.map((f) => f.content) ?? []),
      JSON.stringify(project.claims),
      JSON.stringify(project.runs),
      buildReproductionReport(project),
    ];
    const hits = scanSecrets(texts.join("\n"));
    setScanned(hits);
    return hits;
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const hits = runScan();
      if (hits.length) {
        toast({
          title: "Export blocked by secret scan",
          description: hits.map((h) => h.name).join(", ") + " found in project content. Remove and retry.",
          variant: "destructive",
        });
        return;
      }
      const res = await exportProjectZip(project);
      // Trigger download
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: "Export complete",
        description: `${res.filename} — readable without a hosted account. Unresolved items stay listed inside the report.`,
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Export & share"
        desc="A portable ZIP: scaffold, evidence (JSON/CSV/MD), reported metrics, run manifests, validation and the reproduction report. JSON remains the machine-readable record."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {/* Contents */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-[13px] font-semibold">Export contents</p>
            <ul className="space-y-2">
              {contents.map((c) => (
                <li key={c.label} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2 text-[12.5px]">
                  {c.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--success)]" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--warning)]" />
                  )}
                  <span className="font-medium">{c.label}</span>
                  <span className="ml-auto text-right text-muted-foreground">{c.detail}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Blockers + stale */}
          {blockers + conflicts > 0 || staleAfterValidation ? (
            <div className="rounded-xl border border-amber-warm/50 bg-[color-mix(in_srgb,var(--amber-warm)_9%,transparent)] p-4 text-[12.5px] leading-relaxed">
              <p className="mb-1.5 flex items-center gap-2 font-semibold text-[var(--warning)]">
                <AlertTriangle className="h-4 w-4" /> Will ship with explicit warnings
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {blockers ? <li>{blockers} unresolved critical claim(s) — project marked <strong>provisional</strong> in the report.</li> : null}
                {conflicts ? <li>{conflicts} unresolved conflict(s) — both values and sources ship in the ledger.</li> : null}
                {staleAfterValidation ? <li>Claims changed after the last validation — the report notes revalidation is outstanding.</li> : null}
              </ul>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,transparent)] p-4 text-[12.5px]">
              <CheckCircle2 className="h-4.5 w-4.5 text-[var(--success)]" />
              No unresolved blockers — the export will not carry provisional warnings.
            </div>
          )}

          {/* Secret scan */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <Lock className="h-4 w-4 text-primary" /> Secret scan (runs automatically before every export)
            </p>
            {scanned === null ? (
              <Button variant="outline" size="sm" onClick={() => runScan()}>
                Run scan preview
              </Button>
            ) : scanned.length === 0 ? (
              <p className="flex items-center gap-2 text-[12.5px] text-[var(--success)]">
                <CheckCircle2 className="h-4 w-4" /> No secrets detected in scaffold, evidence, runs or report.
              </p>
            ) : (
              <ul className="space-y-1 text-[12.5px] text-destructive">
                {scanned.map((h, i) => (
                  <li key={i}>
                    <strong>{h.name}</strong> detected (starts “{h.sample}”) — export is blocked until removed.
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Actions + share safely */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-3 text-[13px] font-semibold">Download</p>
            <Button onClick={doExport} disabled={busy} className="w-full gap-2">
              <FileDown className="h-4 w-4" /> {busy ? "Packaging…" : "Export project ZIP"}
            </Button>
            <Button
              variant="outline"
              className="mt-2 w-full gap-2"
              onClick={() => {
                downloadText(buildReproductionReport(project), "reproduction_report.md", "text/markdown");
                toast({ title: "Reproduction report downloaded" });
              }}
            >
              <FileText className="h-4 w-4" /> Report only (Markdown)
            </Button>
            {settings.export_markdown ? (
              <Button
                variant="ghost"
                className="mt-1 w-full gap-2"
                onClick={() => {
                  downloadText(evidenceToMarkdown(project), "evidence.md", "text/markdown");
                }}
              >
                <FileText className="h-4 w-4" /> Evidence ledger (Markdown)
              </Button>
            ) : null}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <Eye className="h-4 w-4 text-primary" /> “Share safely” review
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-muted-foreground">
              <li>Private/unpublished paper files: not included unless you uploaded them into evidence text — check quotes.</li>
              <li>Personal notes: review claim notes before sharing.</li>
              <li>Local dataset paths: never included by the generator — verify manually.</li>
              <li>Author contact details: only if present in extracted text.</li>
              <li>Licence restrictions: dataset records ship with licence state; do not redistribute data.</li>
            </ul>
          </div>

          {!project.scaffold ? (
            <EmptyState
              title="Scaffold not generated"
              hint="The ZIP will include everything else, but generate the scaffold first for the complete package."
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
