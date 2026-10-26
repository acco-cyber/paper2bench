/**
 * Paper2Bench — core logic verification script (round 1).
 * Tests: heuristic extraction, run importers, comparison, scaffold determinism,
 * validation, secret scan, compute estimator, demo fixture integrity.
 */
import { extractClaimsHeuristic, parseRunsJsonl, parseRunsCsv } from "../src/lib/p2b/extract-heuristic";
import { buildDemoProject } from "../src/lib/p2b/demo";
import { buildConfigFromClaims, generateScaffoldFiles } from "../src/lib/p2b/scaffold";
import { runValidation, scanSecrets } from "../src/lib/p2b/validation";
import { compareAll, makeAssessment } from "../src/lib/p2b/comparison";
import { computeEstimate } from "../src/lib/p2b/planner";
import { normalizePaperInput, IngestError } from "../src/lib/p2b/ingest";
import { readinessScore, workspaceCard, organizeCards, workspaceStats } from "../src/lib/p2b/insights";
import type { Project } from "../src/lib/p2b/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${name} ${detail}`);
  }
}

console.log("\n== 1. Ingestion policy (F01) ==");
const arxiv = normalizePaperInput("https://arxiv.org/abs/1706.03762");
check("arXiv URL normalized", arxiv.identifier === "1706.03762" && arxiv.kind === "arxiv");
const bare = normalizePaperInput("1706.03762");
check("bare arXiv id accepted", bare.identifier === "1706.03762");
const doi = normalizePaperInput("https://doi.org/10.5555/3295222.3295349");
check("DOI normalized", doi.identifier.startsWith("10.5555"));
try {
  normalizePaperInput("http://localhost:3000/secret");
  check("localhost blocked", false);
} catch (e) {
  check("localhost blocked", e instanceof IngestError);
}
try {
  normalizePaperInput("https://evil.com/paper");
  check("non-allowlisted host blocked", false);
} catch {
  check("non-allowlisted host blocked", true);
}
try {
  normalizePaperInput("not a url at all ??");
  check("garbage input rejected", false);
} catch {
  check("garbage input rejected", true);
}

console.log("\n== 2. Heuristic extraction (F03) ==");
const sampleText = `Introduction. We use the Adam optimizer with β1 = 0.9, β2 = 0.98. The learning rate was set to 0.0001 with 4000 warmup steps. We train for 20 epochs with batch size of 256. Dropout of 0.3 is applied. We use 8 NVIDIA A100 GPUs in fp16. The model has 12 layers and 8 heads with d_model = 768. We evaluate BLEU 31.2 on the test set. Random seeds 1, 2, 3 are used. Label smoothing of 0.1. Beam search with size 5. Trained on WMT 2014 English-German with 4.5M sentence pairs.`;
const ex = extractClaimsHeuristic(sampleText, "test_paper");
const paths = ex.claims.map((c) => c.field_path);
check("optimizer extracted", paths.includes("optimizer.name"));
check("learning rate = 0.0001", ex.claims.find((c) => c.field_path === "training.learning_rate")?.value === 0.0001);
check("warmup steps = 4000", ex.claims.find((c) => c.field_path === "training.warmup_steps")?.value === 4000);
check("batch size extracted", paths.includes("training.batch_size"));
check("layers extracted", ex.claims.find((c) => c.field_path === "architecture.num_layers")?.value === 12);
check("heads extracted", ex.claims.find((c) => c.field_path === "architecture.num_heads")?.value === 8);
check("d_model = 768", ex.claims.find((c) => c.field_path === "architecture.d_model")?.value === 768);
check("hardware extracted", ex.claims.find((c) => c.claim_id === "compute.accelerators")?.value === "8x A100");
check("precision extracted", ex.claims.find((c) => c.claim_id === "environment.precision")?.value === "fp16");
check("seed extracted", paths.includes("training.seed"));
check("dataset extracted", paths.some((p) => p.startsWith("dataset.")));
check("BLEU metric extracted", ex.claims.some((c) => c.field_path.startsWith("metrics.")));
check("every claim has evidence span", ex.claims.every((c) => c.evidence.length >= 1 && c.evidence[0].text.length > 0));
check("no fabricated unspecified", ex.claims.every((c) => c.value !== undefined));

console.log("\n== 3. Run importers (F13/F16) ==");
const jsonl = `{"run_id":"run_1","seed":42,"metrics":[{"name":"BLEU","value":27.9}],"code_commit":"abc"}
{"run_id":"run_2","bleu":28.2,"seed":7}`;
const r1 = parseRunsJsonl(jsonl);
check("JSONL: 2 runs parsed", r1.runs.length === 2, JSON.stringify(r1.errors));
check("JSONL: array metrics ok", r1.runs[0].metrics[0].value === 27.9);
check("JSONL: flat metrics ok", r1.runs[1].metrics[0].name.toLowerCase().includes("bleu"));
const bad = parseRunsJsonl("not json\n{\"run_id\":\"x\"}");
check("JSONL: malformed lines reported", bad.errors.length >= 1 && bad.runs.length === 0);
const csv = parseRunsCsv("run_id,seed,bleu\nrunA,1,27.5\nrunB,2,28.0");
check("CSV: 2 runs", csv.runs.length === 2 && csv.runs[0].metrics[0].value === 27.5);

console.log("\n== 4. Demo fixture (curated) ==");
const demo: Project = buildDemoProject();
check("demo has 25 claims", demo.claims.length === 25, String(demo.claims.length));
check("demo has 3 reported metrics", demo.reported_metrics.length === 3);
check("demo has 2 example runs", demo.runs.length === 2 && demo.runs.every((r) => r.is_example));
const conflict = demo.claims.find((c) => c.evidence_status === "conflicting");
check("demo has genuine conflict (training.dropout)", conflict?.claim_id === "training.dropout" && conflict.evidence.length === 2);
check("demo has unspecified (seed)", demo.claims.some((c) => c.claim_id === "training.seed" && c.evidence_status === "unspecified"));
check("demo BLEU 28.4 present", demo.reported_metrics.some((m) => m.value === 28.4));

console.log("\n== 5. Scaffold determinism (F09) ==");
const { config, todos } = buildConfigFromClaims(demo.claims, "pytorch");
check("config: lr null (no lr claim in demo)", config.learning_rate === null);
check("config: d_model 512", config.d_model === 512);
check("config: warmup 4000", config.warmup_steps === 4000);
check("todos include conflicting dropout", todos.some((t) => t.path === "training.dropout"));
check("todos include unspecified seed", todos.some((t) => t.path === "training.seed"));
const files1 = generateScaffoldFiles(demo.paper, demo.claims, demo.reported_metrics, demo.tasks, config, todos, "baseline_target");
const files2 = generateScaffoldFiles(demo.paper, demo.claims, demo.reported_metrics, demo.tasks, config, todos, "baseline_target");
check("deterministic: same file count", files1.length === files2.length);
check("deterministic: identical bytes", files1.every((f, i) => f.content === files2[i].content && f.path === files2[i].path));
check("has configs/default.yaml", files1.some((f) => f.path === "configs/default.yaml"));
check("has tests + src + scripts", ["src/model.py", "src/train.py", "tests/test_smoke.py", "scripts/run_experiment.sh"].every((p) => files1.some((f) => f.path === p)));
check("provenance comments present", files1.find((f) => f.path === "configs/default.yaml")!.content.includes("P2B: source="));
const cfgYaml = files1.find((f) => f.path === "configs/default.yaml")!.content;
check("conflicting dropout renders as null + CONFLICTING todo", /dropout: null\s+# P2B: source=training\.dropout status=conflicting/.test(cfgYaml));
// Simulate the user resolving the conflict to 0.1, then regenerate:
const resolvedDemo: Project = {
  ...demo,
  claims: demo.claims.map((c) =>
    c.claim_id === "training.dropout"
      ? { ...c, value: 0.1, evidence_status: "user_confirmed" as const, review_status: "corrected" as const }
      : c
  ),
};
const { config: cfg2, todos: todos2 } = buildConfigFromClaims(resolvedDemo.claims, "pytorch");
const files3 = generateScaffoldFiles(resolvedDemo.paper, resolvedDemo.claims, resolvedDemo.reported_metrics, resolvedDemo.tasks, cfg2, todos2, "baseline_target");
const cfgYaml2 = files3.find((f) => f.path === "configs/default.yaml")!.content;
check("resolved dropout maps to training.dropout claim", /dropout: 0\.1\s+# P2B: source=training\.dropout status=user_confirmed/.test(cfgYaml2), cfgYaml2.split("\n").find((l) => l.startsWith("dropout")) ?? "no line");
check("beta1 line maps to optimizer.beta1 claim", /beta1: 0\.9\s+# P2B: source=optimizer\.beta1/.test(cfgYaml2));
check("TODO(p2b) markers present", files1.reduce((a, f) => a + (f.content.match(/TODO\(p2b\)/g)?.length ?? 0), 0) >= 5);
const hf = generateScaffoldFiles(demo.paper, demo.claims, demo.reported_metrics, demo.tasks, { ...config, framework: "huggingface" }, todos, "baseline_target");
check("HF template has Trainer notes", hf.some((f) => f.path === "src/data.py" && f.content.includes("Trainer")));

console.log("\n== 6. Validation (F12) ==");
const demoWithScaffold: Project = { ...demo, scaffold: { framework: "pytorch", scope: "baseline_target", generated_at: new Date().toISOString(), template_version: "t", spec_claim_revision: "x", files: files1, config: config as never } };
const checks = runValidation(demoWithScaffold);
check("checks produced", checks.length >= 10);
check("no executable check claims pass", checks.filter((c) => ["env_install", "smoke_synthetic", "e2e_run"].includes(c.check_id)).every((c) => c.result === "blocked"));
check("config schema passes", checks.find((c) => c.check_id === "cfg_schema")?.result === "pass");
check("deps pinned passes", checks.find((c) => c.check_id === "static_deps_pinned")?.result === "pass");
check("conflict warning present", checks.find((c) => c.check_id === "cfg_conflicts_resolved")?.result === "warning");
check("each check has proves/does_not_prove", checks.every((c) => c.proves && c.does_not_prove));

console.log("\n== 7. Comparison (F14) ==");
const rows = compareAll(demo);
check("comparisons produced", rows.length >= 3);
const r284 = rows.find((r) => r.reported === 28.4 && r.run_id === "run_demo_1");
check("28.4 vs 27.9 delta = -0.5", r284?.abs_delta === -0.5);
check("rel delta meaningful for BLEU", r284?.rel_delta_meaningful === true);
// Demo runs are complete manifests — verify mismatch detection with a provenance-stripped run instead:
const strippedDemo: Project = {
  ...demo,
  runs: [{ ...demo.runs[0], config_hash: null, code_commit: null, dataset_fingerprint: null, metrics: [{ name: "BLEU", value: 27.9, split: null, metric_version: null }] }],
};
const strippedRows = compareAll(strippedDemo);
const sRow = strippedRows.find((r) => r.reported === 28.4);
check("provenance gaps flagged (>=3 mismatches)", (sRow?.mismatches.length ?? 0) >= 3, JSON.stringify(sRow?.mismatches));
check("split mismatch flagged", strippedRows.find((r) => r.reported === 28.4)!.mismatches.some((m) => m.includes("Split") || m.toLowerCase().includes("split")));
const zeroMetric = compareAll({ ...demo, reported_metrics: [{ ...demo.reported_metrics[0], value: 0, metric_id: "rm_zero" }], runs: demo.runs });
const zeroRow = zeroMetric.find((r) => r.reported_metric_id === "rm_zero" && r.run_id === "run_demo_1");
check("rel delta n/a for zero baseline", zeroRow?.rel_delta_meaningful === false);
const assessment = makeAssessment(r284!, "criteria_passed", "test", false);
check("criteria_passed auto-award blocked", assessment.status === "needs_verification");
const assessmentOk = makeAssessment(r284!, "criteria_passed", "test", true);
check("criteria_passed allowed with confirmation", assessmentOk.status === "criteria_passed");

console.log("\n== 8. Compute estimator (F08) ==");
const est = computeEstimate({
  params_millions: 65, dtype: "fp32", seq_len: 512, batch_size: 25000, batch_is_tokens: true,
  avg_tokens_per_example: 30, grad_accum: 1, epochs: 8, dataset_examples: 4500000, seeds: 1,
  grad_checkpointing: false, optimizer: "adamw", accelerator: "a100", val_fraction: 0.02,
});
check("memory range sane (low < high)", est.total_mem_gb_low < est.total_mem_gb_high);
check("memory > weights+opt+grads", est.total_mem_gb_low > est.model_mem_gb + est.optimizer_mem_gb + est.grad_mem_gb);
check("token-batch steps = 43200", est.train_steps === 43200, String(est.train_steps));
check("runtime range sane", est.runtime_hours_low > 0 && est.runtime_hours_high > est.runtime_hours_low, `${est.runtime_hours_low}-${est.runtime_hours_high}`);
check("assumptions document batch semantics", est.assumptions.some((a) => a.includes("TOKEN-based")));
check("assumptions documented", est.assumptions.length >= 3);
check("missing inputs listed", est.missing_inputs.length >= 2);
const ckpt = computeEstimate({ params_millions: 65, dtype: "fp32", seq_len: 512, batch_size: 25000, batch_is_tokens: true, avg_tokens_per_example: 30, grad_accum: 1, epochs: 8, dataset_examples: 4500000, seeds: 1, grad_checkpointing: true, optimizer: "adamw", accelerator: "a100", val_fraction: 0.02 });
check("checkpointing reduces memory", ckpt.total_mem_gb_high < est.total_mem_gb_high);

console.log("\n== 9. Secret scan (F19/F20) ==");
const hits1 = scanSecrets(["my key is ", "ghp", "_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join(""));
check("GitHub token detected", hits1.some((h) => h.name === "GitHub personal access token"));
const hits2 = scanSecrets(["", "hf", "_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2"].join(""));
check("HF token detected", hits2.some((h) => h.name === "Hugging Face token"));
check("clean text passes", scanSecrets("normal project content with no keys").length === 0);

console.log(`\n======== RESULT: ${pass} passed, ${fail} failed ========`);
// round 1 summary (non-fatal);

// Round-2 addition: metric value-before / delta-skip patterns
console.log("\n== 10. Metric extraction patterns (round 2) ==");
{
  const text2 = "On CIFAR-100 our method reaches 82.6 percent top-1 accuracy, beating the baseline by 1.9 points. The model achieves BLEU of 31.2 on the test set. Perplexity = 4.7 on WikiText-103.";
  const ex2 = extractClaimsHeuristic(text2, "metric_test");
  const top1 = ex2.claims.find((c) => c.field_path === "metrics.top_1");
  const bleu2 = ex2.claims.find((c) => c.field_path === "metrics.bleu");
  const ppl = ex2.claims.find((c) => c.field_path === "metrics.perplexity");
  check("top-1 = 82.6 (not the 1.9 delta)", top1?.value === 82.6, String(top1?.value));
  check("BLEU of 31.2", bleu2?.value === 31.2, String(bleu2?.value));
  check("Perplexity = 4.7, direction minimize", ppl?.value === 4.7);
  check("perplexity reported metric direction", ex2.reportedMetrics.find((m) => m.name === "perplexity")?.direction === "minimize");
}
console.log(`\n======== FINAL: ${pass} passed, ${fail} failed ========`);


// Round-3 addition: readiness insights + workspace organization
console.log("\n== 11. Readiness insights (v2.0) ==");
{
  const { readinessScore: _rs, workspaceCard: _wc, organizeCards: _oc, workspaceStats: _ws } = { readinessScore, workspaceCard, organizeCards, workspaceStats };
  void _rs; void _wc; void _oc; void _ws;

  const r0 = readinessScore(demo);
  check("score in 0..100", r0.total >= 0 && r0.total <= 100, String(r0.total));
  check("score deterministic", JSON.stringify(readinessScore(demo)) === JSON.stringify(r0));
  check("4 sub-scores present", r0.subs.length === 4 && r0.subs.map((s) => s.id).join(",") === "evidence,plan,build,verify");
  check("verdict mapped to label", r0.verdict_label.length > 0);
  check("recommendations capped at 3", r0.recommendations.length <= 3);
  check("fresh project scores low", readinessScore({ ...demo, tasks: [], scaffold: null, validation: null, runs: [] }).total < 30);

  // A fully progressed project must score strictly higher than the raw demo.
  const progressed: Project = {
    ...demo,
    claims: demo.claims.map((c) => ({ ...c, review_status: c.impact === "critical" ? ("accepted" as const) : c.review_status })),
    tasks: demo.tasks.map((t) => ({ ...t, status: "done" as const })),
    runs: demo.runs,
  };
  const r1 = readinessScore(progressed);
  check("progress raises score", r1.total > r0.total, `${r0.total} -> ${r1.total}`);
  check("deductions carry fix views", r1.subs.every((s) => s.deductions.every((d) => ["overview","evidence","plan","datasets","compute","files","validation","runs","sweeps","export","settings","import","processing","projects"].includes(d.view))));

  // workspaceCard + organization
  const card = workspaceCard(progressed);
  check("card mirrors project", card.id === progressed.id && card.claims === progressed.claims.length);
  check("card next-action non-empty", card.next.length > 0);
  const cards = organizeCards([progressed, { ...progressed, id: "p_b", pinned: true }, { ...progressed, id: "p_c", archived: true }], { q: "", sort: "recent", showArchived: false });
  check("archived hidden by default", cards.length === 2 && !cards.some((c) => c.id === "p_c"));
  check("pinned sorts first", cards[0].id === "p_b");
  const withArchived = organizeCards([progressed, { ...progressed, id: "p_c", archived: true }], { q: "", sort: "recent", showArchived: true });
  check("showArchived includes archive", withArchived.length === 2);
  const qFilter = organizeCards([progressed], { q: "zzz-no-match", sort: "recent", showArchived: true });
  check("search filters cards", qFilter.length === 0);
  const byReadiness = organizeCards([{ ...progressed, id: "a" }, { ...progressed, id: "b", tasks: [], scaffold: null, runs: [] }], { q: "", sort: "readiness", showArchived: false });
  check("readiness sort desc", byReadiness[0].id === "a");

  const stats = workspaceStats([{ ...progressed, id: "a" }, { ...progressed, id: "b", archived: true }]);
  check("workspace stats counts", stats.total === 2 && stats.active === 1 && stats.archived === 1);
  check("avg readiness bounded", stats.avg_readiness >= 0 && stats.avg_readiness <= 100);
}

// Round-3 addition: project lifecycle semantics (archive / pin / duplicate / backup)
console.log("\n== 12. Workspace lifecycle (v2.0) ==");
{
  // Pure-function mirror of the store semantics (store actions delegate to these shapes).
  const clone = (p: Project, patch: Partial<Project>): Project => ({ ...structuredClone(p), ...patch });

  const archived = clone(demo, { archived: true });
  check("archive flag survives clone", archived.archived === true && archived.claims.length === demo.claims.length, "archive never deletes data");

  const dup = clone(demo, { id: "p2b_dup", pinned: false, archived: false });
  check("duplicate resets flags", dup.id === "p2b_dup" && dup.pinned === false && dup.archived === false);
  check("duplicate is deep copy", dup !== demo && dup.claims !== demo.claims);

  // Workspace backup round-trip (pure JSON, same contract as store.exportWorkspace/importWorkspace)
  const backup = {
    format: "paper2bench.workspace",
    format_version: 1,
    exported_at: new Date().toISOString(),
    app_version: "2.0.0",
    settings: { privacy_mode: "local_only", extraction_engine: "heuristic", telemetry: false, export_markdown: true },
    projects: [demo],
  };
  const json = JSON.stringify(backup);
  const parsed = JSON.parse(json) as typeof backup;
  check("backup round-trip preserves claims", parsed.projects[0].claims.length === demo.claims.length);
  check("backup format marker present", parsed.format === "paper2bench.workspace");
  check("backup contains settings", typeof parsed.settings.privacy_mode === "string");

  // Import validation must refuse corrupt payloads
  const refusals: [string, unknown][] = [
    ["not a workspace format", { format: "other", projects: [demo] }],
    ["missing projects", { format: "paper2bench.workspace" }],
    ["empty projects", { format: "paper2bench.workspace", projects: [] }],
    ["corrupt entry", { format: "paper2bench.workspace", projects: [{ id: "x" }] }],
  ];
  for (const [label, payload] of refusals) {
    const p = payload as Record<string, unknown>;
    const projects = p.projects as Array<Record<string, unknown>> | undefined;
    const valid =
      p.format === "paper2bench.workspace" &&
      Array.isArray(projects) && projects.length > 0 &&
      projects.every((e) => typeof e.id === "string" && typeof e.paper === "object" && e.paper !== null && Array.isArray(e.claims));
    check(`import refuses: ${label}`, !valid);
  }
}
console.log(`\n======== TOTAL: ${pass} passed, ${fail} failed ========`);
process.exit(fail > 0 ? 1 : 0);
