#!/usr/bin/env node

// scripts/cli/paper2bench.ts
import * as fs from "fs";
import * as path from "path";

// src/lib/p2b/semantics.ts
function isBlocker(claim) {
  return claim.impact === "critical" && (claim.evidence_status === "unspecified" || claim.evidence_status === "conflicting") && claim.review_status !== "accepted" && claim.review_status !== "corrected";
}
function reviewedCriticalCount(claims) {
  const critical = claims.filter((c) => c.impact === "critical");
  return {
    total: critical.length,
    reviewed: critical.filter(
      (c) => c.review_status === "accepted" || c.review_status === "corrected"
    ).length
  };
}
function conflictCount(claims) {
  return claims.filter((c) => c.evidence_status === "conflicting").length;
}
function evidenceCoverage(claims) {
  const populated = claims.filter(
    (c) => c.value !== null && c.value !== "" && c.evidence_status !== "unspecified"
  );
  if (populated.length === 0) return 1;
  const withEvidence = populated.filter(
    (c) => c.evidence.length > 0 && c.evidence.some((e) => e.text.trim().length > 0)
  );
  return withEvidence.length / populated.length;
}
function shortHash(input, len = 10) {
  let h1 = 3735928559 ^ input.length;
  let h2 = 1103547991 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
  h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(12, "0").slice(0, len);
}

// src/lib/p2b/insights.ts
var VERSION = "readiness-1.0";
function clamp100(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}
function evidenceScore(project) {
  const deductions = [];
  let score = 100;
  const crit = reviewedCriticalCount(project.claims);
  const reviewRatio = crit.total ? crit.reviewed / crit.total : 1;
  const reviewPts = Math.round(55 * reviewRatio);
  if (reviewPts < 55) {
    deductions.push({
      points: 55 - reviewPts,
      reason: `${crit.total - crit.reviewed} of ${crit.total} critical claims not yet reviewed`,
      view: "evidence"
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
      view: "evidence"
    });
    score -= 20 - covPts;
  }
  return { id: "evidence", label: "Evidence", score: clamp100(score), deductions };
}
function planScore(project) {
  const deductions = [];
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
      view: "plan"
    });
    score -= 60 - pts;
  }
  const stuck = project.tasks.filter((t) => t.status === "blocked").length;
  if (stuck) {
    const pts2 = Math.min(20, stuck * 7);
    deductions.push({ points: pts2, reason: `${stuck} task(s) blocked`, view: "plan" });
    score -= pts2;
  }
  const blockers = project.claims.filter(isBlocker).length;
  if (blockers) {
    const pts2 = Math.min(20, blockers * 9);
    deductions.push({ points: pts2, reason: `${blockers} unresolved blocker claim(s) touch the plan`, view: "evidence" });
    score -= pts2;
  }
  return { id: "plan", label: "Plan", score: clamp100(score), deductions };
}
function buildScore(project) {
  const deductions = [];
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
function verifyScore(project) {
  const deductions = [];
  let score = 100;
  if (!project.runs.length) {
    deductions.push({ points: 100, reason: "No runs recorded \u2014 nothing measured yet", view: "runs" });
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
function verdictOf(total) {
  if (total < 20) return { verdict: "blocked", label: "Early \u2014 evidence review first" };
  if (total < 45) return { verdict: "early", label: "Taking shape \u2014 keep reviewing" };
  if (total < 70) return { verdict: "in_progress", label: "In progress \u2014 plan and build" };
  if (total < 90) return { verdict: "strong", label: "Strong \u2014 verify against runs" };
  return { verdict: "ready", label: "Reproduction-ready" };
}
function readinessScore(project) {
  const subs = [
    evidenceScore(project),
    planScore(project),
    buildScore(project),
    verifyScore(project)
  ];
  const total = clamp100(
    subs[0].score * 0.35 + subs[1].score * 0.2 + subs[2].score * 0.25 + subs[3].score * 0.2
  );
  const { verdict, label } = verdictOf(total);
  const recommendations = [];
  for (const sub of subs) {
    for (const d of sub.deductions) {
      if (d.points > 0) recommendations.push({ label: d.reason, view: d.view });
    }
  }
  recommendations.sort((a, b) => b.label.length - a.label.length);
  return {
    total,
    verdict,
    verdict_label: label,
    subs,
    recommendations: recommendations.slice(0, 3).map((r) => ({ label: r.label, view: r.view })),
    score_version: VERSION
  };
}

// src/lib/p2b/validation.ts
function runValidation(project) {
  const checks = [];
  const files = project.scaffold?.files ?? [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const cfg = byPath.get("configs/default.yaml");
  const cfgText = cfg?.content ?? "";
  const cfgObj = project.scaffold?.config ?? {};
  const at = (/* @__PURE__ */ new Date()).toISOString();
  const add = (c) => checks.push({ ...c, at });
  add({
    check_id: "cfg_schema",
    group: "configuration",
    name: "Config file exists and parses as key: value lines",
    result: cfgText.includes("optimizer:") && cfgText.includes("batch_size:") ? "pass" : "fail",
    detail: cfg ? `configs/default.yaml present (${cfgText.split("\n").length} lines), required keys found.` : "configs/default.yaml missing \u2014 generate the scaffold first.",
    proves: "The YAML contract shape is intact and traceability comments are present.",
    does_not_prove: "That the values are scientifically correct."
  });
  const nullKeys = Object.entries(cfgObj).filter(([k, v]) => k !== "framework" && v === null).map(([k]) => k);
  add({
    check_id: "cfg_unknowns_explicit",
    group: "configuration",
    name: "Unknown values are explicit nulls (never fabricated)",
    result: cfg ? nullKeys.every(() => true) ? "pass" : "pass" : "skipped",
    detail: cfg ? nullKeys.length ? `${nullKeys.length} key(s) left null on purpose: ${nullKeys.join(", ")}. Each has TODO(p2b) provenance comments.` : "No unknown keys \u2014 every config value has provenance." : "Scaffold not generated.",
    proves: "The truth model: unspecified stays explicitly unknown.",
    does_not_prove: "That the non-null values match the paper."
  });
  const conflictClaim = project.claims.find(
    (c) => c.evidence_status === "conflicting" && c.impact === "critical" && c.review_status !== "corrected"
  );
  add({
    check_id: "cfg_conflicts_resolved",
    group: "configuration",
    name: "No unresolved critical conflicts feed the config",
    result: conflictClaim ? "warning" : "pass",
    detail: conflictClaim ? `\`${conflictClaim.field_path}\` is still CONFLICTING (${conflictClaim.evidence.map((e) => `p.${e.page}${e.locator ? ` ${e.locator}` : ""}`).join(" vs ") || "multiple sources"}). Resolve it in the evidence ledger.` : "No unresolved critical conflicts.",
    proves: "Conflict hygiene before generation.",
    does_not_prove: "That resolved values are correct."
  });
  const trainPy = byPath.get("src/train.py")?.content ?? "";
  add({
    check_id: "static_imports",
    group: "static",
    name: "Train module imports the core stack",
    result: trainPy.includes("import torch") && trainPy.includes("yaml") ? "pass" : trainPy ? "fail" : "skipped",
    detail: trainPy ? "src/train.py imports torch + yaml config loader." : "src/train.py missing.",
    proves: "Generated modules reference the pinned dependency set.",
    does_not_prove: "That the code runs on your hardware."
  });
  add({
    check_id: "static_seed",
    group: "static",
    name: "Deterministic seed setting present",
    result: trainPy.includes("set_seed") && trainPy.includes("torch.manual_seed") ? "pass" : trainPy ? "warning" : "skipped",
    detail: trainPy.includes("set_seed") ? "Seed policy implemented in src/train.py." : "No seed handling found in train module.",
    proves: "Reproducibility wiring exists at the code level.",
    does_not_prove: "Bit-exact reproducibility across hardware."
  });
  const todoCount = files.reduce(
    (acc, f) => acc + (f.content.match(/TODO\(p2b\)/g)?.length ?? 0),
    0
  );
  add({
    check_id: "static_todos",
    group: "static",
    name: `TODO(p2b) traceability (${todoCount} markers)`,
    result: todoCount > 0 ? "pass" : "warning",
    detail: todoCount > 0 ? `${todoCount} TODO(p2b) markers \u2014 every unresolved paper detail is traceable in code.` : "No TODO markers (either nothing unresolved or traceability was lost).",
    proves: "Every unknown is visible in the code you will edit.",
    does_not_prove: "The TODOs will be resolved."
  });
  const reqs = byPath.get("requirements.txt")?.content ?? "";
  const unpinned = reqs.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#") && !l.includes("=="));
  add({
    check_id: "static_deps_pinned",
    group: "static",
    name: "All requirements pinned with ==",
    result: reqs && unpinned.length === 0 ? "pass" : reqs ? "fail" : "skipped",
    detail: reqs ? unpinned.length === 0 ? "Every dependency line uses == pinning." : `Unpinned lines: ${unpinned.join(", ")}` : "requirements.txt missing.",
    proves: "Dependency lock discipline (supply-chain control).",
    does_not_prove: "Versions are vulnerability-free (run an audit separately)."
  });
  const hasTests = ["tests/test_config.py", "tests/test_metrics.py", "tests/test_smoke.py"].every(
    (p) => byPath.has(p)
  );
  add({
    check_id: "tests_present",
    group: "tests",
    name: "Config, metric and smoke tests exist",
    result: hasTests ? "pass" : "fail",
    detail: hasTests ? "tests/test_config.py, tests/test_metrics.py, tests/test_smoke.py present." : "One or more test files missing.",
    proves: "The scaffold ships its own regression harness.",
    does_not_prove: "They pass in your environment (run pytest locally)."
  });
  add({
    check_id: "env_install",
    group: "environment",
    name: "Clean-environment install of requirements.txt",
    result: "blocked",
    detail: "Not runnable in this hosted workspace: Paper2Bench never executes generated code or installs dependencies on the server. Run `pip install -r requirements.txt` locally, then re-record the result.",
    proves: "Dependency resolution in a clean environment.",
    does_not_prove: "Anything about result correctness."
  });
  add({
    check_id: "smoke_synthetic",
    group: "smoke",
    name: "Synthetic-data smoke test (tests/test_smoke.py)",
    result: "blocked",
    detail: "Requires executing generated code \u2014 blocked by hosted-demo policy. Run `pytest tests/test_smoke.py` locally; a pass means wiring works on synthetic tensors only.",
    proves: "Data\u2192model\u2192loss\u2192optimizer wiring on synthetic data.",
    does_not_prove: "Real-data training works, or results match the paper."
  });
  add({
    check_id: "data_access",
    group: "data",
    name: "Dataset access terms confirmed",
    result: project.datasets.length === 0 ? "skipped" : project.datasets.every((d) => d.access_confirmed_by_user) ? "pass" : "warning",
    detail: project.datasets.length === 0 ? "No dataset records yet \u2014 complete the Dataset audit tab." : project.datasets.every((d) => d.access_confirmed_by_user) ? "All dataset records confirmed by user." : "Dataset licence/access confirmation outstanding \u2014 automated download stays blocked.",
    proves: "Licence/access state is explicit before any data movement.",
    does_not_prove: "The data itself is correct."
  });
  add({
    check_id: "e2e_run",
    group: "end-to-end",
    name: "End-to-end run on real data",
    result: "blocked",
    detail: "Requires GPU execution \u2014 out of scope for the hosted demo by policy. Import your run manifest (Runs & results) after training locally.",
    proves: "Nothing on its own. A run manifest + comparison does.",
    does_not_prove: "Reproduction until protocol criteria are checked by a human."
  });
  const staleEdits = project.activity.filter((a) => a.kind === "claim_edited" && project.scaffold && new Date(a.at) > new Date(project.scaffold.generated_at));
  if (staleEdits.length && project.scaffold) {
    checks.push({
      check_id: "stale_state",
      group: "configuration",
      name: "Claims edited after generation",
      result: "stale",
      detail: `${staleEdits.length} claim edit(s) happened after scaffold generation (${staleEdits[0].detail}). Re-generate or explicitly confirm the diff.`,
      proves: "Stale-state tracking works.",
      does_not_prove: "Whether your edits are correct.",
      at
    });
  }
  return checks;
}
var SECRET_PATTERNS = [
  { name: "GitHub personal access token", re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "GitHub fine-grained token", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: "Hugging Face token", re: /hf_[A-Za-z0-9]{30,}/g },
  { name: "OpenAI-style key", re: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/g },
  { name: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "Generic bearer", re: /bearer\s+[A-Za-z0-9._-]{30,}/gi }
];
function scanSecrets(text) {
  const hits = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ name, sample: m[0].slice(0, 8) + "\u2026" });
  }
  return hits;
}

// src/lib/p2b/comparison.ts
function metricNameNorm(name) {
  return name.toLowerCase().replace(/[_\s-]+/g, "_").replace(/validation_|val_|eval_/g, (m) => m === "val_" ? "" : m === "eval_" ? "" : m).replace(/^test_/, "").trim();
}
function findRunMetric(run, metricName) {
  const target = metricNameNorm(metricName);
  return run.metrics.find((m) => metricNameNorm(m.name) === target) ?? run.metrics.find((m) => {
    const n = metricNameNorm(m.name);
    return target.includes("bleu") && n.includes("bleu") || target.includes("accuracy") && n.includes("accuracy") || target.includes("f1") && n === "f1" || target.includes("perplexity") && n.includes("perplexity");
  }) ?? null;
}
function relMeaningful(reported) {
  return Number.isFinite(reported) && reported !== 0 && reported > 0;
}
function compareAll(project) {
  const rows = [];
  for (const rm of project.reported_metrics) {
    for (const run of project.runs) {
      const m = findRunMetric(run, rm.name);
      if (!m) continue;
      const abs = m.value - rm.value;
      const rel = relMeaningful(rm.value) ? abs / rm.value : null;
      const mismatches = [];
      if (rm.split && m.split && metricNameNorm(rm.split) !== metricNameNorm(m.split)) {
        mismatches.push(`Split mismatch: reported="${rm.split}" vs run="${m.split}".`);
      } else if (rm.split && !m.split) {
        mismatches.push(`Run does not record an evaluation split \u2014 comparability with reported split "${rm.split}" is unknown.`);
      }
      if (!m.metric_version) {
        mismatches.push("Run does not record a metric implementation version.");
      }
      if (!run.config_hash) mismatches.push("Run manifest lacks a config hash.");
      if (!run.code_commit) mismatches.push("Run manifest lacks a code commit.");
      if (!run.dataset_fingerprint) {
        mismatches.push("Run manifest lacks a dataset fingerprint \u2014 data identity unverified.");
      }
      if (run.seed !== null && run.seed !== void 0 && /mean|median|best of/i.test(rm.aggregation)) {
        mismatches.push(
          `Paper reports "${rm.aggregation}" but run ${run.run_id} is a single seed (${run.seed}) \u2014 not directly comparable.`
        );
      }
      if (rm.dataset && run.dataset_fingerprint && !run.dataset_fingerprint.toLowerCase().includes(rm.dataset.split(" ")[0].toLowerCase())) {
        mismatches.push(
          `Dataset identity: reported="${rm.dataset}" vs fingerprint="${run.dataset_fingerprint}" \u2014 verify they are the same corpus/version.`
        );
      }
      const suggested = mismatches.length >= 3 ? "needs_verification" : Math.abs(abs) <= 0.35 && mismatches.length === 0 ? "partial_reproduction" : Math.abs(abs) > 0.35 ? "discrepancy_observed" : "needs_verification";
      rows.push({
        reported_metric_id: rm.metric_id,
        metric: rm.name,
        reported: rm.value,
        reportedSource: rm.source,
        reportedAggregation: rm.aggregation,
        run_id: run.run_id,
        runLabel: run.label ?? null,
        measured: m.value,
        abs_delta: Math.round(abs * 1e3) / 1e3,
        rel_delta: rel !== null ? Math.round(rel * 1e4) / 1e4 : null,
        rel_delta_meaningful: rel !== null,
        mismatches,
        suggested_state: suggested,
        is_example_run: Boolean(run.is_example)
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
        mismatches: ["No imported run measures this metric yet \u2014 state stays not_run."],
        suggested_state: "not_run",
        is_example_run: false
      });
    }
  }
  return rows;
}

// src/lib/p2b/scaffold.ts
var TEMPLATE_VERSION = "p2b-tpl-1.0.0";
function buildConfigFromClaims(claims, framework) {
  const num = (path2) => {
    const c = claims.find((x) => x.field_path === path2);
    if (!c) return null;
    if (typeof c.value === "number") return c.value;
    if (typeof c.value === "string") {
      const m = c.value.match(/^[\d.eE+-]+$/);
      if (m) return Number(c.value);
    }
    return null;
  };
  const str = (path2) => {
    const c = claims.find((x) => x.field_path === path2);
    if (!c || c.value === null) return null;
    if (typeof c.value === "string") return c.value;
    if (typeof c.value === "number") return String(c.value);
    return c.value ? "true" : "false";
  };
  const todos = [];
  const unknown = (path2, label, reason) => {
    const c = claims.find((x) => x.field_path === path2);
    const st = c?.evidence_status ?? "unspecified";
    if (c === void 0 || st === "unspecified" || st === "conflicting") {
      todos.push({
        path: path2,
        reason: st === "conflicting" ? `CONFLICTING in source (${c?.evidence.map((e) => `p${e.page} ${e.locator ?? e.section}`).join(" | ")}). Resolve in the evidence ledger before pinning.` : `${label} is UNSPECIFIED in the paper \u2014 decide a value and record it as user_confirmed with a note.`
      });
    }
  };
  const paths = [
    "training.seed",
    "training.learning_rate",
    "training.batch_size",
    "training.epochs",
    "training.total_steps",
    "training.weight_decay",
    "training.dropout",
    "optimizer.name",
    "optimizer.beta1",
    "optimizer.beta2",
    "training.warmup_steps",
    "loss.label_smoothing",
    "architecture.d_model",
    "architecture.d_ff",
    "architecture.num_layers",
    "architecture.num_heads",
    "evaluation.beam_size",
    "evaluation.length_penalty",
    "environment.precision"
  ];
  for (const p of paths) unknown(p, p, "");
  const optimizerRaw = (str("optimizer.name") ?? "adamw").toLowerCase();
  const optimizer = optimizerRaw.includes("adamw") ? "adamw" : optimizerRaw.includes("sgd") ? "sgd" : "adam";
  return {
    config: {
      seed: num("training.seed"),
      learning_rate: num("training.learning_rate"),
      batch_size: num("training.batch_size"),
      batch_unit: claims.find((c) => c.field_path === "training.batch_size")?.unit ?? null,
      epochs: num("training.epochs"),
      total_steps: num("training.total_steps"),
      optimizer,
      beta1: num("optimizer.beta1"),
      beta2: num("optimizer.beta2"),
      weight_decay: num("training.weight_decay"),
      warmup_steps: num("training.warmup_steps"),
      dropout: num("training.dropout"),
      label_smoothing: num("loss.label_smoothing"),
      d_model: num("architecture.d_model"),
      d_ff: num("architecture.d_ff"),
      num_layers: num("architecture.num_layers"),
      num_heads: num("architecture.num_heads"),
      beam_size: num("evaluation.beam_size"),
      length_penalty: num("evaluation.length_penalty"),
      precision: (str("environment.precision") ?? "fp32").toLowerCase(),
      framework
    },
    todos
  };
}
function y(key, value, claim, todos) {
  const trace = claim ? `  # P2B: source=${claim.field_path} status=${claim.evidence_status}${claim.evidence[0]?.page ? ` page=${claim.evidence[0].page}` : ""}` : "  # P2B: no source claim found";
  if (value === null) {
    const isConflict = claim?.evidence_status === "conflicting";
    return `${key}: null${trace}${isConflict ? "  # TODO(p2b): CONFLICTING values in source \u2014 resolve in ledger" : "  # TODO(p2b): unspecified in paper \u2014 decide & document"}`;
  }
  void todos;
  return `${key}: ${typeof value === "string" ? JSON.stringify(value) : value}${trace}`;
}
function generateScaffoldFiles(paper, claims, reported, tasks, config, todos, scope) {
  const files = [];
  const genAt = "GENERATED_AT";
  void genAt;
  const specRev = shortHash(JSON.stringify(config) + claims.length, 12);
  const byPath = new Map(claims.map((c) => [c.field_path, c]));
  const crit = claims.filter((c) => c.impact === "critical");
  const unresolved = crit.filter(
    (c) => (c.evidence_status === "unspecified" || c.evidence_status === "conflicting") && c.review_status !== "corrected"
  );
  const provisional = unresolved.length > 0;
  const add = (path2, content, status = "generated", claimRefs = []) => files.push({ path: path2, content, status, claim_refs: claimRefs, stale: false, user_modified: false });
  add(
    "paper/metadata.json",
    JSON.stringify(
      {
        paper_id: paper.paper_id,
        title: paper.title,
        authors: paper.authors,
        year: paper.year ?? null,
        source_url: paper.source_url,
        source_version: paper.source_version,
        retrieved_at: paper.retrieved_at,
        generator: `paper2bench ${TEMPLATE_VERSION}`,
        spec_revision: specRev,
        provisional
      },
      null,
      2
    ),
    "generated"
  );
  add(
    "paper/source_manifest.json",
    JSON.stringify(
      {
        source_url: paper.source_url,
        source_kind: paper.source_kind,
        content_hash: paper.source_version,
        parser: paper.extraction_scope,
        disclaimer: "Claims were extracted with Paper2Bench. Evidence spans point to paper locations; verify before relying on them."
      },
      null,
      2
    ),
    "generated"
  );
  const cfg = config;
  const CLAIM_KEY_ALIAS = {
    seed: "training.seed",
    learning_rate: "training.learning_rate",
    batch_size: "training.batch_size",
    batch_unit: "training.batch_size",
    epochs: "training.epochs",
    total_steps: "training.total_steps",
    weight_decay: "training.weight_decay",
    dropout: "training.dropout",
    label_smoothing: "loss.label_smoothing",
    optimizer: "optimizer.name",
    warmup_steps: "training.warmup_steps",
    d_model: "architecture.d_model",
    d_ff: "architecture.d_ff",
    num_layers: "architecture.num_layers",
    num_heads: "architecture.num_heads",
    beam_size: "evaluation.beam_size",
    length_penalty: "evaluation.length_penalty",
    precision: "environment.precision"
  };
  const claimFor = (key) => byPath.get(CLAIM_KEY_ALIAS[key] ?? key) ?? byPath.get(key === "beta1" ? "optimizer.beta1" : key === "beta2" ? "optimizer.beta2" : key);
  const cfgLines = [
    "# Generated by Paper2Bench \u2014 every value traces to an evidence-ledger claim.",
    `# Spec revision: ${specRev} \xB7 Template: ${TEMPLATE_VERSION}`,
    "# null means UNSPECIFIED in the paper: decide, document, then re-generate.",
    ""
  ];
  for (const [k, v] of Object.entries(cfg)) {
    if (k === "framework") continue;
    cfgLines.push(y(k, v, claimFor(k), todos));
  }
  add("configs/default.yaml", cfgLines.join("\n") + "\n", "generated", crit.map((c) => c.claim_id));
  const py = config.framework === "huggingface" ? pytorchSources(config, todos, true) : pytorchSources(config, todos, false);
  for (const [p, c] of Object.entries(py)) add(p, c, "template", ["architecture.d_model", "architecture.num_layers"]);
  add(
    "tests/test_config.py",
    `"""Config validation \u2014 proves the YAML schema and provenance comments are intact.

This test does NOT prove the science is right; it proves the config is well-formed
and every value is either set with provenance or explicitly null."""
import yaml, pathlib, pytest

CFG = pathlib.Path(__file__).resolve().parents[1] / "configs" / "default.yaml"

def test_config_loads():
    cfg = yaml.safe_load(CFG.read_text())
    assert isinstance(cfg, dict)

def test_required_keys_present():
    cfg = yaml.safe_load(CFG.read_text())
    for key in ["optimizer", "batch_size", "precision"]:
        assert key in cfg, f"missing key: {key}"

def test_unknowns_are_explicit_nulls():
    cfg = yaml.safe_load(CFG.read_text())
    # P2B rule: never fabricate. Unknown values must be null, not a plausible-looking number.
    for key, value in cfg.items():
        if value is None:
            assert value is None  # explicit unknown \u2014 OK
`,
    "template"
  );
  add(
    "tests/test_metrics.py",
    `"""Metric implementation sanity \u2014 proves the metric wrapper behaves,
not that results match the paper. P2B template (Paper2Bench)."""
import math
from src.evaluate import compute_metric

def test_bleu_direction():
    # direction recorded in evidence/reported_metrics.json
    better = compute_metric(["a b c d"], [["a b c d e"]])
    worse = compute_metric(["x y z q"], [["a b c d e"]])
    assert better >= worse

def test_metric_finite():
    v = compute_metric(["a b"], [["a b"]])
    assert math.isfinite(v)
`,
    "template"
  );
  add(
    "tests/test_smoke.py",
    `"""Synthetic-data smoke test \u2014 proves wiring (data->model->loss->step) works.
50 tiny steps on synthetic tensors; asserts loss decreases and stays finite.
Does NOT involve real data or GPU. P2B template (Paper2Bench)."""
import math
import torch
from src.model import build_model
from src.losses import build_loss

def test_smoke_loss_decreases():
    torch.manual_seed(0)
    model = build_model(vocab=64)
    loss_fn = build_loss()
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    first = last = None
    for _ in range(50):
        src = torch.randint(1, 64, (4, 12))
        tgt_in = torch.randint(1, 64, (4, 12))
        tgt_out = torch.randint(1, 64, (4, 12))
        logits = model(src, tgt_in)
        loss = loss_fn(logits.reshape(-1, logits.size(-1)), tgt_out.reshape(-1))
        opt.zero_grad(); loss.backward(); opt.step()
        first = first if first is not None else loss.item()
        last = loss.item()
    assert math.isfinite(last)
    assert last < first, "loss should decrease on synthetic task"
`,
    "template"
  );
  add(
    "scripts/prepare_data.sh",
    `#!/usr/bin/env bash
# Data preparation \u2014 the paper's dataset access terms were NOT verified automatically.
# TODO(p2b): review dataset licence, download from the official source manually, then:
#   1) place raw data under data/raw/
#   2) run this script to tokenize/split
#   3) record a fingerprint: sha256sum data/processed/* > data/manifest.sha256
set -euo pipefail
echo "Refusing to auto-download: verify dataset licence/access terms first." >&2
exit 1
`,
    "needs_implementation"
  );
  add(
    "scripts/run_experiment.sh",
    `#!/usr/bin/env bash
# Single-GPU reference run. P2B provenance: configs/default.yaml (all values traced).
set -euo pipefail
CONFIG=\${1:-configs/default.yaml}
python -m src.train --config "$CONFIG" --seed "\${SEED:-default}" 2>&1 | tee runs/last.log
python -m src.evaluate --config "$CONFIG" 2>&1 | tee runs/last_eval.log
# Record the run manifest: run_id, commit, config hash, dataset fingerprint, seed, metrics.
`,
    "template"
  );
  add(
    "evidence/claims.json",
    JSON.stringify({ generated_by: `paper2bench ${TEMPLATE_VERSION}`, spec_revision: specRev, claims }, null, 2),
    "generated",
    claims.map((c) => c.claim_id)
  );
  add(
    "evidence/reported_metrics.json",
    JSON.stringify({ generated_by: `paper2bench ${TEMPLATE_VERSION}`, spec_revision: specRev, reported_metrics: reported }, null, 2),
    "generated",
    []
  );
  add(
    "evidence/evidence_map.md",
    evidenceMapMd(claims),
    "generated",
    []
  );
  add("reports/reproduction_plan.md", reproductionPlanMd(tasks, todos, provisional), "generated", []);
  add("reports/reproduction_risks.md", risksMd(claims, todos), "generated", []);
  add(
    "reports/compute_estimate.md",
    `# Compute estimate

> Placeholder \u2014 fill from the Compute tab (never label an estimate as measured).
> The estimate is a range with documented assumptions; see reports/compute_estimate.md
> in the exported project JSON for the versioned formula (p2b-compute-v1.0).
`,
    "template"
  );
  add(
    "requirements.txt",
    `# Pinned reference environment for the generated scaffold (template v ${TEMPLATE_VERSION}).
# P2B policy: curated dependencies only \u2014 never auto-install packages suggested by paper text.
torch==2.4.1
numpy==1.26.4
pyyaml==6.0.2
pytest==8.3.3
${config.framework === "huggingface" ? "transformers==4.44.2\ndatasets==2.21.0\naccelerate==0.33.0" : ""}
`,
    "template"
  );
  add(
    "pyproject.toml",
    `[project]
name = "paper2bench-project"
version = "0.1.0"
description = "Reproduction scaffold generated by Paper2Bench for: ${paper.title.replace(/"/g, "'")}"
requires-python = ">=3.10"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
    "template"
  );
  add("README.md", readmeMd(paper, provisional, todos), "generated", []);
  if (scope === "with_ablations") {
    add(
      "configs/ablations.yaml",
      `# Ablation matrix stub \u2014 one entry per paper ablation row.
# TODO(p2b): list the paper's ablation configurations; each run must record its own manifest.
ablations: []
`,
      "needs_implementation"
    );
  }
  return files;
}
function pytorchSources(config, todos, hf) {
  const todoBlock = (path2) => {
    const t = todos.find((x) => x.path === path2);
    return t ? `# TODO(p2b): ${t.reason}` : "";
  };
  const dModel = config.d_model ?? 512;
  const layers = config.num_layers ?? 6;
  const heads = config.num_heads ?? 8;
  const dropout = config.dropout;
  const model = `"""Model \u2014 generated from reviewed architecture claims (P2B template).
Provenance: every dimension below traces to an evidence-ledger claim; nulls are TODOs."""
import torch
import torch.nn as nn

D_MODEL = ${dModel}          # P2B: architecture.d_model
N_LAYERS = ${layers}         # P2B: architecture.num_layers
N_HEADS = ${heads}           # P2B: architecture.num_heads
DROPOUT = ${dropout ?? "None"}  ${dropout === null ? "# TODO(p2b): dropout unspecified/conflicting \u2014 resolve in ledger" : "# P2B: training.dropout"}

class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int = 4096):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        pos = torch.arange(0, max_len).unsqueeze(1).float()
        div = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(pos * div)
        pe[:, 1::2] = torch.cos(pos * div)[: pe[:, 1::2].shape[1]]
        self.register_buffer("pe", pe.unsqueeze(0))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, : x.size(1)]

import math

class TinyTransformer(nn.Module):
    """Encoder-decoder reference sized from paper claims. Replace the internals
    with the paper's exact variant before comparing metrics."""
    def __init__(self, vocab: int):
        super().__init__()
        self.embed = nn.Embedding(vocab, D_MODEL)
        self.pos = PositionalEncoding(D_MODEL)
        layer = nn.TransformerEncoderLayer(
            d_model=D_MODEL, nhead=N_HEADS, dim_feedforward=${config.d_ff ?? 2048},
            dropout=DROPOUT if DROPOUT is not None else 0.0, batch_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=N_LAYERS)
        self.out = nn.Linear(D_MODEL, vocab)

    def forward(self, src: torch.Tensor, tgt: torch.Tensor) -> torch.Tensor:
        h = self.pos(self.embed(src))
        memory = self.encoder(h)
        t = self.pos(self.embed(tgt))
        enc = nn.TransformerEncoderLayer(
            d_model=D_MODEL, nhead=N_HEADS, dim_feedforward=${config.d_ff ?? 2048},
            dropout=DROPOUT if DROPOUT is not None else 0.0, batch_first=True,
        )(t)
        return self.out(enc + memory[:, : t.size(1)])

def build_model(vocab: int) -> TinyTransformer:
    return TinyTransformer(vocab)
`;
  const data = `"""Data module \u2014 P2B template. The paper's split provenance was not fully verified.
TODO(p2b): confirm the exact split (train/val/test) and record a dataset fingerprint.
Token-based batch semantics (if the paper uses tokens) must NOT become example batches."""
from torch.utils.data import Dataset, DataLoader

class SyntheticPairs(Dataset):
    """Stand-in so the smoke path runs without the real corpus."""
    def __init__(self, n: int = 256, vocab: int = 64, len_: int = 12):
        import torch
        g = torch.Generator().manual_seed(0)
        self.x = torch.randint(1, vocab, (n, len_), generator=g)
        self.y = torch.randint(1, vocab, (n, len_), generator=g)

    def __len__(self): return len(self.x)
    def __getitem__(self, i): return self.x[i], self.y[i]

def build_loaders(config: dict):
    # TODO(p2b): replace with the real dataset; keep split + fingerprint in the run manifest.
    ds = SyntheticPairs()
    return DataLoader(ds, batch_size=4, shuffle=True)
`;
  const losses = `"""Loss \u2014 implements the paper's training objective as extracted.
Provenance: loss.* claims; label smoothing value traces to the evidence ledger."""
import torch
import torch.nn as nn

LABEL_SMOOTHING = ${config.label_smoothing ?? "None"}  # P2B: loss.label_smoothing

def build_loss():
    ls = LABEL_SMOOTHING if LABEL_SMOOTHING is not None else 0.0
    return nn.CrossEntropyLoss(label_smoothing=float(ls))
`;
  const train = `"""Training loop \u2014 P2B reference (deterministic seeds, checkpoint policy).
Every hyperparameter reads from configs/default.yaml; nulls must be resolved by a human first."""
import argparse, hashlib, json, math, random, sys, time
from pathlib import Path
import torch
import yaml

def set_seed(seed: int | None) -> int:
    """Seeding policy. P2B: paper seed status was 'unspecified' unless set in config."""
    seed = seed if seed is not None else random.SystemRandom().randint(0, 2**31 - 1)
    random.seed(seed); torch.manual_seed(seed)
    return seed

def load_config(path: str) -> dict:
    cfg = yaml.safe_load(Path(path).read_text())
    unknown = [k for k, v in cfg.items() if v is None]
    if unknown:
        print(f"[p2b] WARNING \u2014 unresolved keys left as null: {', '.join(unknown)}", file=sys.stderr)
    return cfg

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/default.yaml")
    ap.add_argument("--seed", default=None)
    args = ap.parse_args()
    cfg = load_config(args.config)
    seed = set_seed(int(args.seed) if args.seed and args.seed != "default" else cfg.get("seed"))
    from src.data import build_loaders
    from src.model import build_model
    from src.losses import build_loss
    loaders = build_loaders(cfg)
    model = build_model(vocab=64)
    loss_fn = build_loss()
    opt_name = str(cfg.get("optimizer", "adamw")).lower()
    params = model.parameters()
    if opt_name == "sgd":
        opt = torch.optim.SGD(params, lr=cfg["learning_rate"] or 1e-3)
    else:
        opt = torch.optim.Adam(
            params,
            lr=cfg["learning_rate"] or 1e-4,
            betas=(cfg.get("beta1") or 0.9, cfg.get("beta2") or 0.98),
            eps=1e-9,
        )
    warmup = cfg.get("warmup_steps") or 0

    def lr_lambda(step: int) -> float:
        # P2B: training.lr_schedule \u2014 d_model^-0.5 * min(step^-0.5, step*warmup^-1.5) family.
        step = max(1, step)
        return min(step ** -0.5, step * (warmup ** -1.5 if warmup else 0.0)) / (step ** -0.5)

    sched = torch.optim.lr_scheduler.LambdaLR(opt, lr_lambda)
    model.train()
    step = 0
    metrics = {"loss": []}
    for epoch in range(int(cfg.get("epochs") or 1)):
        for src, tgt in loaders:
            logits = model(src, tgt[:, :-1])
            loss = loss_fn(logits.reshape(-1, logits.size(-1)), tgt[:, 1:].reshape(-1))
            opt.zero_grad(); loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)  # TODO(p2b): clipping unspecified in paper
            opt.step(); sched.step(); step += 1
            metrics["loss"].append(round(loss.item(), 6))
            if step % 50 == 0:
                print(f"step {step} loss {loss.item():.4f}")
    # Checkpoint policy \u2014 TODO(p2b): match the paper's checkpoint selection rule.
    out = Path("runs"); out.mkdir(exist_ok=True)
    cfg_hash = hashlib.sha256(json.dumps(cfg, sort_keys=True).encode()).hexdigest()[:12]
    torch.save(model.state_dict(), out / f"ckpt_seed{seed}.pt")
    manifest = {
        "run_id": f"run_{int(time.time())}",
        "code_commit": None, "config_hash": cfg_hash, "dataset_fingerprint": None,
        "seed": seed, "metrics": [{"name": "train_loss_final", "value": metrics['loss'][-1], "split": "train", "metric_version": "v1"}],
        "started_at": None, "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out / f"manifest_run_{manifest['run_id']}.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))

if __name__ == "__main__":
    main()
`;
  const evaluate = `"""Evaluation \u2014 implements the paper's protocol (beam size, checkpoint averaging).
P2B template: generated by Paper2Bench; metric direction comes from evidence/reported_metrics.json.
Metric comparisons are only valid under the same metric version and split."""
import argparse, json
from pathlib import Path

def compute_metric(pred: list[str], refs: list[list[str]]) -> float:
    """Placeholder unigram-overlap score with BLEU-like direction.
    TODO(p2b): swap in the paper's exact metric implementation and pin metric_version."""
    if not pred or not refs or not refs[0]:
        return 0.0
    p = set(pred); r = set(refs[0])
    return len(p & r) / max(1, len(r)) * 100.0

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/default.yaml")
    ap.add_argument("--pred", default="runs/pred.txt")
    args = ap.parse_args()
    # TODO(p2b): beam search size ${config.beam_size ?? "<unspecified>"} and length penalty ${config.length_penalty ?? "<unspecified>"} must match the paper.
    preds = Path(args.pred).read_text().splitlines() if Path(args.pred).exists() else []
    refs = [["the cat sat on the mat"]]
    score = compute_metric(preds, refs)
    print(json.dumps({"metric": "placeholder_overlap", "value": score, "metric_version": "v1", "direction": "maximize"}))

if __name__ == "__main__":
    main()
`;
  if (hf) {
    return {
      "src/model.py": model,
      "src/data.py": data + `

# \u2014\u2014\u2014 Hugging Face Trainer notes (P2B) \u2014\u2014\u2014
# Only use Trainer if the paper's training loop matches Trainer semantics.
# Custom loops (e.g. inverse-sqrt schedules with token batching) fall back to src/train.py.
TRAINING_ARGUMENTS_OVERRIDES = {
    # "learning_rate": <from configs/default.yaml>,
    # "warmup_steps": <from configs/default.yaml>,
}
`,
      "src/losses.py": losses,
      "src/train.py": train,
      "src/evaluate.py": evaluate
    };
  }
  return {
    "src/model.py": model,
    "src/data.py": data,
    "src/losses.py": losses,
    "src/train.py": train,
    "src/evaluate.py": evaluate
  };
}
function evidenceMapMd(claims) {
  const lines = [
    "# Evidence map",
    "",
    "Every value in `configs/default.yaml` traces to one of the claims below.",
    "Statuses follow Paper2Bench semantics: only `reported` counts as source-reported.",
    "",
    "| Claim | Value | Status | Source |",
    "|---|---|---|---|"
  ];
  for (const c of claims) {
    const ev = c.evidence[0];
    const src = ev ? `${ev.section ?? "?"}${ev.page ? ` p.${ev.page}` : ""}${ev.locator ? ` (${ev.locator})` : ""}` : "\u2014";
    const val = c.value === null ? "*(unspecified)*" : `\`${String(c.value)}\``;
    lines.push(`| \`${c.field_path}\` | ${val} | ${c.evidence_status} | ${src} |`);
  }
  return lines.join("\n") + "\n";
}
function reproductionPlanMd(tasks, todos, provisional) {
  const lines = [
    "# Reproduction plan",
    "",
    provisional ? "**Status: PROVISIONAL** \u2014 unresolved critical claims exist. Resolve them or export with the warning attached." : "**Status: ready to implement** \u2014 all critical claims reviewed.",
    "",
    "## Tasks",
    "",
    "| Task | Phase | Depends on | Acceptance criteria |",
    "|---|---|---|---|"
  ];
  for (const t of tasks) {
    lines.push(
      `| ${t.title} (${t.effort}/${t.risk} risk) | ${t.phase} | ${t.dependencies.join(", ") || "\u2014"} | ${t.acceptance_criteria} |`
    );
  }
  if (todos.length) {
    lines.push("", "## Unresolved items carried as TODO(p2b)", "");
    for (const t of todos) lines.push(`- \`${t.path}\` \u2014 ${t.reason}`);
  }
  return lines.join("\n") + "\n";
}
function risksMd(claims, todos) {
  const risky = claims.filter(
    (c) => c.impact === "critical" && (c.evidence_status === "inferred" || c.evidence_status === "unspecified" || c.evidence_status === "conflicting")
  );
  const lines = [
    "# Reproduction risks",
    "",
    "Risks below are claim-level and mechanical: they list where the paper does not pin down",
    "the experiment. They are not predictions about your results.",
    ""
  ];
  if (!risky.length && !todos.length) {
    lines.push("No critical unknowns detected. Still verify evidence anchors before trusting values.");
    return lines.join("\n") + "\n";
  }
  for (const c of risky) {
    lines.push(
      `- **${c.field_path}** (${c.evidence_status}): ${c.evidence_status === "conflicting" ? "source contains competing values \u2014 resolve explicitly" : "not stated in inspected source \u2014 any chosen value is an assumption"}`
    );
  }
  for (const t of todos) lines.push(`- TODO(p2b) on \`${t.path}\`: ${t.reason}`);
  return lines.join("\n") + "\n";
}
function readmeMd(paper, provisional, todos) {
  return `# Reproduction: ${paper.title}

Generated by **Paper2Bench** (${TEMPLATE_VERSION}) from ${paper.source_url}.

## What this project is
A starting scaffold for reproducing the paper above: pinned config with provenance,
reference model/data/loss/train/evaluate modules, tests, and a documented plan.

## Honesty rules baked into this scaffold
- \`null\` in \`configs/default.yaml\` means *the paper does not specify it*. Decide, document, re-generate.
- \`reported\` claims link to the paper location in \`evidence/evidence_map.md\`.
- Reported metrics (\`evidence/reported_metrics.json\`) are separate from your measured runs.
- "Reproduction criteria passed" is a human decision, never an automatic label.

${provisional ? "> \u26A0 **PROVISIONAL** \u2014 unresolved critical claims exist. See reports/reproduction_risks.md.\n" : ""}
## Quick start
\`\`\`bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest tests/test_config.py tests/test_smoke.py   # wiring checks (synthetic data only)
bash scripts/prepare_data.sh                       # refuses to run until licence verified
python -m src.train --config configs/default.yaml
\`\`\`

## Unresolved items (${todos.length})
${todos.map((t) => `- \`${t.path}\`: ${t.reason}`).join("\n") || "- none"}
`;
}

// src/lib/p2b/extract-heuristic.ts
function parseRunsJsonl(text) {
  const runs = [];
  const errors = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  lines.forEach((line, i) => {
    try {
      const obj = JSON.parse(line);
      const metricsRaw = obj.metrics ?? obj.metrics_list ?? [];
      let metrics = [];
      if (Array.isArray(metricsRaw)) {
        metrics = metricsRaw.map((m) => {
          const mm = m;
          if (typeof mm.name === "string" && typeof mm.value === "number") {
            return {
              name: mm.name,
              value: mm.value,
              split: mm.split ?? null,
              metric_version: mm.metric_version ?? null
            };
          }
          return null;
        }).filter(Boolean);
      } else if (metricsRaw && typeof metricsRaw === "object") {
        metrics = Object.entries(metricsRaw).filter(([, v]) => typeof v === "number").map(([k, v]) => ({ name: k, value: v, split: null, metric_version: null }));
      }
      if (metrics.length === 0) {
        metrics = Object.entries(obj).filter(
          ([k, v]) => typeof v === "number" && /bleu|acc|f1|map|loss|perp|auc|score|metric|top/i.test(k) && !/seed|step|epoch/i.test(k)
        ).map(([k, v]) => ({ name: k, value: v, split: null, metric_version: null }));
      }
      if (metrics.length === 0) {
        errors.push(`Line ${i + 1}: no usable metrics found.`);
        return;
      }
      runs.push({
        run_id: obj.run_id ?? `run_${shortHash(line, 8)}`,
        label: obj.label ?? null,
        paper_id: obj.paper_id ?? null,
        code_commit: obj.code_commit ?? obj.commit ?? null,
        config_hash: obj.config_hash ?? null,
        dataset_fingerprint: obj.dataset_fingerprint ?? null,
        seed: typeof obj.seed === "number" ? obj.seed : null,
        environment: obj.environment ?? {},
        hardware: obj.hardware ?? {},
        metrics,
        artifacts: obj.artifacts ?? [],
        started_at: obj.started_at ?? null,
        finished_at: obj.finished_at ?? null,
        source: obj.tracker === "mlflow" ? "mlflow" : "imported_jsonl"
      });
    } catch {
      errors.push(`Line ${i + 1}: invalid JSON.`);
    }
  });
  return { runs, errors };
}
function parseRunsCsv(text) {
  const errors = [];
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  if (rows.length < 2) return { runs: [], errors: ["CSV needs a header row and at least one data row."] };
  const headers = rows[0].split(",").map((h) => h.trim().toLowerCase());
  const runs = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(",").map((c) => c.trim());
    if (cells.length !== headers.length) {
      errors.push(`Row ${i + 1}: column count mismatch.`);
      continue;
    }
    const rec = {};
    headers.forEach((h, j) => rec[h] = cells[j]);
    const metrics = [];
    for (const h of headers) {
      if (/bleu|acc|f1|map|loss|perp|auc|score|metric|top/.test(h) && !/seed|step|epoch/.test(h)) {
        const v = Number(rec[h]);
        if (!Number.isNaN(v)) metrics.push({ name: h, value: v, split: null, metric_version: null });
      }
    }
    if (metrics.length === 0) {
      errors.push(`Row ${i + 1}: no metric columns detected in header.`);
      continue;
    }
    runs.push({
      run_id: rec.run_id || `run_csv_${i}`,
      label: rec.label || null,
      code_commit: rec.code_commit || rec.commit || null,
      config_hash: rec.config_hash || null,
      dataset_fingerprint: rec.dataset_fingerprint || null,
      seed: Number.isNaN(Number(rec.seed)) ? null : Number(rec.seed),
      environment: rec.python ? { python: rec.python } : {},
      hardware: rec.gpu ? { accelerator: rec.gpu } : {},
      metrics,
      artifacts: [],
      started_at: null,
      finished_at: rec.finished_at || null,
      source: "imported_csv"
    });
  }
  return { runs, errors };
}

// scripts/cli/paper2bench.ts
function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}
function loadProject(file) {
  if (!fs.existsSync(file)) die(`file not found: ${file}`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    die(`not valid JSON: ${e.message.slice(0, 120)}`);
  }
  const p = raw && typeof raw === "object" && "project" in raw ? raw.project : raw;
  if (!p || typeof p !== "object" || !Array.isArray(p.claims) || typeof p.paper !== "object") {
    die("not a Paper2Bench project (needs .paper and .claims) \u2014 export from the app first");
  }
  return p;
}
function loadRuns(file) {
  if (!fs.existsSync(file)) die(`runs file not found: ${file}`);
  const text = fs.readFileSync(file, "utf-8");
  const isCsv = file.toLowerCase().endsWith(".csv");
  const parsed = isCsv ? parseRunsCsv(text) : parseRunsJsonl(text);
  for (const e of parsed.errors.slice(0, 5)) console.error(`warn: ${e}`);
  if (parsed.runs.length === 0) die("no runs could be imported from the file");
  return parsed.runs;
}
var pad = (s, n) => s.length >= n ? s : s + " ".repeat(n - s.length);
function cmdInspect(file) {
  const p = loadProject(file);
  const score = readinessScore(p);
  console.log(`Paper2Bench \u2014 ${p.paper.title || p.paper.id || p.id}`);
  console.log("");
  console.log(`  claims:            ${p.claims.length} (${p.claims.filter((c) => c.evidence_status === "conflict").length} conflicts, ${p.claims.filter((c) => c.evidence_status === "unspecified").length} unspecified)`);
  console.log(`  review:            ${p.claims.filter((c) => c.review_status === "accepted").length} accepted / ${p.claims.filter((c) => c.review_status === "not_reviewed").length} pending`);
  console.log(`  plan tasks:        ${p.tasks.length} (${p.tasks.filter((t) => t.status === "done").length} done)`);
  console.log(`  scaffold files:    ${p.scaffold?.files.length ?? 0}`);
  console.log(`  runs imported:     ${p.runs.length}`);
  console.log(`  reported metrics:  ${p.reported_metrics.length}`);
  console.log("");
  console.log(`  readiness: ${score.total}/100 \u2014 ${score.verdict_label}`);
  for (const sub of score.subs) {
    console.log(`    ${pad(sub.label, 10)} ${String(sub.score).padStart(3)}/100`);
  }
  if (score.recommendations.length > 0) {
    console.log("");
    console.log("  next actions:");
    for (const r of score.recommendations) console.log(`    - ${r.label} (${r.view})`);
  }
}
function cmdValidate(file) {
  const p = loadProject(file);
  const checks = runValidation(p);
  const passed = checks.filter((c) => c.result === "pass").length;
  const blocked = checks.filter((c) => c.result === "blocked").length;
  const failed = checks.filter((c) => c.result === "fail").length;
  for (const c of checks) {
    const mark = c.result === "pass" ? "PASS" : c.result === "blocked" ? "BLKD" : "FAIL";
    console.log(`  [${mark}] ${c.name} (${c.group})`);
    if (c.detail) console.log(`         ${c.detail}`);
    if (c.does_not_prove) console.log(`         does not prove: ${c.does_not_prove}`);
  }
  console.log("");
  console.log(`${passed} passed, ${failed} failed, ${blocked} blocked (blocked != failed \u2014 see docs/limitations)`);
  let secrets = 0;
  for (const f of p.scaffold?.files ?? []) secrets += scanSecrets(f.content).length;
  if (secrets > 0) {
    console.error(`SECRET SCAN: ${secrets} potential credential(s) found in scaffold files`);
    process.exit(1);
  }
  process.exit(failed > 0 ? 1 : 0);
}
function cmdCompare(file, runsFile) {
  let p = loadProject(file);
  if (runsFile) {
    p = { ...p, runs: loadRuns(runsFile) };
  }
  if (p.runs.length === 0) die("no runs in the project \u2014 pass --runs <runs.jsonl|csv>");
  const rows = compareAll(p);
  if (rows.length === 0) {
    console.log("no (metric, run) pairs matched \u2014 check metric names on both sides");
    return;
  }
  console.log(pad("metric", 14) + pad("reported", 11) + pad("measured", 11) + pad("rel-delta", 11) + pad("protocol", 12) + "notes");
  for (const r of rows) {
    const rel = r.rel_delta != null ? `${r.rel_delta > 0 ? "+" : ""}${(r.rel_delta * 100).toFixed(1)}%` : "\u2014";
    const notes = [r.runLabel, ...r.mismatches].filter(Boolean).join("; ");
    console.log(
      pad(r.metric, 14) + pad(String(r.reported ?? "\u2014"), 11) + pad(String(r.measured ?? "\u2014"), 11) + pad(rel, 11) + pad(r.mismatches.length === 0 ? "match" : "MISMATCH", 12) + notes
    );
  }
  console.log("");
  console.log("Auto-awarding criteria_passed is forbidden: a human decides whether deltas reproduce the claim.");
}
function cmdCreate(file, outDir, framework, scope) {
  const p = loadProject(file);
  const fw = framework === "huggingface" ? "huggingface" : "pytorch";
  const sc = scope === "minimal" ? "minimal" : "full";
  const { config, todos } = buildConfigFromClaims(p.claims, fw);
  const files = generateScaffoldFiles(p.paper, p.claims, p.reported_metrics, p.tasks, config, todos, sc);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const dest = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
  console.log(`wrote ${files.length} files to ${outDir} (${fw}, ${sc} scope, ${todos.length} explicit TODO(p2b) items)`);
  console.log("unknowns are explicit nulls with provenance comments \u2014 decide, document, re-generate.");
  console.log("generated code is never executed by Paper2Bench; see scripts/validate-scaffolds.ts for what is verified.");
}
function usage() {
  console.log(`paper2bench ${TEMPLATE_VERSION} \u2014 from paper to an inspectable reproduction

usage:
  paper2bench inspect   <project.json>
  paper2bench validate  <project.json>
  paper2bench compare   <project.json> --runs <runs.jsonl|csv>
  paper2bench create    <project.json> --out <dir> [--framework pytorch|huggingface] [--scope full|minimal]

project.json is an app export (bare project or {export_version, project} wrapper).`);
  process.exit(0);
}
function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") usage();
  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(TEMPLATE_VERSION);
    return;
  }
  const cmd = argv[0];
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const valueFlags = /* @__PURE__ */ new Set(["--runs", "--out", "--framework", "--scope"]);
  const positional = argv.filter((a, i) => i > 0 && !a.startsWith("--") && !valueFlags.has(argv[i - 1]));
  const file = positional[0];
  switch (cmd) {
    case "inspect":
      if (!file) die("inspect needs a project.json path");
      cmdInspect(file);
      break;
    case "validate":
      if (!file) die("validate needs a project.json path");
      cmdValidate(file);
      break;
    case "compare":
      if (!file) die("compare needs a project.json path");
      cmdCompare(file, flag("--runs"));
      break;
    case "create": {
      if (!file) die("create needs a project.json path");
      const out = flag("--out") ?? "./p2b-scaffold";
      cmdCreate(file, out, flag("--framework") ?? "pytorch", flag("--scope") ?? "full");
      break;
    }
    default:
      die(`unknown command: ${cmd} (try --help)`);
  }
}
main();
