import type {
  Claim,
  PaperMeta,
  ParseCoverage,
  Project,
  ReportedMetric,
  RunManifest,
  EvidenceSpan,
} from "./types";
import { shortHash } from "./semantics";

/**
 * Curated demonstration project for "Attention Is All You Need" (Vaswani et al., 2017,
 * arXiv:1706.03762). Claim values below are transcribed from the publicly available
 * paper (sections quoted in the evidence spans). This file exists so the full workflow
 * can be explored without any network access, and it deliberately includes:
 *  - reported claims with quotes,
 *  - one genuinely conflicting field (residual dropout: §5.4 states 0.1, Table 2 lists
 *    P_drop 0.3 for the big variant) so conflict-resolution UI can be exercised honestly,
 *  - unspecified fields (random seeds, weight decay) so "unknown" stays visible.
 */

const PID = "demo_1706.03762";

function span(
  id: string,
  page: number,
  section: string,
  text: string,
  locator?: string
): EvidenceSpan {
  return {
    evidence_id: `ev_${id}`,
    page,
    section,
    locator: locator ?? null,
    text,
    anchor_validity: "verified",
  };
}

function claim(
  path: string,
  category: Claim2,
  label: string,
  value: string | number | boolean | null,
  unit: string | null,
  impact: "critical" | "important" | "informational",
  evidence: EvidenceSpan[],
  status: "reported" | "inferred" | "unspecified" | "conflicting" = "reported",
  raw?: string
): Claim {
  return {
    claim_id: path,
    category,
    field_path: path,
    label,
    raw_value: raw ?? (typeof value === "number" ? String(value) : value ?? null),
    value,
    unit,
    evidence_status: status,
    impact,
    confidence: status === "unspecified" ? 0.9 : 0.94,
    review_status: "not_reviewed",
    notes: [],
    evidence,
    revisions: [
      {
        value,
        evidence_status: status,
        actor: "extractor",
        at: "2026-10-26T00:00:00.000Z",
        reason: "curated demo extraction",
      },
    ],
    extractor: "demo",
  };
}

type Claim2 =
  | "architecture"
  | "dataset"
  | "preprocessing"
  | "loss"
  | "optimizer"
  | "training"
  | "evaluation"
  | "metrics"
  | "compute"
  | "environment"
  | "reported_results";

export function buildDemoProject(): Project {
  const paper: PaperMeta = {
    paper_id: PID,
    title: "Attention Is All You Need",
    authors: [
      "Ashish Vaswani",
      "Noam Shazeer",
      "Niki Parmar",
      "Jakob Uszkoreit",
      "Llion Jones",
      "Aidan N. Gomez",
      "Lukasz Kaiser",
      "Illia Polosukhin",
    ],
    year: 2017,
    venue: "NeurIPS 2017",
    source_url: "https://arxiv.org/abs/1706.03762",
    source_kind: "demo",
    source_version: `demo-${shortHash("attention-is-all-you-need", 12)}`,
    retrieved_at: "2026-10-26T00:00:00.000Z",
    abstract:
      "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. … We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train. Our model achieves 28.4 BLEU on the WMT 2014 English-to-German translation task, improving over the existing best results, including ensembles, by over 2 BLEU. …",
    full_text_available: true,
    extraction_scope: "curated_demo",
  };

  const coverage: ParseCoverage = {
    parser: "Curated demo fixture v1 (sections transcribed from the published arXiv v6 PDF)",
    pages: 15,
    sections_detected: [
      "Abstract",
      "1 Introduction",
      "2 Background",
      "3 Model Architecture",
      "3.2 Attention",
      "5 Training",
      "5.1 Training Data and Batching",
      "5.3 Optimizer",
      "5.4 Regularization",
      "6 Results",
      "6.1 Machine Translation",
      "7 Conclusion",
    ],
    tables_detected: 3,
    equations_detected: 2,
    image_only_pages: [],
    warnings: [
      "This is a curated demonstration fixture: claims were transcribed by hand from the published paper, not machine-extracted.",
    ],
    coverage_pct: 0.97,
  };

  const s31 = "Table 1: Maximum path lengths, per-layer complexity and minimum number of sequential operations for different layer types.";
  const s51 = "We trained on the standard WMT 2014 English-German dataset consisting of about 4.5 million sentence pairs, and 36M sentences for English-French. Sentences were encoded using byte-pair encoding, which has a shared source-target vocabulary of about 37000 tokens.";
  const s52 = "We trained all the models on a machine with 8 NVIDIA P100 GPUs.  We used the Adam optimizer with β1 = 0.9, β2 = 0.98 and ε = 10−9.  We varied the learning rate over the course of training, according to the formula: lrate = d−0.5 model · min(step_num−0.5, step_num · warmup_steps−1.5) with warmup_steps = 4000.";
  const s54 = "Residual Dropout We apply dropout to the output of each sub-layer, before it is added to the sub-layer input and normalized.  In addition, we apply dropout to the sums of the embeddings and the positional encodings in both the encoder and decoder stacks.  With the base model, we use a dropout rate of Pdrop = 0.1.";
  const t2row = "Transformer (big) — BLEU 28.4 / 41.8, training cost FLOPs 3.3·1023 / 2.3·1023 (Table 2). Transformer (base), Pdrop 0.1: 27.3 BLEU EN-DE.";
  const s61 = "On the WMT 2014 English-to-German translation task, the big transformer model (Transformer (big) in Table 2) outperforms the best previously reported models (including ensembles) by more than 2.0 BLEU, establishing a new state-of-the-art BLEU score of 28.4.";
  const s62 = "For the base models, we used a single model obtained by averaging the last 5 checkpoints, which were saved at 10 minute intervals. For the big models, we averaged the last 20 checkpoints. ... During inference, we use beam search with a beam size of 4 and length penalty α = 0.6.";
  const s53 = "We used a batch size of 25000 source and target tokens.";

  const claims: Claim[] = [
    claim("architecture.type", "architecture", "Model family", "Encoder-decoder Transformer", null, "critical", [span("a1", 3, "3 Model Architecture", "The Transformer follows this overall architecture using stacked self-attention and point-wise, fully connected layers for both the encoder and decoder, shown in the left and right halves of Figure 1, respectively.")]),
    claim("architecture.num_layers", "architecture", "Encoder/decoder layers", 6, "layers", "critical", [span("a2", 3, "3.1 Encoder and Decoder Stacks", "The Transformer follows this overall architecture… The encoder is composed of a stack of N = 6 identical layers.", "Figure 1 caption / §3.1")]),
    claim("architecture.d_model", "architecture", "Model dimension (d_model)", 512, null, "critical", [span("a3", 5, "3.2.1 Scaled Dot-Product Attention", "dmodel = 512 as in the base configuration.", "§3.2.1")]),
    claim("architecture.d_ff", "architecture", "Feed-forward dimension (d_ff)", 2048, null, "important", [span("a4", 5, "3.3 Position-wise Feed-Forward Networks", "The dimensionality of input and output is dmodel = 512, and the inner-layer has dimensionality dff = 2048.")]),
    claim("architecture.num_heads", "architecture", "Attention heads (h)", 8, "heads", "important", [span("a5", 4, "3.2.2 Multi-Head Attention", "Due to the reduced dimension of each head, the total computational cost is similar to that of single-head attention with full dimensionality. h = 8 parallel attention…", "§3.2.2")]),
    claim("dataset.wmt14_ende", "dataset", "Primary dataset", "WMT 2014 English-German", null, "critical", [span("d1", 8, "5.1 Training Data and Batching", s51)], "reported", "WMT 2014 English-German"),
    claim("dataset.size_ende", "dataset", "EN-DE corpus size", "4.5M sentence pairs", null, "important", [span("d1", 8, "5.1 Training Data and Batching", s51)], "reported", "4.5M"),
    claim("dataset.tokenization", "preprocessing", "Tokenization", "Byte-pair encoding, shared 37000-token vocabulary", null, "important", [span("d2", 8, "5.1 Training Data and Batching", s51)]),
    claim("optimizer.name", "optimizer", "Optimizer", "Adam", null, "critical", [span("o1", 8, "5.3 Optimizer", s52)]),
    claim("optimizer.beta1", "optimizer", "Adam beta1", 0.9, null, "important", [span("o1", 8, "5.3 Optimizer", s52)], "reported", "0.9"),
    claim("optimizer.beta2", "optimizer", "Adam beta2", 0.98, null, "important", [span("o1", 8, "5.3 Optimizer", s52)], "reported", "0.98"),
    claim("optimizer.epsilon", "optimizer", "Adam epsilon", 1e-9, null, "informational", [span("o1", 8, "5.3 Optimizer", s52)], "reported", "1e-9"),
    claim("training.lr_schedule", "training", "LR schedule", "lrate = d_model^-0.5 · min(step^-0.5, step · warmup^-1.5)", null, "critical", [span("o1", 8, "5.3 Optimizer", s52), span("o2", 8, "Equation (3)", "lrate = d−0.5 model · min(step_num−0.5, step_num · warmup_steps−1.5)", "Equation (3)")]),
    claim("training.warmup_steps", "training", "Warmup steps", 4000, "steps", "critical", [span("o1", 8, "5.3 Optimizer", s52)], "reported", "4000"),
    claim("training.batch_size", "training", "Batch size", 25000, "tokens (source + target)", "critical", [span("b1", 8, "5.2 Hardware and Schedule", s53)], "reported", "25000"),
    claim("training.dropout", "training", "Residual dropout (Pdrop)", null, null, "critical", [span("c1", 9, "5.4 Regularization", s54, "§5.4"), span("c2", 10, "Table 2 (big variant row)", t2row, "Table 2")], "conflicting", "0.1 vs 0.3"),
    claim("training.label_smoothing", "loss", "Label smoothing", 0.1, null, "important", [span("l1", 9, "5.4 Regularization", "During training, we employed label smoothing of value εls = 0.1 [36]. This hurts perplexity, as the model learns to be more unsure, but improves accuracy and BLEU score.")]),
    claim("loss.type", "loss", "Training loss", "Cross-entropy with label smoothing", null, "critical", [span("l1", 9, "5.4 Regularization", "During training, we employed label smoothing of value εls = 0.1 [36].")]),
    claim("training.seed", "training", "Random seed(s)", null, null, "critical", [], "unspecified"),
    claim("training.weight_decay", "training", "Weight decay", null, null, "important", [], "unspecified"),
    claim("compute.accelerators", "compute", "Training hardware", "8x P100", null, "important", [span("h1", 8, "5.2 Hardware and Schedule", "We trained all the models on a machine with 8 NVIDIA P100 GPUs.")]),
    claim("training.wallclock_big", "training", "Wall-clock (big model)", "3.5 days", null, "informational", [span("h2", 8, "5.2 Hardware and Schedule", "The big models were trained for 3.5 days; the base models 0.5 day each.")], "inferred"),
    claim("evaluation.beam_size", "evaluation", "Beam size", 4, null, "important", [span("e1", 9, "6.1 Machine Translation", s62)]),
    claim("evaluation.length_penalty", "evaluation", "Length penalty α", 0.6, null, "informational", [span("e1", 9, "6.1 Machine Translation", s62)], "reported", "0.6"),
    claim("evaluation.checkpoint_averaging", "evaluation", "Checkpoint averaging", "last 5 (base) / last 20 (big) checkpoints", null, "important", [span("e1", 9, "6.1 Machine Translation", s62)]),
  ];

  const reported_metrics: ReportedMetric[] = [
    {
      metric_id: "rm_bleu_ende_big",
      name: "BLEU",
      value: 28.4,
      unit: "BLEU",
      dataset: "WMT 2014 English-German",
      split: "newstest2014",
      direction: "maximize",
      aggregation: "single model (checkpoint-averaged), single run",
      source: "Table 2 — row: Transformer (big)",
      evidence: [span("r1", 10, "6.1 Machine Translation / Table 2", s61, "Table 2")],
      variability: null,
    },
    {
      metric_id: "rm_bleu_ende_base",
      name: "BLEU",
      value: 27.3,
      unit: "BLEU",
      dataset: "WMT 2014 English-German",
      split: "newstest2014",
      direction: "maximize",
      aggregation: "single model (checkpoint-averaged), single run",
      source: "Table 2 — row: Transformer (base)",
      evidence: [span("r2", 10, "Table 2", t2row, "Table 2")],
      variability: null,
    },
    {
      metric_id: "rm_bleu_enfr_big",
      name: "BLEU",
      value: 41.8,
      unit: "BLEU",
      dataset: "WMT 2014 English-French",
      split: "newstest2014",
      direction: "maximize",
      aggregation: "single model (checkpoint-averaged), single run",
      source: "Table 2 — row: Transformer (big), EN-FR",
      evidence: [span("r3", 10, "6.1 Machine Translation / Table 2", "On the WMT 2014 English-to-French translation task, our big model achieves a BLEU score of 41.8, outperforming all of the previously published single models, at less than 1/4 the training cost…", "Table 2")],
      variability: null,
    },
  ];

  const runs: RunManifest[] = [
    {
      run_id: "run_demo_1",
      label: "Example: base config, seed 42 (illustrative)",
      paper_id: PID,
      code_commit: "9f31ac2 (example)",
      config_hash: "cfg-demo-4f7a (example)",
      dataset_fingerprint: "wmt14ende-bpe37k-sha-demo",
      seed: 42,
      environment: { python: "3.11", torch: "2.4.1" },
      hardware: { accelerator: "1x A100-40GB", precision: "fp32" },
      metrics: [
        { name: "BLEU", value: 27.9, split: "newstest2014", metric_version: "v1" },
      ],
      artifacts: ["checkpoints/best.pt (example)"],
      history: {
        BLEU: [1,2,3,4,5,6,7,8].map((i) => ({ step: i * 12500, value: 4 + i * 3.05 + (i % 3) * 0.3 })),
      },
      started_at: "2026-10-20T09:00:00Z",
      finished_at: "2026-10-21T03:00:00Z",
      source: "demo",
      is_example: true,
    },
    {
      run_id: "run_demo_2",
      label: "Example: big config, seed 7 (illustrative)",
      paper_id: PID,
      code_commit: "b84ce10 (example)",
      config_hash: "cfg-demo-91bd (example)",
      dataset_fingerprint: "wmt14ende-bpe37k-sha-demo",
      seed: 7,
      environment: { python: "3.11", torch: "2.4.1" },
      hardware: { accelerator: "8x P100", precision: "fp32" },
      metrics: [
        { name: "BLEU", value: 28.1, split: "newstest2014", metric_version: "v1" },
      ],
      artifacts: [],
      history: {
        BLEU: [1,2,3,4,5,6,7,8].map((i) => ({ step: i * 12500, value: 3.4 + i * 3.15 + (i % 4) * 0.22 })),
      },
      started_at: "2026-10-22T09:00:00Z",
      finished_at: "2026-10-25T20:00:00Z",
      source: "demo",
      is_example: true,
    },
  ];

  return {
    id: `p2b_demo_${shortHash(PID, 8)}`,
    created_at: "2026-10-26T00:00:00.000Z",
    updated_at: new Date().toISOString(),
    paper,
    coverage,
    claims,
    reported_metrics,
    tasks: [],
    datasets: [],
    compute: null,
    scaffold: null,
    validation: null,
    runs,
    assessments: [],
    activity: [
      {
        at: new Date().toISOString(),
        kind: "project_created",
        detail: "Demo project loaded (curated fixture: Attention Is All You Need).",
      },
    ],
    provisional: false,
  };
}
