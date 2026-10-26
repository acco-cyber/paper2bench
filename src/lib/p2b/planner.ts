import type {
  Claim,
  ComputeEstimate,
  DatasetRecord,
  ProtocolTask,
  ReportedMetric,
} from "./types";
import { shortHash } from "./semantics";

/**
 * F06 Reproduction planner — ordered tasks with dependencies, claim refs and
 * concrete acceptance criteria. F07 Dataset audit starter records.
 * F08 Compute estimator — transparent ranges with formulas and assumptions.
 */

export type PlanPreset = "smoke_only" | "main_result" | "main_plus_ablations" | "full_paper";

const PHASE_ORDER = [
  "data",
  "environment",
  "model",
  "loss",
  "training",
  "evaluation",
  "comparison",
  "report",
] as const;

function t(
  id: string,
  title: string,
  phase: ProtocolTask["phase"],
  description: string,
  claimRefs: string[],
  acceptance: string,
  deps: string[],
  effort: ProtocolTask["effort"],
  risk: ProtocolTask["risk"]
): ProtocolTask {
  return {
    task_id: id,
    title,
    phase,
    description,
    status: "not_started",
    dependencies: deps,
    claim_refs: claimRefs,
    acceptance_criteria: acceptance,
    effort,
    risk,
    owner: null,
    note: null,
  };
}

export function generatePlan(
  claims: Claim[],
  preset: PlanPreset
): ProtocolTask[] {
  const byId = new Map(claims.map((c) => [c.claim_id, c]));
  const get = (id: string) => byId.get(id);
  const statusOf = (id: string) => {
    const c = get(id);
    if (!c) return "unspecified";
    return c.evidence_status;
  };

  const tasks: ProtocolTask[] = [
    t(
      "t_env_1",
      "Create pinned Python environment",
      "environment",
      "Set up a virtual/conda environment with pinned framework versions and record exact package versions for the run manifest.",
      [],
      "requirements/lock file exists and `pip freeze` output is recorded in the run manifest.",
      [],
      "S",
      "low"
    ),
    t(
      "t_report_1",
      "Write reproduction README with scope and deviations",
      "report",
      "Record reproduction scope, deviations from the paper, and the explicit list of unresolved items before any training run.",
      [],
      "README documents scope, deviations, and unresolved-item list; export marked provisional if unresolved critical items remain.",
      [],
      "S",
      "low"
    ),
  ];

  const datasetClaims = claims.filter((c) => c.category === "dataset");
  tasks.push(
    t(
      "t_data_1",
      "Obtain dataset and record access/licence state",
      "data",
      "Follow the paper's data source, record version, licence/access terms and access state. Never download gated data without user action.",
      datasetClaims.map((c) => c.claim_id),
      "Dataset access state is 'downloaded' with licence status recorded; unknown licences are NOT treated as permissive.",
      [],
      "M",
      "medium"
    ),
    t(
      "t_data_2",
      "Verify split identity and record fingerprint",
      "data",
      `Split status from paper: ${statusOf("dataset.splits") === "unspecified" ? "SPLIT NOT SPECIFIED — check appendix or document an assumption" : "review extracted split claims"}. Record a content fingerprint for the exact split used.`,
      ["dataset.splits", "dataset.size_ende"].filter((id) => get(id)),
      "Split provenance recorded and dataset/split fingerprint stored in every run manifest.",
      ["t_data_1"],
      "M",
      "high"
    )
  );

  const archClaims = claims.filter((c) => c.category === "architecture");
  tasks.push(
    t(
      "t_model_1",
      "Implement model from reviewed architecture claims",
      "model",
      "Implement the architecture using the evidence ledger as source of truth; leave TODO(p2b) markers for every unspecified field.",
      archClaims.map((c) => c.claim_id),
      "Config validation passes; every architecture TODO traces to a specific unresolved claim id.",
      ["t_env_1"],
      "L",
      "medium"
    )
  );

  const lossClaims = claims.filter((c) => c.category === "loss");
  tasks.push(
    t(
      "t_loss_1",
      "Implement loss exactly as extracted (incl. label smoothing)",
      "loss",
      "Implement the loss function(s); where the paper omits coefficients, mark them as user-confirmed assumptions in the ledger.",
      lossClaims.map((c) => c.claim_id),
      "Loss unit test passes; smoothing/coefficient values each link to a claim or recorded decision.",
      ["t_model_1"],
      "M",
      "high"
    )
  );

  const trainClaims = claims.filter((c) => ["training", "optimizer"].includes(c.category));
  tasks.push(
    t(
      "t_train_1",
      "Wire optimizer, schedule, and batch semantics",
      "training",
      `Optimizer: ${statusOf("optimizer.name")}. Batch semantics matter: token-based batches are NOT example-based batches — implement what the paper specifies.`,
      trainClaims.map((c) => c.claim_id),
      "Config validator confirms optimizer/schedule parameters match reviewed claims; batch semantics documented.",
      ["t_model_1"],
      "M",
      "high"
    ),
    t(
      "t_train_2",
      "Smoke run on synthetic data",
      "training",
      "Run the generated smoke test on a tiny synthetic batch to validate wiring end-to-end without GPU cost.",
      [],
      "Synthetic smoke test passes: loss decreases on a 50-step run and no NaNs occur.",
      ["t_loss_1", "t_train_1"],
      "S",
      "low"
    )
  );

  const evalClaims = claims.filter(
    (c) => ["evaluation", "metrics", "reported_results"].includes(c.category)
  );
  tasks.push(
    t(
      "t_eval_1",
      "Implement evaluation protocol (beam, checkpoint policy)",
      "evaluation",
      "Implement inference/eval exactly as specified (beam size, checkpoint averaging, length penalty). Wrong eval protocol invalidates comparisons.",
      evalClaims.map((c) => c.claim_id),
      "Evaluation flags (beam size, checkpoint selection) recorded in config and run manifest.",
      ["t_train_2"],
      "M",
      "high"
    ),
    t(
      "t_cmp_1",
      "Import runs and compare under protocol criteria",
      "comparison",
      "Import run manifests (JSONL/CSV), then compare reported vs measured with protocol-mismatch visibility. 'Reproduction criteria passed' requires the user to confirm protocol checks.",
      [],
      "Every reported metric has an assessment with mismatches listed; no auto-awarded 'passed' state.",
      ["t_eval_1"],
      "S",
      "medium"
    )
  );

  if (preset === "smoke_only") {
    return tasks.filter((t0) =>
      ["t_env_1", "t_model_1", "t_loss_1", "t_train_1", "t_train_2", "t_report_1"].includes(t0.task_id)
    );
  }
  if (preset === "full_paper") {
    tasks.push(
      t(
        "t_eval_2",
        "Reproduce ablation table rows",
        "evaluation",
        "Run the ablation configurations listed in the paper and compare each against its reported row.",
        [],
        "Each ablation row has a run manifest and assessment entry.",
        ["t_eval_1"],
        "L",
        "high"
      )
    );
  }
  return tasks; // main_result & main_plus_ablations share the base set (ablations only in full)
}

const KNOWN_DATASET_URLS: Record<string, string> = {
  "wmt 2014 english-german": "https://www.statmt.org/wmt14/translation-task.html",
  "wmt 2014 english-french": "https://www.statmt.org/wmt14/translation-task.html",
  imagenet: "https://image-net.org/download.php",
  "cifar-10/100": "https://www.cs.toronto.edu/~kriz/cifar.html",
  mnist: "https://yann.lecun.com/exdb/mnist/",
  "ms coco": "https://cocodataset.org/#download",
  "glue benchmark": "https://gluebenchmark.com/",
  squad: "https://rajpurkar.github.io/SQuAD-explorer/",
  "wikitext-103": "https://huggingface.co/datasets/Salesforce/wikitext",
  librispeech: "https://www.openslr.org/12",
  openwebtext: "https://skylion007.github.io/OpenWebTextCorpus/",
  bookcorpus: "https://yann.la/bookcorpus/",
  laion: "https://laion.ai/blog/laion-5b/",
};

export function generateDatasetRecords(claims: Claim[]): DatasetRecord[] {
  const dsClaims = claims.filter(
    (c) => c.category === "dataset" && c.value !== null
  );
  const seen = new Map<string, DatasetRecord>();
  for (const c of dsClaims) {
    const name = String(c.value);
    const key = name.toLowerCase();
    if (seen.has(key)) {
      const rec = seen.get(key)!;
      rec.claim_refs.push(c.claim_id);
      if (c.evidence[0] && !rec.evidence) rec.evidence = [];
      if (c.evidence[0]) rec.evidence!.push(c.evidence[0]);
      continue;
    }
    const url = KNOWN_DATASET_URLS[key] ?? null;
    const sizeClaim = claims.find((x) => x.claim_id === "dataset.size" || x.claim_id.includes("size"));
    seen.set(key, {
      dataset_id: `ds_${shortHash(name, 8)}`,
      name,
      version: null,
      source_url: url,
      license_status: "unknown",
      license_note:
        "Licence/access terms not identified — automated download is blocked until access terms are confirmed by the user.",
      splits: null,
      split_provenance: "unknown",
      preprocessing: claims.find((x) => x.claim_id.includes("tokenization"))?.value?.toString() ?? null,
      access_state: url ? "linked" : "mentioned",
      fingerprint: null,
      access_confirmed_by_user: false,
      leakage_checks: [
        { id: "lc_test_tuning", label: "Test set not used for model tuning / early stopping", state: "unknown" },
        { id: "lc_dupes", label: "No duplicate examples across train/eval splits", state: "unknown" },
        { id: "lc_custom_split", label: "Split provenance verified (not a custom undocumented split)", state: "unknown" },
        { id: "lc_eval_public", label: "Evaluation data is publicly accessible for verification", state: "unknown" },
      ],
      claim_refs: [c.claim_id],
      evidence: c.evidence.slice(0, 1),
    });
    if (sizeClaim) {
      // attach size evidence to first record only
      const rec = seen.get(key)!;
      if (sizeClaim.evidence[0]) rec.evidence = [...rec.evidence, sizeClaim.evidence[0]];
    }
  }
  return Array.from(seen.values());
}

// ————————————————————————————————————————————————————————————
// F08 Compute estimator — documented formulas, ranges, no fake precision.
// ————————————————————————————————————————————————————————————

export interface ComputeInputs {
  params_millions: number;
  dtype: "fp32" | "fp16" | "bf16";
  seq_len: number;
  batch_size: number;
  batch_is_tokens: boolean;
  avg_tokens_per_example: number;
  grad_accum: number;
  epochs: number;
  dataset_examples: number;
  seeds: number;
  grad_checkpointing: boolean;
  optimizer: "adamw" | "adam" | "sgd";
  accelerator: string;
  val_fraction: number;
}

const DT_BYTES: Record<ComputeInputs["dtype"], number> = { fp32: 4, fp16: 2, bf16: 2 };
// Tokens/sec for a 100M-param model, fp32, forward+backward, ONE device. Versioned heuristic.
const ACCEL_TPS: Record<string, number> = {
  "a100": 120000,
  "h100": 250000,
  "v100": 40000,
  "p100": 25000,
  "t4": 18000,
  "cpu": 800,
};
const ACCEL_MEM: Record<string, number> = {
  "a100": 40, "h100": 80, "v100": 16, "p100": 16, "t4": 16, "cpu": 8,
};

export function defaultComputeInputs(claims: Claim[]): ComputeInputs {
  const v = (path: string): number | null => {
    const c = claims.find((x) => x.field_path === path);
    if (c && typeof c.value === "number") return c.value;
    if (c && typeof c.value === "string") {
      const m = c.value.match(/[\d.]+/);
      if (m) return Number(m[0]);
    }
    return null;
  };
  const hw = claims.find((c) => c.claim_id === "compute.accelerators");
  const hwStr = hw && hw.value ? String(hw.value).toLowerCase() : "";
  const accelKey =
    ["h100", "a100", "v100", "p100", "t4"].find((k) => hwStr.includes(k)) ?? "a100";
  const batchVal = v("training.batch_size");
  const batchClaim = claims.find((c) => c.claim_id === "training.batch_size");
  const batchIsTokens = batchClaim?.unit ? /token/i.test(batchClaim.unit) : true;
  return {
    params_millions: 65, // conservative placeholder for a base Transformer-scale model
    dtype: "fp32",
    seq_len: 512,
    batch_size: batchVal ?? 25000,
    batch_is_tokens: batchIsTokens,
    avg_tokens_per_example: 30,
    grad_accum: 1,
    epochs: 8,
    dataset_examples: 4500000,
    seeds: 1,
    grad_checkpointing: false,
    optimizer: "adamw",
    accelerator: accelKey,
    val_fraction: 0.02,
  };
}

export function computeEstimate(inp: ComputeInputs): ComputeEstimate {
  const assumptions: string[] = [];
  const missing: string[] = [];

  const dtBytes = DT_BYTES[inp.dtype];
  const params = inp.params_millions * 1e6;

  // Model weights
  const modelMem = (params * dtBytes) / 1024 ** 3;

  // Optimizer state: AdamW/Adam keep fp32 m and v (8 B/param); SGD momentum 4 B/param
  const optBytes = inp.optimizer === "sgd" ? 4 : 8;
  const optMem = (params * optBytes) / 1024 ** 3;
  assumptions.push(
    `Optimizer state = ${optBytes} bytes/param (${inp.optimizer}: fp32 first/second moment${inp.optimizer === "sgd" ? " momentum" : " m & v"}).`
  );

  // Gradients: same precision as params here (no master-weight duplication assumed for fp32)
  const gradBytes = inp.dtype === "fp32" ? 4 : 4; // grads usually fp32 even in mixed precision
  const gradMem = (params * gradBytes) / 1024 ** 3;
  if (inp.dtype !== "fp32") {
    assumptions.push("Gradients assumed fp32 (mixed-precision common practice).");
  }

  // Activations: heuristic ~ per-token per-layer ~ 34 bytes; d_model scaling captured by params proxy.
  const estLayers = Math.max(2, Math.round(inp.params_millions / 8)); // crude: ~8M params/layer at d512
  const tokensPerMicro =
    (inp.batch_is_tokens ? inp.batch_size : inp.batch_size * inp.avg_tokens_per_example) * inp.grad_accum;
  const actBase =
    (tokensPerMicro * estLayers * 34) / 1024 ** 3;
  const ckptFactor = inp.grad_checkpointing ? 0.28 : 1.0;
  const actLow = actBase * ckptFactor * 0.7;
  const actHigh = actBase * ckptFactor * 1.5;
  assumptions.push(
    `Activation memory uses a documented heuristic (≈34 bytes/token/layer, ${estLayers} estimated layers) — profile your own step to refine.`
  );
  if (inp.grad_checkpointing) assumptions.push("Gradient checkpointing factor 0.28 applied to activations.");

  const totalLow = modelMem + optMem + gradMem + actLow;
  const totalHigh = modelMem + optMem + gradMem + actHigh;

  // Storage: dataset + checkpoints (model + optimizer state per checkpoint, 2 kept) + logs headroom
  const ckptOne = modelMem + optMem;
  const datasetGb = (inp.dataset_examples * inp.seq_len * 2.4) / 1024 ** 3; // ~2.4 bytes/token text heuristic
  const storage = datasetGb + ckptOne * 2 + 2;

  // Steps & runtime — batch semantics are honoured: token batches ≠ example batches
  // (the blueprint's own warning). Token-based batches convert via avg_tokens_per_example.
  const tokensPerExample = inp.batch_is_tokens ? inp.avg_tokens_per_example : 1;
  const tokensPerEpoch = inp.dataset_examples * tokensPerExample;
  const effBatchTokens =
    (inp.batch_is_tokens ? inp.batch_size : inp.batch_size * tokensPerExample) * inp.grad_accum;
  const trainSteps = Math.max(1, Math.round((inp.epochs * tokensPerEpoch) / effBatchTokens));
  const key = Object.keys(ACCEL_TPS).find((k) => inp.accelerator.toLowerCase().includes(k)) ?? "a100";
  const tps = ACCEL_TPS[key] * (100 / Math.max(1, inp.params_millions)); // tokens/s scaled by params
  const tokensPerRun = trainSteps * effBatchTokens;
  const hoursLow = ((tokensPerRun / (tps * 1.5)) * inp.seeds) / 3600;
  const hoursHigh = ((tokensPerRun / (tps * 0.6)) * inp.seeds) / 3600;
  assumptions.push(
    `Throughput heuristic: ${(ACCEL_TPS[key] / 1000).toFixed(0)}k tokens/s per 100M params on ${key.toUpperCase()} (single device), scaled to ${Math.round(tps).toLocaleString()} t/s for ${inp.params_millions}M params; ±50%/–40% range covers kernels, precision and data loading.`
  );
  if (inp.batch_is_tokens) {
    assumptions.push(
      `Batch is TOKEN-based (${inp.batch_size.toLocaleString()} tokens/step): steps = epochs × dataset tokens ÷ batch tokens, using ${inp.avg_tokens_per_example} avg tokens/example.`
    );
  } else {
    assumptions.push(`Batch is EXAMPLE-based (${inp.batch_size.toLocaleString()} examples/step).`);
  }

  // Missing inputs that materially move the estimate
  const seedClaimMissing = true;
  void seedClaimMissing;
  missing.push(
    "Total parameter count was not extracted from the paper — placeholder 65M used. Wrong params change memory & runtime linearly.",
    "Number of seeds / averaging protocol unknown — runtime scales linearly with seeds.",
    "Dataset size in tokens not verified — storage and step count are approximations until the dataset is fingerprinted."
  );

  return {
    ...inp,
    model_mem_gb: r2(modelMem),
    optimizer_mem_gb: r2(optMem),
    grad_mem_gb: r2(gradMem),
    activation_mem_gb_low: r2(actLow),
    activation_mem_gb_high: r2(actHigh),
    total_mem_gb_low: r2(totalLow),
    total_mem_gb_high: r2(totalHigh),
    storage_gb: r2(storage),
    runtime_hours_low: r2(hoursLow),
    runtime_hours_high: r2(hoursHigh),
    train_steps: trainSteps,
    assumptions,
    missing_inputs: missing,
    formula_version: "p2b-compute-v1.0",
    computed_at: new Date().toISOString(),
  };
}

function r2(n: number) { return Math.round(n * 100) / 100; }
function r1(n: number) { return Math.round(n * 10) / 10; }

export function metricsNeedingAssessment(
  reported: ReportedMetric[],
  runs: ProtocolTask[] // unused, placeholder to keep signature minimal
): ReportedMetric[] {
  void runs;
  return reported;
}
