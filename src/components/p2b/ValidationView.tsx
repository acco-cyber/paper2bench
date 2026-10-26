"use client";

import { useP2B } from "@/lib/p2b/store";
import { SectionHeading, CheckResultPill, EmptyState } from "./bits";
import { Button } from "@/components/ui/button";
import { FileCheck2, RefreshCcw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { ValidationCheck } from "@/lib/p2b/types";
import { fmtDateTime } from "./format";

const GROUPS: ValidationCheck["group"][] = [
  "configuration",
  "static",
  "tests",
  "environment",
  "smoke",
  "data",
  "end-to-end",
];

/** Screen J — validation report. Skipped/blocked are never portrayed as passed. */
export function ValidationView() {
  const project = useP2B((s) => (s.activeProjectId ? s.projects[s.activeProjectId] : null));
  const validate = useP2B((s) => s.validate);
  const setView = useP2B((s) => s.setView);

  if (!project) return null;
  const val = project.validation;

  const counts = val
    ? {
        pass: val.checks.filter((c) => c.result === "pass").length,
        warning: val.checks.filter((c) => c.result === "warning").length,
        fail: val.checks.filter((c) => c.result === "fail").length,
        skipped: val.checks.filter((c) => c.result === "skipped").length,
        blocked: val.checks.filter((c) => c.result === "blocked").length,
        stale: val.checks.filter((c) => c.result === "stale").length,
      }
    : null;

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Validation report"
        desc="Each check states what it proves and what it does not. Executable checks (install, smoke, e2e) are blocked by hosted-demo policy — run them locally with pytest."
        right={
          <div className="flex gap-2">
            {project.scaffold ? (
              <Button
                onClick={() => {
                  validate(project.id);
                  toast({ title: "Validation complete", description: "Review results — blocked checks need local execution." });
                }}
                className="gap-2"
              >
                <RefreshCcw className="h-4 w-4" /> {val ? "Re-run checks" : "Run checks"}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setView("files")} className="gap-2">
                Generate scaffold first
              </Button>
            )}
          </div>
        }
      />

      {!val ? (
        <EmptyState
          icon={<FileCheck2 className="h-8 w-8" />}
          title="Validation has not run"
          hint="Checks cover config schema, provenance integrity, imports, seed handling, dependency pinning, test presence, and data-access state — with honest skipped/blocked statuses for anything requiring local execution."
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {Object.entries(counts!).map(([k, v]) =>
              v > 0 ? (
                <div key={k} className="rounded-lg border border-border bg-card px-3 py-2 text-[12px]">
                  <span className="font-semibold">{v}</span>{" "}
                  <span className="text-muted-foreground">{k}</span>
                </div>
              ) : null
            )}
            <span className="ml-auto self-center text-[11.5px] text-muted-foreground">
              ran {fmtDateTime(val.ran_at)}
            </span>
          </div>

          <div className="space-y-4">
            {GROUPS.map((g) => {
              const checks = val.checks.filter((c) => c.group === g);
              if (!checks.length) return null;
              return (
                <div key={g}>
                  <p className="mb-2 text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">{g}</p>
                  <div className="space-y-2">
                    {checks.map((c) => (
                      <div key={c.check_id} className="rounded-xl border border-border bg-card p-4">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <CheckResultPill result={c.result} />
                          <p className="text-[13px] font-semibold">{c.name}</p>
                        </div>
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-foreground/85">{c.detail}</p>
                        <div className="mt-2 grid gap-2 text-[11.5px] md:grid-cols-2">
                          <p className="rounded-lg bg-muted/60 p-2">
                            <span className="font-semibold">Proves: </span>
                            {c.proves}
                          </p>
                          <p className="rounded-lg bg-muted/60 p-2">
                            <span className="font-semibold">Does NOT prove: </span>
                            {c.does_not_prove}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
