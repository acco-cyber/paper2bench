/**
 * Paper2Bench — readiness analytics.
 * Deterministic, dependency-free scoring of how ready a reproduction project is,
 * computed ONLY from user-visible state. A high score never implies scientific
 * success — it measures process completeness (evidence reviewed, plan built,
 * scaffold validated, runs compared). Every sub-score is explainable and every
 * deduction is listed, so the number is auditable rather than magical.
 */

import type { Project, ViewId } from "./types";
import {
  conflictCount,
  evidenceCoverage,
  isBlocker,
  reviewedCriticalCount,
  unresolvedCriticalCount,
} from "./semantics";

export interface ScoreDeduction {
  points: number; // positive number = how much was deducted from that sub-score
  reason: string;
  view: ViewId; // where the user fixes it
}

export interface SubScore {
  id: "evidence" | "plan" | "build" | "verify";
  label: string;
  score: number; // 0..100
  deductions: ScoreDeduction[];
}

export interface ReadinessScore {
  total: number; // 0..100
  verdict: "blocked" | "early" | "in_progress" | "strong" | "ready";
  verdict_label: string;
  subs: SubScore[];
  recommendations: { label: string; view: ViewId }[]; // ordered, max 3
  score_version: string;
}

const VERSION = "readiness-1.0";

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Evidence sub-score: 55% critical review, 25% conflicts, 20% anchor coverage. */
function evidenceScore(project: Project): SubScore {
  const deductions: ScoreDeduction[] = [];
  let score = 100;

  const crit = reviewedCriticalCount(project.claims);
  const reviewRatio = crit.total ? crit.reviewed / crit.total : 1;
  const reviewPts = Math.round(55 * reviewRatio);
  if (reviewPts < 55) {
    deductions.push({
      points: 55 - reviewPts,
      reason: `${crit.total - crit.reviewed} of ${crit.total} critical claims not yet reviewed`,
      view: "evidence",
    });
    score -= 55 - reviewPts;
  }

  const conflicts = conflictCount(project.claims);
  if (conflicts) {
    const pts = Math.min(25, conflicts * 13);
    deductions.push({ points: pts, reason: `${conflicts} conflicting claim(s) unresolved`, view: "evidence" });
    score -= pts;
  }

  const coverage = evidenceCoverage(project.claims);
  const covPts = Math.round(20 * coverage);
  if (covPts < 20) {
    deductions.push({
      points: 20 - covPts,
      reason: `${Math.round((1 - coverage) * 100)}% of populated claims lack an evidence anchor`,
      view: "evidence",
    });
    score -= 20 - covPts;
  }

  return { id: "evidence", label: "Evidence", score: clamp100(score), deductions };
}

/** Plan sub-score: generated? tasks progressing? blockers acknowledged? */
function planScore(project: Project): SubScore {
  const deductions: ScoreDeduction[] = [];
  let score = 100;

  if (!project.tasks.length) {
    deductions.push({ points: 100, reason: "Reproduction plan not generated", view: "plan" });
    return { id: "plan", label: "Plan", score: 0, deductions };
  }

  const done = project.tasks.filter((t) => t.status === "done" || t.status === "not_applicable").length;
  const progress = done / project.tasks.length;
  const pts = Math.round(60 * progress);
  if (pts < 60) {
    deductions.push({
      points: 60 - pts,
      reason: `${project.tasks.length - done}/${project.tasks.length} plan tasks still open`,
      view: "plan",
    });
    score -= 60 - pts;
  }

  const stuck = project.tasks.filter((t) => t.status === "blocked").length;
  if (stuck) {
    const pts = Math.min(20, stuck * 7);
    deductions.push({ points: pts, reason: `${stuck} task(s) blocked`, view: "plan" });
    score -= pts;
  }

  const blockers = project.claims.filter(isBlocker).length;
  if (blockers) {
    const pts = Math.min(20, blockers * 9);
    deductions.push({ points: pts, reason: `${blockers} unresolved blocker claim(s) touch the plan`, view: "evidence" });
    score -= pts;
  }

  return { id: "plan", label: "Plan", score: clamp100(score), deductions };
}

/** Build sub-score: scaffold generated, not provisional, validation healthy. */
function buildScore(project: Project): SubScore {
  const deductions: ScoreDeduction[] = [];
  let score = 100;

  if (!project.scaffold) {
    deductions.push({ points: 100, reason: "Project scaffold not generated", view: "files" });
    return { id: "build", label: "Build", score: 0, deductions };
  }

  if (project.provisional) {
    deductions.push({ points: 25, reason: "Scaffold is provisional (generated with unresolved criticals)", view: "files" });
    score -= 25;
  }

  const staleCount = project.scaffold.files.filter((f) => f.stale).length;
  if (staleCount) {
    const pts = Math.min(15, staleCount * 5);
    deductions.push({ points: pts, reason: `${staleCount} scaffold file(s) stale after claim edits`, view: "files" });
    score -= pts;
  }

  if (!project.validation) {
    deductions.push({ points: 40, reason: "Validation never ran", view: "validation" });
    score -= 40;
  } else {
    const fails = project.validation.checks.filter((c) => c.result === "fail").length;
    const warns = project.validation.checks.filter((c) => c.result === "warning").length;
    if (fails) {
      const pts = Math.min(30, fails * 15);
      deductions.push({ points: pts, reason: `${fails} validation check(s) failed`, view: "validation" });
      score -= pts;
    }
    if (warns) {
      const pts = Math.min(10, warns * 3);
      deductions.push({ points: pts, reason: `${warns} validation warning(s)`, view: "validation" });
      score -= pts;
    }
  }

  return { id: "build", label: "Build", score: clamp100(score), deductions };
}

/** Verify sub-score: runs recorded + compared + criteria confirmed (never auto-awarded). */
function verifyScore(project: Project): SubScore {
  const deductions: ScoreDeduction[] = [];
  let score = 100;

  if (!project.runs.length) {
    deductions.push({ points: 100, reason: "No runs recorded — nothing measured yet", view: "runs" });
    return { id: "verify", label: "Verify", score: 0, deductions };
  }

  if (!project.reported_metrics.length) {
    deductions.push({ points: 30, reason: "No reported metrics extracted to compare against", view: "runs" });
    score -= 30;
  } else {
    const unassessed = project.reported_metrics.length - project.assessments.length;
    if (unassessed > 0) {
      const pts = Math.min(45, unassessed * 15);
      deductions.push({ points: pts, reason: `${unassessed} reported metric(s) not compared to a run`, view: "runs" });
      score -= pts;
    }
    const confirmed = project.assessments.filter((a) => a.criteria_confirmed_by_user).length;
    if (!confirmed) {
      deductions.push({ points: 25, reason: "No reproduction criteria explicitly confirmed by a human", view: "runs" });
      score -= 25;
    }
  }

  const discrepant = project.assessments.filter(
    (a) => a.status === "discrepancy_observed" || a.status === "needs_verification"
  ).length;
  if (discrepant) {
    const pts = Math.min(20, discrepant * 7);
    deductions.push({ points: pts, reason: `${discrepant} assessment(s) flagged discrepancy / needs verification`, view: "runs" });
    score -= pts;
  }

  return { id: "verify", label: "Verify", score: clamp100(score), deductions };
}

function verdictOf(total: number): { verdict: ReadinessScore["verdict"]; label: string } {
  if (total < 20) return { verdict: "blocked", label: "Early — evidence review first" };
  if (total < 45) return { verdict: "early", label: "Taking shape — keep reviewing" };
  if (total < 70) return { verdict: "in_progress", label: "In progress — plan and build" };
  if (total < 90) return { verdict: "strong", label: "Strong — verify against runs" };
  return { verdict: "ready", label: "Reproduction-ready" };
}

/** Compute the readiness score. Pure & deterministic: same project → same score. */
export function readinessScore(project: Project): ReadinessScore {
  const subs: SubScore[] = [
    evidenceScore(project),
    planScore(project),
    buildScore(project),
    verifyScore(project),
  ];
  // Weights: evidence matters most, then build, plan, verify.
  const total = clamp100(
    subs[0].score * 0.35 + subs[1].score * 0.2 + subs[2].score * 0.25 + subs[3].score * 0.2
  );
  const { verdict, label } = verdictOf(total);

  const recommendations: { label: string; view: ViewId }[] = [];
  for (const sub of subs) {
    for (const d of sub.deductions) {
      if (d.points > 0) recommendations.push({ label: d.reason, view: d.view });
    }
  }
  recommendations.sort((a, b) => b.label.length - a.label.length); // stable-ish ordering

  return {
    total,
    verdict,
    verdict_label: label,
    subs,
    recommendations: recommendations.slice(0, 3).map((r) => ({ label: r.label, view: r.view })),
    score_version: VERSION,
  };
}

/* —————————————————————————————————————————————————————————— */
/* Workspace-level aggregates (projects dashboard)            */
/* —————————————————————————————————————————————————————————— */

export type ProjectCardTone = "good" | "warn" | "bad" | "muted";

export interface WorkspaceCard {
  id: string;
  title: string;
  source_kind: string;
  updated_at: string;
  created_at: string;
  claims: number;
  conflicts: number;
  blockers: number;
  runs: number;
  tasks_done: number;
  tasks_total: number;
  has_scaffold: boolean;
  provisional: boolean;
  readiness: ReadinessScore;
  archived: boolean;
  pinned: boolean;
  next: string;
}

/** Build a dashboard card for one project. Pure. */
export function workspaceCard(project: Project): WorkspaceCard {
  const r = readinessScore(project);
  const crit = reviewedCriticalCount(project.claims);
  const blockers = unresolvedCriticalCount(project.claims);
  const conflicts = conflictCount(project.claims);
  const done = project.tasks.filter((t) => t.status === "done" || t.status === "not_applicable").length;

  let next = "Open workspace";
  if (conflicts) next = `Resolve ${conflicts} conflict${conflicts > 1 ? "s" : ""}`;
  else if (blockers) next = `Review ${blockers} blocker${blockers > 1 ? "s" : ""}`;
  else if (!project.tasks.length) next = "Generate reproduction plan";
  else if (!project.scaffold) next = "Generate scaffold";
  else if (!project.validation) next = "Run validation";
  else if (!project.runs.length) next = "Import run records";

  return {
    id: project.id,
    title: project.paper.title,
    source_kind: project.paper.source_kind,
    updated_at: project.updated_at,
    created_at: project.created_at,
    claims: project.claims.length,
    conflicts,
    blockers,
    runs: project.runs.length,
    tasks_done: done,
    tasks_total: project.tasks.length,
    has_scaffold: Boolean(project.scaffold),
    provisional: project.provisional,
    readiness: r,
    archived: project.archived === true,
    pinned: project.pinned === true,
    next,
    ...(crit.total ? {} : {}),
  };
}

export type CardSort = "recent" | "name" | "readiness";

/** Sort + filter workspace cards. Pure. */
export function organizeCards(
  projects: Project[],
  opts: { q: string; sort: CardSort; showArchived: boolean }
): WorkspaceCard[] {
  const q = opts.q.trim().toLowerCase();
  let cards = projects.map(workspaceCard);
  if (q) {
    cards = cards.filter((c) => c.title.toLowerCase().includes(q));
  }
  if (!opts.showArchived) cards = cards.filter((c) => !c.archived);
  const cmp: Record<CardSort, (a: WorkspaceCard, b: WorkspaceCard) => number> = {
    recent: (a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
    name: (a, b) => a.title.localeCompare(b.title),
    readiness: (a, b) => b.readiness.total - a.readiness.total,
  };
  cards.sort(cmp[opts.sort]);
  // Pinned always first.
  cards.sort((a, b) => Number(b.pinned) - Number(a.pinned));
  return cards;
}

/** Workspace-wide stats strip. Pure. */
export function workspaceStats(projects: Project[]): {
  total: number;
  active: number;
  archived: number;
  avg_readiness: number;
  total_runs: number;
  criteria_passed: number;
} {
  const cards = projects.map(workspaceCard);
  const active = cards.filter((c) => !c.archived).length;
  const avg = cards.length
    ? Math.round(cards.reduce((s, c) => s + c.readiness.total, 0) / cards.length)
    : 0;
  const criteriaPassed = projects.filter((p) =>
    p.assessments.some((a) => a.status === "criteria_passed")
  ).length;
  return {
    total: projects.length,
    active,
    archived: cards.length - active,
    avg_readiness: avg,
    total_runs: projects.reduce((s, p) => s + p.runs.length, 0),
    criteria_passed: criteriaPassed,
  };
}
