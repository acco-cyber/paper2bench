import type {
  Claim,
  EvidenceStatus,
  Impact,
  ReviewStatus,
} from "./types";

/**
 * Evidence-status semantics — verbatim behavioural rules from the blueprint (section 7.2).
 * The UI never lets a confidence score promote a claim to "reported".
 */

export const EVIDENCE_STATUS_META: Record<
  EvidenceStatus,
  {
    label: string;
    short: string;
    definition: string;
    counts_as_reported: boolean;
    tone: "good" | "neutral" | "warn" | "bad" | "muted";
  }
> = {
  reported: {
    label: "Reported",
    short: "REP",
    definition:
      "Explicitly stated in the selected source. Counts as source-reported only when the evidence span is valid and supports the exact value.",
    counts_as_reported: true,
    tone: "good",
  },
  derived: {
    label: "Derived",
    short: "DER",
    definition:
      "Calculated deterministically from reported values; the calculation and inputs are stored. Does not count as source-reported.",
    counts_as_reported: false,
    tone: "neutral",
  },
  inferred: {
    label: "Inferred",
    short: "INF",
    definition:
      "Plausible interpretation based on indirect context. Must remain visible as an inference; does not count as source-reported.",
    counts_as_reported: false,
    tone: "warn",
  },
  unspecified: {
    label: "Unspecified",
    short: "UNS",
    definition:
      "No adequate evidence found in the inspected source. The field stays explicitly unknown — never silently filled.",
    counts_as_reported: false,
    tone: "bad",
  },
  conflicting: {
    label: "Conflicting",
    short: "CON",
    definition:
      "Two or more credible sources disagree. No resolved value until a user or documented decision policy resolves it.",
    counts_as_reported: false,
    tone: "bad",
  },
  user_confirmed: {
    label: "User confirmed",
    short: "USR",
    definition:
      "A human explicitly confirmed or corrected the field. Counts as source-reported only if linked to evidence; otherwise it is a user decision.",
    counts_as_reported: false,
    tone: "good",
  },
  not_applicable: {
    label: "Not applicable",
    short: "N/A",
    definition:
      "Field does not apply to this research contribution. Not applicable is not missing.",
    counts_as_reported: false,
    tone: "muted",
  },
};

export const REVIEW_STATUS_META: Record<
  ReviewStatus,
  { label: string; tone: "muted" | "good" | "warn" | "bad" }
> = {
  not_reviewed: { label: "Not reviewed", tone: "muted" },
  accepted: { label: "Accepted", tone: "good" },
  corrected: { label: "Corrected", tone: "warn" },
  escalated: { label: "Escalated", tone: "bad" },
};

export const IMPACT_META: Record<
  Impact,
  { label: string; rule: string }
> = {
  critical: {
    label: "Critical",
    rule: "Directly changes training results or metric comparability (e.g. split, learning rate, loss, seeds, metric definition).",
  },
  important: {
    label: "Important",
    rule: "Likely affects reproduction fidelity but has documented fallbacks (e.g. augmentation, scheduler, tokenizer version).",
  },
  informational: {
    label: "Informational",
    rule: "Context that rarely changes results but aids understanding (e.g. author affiliation, hardware brand).",
  },
};

/** Categories of claims, with the review filter grouping used by the evidence ledger. */
export const CLAIM_CATEGORIES: { id: string; label: string }[] = [
  { id: "architecture", label: "Architecture" },
  { id: "dataset", label: "Dataset" },
  { id: "preprocessing", label: "Preprocessing" },
  { id: "loss", label: "Loss" },
  { id: "optimizer", label: "Optimizer" },
  { id: "training", label: "Training" },
  { id: "evaluation", label: "Evaluation" },
  { id: "metrics", label: "Metrics" },
  { id: "compute", label: "Compute" },
  { id: "environment", label: "Environment" },
  { id: "reported_results", label: "Reported results" },
];

export function isBlocker(claim: Claim): boolean {
  return (
    claim.impact === "critical" &&
    (claim.evidence_status === "unspecified" ||
      claim.evidence_status === "conflicting") &&
    claim.review_status !== "accepted" &&
    claim.review_status !== "corrected"
  );
}

export function unresolvedCriticalCount(claims: Claim[]): number {
  return claims.filter(
    (c) =>
      c.impact === "critical" &&
      (c.evidence_status === "unspecified" ||
        c.evidence_status === "conflicting") &&
      c.review_status === "not_reviewed"
  ).length;
}

export function reviewedCriticalCount(claims: Claim[]): {
  reviewed: number;
  total: number;
} {
  const critical = claims.filter((c) => c.impact === "critical");
  return {
    total: critical.length,
    reviewed: critical.filter(
      (c) => c.review_status === "accepted" || c.review_status === "corrected"
    ).length,
  };
}

export function conflictCount(claims: Claim[]): number {
  return claims.filter((c) => c.evidence_status === "conflicting").length;
}

export function evidenceCoverage(claims: Claim[]): number {
  const populated = claims.filter(
    (c) => c.value !== null && c.value !== "" && c.evidence_status !== "unspecified"
  );
  if (populated.length === 0) return 1;
  const withEvidence = populated.filter(
    (c) => c.evidence.length > 0 && c.evidence.some((e) => e.text.trim().length > 0)
  );
  return withEvidence.length / populated.length;
}

/** Deterministic short id from a string (non-cryptographic, for display + ordering). */
export function shortHash(input: string, len = 10): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(12, "0").slice(0, len);
}

export function formatValue(
  value: string | number | boolean | null,
  unit: string | null
): string {
  if (value === null || value === "") return "— unknown —";
  let base: string;
  if (typeof value === "number") {
    base = Number.isInteger(value)
      ? value.toLocaleString("en-US")
      : String(Number(value.toFixed(6)));
  } else if (typeof value === "boolean") {
    base = value ? "yes" : "no";
  } else {
    base = value;
  }
  return unit ? `${base} ${unit}` : base;
}
