"use client";

import { useMemo, useState } from "react";
import { useP2B } from "@/lib/p2b/store";
import type { Claim, EvidenceStatus } from "@/lib/p2b/types";
import {
  CLAIM_CATEGORIES,
  EVIDENCE_STATUS_META,
  IMPACT_META,
  REVIEW_STATUS_META,
  evidenceCoverage,
  formatValue,
} from "@/lib/p2b/semantics";
import { ClaimValue, EmptyState, EvidenceStatusPill, ImpactPill, ReviewStatusPill, SectionHeading } from "./bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ArrowDownUp,
  CheckCheck,
  FileJson,
  FileSpreadsheet,
  FileText,
  Quote,
  Undo2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { downloadText } from "@/lib/p2b/exporter";
import { evidenceToCsv, evidenceToMarkdown } from "@/lib/p2b/exporter";
import { timeAgo } from "./format";

/** Screens D + E — evidence ledger, claim detail, review & conflict resolution. */
export function EvidenceView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const filters = useP2B((s) => s.evidenceFilters);
  const setFilter = useP2B((s) => s.setFilter);
  const selectedId = useP2B((s) => s.selectedClaimId);
  const setSelected = useP2B((s) => s.setSelectedClaim);
  const bulkAccept = useP2B((s) => s.bulkAccept);
  const undo = useP2B((s) => s.undoLastEdit);
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    if (!project) return [];
    const q = filters.q.toLowerCase();
    let rows = project.claims.filter((c) => {
      if (filters.category !== "all" && c.category !== filters.category) return false;
      if (filters.status !== "all" && c.evidence_status !== filters.status) return false;
      if (filters.impact !== "all" && c.impact !== filters.impact) return false;
      if (filters.review !== "all" && c.review_status !== filters.review) return false;
      if (q) {
        const hay = `${c.field_path} ${c.label} ${String(c.value ?? "")} ${c.evidence.map((e) => e.text).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const impactOrder = { critical: 0, important: 1, informational: 2 } as const;
    rows = [...rows].sort((a, b) => {
      const d = impactOrder[a.impact] - impactOrder[b.impact] || a.field_path.localeCompare(b.field_path);
      return sortAsc ? d : -d;
    });
    return rows;
  }, [project, filters, sortAsc]);

  if (!project) return null;

  const selected = project.claims.find((c) => c.claim_id === selectedId) ?? null;
  const bulkable = filtered.filter(
    (c) => c.review_status === "not_reviewed" && c.impact !== "critical" && c.evidence_status !== "conflicting"
  );

  const exportJson = () => {
    downloadText(
      JSON.stringify({ paper: project.paper, exported_at: new Date().toISOString(), claims: filtered }, null, 2),
      "evidence.json",
      "application/json"
    );
    toast({ title: "Evidence exported as JSON", description: "Includes paper hash and export time." });
  };

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Evidence ledger"
        desc={`Every claim links to a source span. Confidence never substitutes for evidence status — only "reported" counts as source-reported. Coverage: ${Math.round(evidenceCoverage(project.claims) * 100)}% of populated claims carry spans.`}
        right={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportJson}>
              <FileJson className="h-3.5 w-3.5" /> JSON
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                downloadText(evidenceToCsv(project), "evidence.csv", "text/csv");
                toast({ title: "Evidence exported as CSV" });
              }}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                downloadText(evidenceToMarkdown(project), "evidence.md", "text/markdown");
                toast({ title: "Evidence exported as Markdown" });
              }}
            >
              <FileText className="h-3.5 w-3.5" /> Markdown
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <Input
          placeholder="Search claims, values, evidence text…"
          value={filters.q}
          onChange={(e) => setFilter("q", e.target.value)}
          className="h-9 w-full sm:w-64"
          aria-label="Search evidence"
        />
        <Select value={filters.category} onValueChange={(v) => setFilter("category", v)}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CLAIM_CATEGORIES.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilter("status", v)}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by evidence status">
            <SelectValue placeholder="Evidence" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.keys(EVIDENCE_STATUS_META).map((k) => (
              <SelectItem key={k} value={k}>
                {EVIDENCE_STATUS_META[k as EvidenceStatus].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.impact} onValueChange={(v) => setFilter("impact", v)}>
          <SelectTrigger className="h-9 w-[140px]" aria-label="Filter by impact">
            <SelectValue placeholder="Impact" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All impact</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="important">Important</SelectItem>
            <SelectItem value="informational">Informational</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.review} onValueChange={(v) => setFilter("review", v)}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Filter by review status">
            <SelectValue placeholder="Review" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All review</SelectItem>
            {Object.keys(REVIEW_STATUS_META).map((k) => (
              <SelectItem key={k} value={k}>
                {REVIEW_STATUS_META[k as keyof typeof REVIEW_STATUS_META].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setSortAsc(!sortAsc)}>
          <ArrowDownUp className="h-3.5 w-3.5" /> {sortAsc ? "Impact first" : "Reverse"}
        </Button>
        <div className="ml-auto flex gap-2">
          {bulkable.length ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                bulkAccept(project.id, bulkable.map((c) => c.claim_id));
                toast({
                  title: `Bulk-accepted ${bulkable.length} low-risk claims`,
                  description: "Conflicts and critical unknowns are never bulk-accepted.",
                });
              }}
            >
              <CheckCheck className="h-3.5 w-3.5" /> Accept {bulkable.length} low-risk
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              undo(project.id);
              toast({ title: "Undo applied", description: "Reverted the most recent session correction." });
            }}
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo last
          </Button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No claims match the current filters"
          hint="Adjust the filters above, or re-run extraction with a full-text PDF for richer coverage."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <ScrollArea className="max-h-[62vh]">
            <table className="w-full min-w-[860px] text-[13px]">
              <thead className="sticky top-0 z-10 bg-card/95 backdrop-blur">
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Claim</th>
                  <th className="px-4 py-2.5 font-semibold">Value</th>
                  <th className="px-4 py-2.5 font-semibold">Evidence</th>
                  <th className="px-4 py-2.5 font-semibold">Source</th>
                  <th className="px-4 py-2.5 font-semibold">Impact</th>
                  <th className="px-4 py-2.5 font-semibold">Review</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const ev = c.evidence[0];
                  return (
                    <tr
                      key={c.claim_id}
                      tabIndex={0}
                      onClick={() => setSelected(c.claim_id)}
                      onKeyDown={(e) => e.key === "Enter" && setSelected(c.claim_id)}
                      className={cn(
                        "cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/50 focus:bg-accent focus:outline-none",
                        selectedId === c.claim_id && "bg-accent"
                      )}
                      aria-label={`Open claim ${c.field_path}`}
                    >
                      <td className="max-w-[260px] px-4 py-2.5">
                        <span className="block truncate font-mono text-[12.5px] font-medium text-primary">{c.field_path}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{c.label}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <ClaimValue value={c.value} unit={c.unit} />
                      </td>
                      <td className="px-4 py-2.5">
                        <EvidenceStatusPill status={c.evidence_status} />
                      </td>
                      <td className="max-w-[220px] px-4 py-2.5 text-[12px] text-muted-foreground">
                        {ev ? (
                          <span className="flex items-center gap-1.5">
                            <Quote className="h-3 w-3 shrink-0 text-primary/70" />
                            <span className="truncate">
                              {ev.section ?? "source"} {ev.page ? `· p.${ev.page}` : ""} {ev.locator ? `· ${ev.locator}` : ""}
                            </span>
                          </span>
                        ) : (
                          <span className="italic">no span — anchor invalid</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <ImpactPill impact={c.impact} />
                      </td>
                      <td className="px-4 py-2.5">
                        <ReviewStatusPill status={c.review_status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      )}

      <ClaimDetailSheet claim={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ClaimDetailSheet({ claim, onClose }: { claim: Claim | null; onClose: () => void }) {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const editClaim = useP2B((s) => s.editClaim);
  const setReview = useP2B((s) => s.setClaimReview);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [status, setStatus] = useState<EvidenceStatus>("reported");
  const [reason, setReason] = useState("found_in_paper");
  const [note, setNote] = useState("");
  const [editedFor, setEditedFor] = useState<string | null>(null);
  const [conflictPick, setConflictPick] = useState<string>("");

  // Sync form when a different claim opens
  const claimId = claim?.claim_id ?? null;
  const key = `${claimId}`;
  const [lastKey, setLastKey] = useState("");
  if (key !== lastKey) {
    setLastKey(key);
    setValue(claim ? (claim.value === null ? "" : String(claim.value)) : "");
    setUnit(claim?.unit ?? "");
    setStatus(claim?.evidence_status ?? "reported");
    setNote("");
    setConflictPick("");
    setEditedFor(null);
  }

  if (!claim || !project) return null;

  const save = () => {
    let parsed: string | number | null = value.trim() === "" ? null : value.trim();
    if (parsed !== null && parsed !== "") {
      const n = Number(parsed);
      if (!Number.isNaN(n) && /^-?[\d.]+(e-?\d+)?$/i.test(parsed!.trim())) parsed = n;
    }
    editClaim(
      project.id,
      claim.claim_id,
      {
        value: parsed,
        unit: unit.trim() === "" ? null : unit.trim(),
        evidence_status: status,
        note: note.trim() || undefined,
      },
      reason
    );
    setEditedFor(claim.claim_id);
    toast({
      title: "Claim corrected",
      description: "Downstream reports/configs are now marked stale until regenerated.",
    });
  };

  const conflicting = claim.evidence_status === "conflicting";
  const meta = EVIDENCE_STATUS_META[claim.evidence_status];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl lg:max-w-2xl" side="right">
        <SheetHeader className="pb-0">
          <SheetTitle className="font-mono text-[15px] text-primary">{claim.field_path}</SheetTitle>
          <SheetDescription className="text-[12.5px]">
            {claim.label} · {CLAIM_CATEGORIES.find((c) => c.id === claim.category)?.label ?? claim.category}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-8">
          {/* Status row */}
          <div className="flex flex-wrap items-center gap-2">
            <EvidenceStatusPill status={claim.evidence_status} />
            <ImpactPill impact={claim.impact} />
            <ReviewStatusPill status={claim.review_status} />
            <span className="text-[11.5px] text-muted-foreground">
              extraction confidence {Math.round(claim.confidence * 100)}% · {claim.extractor}
            </span>
          </div>
          <p className="rounded-lg bg-muted p-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {meta.definition}
          </p>

          {/* Conflict resolution */}
          {conflicting ? (
            <div className="rounded-xl border border-destructive/40 bg-destructive/6 p-4">
              <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-destructive">
                Conflict — competing source values
              </p>
              <div className="space-y-2">
                {claim.evidence.map((e) => (
                  <label key={e.evidence_id} className="flex cursor-pointer gap-2.5 rounded-lg border border-border bg-card p-2.5 text-[12.5px] hover:border-primary/50">
                    <input
                      type="radio"
                      name={`conflict-${claim.claim_id}`}
                      className="mt-1"
                      checked={conflictPick === (e.text.slice(0, 80) + `|p${e.page}`)}
                      onChange={() => setConflictPick(e.text.slice(0, 80) + `|p${e.page}`)}
                    />
                    <span>
                      <span className="block font-medium">
                        {e.locator ?? e.section} {e.page ? `· p.${e.page}` : ""}
                      </span>
                      <span className="mt-0.5 block text-muted-foreground">“{e.text.slice(0, 180)}…”</span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={!conflictPick}
                  onClick={() => {
                    const chosenIdx = claim.evidence.findIndex((e) => e.text.slice(0, 80) + `|p${e.page}` === conflictPick);
                    const e = claim.evidence[chosenIdx];
                    // Extract a number from the chosen span; prefer the one after dropout/rate/Pdrop keywords.
                    const prefer = e.text.match(/(?:P_?drop|dropout(?:\s+rate)?|rate|value)\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)/i);
                    const anyNum = e.text.match(/\d+(?:\.\d+)?/);
                    const numStr = prefer?.[1] ?? anyNum?.[0] ?? null;
                    const parsedVal = numStr !== null ? Number(numStr) : claim.raw_value !== null && claim.raw_value !== undefined ? Number(claim.raw_value) || claim.raw_value : null;
                    editClaim(
                      project.id,
                      claim.claim_id,
                      {
                        value: parsedVal,
                        evidence_status: "user_confirmed",
                        note: `Resolved conflict by choosing ${e.locator ?? e.section ?? "source"}${e.page ? ` (p.${e.page})` : ""}.`,
                      },
                      "conflict_resolution"
                    );
                    setValue(numStr ?? "");
                    setStatus("user_confirmed");
                    setConflictPick("");
                    toast({ title: "Conflict resolved", description: "Value set to your choice and marked user-confirmed." });
                  }}
                >
                  Resolve with selected source
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setReview(project.id, claim.claim_id, "escalated");
                    toast({ title: "Kept unresolved", description: "Claim stays conflicting and visible in every export." });
                  }}
                >
                  Keep unresolved
                </Button>
              </div>
            </div>
          ) : null}

          {/* Value + correction form */}
          <div className="space-y-3">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Correction form</p>
            <div className="grid grid-cols-[1fr_130px] gap-2">
              <div>
                <label htmlFor="cd-value" className="text-[12px] font-medium">
                  Value {claim.value === null ? "(currently unspecified)" : ""}
                </label>
                <Input id="cd-value" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 h-9 font-mono" />
              </div>
              <div>
                <label htmlFor="cd-unit" className="text-[12px] font-medium">
                  Unit
                </label>
                <Input id="cd-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className="mt-1 h-9" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[12px] font-medium">New evidence status</label>
                <Select value={status} onValueChange={(v) => setStatus(v as EvidenceStatus)}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EVIDENCE_STATUS_META).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[12px] font-medium">Basis of the new value</label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="found_in_paper">Found in the paper</SelectItem>
                    <SelectItem value="derived_mathematically">Derived mathematically</SelectItem>
                    <SelectItem value="user_choice">My choice / assumption</SelectItem>
                    <SelectItem value="inferred_from_context">Inferred from context</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label htmlFor="cd-note" className="text-[12px] font-medium">
                Note / rationale (stored with the revision)
              </label>
              <Textarea id="cd-note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-[64px]" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={save}>
                Save correction
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReview(project.id, claim.claim_id, "accepted")}>
                Accept as extracted
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReview(project.id, claim.claim_id, "escalated")}
              >
                Escalate
              </Button>
              {editedFor === claim.claim_id ? (
                <span className="self-center text-[11.5px] text-[var(--success)]">Saved — dependent artifacts marked stale.</span>
              ) : null}
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Impact rule — {IMPACT_META[claim.impact].rule}
            </p>
          </div>

          <Separator />

          {/* Evidence spans */}
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              Evidence spans ({claim.evidence.length})
            </p>
            {claim.evidence.length === 0 ? (
              <p className="rounded-lg border border-dashed p-3 text-[12.5px] text-muted-foreground">
                No source span. This value can never count as reported — attach a source or keep it unspecified.
              </p>
            ) : (
              <ul className="space-y-2">
                {claim.evidence.map((e) => (
                  <li key={e.evidence_id} className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11.5px]">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-primary">
                        {e.section ?? "source"}{e.page ? ` · p.${e.page}` : ""}
                      </span>
                      {e.locator ? <span className="text-muted-foreground">{e.locator}</span> : null}
                      <span className={cn("ml-auto rounded px-1.5 py-0.5 font-medium", e.anchor_validity === "verified" ? "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]" : "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning)]")}>
                        anchor: {e.anchor_validity}
                      </span>
                    </div>
                    <blockquote className="border-l-2 border-primary/40 pl-3 text-[12.5px] leading-relaxed text-foreground/85">
                      “{e.text}”
                    </blockquote>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Separator />

          {/* History */}
          <div>
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              Revision history
            </p>
            <ol className="space-y-1.5">
              {claim.revisions.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-muted/60 px-3 py-1.5 text-[12px]">
                  <span className="font-mono">{formatValue(r.value, claim.unit)}</span>
                  <span className="text-muted-foreground">({r.evidence_status})</span>
                  <span className="text-muted-foreground">· {r.actor}</span>
                  <span className="text-muted-foreground">· {timeAgo(r.at)}</span>
                  {r.reason ? <span className="text-muted-foreground">· {r.reason}</span> : null}
                </li>
              ))}
            </ol>
          </div>

          {claim.notes.length ? (
            <div>
              <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
              <ul className="list-disc space-y-1 pl-5 text-[12.5px]">
                {claim.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
