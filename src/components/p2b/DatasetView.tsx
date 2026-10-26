"use client";

import { useP2B } from "@/lib/p2b/store";
import type { DatasetAccessState, LicenseStatus } from "@/lib/p2b/types";
import { SectionHeading, StatusPill, EmptyState } from "./bits";
import { Button } from "@/components/ui/button";
import { Wand2, ExternalLink, KeyRound, ShieldAlert, Database } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Quote } from "lucide-react";

const ACCESS_STEPS: DatasetAccessState[] = [
  "mentioned",
  "linked",
  "access_verified",
  "downloaded",
  "fingerprinted",
  "preprocessed",
];

const ACCESS_LABEL: Record<DatasetAccessState, string> = {
  mentioned: "Mentioned in paper",
  linked: "Linked by authors",
  access_verified: "Access verified",
  downloaded: "Downloaded",
  fingerprinted: "Fingerprinted",
  preprocessed: "Preprocessed",
};

const LICENSE_LABEL: Record<LicenseStatus, { label: string; tone: string }> = {
  identified: { label: "Licence identified", tone: "good" },
  permissive: { label: "Permissive licence", tone: "good" },
  restricted: { label: "Restricted / gated", tone: "bad" },
  unknown: { label: "Licence NOT identified — treated as non-permissive", tone: "bad" },
  not_applicable: { label: "Not applicable", tone: "muted" },
};

/** Screen G — dataset audit with access ladder, licence honesty and leakage checks. */
export function DatasetView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const updateDataset = useP2B((s) => s.updateDataset);
  const setLeakage = useP2B((s) => s.setLeakageCheck);
  const generatePlan = useP2B((s) => s.generatePlan);

  if (!project) return null;

  if (project.datasets.length === 0) {
    return (
      <div className="space-y-4">
        <SectionHeading
          title="Dataset audit"
          desc="One record per dataset: source, version, splits, licence, access state and fingerprint."
        />
        <EmptyState
          icon={<Database className="h-8 w-8" />}
          title="No dataset records"
          hint="Generate the reproduction plan — dataset records are created from the extracted dataset claims with licence/access states left honestly unknown."
          action={
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                generatePlan(project.id, "main_result");
                toast({ title: "Plan generated", description: "Dataset records were created from claims." });
              }}
            >
              <Wand2 className="h-4 w-4" /> Generate plan + dataset records
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Dataset audit"
        desc="Gated or private data is never downloaded automatically. Unknown licence stays explicitly non-permissive until you confirm access terms."
      />

      {project.datasets.map((d) => {
        const stepIdx = ACCESS_STEPS.indexOf(d.access_state);
        return (
          <div key={d.dataset_id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[15px] font-semibold">{d.name}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {d.source_url ? (
                    <a
                      href={d.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {d.source_url} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    "no official source link identified"
                  )}
                </p>
              </div>
              <StatusPill tone={LICENSE_LABEL[d.license_status].tone}>
                {LICENSE_LABEL[d.license_status].label}
              </StatusPill>
            </div>

            {d.evidence && d.evidence.length ? (
              <blockquote className="mt-3 flex gap-2 border-l-2 border-primary/40 pl-3 text-[12.5px] italic leading-relaxed text-foreground/80">
                <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" />
                <span>
                  “{d.evidence[0].text.slice(0, 220)}{d.evidence[0].text.length > 220 ? "…" : ""}”
                  {d.evidence[0].page ? ` — p.${d.evidence[0].page}` : ""}
                </span>
              </blockquote>
            ) : null}

            {/* Access ladder */}
            <div className="mt-4">
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                Access state (advance manually — never automatic)
              </p>
              <ol className="flex flex-wrap gap-1.5" aria-label="Dataset access states">
                {ACCESS_STEPS.map((s, i) => (
                  <li key={s}>
                    <button
                      onClick={() => {
                        if (s === "access_verified" && !d.access_confirmed_by_user) {
                          const ok = window.confirm(
                            "Have YOU reviewed and accepted the dataset's licence/access terms? Paper2Bench will then record access as user-confirmed."
                          );
                          if (!ok) {
                            toast({
                              title: "Access not confirmed",
                              description: "License/access terms remain unresolved; download stays blocked.",
                            });
                            return;
                          }
                        }
                        updateDataset(project.id, d.dataset_id, {
                          access_state: s,
                          access_confirmed_by_user: i >= 2 ? true : d.access_confirmed_by_user,
                        });
                      }}
                      className={cn(
                        "rounded-md border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors",
                        i <= stepIdx
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40"
                      )}
                      aria-current={s === d.access_state ? "step" : undefined}
                    >
                      {i + 1}. {ACCESS_LABEL[s]}
                    </button>
                  </li>
                ))}
              </ol>
            </div>

            {/* Details grid */}
            <div className="mt-4 grid gap-2.5 text-[12.5px] md:grid-cols-3">
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="font-semibold text-muted-foreground">Splits</p>
                <p className="mt-0.5">{d.splits ?? "not specified in inspected source"}</p>
                <p className="mt-1 text-[11.5px]">
                  {d.split_provenance === "unknown" ? (
                    <span className="text-[var(--warning)]">split provenance unknown — risk of custom split</span>
                  ) : d.split_provenance === "paper_specified" ? (
                    <span className="text-[var(--success)]">specified in paper</span>
                  ) : null}
                </p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="font-semibold text-muted-foreground">Preprocessing</p>
                <p className="mt-0.5">{d.preprocessing ?? "not captured — check paper/appendix"}</p>
              </div>
              <div className="rounded-lg bg-muted/60 p-3">
                <p className="font-semibold text-muted-foreground">Fingerprint</p>
                <p className="mt-0.5 font-mono text-[11.5px]">{d.fingerprint ?? "none — record after download"}</p>
              </div>
            </div>

            {/* Data-access checklist */}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold">
                  <KeyRound className="h-3.5 w-3.5 text-primary" /> Data-access checklist
                </p>
                <ul className="list-disc space-y-1 pl-4 text-[12px] text-muted-foreground">
                  <li>Credentials / registration needed: <strong className="text-foreground">{d.license_status === "restricted" ? "likely — gated access" : "verify on the official page"}</strong></li>
                  <li>Terms to accept before download: confirm on source page</li>
                  <li>Storage estimate: record after download</li>
                  <li>User-confirmed access: <strong className="text-foreground">{d.access_confirmed_by_user ? "yes" : "no"}</strong></li>
                </ul>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold">
                  <ShieldAlert className="h-3.5 w-3.5 text-[var(--warning)]" /> Leakage hazard checks
                </p>
                <ul className="space-y-1.5">
                  {(d.leakage_checks ?? []).map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="min-w-0 flex-1 leading-snug">{l.label}</span>
                      <SelectLike state={l.state} onSet={(v) => setLeakage(project.id, d.dataset_id, l.id, v)} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SelectLike({
  state,
  onSet,
}: {
  state: "unknown" | "clear" | "flagged";
  onSet: (v: "unknown" | "clear" | "flagged") => void;
}) {
  const meta = {
    unknown: { label: "unknown", cls: "text-muted-foreground border-border" },
    clear: { label: "clear", cls: "text-[var(--success)] border-[color-mix(in_srgb,var(--success)_40%,transparent)]" },
    flagged: { label: "flagged", cls: "text-destructive border-destructive/50" },
  }[state];
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={() => onSet(state === "clear" ? "unknown" : "clear")}
        className={cn("rounded border px-1.5 py-0.5 text-[10.5px] font-semibold", meta.cls)}
        title="Toggle clear/unknown"
      >
        {meta.label}
      </button>
      <button
        onClick={() => onSet("flagged")}
        className="rounded border border-destructive/40 px-1.5 py-0.5 text-[10.5px] font-semibold text-destructive disabled:opacity-40"
        disabled={state === "flagged"}
        title="Flag hazard"
      >
        flag
      </button>
    </div>
  );
}
