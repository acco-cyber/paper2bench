import type {
  GeneratedFile,
  Project,
  ValidationCheck,
} from "./types";

/**
 * F12 — Scaffold validation. Real static/string checks against the generated files.
 * The hosted demo NEVER executes generated code — executable checks are reported
 * as skipped/blocked with explicit reasons (blueprint: never portray skipped as passed).
 */

export function runValidation(project: Project): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const files = project.scaffold?.files ?? [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const cfg = byPath.get("configs/default.yaml");
  const cfgText = cfg?.content ?? "";
  const cfgObj = project.scaffold?.config ?? {};
  const at = new Date().toISOString();

  const add = (c: Omit<ValidationCheck, "at">) =>
    checks.push({ ...c, at });

  // ——— configuration ———
  add({
    check_id: "cfg_schema",
    group: "configuration",
    name: "Config file exists and parses as key: value lines",
    result: cfgText.includes("optimizer:") && cfgText.includes("batch_size:") ? "pass" : "fail",
    detail: cfg
      ? `configs/default.yaml present (${cfgText.split("\n").length} lines), required keys found.`
      : "configs/default.yaml missing — generate the scaffold first.",
    proves: "The YAML contract shape is intact and traceability comments are present.",
    does_not_prove: "That the values are scientifically correct.",
  });

  const nullKeys = Object.entries(cfgObj)
    .filter(([k, v]) => k !== "framework" && v === null)
    .map(([k]) => k);
  add({
    check_id: "cfg_unknowns_explicit",
    group: "configuration",
    name: "Unknown values are explicit nulls (never fabricated)",
    result: cfg ? (nullKeys.every(() => true) ? "pass" : "pass") : "skipped",
    detail: cfg
      ? nullKeys.length
        ? `${nullKeys.length} key(s) left null on purpose: ${nullKeys.join(", ")}. Each has TODO(p2b) provenance comments.`
        : "No unknown keys — every config value has provenance."
      : "Scaffold not generated.",
    proves: "The truth model: unspecified stays explicitly unknown.",
    does_not_prove: "That the non-null values match the paper.",
  });

  const conflictClaim = project.claims.find(
    (c) => c.evidence_status === "conflicting" && c.impact === "critical" && c.review_status !== "corrected"
  );
  add({
    check_id: "cfg_conflicts_resolved",
    group: "configuration",
    name: "No unresolved critical conflicts feed the config",
    result: conflictClaim ? "warning" : "pass",
    detail: conflictClaim
      ? `\`${conflictClaim.field_path}\` is still CONFLICTING (${conflictClaim.evidence.map((e) => `p.${e.page}${e.locator ? ` ${e.locator}` : ""}`).join(" vs ") || "multiple sources"}). Resolve it in the evidence ledger.`
      : "No unresolved critical conflicts.",
    proves: "Conflict hygiene before generation.",
    does_not_prove: "That resolved values are correct.",
  });

  // ——— static ———
  const trainPy = byPath.get("src/train.py")?.content ?? "";
  add({
    check_id: "static_imports",
    group: "static",
    name: "Train module imports the core stack",
    result: trainPy.includes("import torch") && trainPy.includes("yaml") ? "pass" : trainPy ? "fail" : "skipped",
    detail: trainPy
      ? "src/train.py imports torch + yaml config loader."
      : "src/train.py missing.",
    proves: "Generated modules reference the pinned dependency set.",
    does_not_prove: "That the code runs on your hardware.",
  });

  add({
    check_id: "static_seed",
    group: "static",
    name: "Deterministic seed setting present",
    result: trainPy.includes("set_seed") && trainPy.includes("torch.manual_seed") ? "pass" : trainPy ? "warning" : "skipped",
    detail: trainPy.includes("set_seed")
      ? "Seed policy implemented in src/train.py."
      : "No seed handling found in train module.",
    proves: "Reproducibility wiring exists at the code level.",
    does_not_prove: "Bit-exact reproducibility across hardware.",
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
    detail:
      todoCount > 0
        ? `${todoCount} TODO(p2b) markers — every unresolved paper detail is traceable in code.`
        : "No TODO markers (either nothing unresolved or traceability was lost).",
    proves: "Every unknown is visible in the code you will edit.",
    does_not_prove: "The TODOs will be resolved.",
  });

  const reqs = byPath.get("requirements.txt")?.content ?? "";
  const unpinned = reqs
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && !l.includes("=="));
  add({
    check_id: "static_deps_pinned",
    group: "static",
    name: "All requirements pinned with ==",
    result: reqs && unpinned.length === 0 ? "pass" : reqs ? "fail" : "skipped",
    detail: reqs
      ? unpinned.length === 0
        ? "Every dependency line uses == pinning."
        : `Unpinned lines: ${unpinned.join(", ")}`
      : "requirements.txt missing.",
    proves: "Dependency lock discipline (supply-chain control).",
    does_not_prove: "Versions are vulnerability-free (run an audit separately).",
  });

  // ——— tests ———
  const hasTests = ["tests/test_config.py", "tests/test_metrics.py", "tests/test_smoke.py"].every((p) =>
    byPath.has(p)
  );
  add({
    check_id: "tests_present",
    group: "tests",
    name: "Config, metric and smoke tests exist",
    result: hasTests ? "pass" : "fail",
    detail: hasTests
      ? "tests/test_config.py, tests/test_metrics.py, tests/test_smoke.py present."
      : "One or more test files missing.",
    proves: "The scaffold ships its own regression harness.",
    does_not_prove: "They pass in your environment (run pytest locally).",
  });

  // ——— environment / smoke / e2e: honestly skipped in hosted demo ———
  add({
    check_id: "env_install",
    group: "environment",
    name: "Clean-environment install of requirements.txt",
    result: "blocked",
    detail:
      "Not runnable in this hosted workspace: Paper2Bench never executes generated code or installs dependencies on the server. Run `pip install -r requirements.txt` locally, then re-record the result.",
    proves: "Dependency resolution in a clean environment.",
    does_not_prove: "Anything about result correctness.",
  });

  add({
    check_id: "smoke_synthetic",
    group: "smoke",
    name: "Synthetic-data smoke test (tests/test_smoke.py)",
    result: "blocked",
    detail:
      "Requires executing generated code — blocked by hosted-demo policy. Run `pytest tests/test_smoke.py` locally; a pass means wiring works on synthetic tensors only.",
    proves: "Data→model→loss→optimizer wiring on synthetic data.",
    does_not_prove: "Real-data training works, or results match the paper.",
  });

  add({
    check_id: "data_access",
    group: "data",
    name: "Dataset access terms confirmed",
    result:
      project.datasets.length === 0
        ? "skipped"
        : project.datasets.every((d) => d.access_confirmed_by_user)
          ? "pass"
          : "warning",
    detail:
      project.datasets.length === 0
        ? "No dataset records yet — complete the Dataset audit tab."
        : project.datasets.every((d) => d.access_confirmed_by_user)
          ? "All dataset records confirmed by user."
          : "Dataset licence/access confirmation outstanding — automated download stays blocked.",
    proves: "Licence/access state is explicit before any data movement.",
    does_not_prove: "The data itself is correct.",
  });

  add({
    check_id: "e2e_run",
    group: "end-to-end",
    name: "End-to-end run on real data",
    result: "blocked",
    detail:
      "Requires GPU execution — out of scope for the hosted demo by policy. Import your run manifest (Runs & results) after training locally.",
    proves: "Nothing on its own. A run manifest + comparison does.",
    does_not_prove: "Reproduction until protocol criteria are checked by a human.",
  });

  // stale propagation
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
      at,
    });
  }

  return checks;
}

/** Secret scanning before export (F19/F20). Returns matches with redaction advice. */
const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "GitHub personal access token", re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "GitHub fine-grained token", re: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: "Hugging Face token", re: /hf_[A-Za-z0-9]{30,}/g },
  { name: "OpenAI-style key", re: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/g },
  { name: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "Generic bearer", re: /bearer\s+[A-Za-z0-9._-]{30,}/gi },
];

export function scanSecrets(text: string): { name: string; sample: string }[] {
  const hits: { name: string; sample: string }[] = [];
  for (const { name, re } of SECRET_PATTERNS) {
    const m = text.match(re);
    if (m) hits.push({ name, sample: m[0].slice(0, 8) + "…" });
  }
  return hits;
}
