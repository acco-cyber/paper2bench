"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  EVIDENCE_STATUS_META,
  REVIEW_STATUS_META,
  formatValue,
} from "@/lib/p2b/semantics";
import type { CheckResult, EvidenceStatus, Impact, ReviewStatus } from "@/lib/p2b/types";
import { AlertTriangle, CheckCircle2, CircleSlash, HelpCircle, OctagonAlert, RefreshCcw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

/** Tone → class mapping (semantic tokens; text always accompanies color). */
const TONE_CLASS: Record<string, string> = {
  good: "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)] border-[color-mix(in_srgb,var(--success)_35%,transparent)]",
  neutral: "bg-secondary text-secondary-foreground border-border",
  warn: "bg-[color-mix(in_srgb,var(--warning)_14%,transparent)] text-[var(--warning)] border-[color-mix(in_srgb,var(--warning)_40%,transparent)]",
  bad: "bg-[color-mix(in_srgb,var(--destructive)_12%,transparent)] text-[var(--destructive)] border-[color-mix(in_srgb,var(--destructive)_38%,transparent)]",
  muted: "bg-muted text-muted-foreground border-border",
};

export function StatusPill({
  tone,
  children,
  icon,
  className,
}: {
  tone: keyof typeof TONE_CLASS | string;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium whitespace-nowrap", TONE_CLASS[tone] ?? TONE_CLASS.muted, className)}
    >
      {icon}
      {children}
    </Badge>
  );
}

const STATUS_ICON: Record<EvidenceStatus, ReactNode> = {
  reported: <ShieldCheck className="h-3 w-3" aria-hidden />,
  derived: <RefreshCcw className="h-3 w-3" aria-hidden />,
  inferred: <HelpCircle className="h-3 w-3" aria-hidden />,
  unspecified: <CircleSlash className="h-3 w-3" aria-hidden />,
  conflicting: <OctagonAlert className="h-3 w-3" aria-hidden />,
  user_confirmed: <CheckCircle2 className="h-3 w-3" aria-hidden />,
  not_applicable: <CircleSlash className="h-3 w-3" aria-hidden />,
};

export function EvidenceStatusPill({ status }: { status: EvidenceStatus }) {
  const meta = EVIDENCE_STATUS_META[status];
  return (
    <StatusPill tone={meta.tone} icon={STATUS_ICON[status]}>
      {meta.label}
    </StatusPill>
  );
}

export function ReviewStatusPill({ status }: { status: ReviewStatus }) {
  const meta = REVIEW_STATUS_META[status];
  return <StatusPill tone={meta.tone}>{meta.label}</StatusPill>;
}

export function ImpactPill({ impact }: { impact: Impact }) {
  const tone = impact === "critical" ? "bad" : impact === "important" ? "warn" : "muted";
  const label = impact === "critical" ? "Critical impact" : impact === "important" ? "Important" : "Informational";
  return (
    <StatusPill tone={tone}>
      {label}
    </StatusPill>
  );
}

export const CHECK_RESULT_META: Record<
  CheckResult,
  { label: string; tone: string; icon: ReactNode }
> = {
  pass: { label: "Passed this check", tone: "good", icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> },
  warning: { label: "Potential issue", tone: "warn", icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> },
  fail: { label: "Failed check", tone: "bad", icon: <OctagonAlert className="h-3.5 w-3.5" aria-hidden /> },
  skipped: { label: "Not run", tone: "muted", icon: <CircleSlash className="h-3.5 w-3.5" aria-hidden /> },
  blocked: { label: "Blocked", tone: "bad", icon: <OctagonAlert className="h-3.5 w-3.5" aria-hidden /> },
  stale: { label: "Stale — input changed", tone: "warn", icon: <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> },
};

export function CheckResultPill({ result }: { result: CheckResult }) {
  const meta = CHECK_RESULT_META[result];
  return (
    <StatusPill tone={meta.tone} icon={meta.icon}>
      {meta.label}
    </StatusPill>
  );
}

/** Consistent value renderer for claims (unknown is never blank). */
export function ClaimValue({ value, unit }: { value: string | number | boolean | null; unit: string | null }) {
  const text = formatValue(value, unit);
  return (
    <span className={cn("font-mono text-[13px]", (value === null || value === "") && "text-muted-foreground italic")}>
      {text}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-14 px-6 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{hint}</p>
      {action}
    </div>
  );
}

export function SectionHeading({
  title,
  desc,
  right,
}: {
  title: string;
  desc?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">{title}</h2>
        {desc ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{desc}</p> : null}
      </div>
      {right}
    </div>
  );
}
