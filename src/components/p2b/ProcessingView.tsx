"use client";

import { useP2B } from "@/lib/p2b/store";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Circle, Loader2, OctagonAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Screen B — staged processing with real stage state, elapsed time and cancel. */
export function ProcessingView() {
  const processing = useP2B((s) => s.processing);
  const cancel = useP2B((s) => s.cancelProcessing);

  if (!processing) return null;
  const stages = processing.stages;
  const doneCount = stages.filter((s) => s.status === "done").length;
  const failed = stages.find((s) => s.status === "failed");
  const runningIdx = stages.findIndex((s) => s.status === "running");
  const pct = Math.round(((failed ? doneCount + 0.5 : doneCount) / stages.length) * 100);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm lg:p-8">
        <div className="mb-1 flex items-center justify-between">
          <h1 className="font-display text-xl font-semibold">
            {failed ? "Processing stopped" : "Analyzing paper…"}
          </h1>
          <Button variant="ghost" size="icon" onClick={cancel} aria-label="Cancel analysis">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {failed
            ? "You can retry with a different source — nothing was lost."
            : "Progress reflects real completed stages, not a fake spinner."}
        </p>

        <div
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={cn("h-full rounded-full transition-all duration-500", failed ? "bg-destructive" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-right text-[11px] text-muted-foreground">{pct}%</p>

        <ol className="mt-4 space-y-2.5" aria-label="Processing stages">
          {stages.map((s, i) => {
            const isRunning = s.status === "running";
            const isDone = s.status === "done";
            const isFailed = s.status === "failed";
            return (
              <li key={s.id} className="flex items-start gap-3">
                <span className="mt-0.5">
                  {isDone ? (
                    <CheckCircle2 className="h-4.5 w-4.5 text-[var(--success)]" />
                  ) : isRunning ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin text-primary" />
                  ) : isFailed ? (
                    <OctagonAlert className="h-4.5 w-4.5 text-destructive" />
                  ) : (
                    <Circle className="h-4.5 w-4.5 text-muted-foreground/40" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-[13.5px] leading-snug",
                      isDone && "text-foreground",
                      isRunning && "font-medium text-primary",
                      isFailed && "font-medium text-destructive",
                      s.status === "pending" && "text-muted-foreground"
                    )}
                  >
                    {i + 1}. {s.label}
                  </p>
                  {s.detail ? (
                    <p className={cn("text-[12px] leading-snug", isFailed ? "text-destructive/90" : "text-muted-foreground")}>
                      {s.detail}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {failed ? (
          <Button onClick={cancel} className="mt-5 w-full">
            Back to import
          </Button>
        ) : null}
      </div>
    </div>
  );
}
