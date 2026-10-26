import type {
  Project,
  ReportedMetric,
  ReproductionAssessment,
  RunManifest,
} from "./types";
import { shortHash } from "./semantics";

/**
 * F14 — Reported-vs-measured comparison with honest semantics.
 * - Absolute delta by default. Relative delta only when mathematically meaningful.
 * - Single-seed vs paper-mean comparisons are flagged, never silent.
 * - "criteria_passed" is always a human confirmation, never automatic.
 */

export function metricNameNorm(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\s-]+/g, "_")
    .replace(/validation_|val_|eval_/g, (m) => (m === "val_" ? "" : m === "eval_" ? "" : m))
    .replace(/^test_/, "")
    .trim();
}

function findRunMetric(run: RunManifest, metricName: string) {
  const target = metricNameNorm(metricName);
  return (
    run.metrics.find((m) => metricNameNorm(m.name) === target) ??
    run.metrics.find((m) => {
      const n = metricNameNorm(m.name);
      return (
        (target.includes("bleu") && n.includes("bleu")) ||
        (target.includes("accuracy") && n.includes("accuracy")) ||
        (target.includes("f1") && n === "f1") ||
        (target.includes("perplexity") && n.includes("perplexity"))
      );
    }) ??
    null
  );
}

export interface ComparisonRow {
  reported_metric_id: string;
  metric: string;
  reported: number;
  reportedSource: string;
  reportedAggregation: string;
  run_id: string | null;
  runLabel: string | null;
  measured: number | null;
  abs_delta: number | null;
  rel_delta: number | null;
  rel_delta_meaningful: boolean;
  mismatches: string[];
  suggested_state: ReproductionAssessment["status"];
  is_example_run: boolean;
}

function relMeaningful(reported: number): boolean {
  // Relative change is meaningless for zero/signed baselines.
  return Number.isFinite(reported) && reported !== 0 && reported > 0;
}

export function compareAll(project: Project): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  for (const rm of project.reported_metrics) {
    for (const run of project.runs) {
      const m = findRunMetric(run, rm.name);
      if (!m) continue;
      const abs = m.value - rm.value;
      const rel = relMeaningful(rm.value) ? abs / rm.value : null;
      const mismatches: string[] = [];

      if (rm.split && m.split && metricNameNorm(rm.split) !== metricNameNorm(m.split)) {
        mismatches.push(`Split mismatch: reported="${rm.split}" vs run="${m.split}".`);
      } else if (rm.split && !m.split) {
        mismatches.push(`Run does not record an evaluation split — comparability with reported split "${rm.split}" is unknown.`);
      }
      if (!m.metric_version) {
        mismatches.push("Run does not record a metric implementation version.");
      }
      if (!run.config_hash) mismatches.push("Run manifest lacks a config hash.");
      if (!run.code_commit) mismatches.push("Run manifest lacks a code commit.");
      if (!run.dataset_fingerprint) {
        mismatches.push("Run manifest lacks a dataset fingerprint — data identity unverified.");
      }
      if (run.seed !== null && run.seed !== undefined && /mean|median|best of/i.test(rm.aggregation)) {
        mismatches.push(
          `Paper reports "${rm.aggregation}" but run ${run.run_id} is a single seed (${run.seed}) — not directly comparable.`
        );
      }
      if (rm.dataset && run.dataset_fingerprint && !run.dataset_fingerprint.toLowerCase().includes(rm.dataset.split(" ")[0].toLowerCase())) {
        mismatches.push(
          `Dataset identity: reported="${rm.dataset}" vs fingerprint="${run.dataset_fingerprint}" — verify they are the same corpus/version.`
        );
      }

      const suggested: ReproductionAssessment["status"] =
        mismatches.length >= 3
          ? "needs_verification"
          : Math.abs(abs) <= 0.35 && mismatches.length === 0
            ? "partial_reproduction"
            : Math.abs(abs) > 0.35
              ? "discrepancy_observed"
              : "needs_verification";

      rows.push({
        reported_metric_id: rm.metric_id,
        metric: rm.name,
        reported: rm.value,
        reportedSource: rm.source,
        reportedAggregation: rm.aggregation,
        run_id: run.run_id,
        runLabel: run.label ?? null,
        measured: m.value,
        abs_delta: Math.round(abs * 1000) / 1000,
        rel_delta: rel !== null ? Math.round(rel * 10000) / 10000 : null,
        rel_delta_meaningful: rel !== null,
        mismatches,
        suggested_state: suggested,
        is_example_run: Boolean(run.is_example),
      });
    }
    if (!project.runs.some((r) => findRunMetric(r, rm.name))) {
      rows.push({
        reported_metric_id: rm.metric_id,
        metric: rm.name,
        reported: rm.value,
        reportedSource: rm.source,
        reportedAggregation: rm.aggregation,
        run_id: null,
        runLabel: null,
        measured: null,
        abs_delta: null,
        rel_delta: null,
        rel_delta_meaningful: false,
        mismatches: ["No imported run measures this metric yet — state stays not_run."],
        suggested_state: "not_run",
        is_example_run: false,
      });
    }
  }
  return rows;
}

export function makeAssessment(
  row: ComparisonRow,
  status: ReproductionAssessment["status"],
  note?: string,
  criteriaConfirmed?: boolean
): ReproductionAssessment {
  const mismatches = [...row.mismatches];
  if (status === "criteria_passed" && !criteriaConfirmed) {
    // Guard: auto-awarding is forbidden by the blueprint.
    status = "needs_verification";
    mismatches.push("criteria_passed requested without user confirmation — downgraded.");
  }
  return {
    assessment_id: `as_${shortHash(row.reported_metric_id + (row.run_id ?? "none"), 10)}`,
    reported_metric_id: row.reported_metric_id,
    run_id: row.run_id,
    status,
    abs_delta: row.abs_delta,
    rel_delta: row.rel_delta_meaningful ? row.rel_delta : null,
    rel_delta_meaningful: row.rel_delta_meaningful,
    mismatches,
    reviewer_note: note ?? null,
    criteria_confirmed_by_user: criteriaConfirmed ?? false,
    updated_at: new Date().toISOString(),
  };
}

export const REPRO_STATE_LABELS: Record<ReproductionAssessment["status"], string> = {
  not_run: "Not run",
  run_recorded: "Run recorded",
  partial_reproduction: "Partial reproduction",
  needs_verification: "Needs verification",
  discrepancy_observed: "Discrepancy observed",
  criteria_passed: "Reproduction criteria passed",
  blocked: "Blocked",
};

export const REPRO_STATE_TONE: Record<
  ReproductionAssessment["status"],
  "good" | "warn" | "bad" | "muted" | "neutral"
> = {
  not_run: "muted",
  run_recorded: "neutral",
  partial_reproduction: "warn",
  needs_verification: "warn",
  discrepancy_observed: "bad",
  criteria_passed: "good",
  blocked: "bad",
};

/** Aggregate project-level status — must never claim "reproduced" wholesale. */
export function projectStatus(project: Project): {
  label: string;
  tone: "good" | "warn" | "bad" | "muted";
  detail: string;
} {
  const assessments = project.assessments;
  if (!project.runs.length)
    return {
      label: "No runs recorded",
      tone: "muted",
      detail: "Import a run manifest after training locally; nothing is claimed yet.",
    };
  if (assessments.some((a) => a.status === "criteria_passed" && a.criteria_confirmed_by_user))
    return {
      label: "Criteria passed (per checked protocol)",
      tone: "good",
      detail: "At least one comparison passed the user-confirmed protocol criteria.",
    };
  if (assessments.some((a) => a.status === "discrepancy_observed"))
    return {
      label: "Discrepancy observed",
      tone: "bad",
      detail: "A comparable run differs from the reported value. Causes are hypotheses, not findings.",
    };
  if (assessments.some((a) => a.status === "needs_verification" || a.status === "partial_reproduction"))
    return {
      label: "Needs verification",
      tone: "warn",
      detail: "Runs exist but protocol/provenance requirements remain.",
    };
  return {
    label: "Run recorded",
    tone: "neutral",
    detail: "Run manifests exist; comparisons not yet assessed.",
  };
}
