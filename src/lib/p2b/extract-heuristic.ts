import type {
  Claim,
  ClaimCategory,
  EvidenceSpan,
  Impact,
  ReportedMetric,
  RunManifest,
} from "./types";
import { shortHash } from "./semantics";

/**
 * Local, deterministic, pattern-based claim extraction (F03 fallback path).
 * Every claim carries the matched sentence as its evidence span with anchor_validity
 * "weak" until a human verifies it in context. Absent fields stay unspecified —
 * this extractor never invents values.
 */

interface RawHit {
  path: string;
  category: ClaimCategory;
  label: string;
  value: string | number | boolean | null;
  unit: string | null;
  impact: Impact;
  sentence: string;
  page?: number | null;
  locator?: string | null;
  status?: "reported" | "inferred" | "unspecified" | "conflicting";
}

const KNOWN_DATASETS: { re: RegExp; name: string; url?: string }[] = [
  { re: /\bWMT\s?20?1?4?\s?(English-German|EN-DE|English to German)\b/i, name: "WMT 2014 English-German", url: "https://www.statmt.org/wmt14/" },
  { re: /\bWMT\s?201?4?\b/i, name: "WMT 2014", url: "https://www.statmt.org/wmt14/" },
  { re: /\bImageNet\b/i, name: "ImageNet", url: "https://image-net.org/" },
  { re: /\bImageNet-21k\b/i, name: "ImageNet-21k" },
  { re: /\bCIFAR-?100?\b/i, name: "CIFAR-10/100" },
  { re: /\bMNIST\b/i, name: "MNIST" },
  { re: /\bCOCO\b/i, name: "MS COCO" },
  { re: /\bGLUE\b/i, name: "GLUE benchmark" },
  { re: /\bSQuAD\s?1?\.?1?\b/i, name: "SQuAD" },
  { re: /\bWikiText-?(103|2)\b/i, name: "WikiText-103" },
  { re: /\bLibriSpeech\b/i, name: "LibriSpeech" },
  { re: /\bOpenWebText\b/i, name: "OpenWebText" },
  { re: /\bBookCorpus\b/i, name: "BookCorpus" },
  { re: /\bLAION\b/i, name: "LAION" },
];

function sentencesOf(text: string): { s: string; page: number }[] {
  const pages = text.split(/\f|\u000c/);
  const out: { s: string; page: number }[] = [];
  pages.forEach((pageText, pi) => {
    const normalized = pageText.replace(/\s+/g, " ");
    const parts = normalized.split(/(?<=[.!?])\s+(?=[A-Z(])/g);
    for (const s of parts) {
      const t = s.trim();
      if (t.length > 12) out.push({ s: t, page: pages.length > 1 ? pi + 1 : 1 });
    }
  });
  return out;
}

function num(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

export function extractClaimsHeuristic(
  text: string,
  paperId: string
): { claims: Claim[]; reportedMetrics: ReportedMetric[] } {
  const hits: RawHit[] = [];
  const sents = sentencesOf(text);
  const push = (h: RawHit) => {
    if (!hits.some((x) => x.path === h.path)) hits.push(h);
  };

  for (const { s: sentence, page } of sents) {
    // Optimizer
    const adam = sentence.match(
      /\bAdam(?:W)?\s+optimizer?\b.*?β\s*1?\s*=\s*([\d.]+).*?β\s*2?\s*=\s*([\d.]+)(?:.*?ε\s*=\s*([\d.e\-−]+))?/i
    );
    if (adam) {
      push({
        path: "optimizer.name",
        category: "optimizer",
        label: "Optimizer",
        value: /AdamW/i.test(adam[0]) ? "AdamW" : "Adam",
        unit: null,
        impact: "critical",
        sentence,
        page,
      });
      push({
        path: "optimizer.beta1",
        category: "optimizer",
        label: "Adam beta1",
        value: Number(adam[1]),
        unit: null,
        impact: "important",
        sentence,
        page,
      });
      push({
        path: "optimizer.beta2",
        category: "optimizer",
        label: "Adam beta2",
        value: Number(adam[2]),
        unit: null,
        impact: "important",
        sentence,
        page,
      });
      if (adam[3]) {
        push({
          path: "optimizer.epsilon",
          category: "optimizer",
          label: "Adam epsilon",
          value: Number(adam[3].replace("−", "-")),
          unit: null,
          impact: "informational",
          sentence,
          page,
        });
      }
    }
    const sgd = sentence.match(/\bSGD\b|\bstochastic gradient descent\b/i);
    if (sgd && !hits.some((h) => h.path === "optimizer.name")) {
      push({
        path: "optimizer.name",
        category: "optimizer",
        label: "Optimizer",
        value: "SGD",
        unit: null,
        impact: "critical",
        sentence,
        page,
      });
      const mom = sentence.match(/momentum(?:\s+of|\s*=)?\s*([\d.]+)/i);
      if (mom)
        push({
          path: "optimizer.momentum",
          category: "optimizer",
          label: "Momentum",
          value: Number(mom[1]),
          unit: null,
          impact: "important",
          sentence,
          page,
        });
    }

    // Learning rate — handles "learning rate of X", "was set to X", "= X", ": X"
    const lr = sentence.match(
      /learning\s+rate\s+(?:(?:is|was|set|fixed|of|to|at)\s+)*[:=]?\s*([\d.]+\s*(?:x|×)?\s*10\s*[-−^]\s*−?\d+|[\d.]+e\s*-?\d+|\d*\.?\d+)/i
    );
    if (lr) {
      let v: number | null = null;
      const sci = lr[1].match(/([\d.]+)\s*(?:x|×)?\s*10\s*[-−^]\s*(\d+)/i);
      if (sci) v = Number(sci[1]) * Math.pow(10, -Number(sci[2]));
      else if (/e/i.test(lr[1])) v = Number(lr[1]);
      else v = Number(lr[1]);
      if (v !== null && !Number.isNaN(v)) {
        push({
          path: "training.learning_rate",
          category: "training",
          label: "Learning rate",
          value: v,
          unit: null,
          impact: "critical",
          sentence,
          page,
          locator: null,
        });
      }
    }

    // Warmup — both "warmup_steps = 4000" and "4000 warmup steps" shapes
    const warm =
      sentence.match(/warm[_ ]?(?:up|-up)\s*_?(?:steps?|iterations?)?\s*(?:of|=|:|for)?\s*(?:the\s+first\s+)?([\d,]+)/i) ??
      sentence.match(/([\d,]+)\s+warm[_ ]?(?:up|-up)\s*(?:steps?|iterations?)?/i);
    if (warm) {
      push({
        path: "training.warmup_steps",
        category: "training",
        label: "LR warmup steps",
        value: num(warm[1]),
        unit: "steps",
        impact: "important",
        sentence,
        page,
      });
    }

    // Batch size
    const batch = sentence.match(
      /batch\s+size\s+(?:of|=|:)?\s*([\d,]+)|([\d,]+)\s*(?:sentences?|tokens?|examples?)\s+(?:per|each)\s+(?:batch|GPU)/i
    );
    if (batch) {
      const rawVal = batch[1] ?? batch[2];
      const tokenBased = /tokens?/i.test(batch[0]) || /sentences?/i.test(batch[0]);
      push({
        path: "training.batch_size",
        category: "training",
        label: tokenBased ? "Batch size (tokens)" : "Batch size",
        value: num(rawVal),
        unit: tokenBased ? "tokens" : "examples",
        impact: "critical",
        sentence,
        page,
      });
    }

    // Epochs / steps
    const epochs = sentence.match(
      /(?:trained|train|training)\s+(?:for\s+)?([\d,]+)\s+epochs?\b/i
    );
    if (epochs) {
      push({
        path: "training.epochs",
        category: "training",
        label: "Training epochs",
        value: num(epochs[1]),
        unit: "epochs",
        impact: "critical",
        sentence,
        page,
      });
    }
    const steps = sentence.match(
      /(?:for\s+)?([\d,]+)\s+(?:training\s+)?steps?\b/i
    );
    if (steps && Number(steps[1].replace(/,/g, "")) > 100) {
      push({
        path: "training.total_steps",
        category: "training",
        label: "Total training steps",
        value: num(steps[1]),
        unit: "steps",
        impact: "important",
        sentence,
        page,
      });
    }

    // Dropout
    const drop = sentence.match(
      /dropout(?:\s+(?:of|rate|to))?\s*[=:]?\s*(?:P_?drop\s*=\s*)?([\d.]+)/i
    );
    if (drop) {
      push({
        path: "training.dropout",
        category: "training",
        label: "Dropout rate",
        value: Number(drop[1]),
        unit: null,
        impact: "important",
        sentence,
        page,
      });
    }

    // Label smoothing
    const ls = sentence.match(/label\s+smoothing\s+(?:of|value|=|:)?\s*([\d.]+)/i);
    if (ls) {
      push({
        path: "loss.label_smoothing",
        category: "loss",
        label: "Label smoothing",
        value: Number(ls[1]),
        unit: null,
        impact: "important",
        sentence,
        page,
      });
    }

    // Weight decay
    const wd = sentence.match(/weight\s+decay\s+(?:of|=|:)?\s*([\d.e\-]+)/i);
    if (wd) {
      push({
        path: "training.weight_decay",
        category: "training",
        label: "Weight decay",
        value: Number(wd[1]),
        unit: null,
        impact: "important",
        sentence,
        page,
      });
    }

    // Seeds
    const seed = sentence.match(
      /(?:random\s+)?seeds?\s*(?:of|=|:|fixed\s+to)?\s*(\d{1,5}(?:\s*,\s*\d{1,5})*)/i
    );
    if (seed) {
      push({
        path: "training.seed",
        category: "training",
        label: "Random seed(s)",
        value: seed[1],
        unit: null,
        impact: "critical",
        sentence,
        page,
      });
    }

    // Layers / heads / dims
    const layers = sentence.match(
      /(?:stacked|use|uses|using|of|with|comprises?)?\s*(\d+)\s+(?:identical\s+)?(?:stacked\s+)?layers?\b/i
    );
    if (layers && Number(layers[1]) >= 2 && Number(layers[1]) <= 200) {
      push({
        path: "architecture.num_layers",
        category: "architecture",
        label: "Number of layers",
        value: Number(layers[1]),
        unit: "layers",
        impact: "critical",
        sentence,
        page,
      });
    }
    const heads = sentence.match(/(\d+)\s+(?:parallel\s+)?(?:attention\s+)?heads?\b/i);
    if (heads && Number(heads[1]) >= 1 && Number(heads[1]) <= 128) {
      push({
        path: "architecture.num_heads",
        category: "architecture",
        label: "Attention heads",
        value: Number(heads[1]),
        unit: "heads",
        impact: "important",
        sentence,
        page,
      });
    }
    const dmodel = sentence.match(
      /d_?model\s*=\s*(\d+)|hidden\s+(?:size|dimension)\s+(?:of|=)?\s*(\d+)/i
    );
    if (dmodel) {
      push({
        path: "architecture.d_model",
        category: "architecture",
        label: "Model dimension (d_model)",
        value: Number(dmodel[1] ?? dmodel[2]),
        unit: null,
        impact: "critical",
        sentence,
        page,
      });
    }
    const dff = sentence.match(/d_?ff\s*=\s*(\d+)/i);
    if (dff) {
      push({
        path: "architecture.d_ff",
        category: "architecture",
        label: "Feed-forward dimension (d_ff)",
        value: Number(dff[1]),
        unit: null,
        impact: "important",
        sentence,
        page,
      });
    }

    // Hardware
    const hw = sentence.match(
      /(\d+)\s*(?:x\s*)?(NVIDIA\s*)?(V100|A100|H100|P100|T4|TPU\S*|GTX\s*10\d0|RTX\s*\d{4})/i
    );
    if (hw) {
      push({
        path: "compute.accelerators",
        category: "compute",
        label: "Training hardware",
        value: `${hw[1]}x ${hw[3].toUpperCase()}`,
        unit: null,
        impact: "important",
        sentence,
        page,
      });
    }

    // Precision
    const prec = sentence.match(/\b(fp16|fp32|bf16|float16|float32|bfloat16|mixed precision)\b/i);
    if (prec) {
      const p = prec[1].toLowerCase();
      push({
        path: "environment.precision",
        category: "environment",
        label: "Numeric precision",
        value: p === "float16" ? "fp16" : p === "float32" ? "fp32" : p === "bfloat16" ? "bf16" : p,
        unit: null,
        impact: "important",
        sentence,
        page,
      });
    }

    // Loss names
    const lossNames: [RegExp, string][] = [
      [/\bcross[- ]?entropy\b/i, "cross-entropy"],
      [/\bfocal loss\b/i, "focal loss"],
      [/\bMSE\b|\bmean squared error\b/i, "MSE"],
      [/\bcontrastive loss\b/i, "contrastive loss"],
      [/\bKL divergence\b/i, "KL divergence"],
      [/\bhinge loss\b/i, "hinge loss"],
    ];
    for (const [re, name] of lossNames) {
      if (re.test(sentence)) {
        push({
          path: "loss.type",
          category: "loss",
          label: "Loss function",
          value: name,
          unit: null,
          impact: "critical",
          sentence,
          page,
        });
        break;
      }
    }

    // Datasets
    for (const ds of KNOWN_DATASETS) {
      if (ds.re.test(sentence)) {
        push({
          path: `dataset.${ds.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
          category: "dataset",
          label: `Dataset: ${ds.name}`,
          value: ds.name,
          unit: null,
          impact: "critical",
          sentence,
          page,
        });
        const pairCount = sentence.match(/([\d.]+)\s*(million|M)\s+sentence pairs/i);
        if (pairCount) {
          push({
            path: "dataset.size",
            category: "dataset",
            label: "Dataset size",
            value: `${pairCount[1]}M sentence pairs`,
            unit: null,
            impact: "important",
            sentence,
            page,
          });
        }
        break;
      }
    }

    // Beam search / eval protocol
    const beam = sentence.match(/beam\s+search\s+(?:with|of)?\s*(?:size|width)?\s*[=:]?\s*(\d+)/i);
    if (beam) {
      push({
        path: "evaluation.beam_size",
        category: "evaluation",
        label: "Beam size",
        value: Number(beam[1]),
        unit: null,
        impact: "important",
        sentence,
        page,
      });
    }
    const lenp = sentence.match(/length\s+(?:penalty|alpha)\s+[^.\d]*([\d.]+)/i);
    if (lenp) {
      push({
        path: "evaluation.length_penalty",
        category: "evaluation",
        label: "Length penalty (alpha)",
        value: Number(lenp[1]),
        unit: null,
        impact: "informational",
        sentence,
        page,
      });
    }
    // Checkpoint averaging
    const ckptAvg = sentence.match(/averag\w+\s+the\s+last\s+(\d+)\s+checkpoints?/i);
    if (ckptAvg) {
      push({
        path: "evaluation.checkpoint_averaging",
        category: "evaluation",
        label: "Checkpoint averaging",
        value: `last ${ckptAvg[1]} checkpoints`,
        unit: null,
        impact: "important",
        sentence,
        page,
      });
    }

    // BLEU-style metrics in sentences — try precise patterns before the loose one.
    const METRIC_RE = /\b(BLEU|accuracy|F1|mAP|top-1|top-5|perplexity|AUC)\b/i;
    let metricHit: { name: string; value: number } | null = null;
    const m0 = sentence.match(METRIC_RE);
    if (m0) {
      const name = m0[1].toUpperCase() === "BLEU" ? "BLEU" : m0[1].toLowerCase();
      const patterns: RegExp[] = [
        // "top-1 accuracy of 82.6" / "BLEU = 28.4" / "accuracy is 91.2"
        new RegExp(`${m0[1]}[^.\\d]{0,30}?(?:of|is|=|:|reaches|achieves|at)\\s*(\\d{1,2}\\.\\d{1,4})`, "i"),
        // "82.6 percent top-1 accuracy" / "82.6% BLEU" (value before the metric name)
        new RegExp(`(\\d{1,2}\\.\\d{1,4})\\s*(?:%|percent)[^.]{0,25}?${m0[1]}`, "i"),
        // generic: metric followed by a number that is NOT a delta ("by 1.9 points")
        new RegExp(`${m0[1]}[^.\\d]{0,40}?(\\d{1,2}\\.\\d{1,4})`, "i"),
      ];
      for (const re of patterns) {
        const mm = sentence.match(re);
        if (mm && mm[1]) {
          const before = sentence.slice(Math.max(0, (mm.index ?? 0) - 12), mm.index ?? 0).toLowerCase();
          if (re === patterns[2] && /\bby\s*$/.test(before)) continue; // skip improvement deltas
          metricHit = { name, value: Number(mm[1]) };
          break;
        }
      }
    }
    if (metricHit) {
      push({
        path: `metrics.${metricHit.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        category: "metrics",
        label: `Metric: ${metricHit.name}`,
        value: metricHit.value,
        unit: metricHit.name === "perplexity" ? null : metricHit.name === "BLEU" ? "BLEU" : "%",
        impact: "critical",
        sentence,
        page,
      });
    }
  }

  const claims: Claim[] = hits.map((h) => {
    const span: EvidenceSpan = {
      evidence_id: `ev_${shortHash(paperId + h.path + h.sentence, 12)}`,
      page: h.page ?? null,
      section: guessSection(h.sentence),
      locator: h.locator ?? null,
      text: h.sentence.slice(0, 400),
      anchor_validity: "weak",
    };
    return {
      claim_id: h.path,
      category: h.category,
      field_path: h.path,
      label: h.label,
      raw_value: typeof h.value === "number" ? String(h.value) : h.value ?? null,
      value: h.value,
      unit: h.unit,
      evidence_status: h.status ?? "reported",
      impact: h.impact,
      confidence: 0.72, // pattern-based extraction; evidence needs review
      review_status: "not_reviewed",
      notes: [],
      evidence: [span],
      revisions: [
        {
          value: h.value,
          evidence_status: h.status ?? "reported",
          actor: "extractor",
          at: new Date().toISOString(),
          reason: "heuristic pattern match",
        },
      ],
      extractor: "heuristic",
    };
  });

  // Reported metrics table (from metric hits)
  const reportedMetrics: ReportedMetric[] = hits
    .filter((h) => h.category === "metrics" && typeof h.value === "number")
    .map((h) => ({
      metric_id: `rm_${shortHash(paperId + h.path + String(h.value), 10)}`,
      name: h.label.replace("Metric: ", ""),
      value: h.value as number,
      unit: h.unit,
      dataset: null,
      split: null,
      direction: /perplexity|loss|error/i.test(h.label) ? "minimize" : "maximize",
      aggregation: "single run (assumed — verify in paper)",
      source: h.page ? `page ${h.page}` : "paper text",
      evidence: [
        {
          evidence_id: `ev_${shortHash(paperId + h.path + h.sentence, 12)}`,
          page: h.page ?? null,
          section: guessSection(h.sentence),
          locator: h.locator ?? null,
          text: h.sentence.slice(0, 400),
          anchor_validity: "weak",
        },
      ],
      variability: null,
    }));

  return { claims, reportedMetrics };
}

function guessSection(sentence: string): string {
  const s = sentence.toLowerCase();
  if (/optimi|adam|learning rate|warm/.test(s)) return "Training setup (inferred)";
  if (/dataset|pairs|corpus|wmt|imageNet/.test(s)) return "Data (inferred)";
  if (/layer|head|attention|dimension|transformer/.test(s)) return "Model (inferred)";
  if (/bleu|accuracy|f1|perplexity|result/.test(s)) return "Results (inferred)";
  if (/beam|checkpoint|evaluat/.test(s)) return "Evaluation (inferred)";
  return "Body text (inferred)";
}

/** Tiny structured JSONL run importer with tolerant field aliases (F13/F16). */
export function parseRunsJsonl(text: string): {
  runs: RunManifest[];
  errors: string[];
} {
  const runs: RunManifest[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  lines.forEach((line, i) => {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const metricsRaw = (obj.metrics ?? obj.metrics_list ?? []) as unknown[];
      let metrics: RunManifest["metrics"] = [];
      if (Array.isArray(metricsRaw)) {
        metrics = metricsRaw
          .map((m) => {
            const mm = m as Record<string, unknown>;
            if (typeof mm.name === "string" && typeof mm.value === "number") {
              return {
                name: mm.name,
                value: mm.value,
                split: (mm.split as string) ?? null,
                metric_version: (mm.metric_version as string) ?? null,
              };
            }
            return null;
          })
          .filter(Boolean) as RunManifest["metrics"];
      } else if (metricsRaw && typeof metricsRaw === "object") {
        metrics = Object.entries(metricsRaw as Record<string, unknown>)
          .filter(([, v]) => typeof v === "number")
          .map(([k, v]) => ({ name: k, value: v as number, split: null, metric_version: null }));
      }
      if (metrics.length === 0) {
        // flat style: {bleu: 27.9, seed: 42}
        metrics = Object.entries(obj)
          .filter(
            ([k, v]) =>
              typeof v === "number" &&
              /bleu|acc|f1|map|loss|perp|auc|score|metric|top/i.test(k) &&
              !/seed|step|epoch/i.test(k)
          )
          .map(([k, v]) => ({ name: k, value: v as number, split: null, metric_version: null }));
      }
      if (metrics.length === 0) {
        errors.push(`Line ${i + 1}: no usable metrics found.`);
        return;
      }
      runs.push({
        run_id: (obj.run_id as string) ?? `run_${shortHash(line, 8)}`,
        label: (obj.label as string) ?? null,
        paper_id: (obj.paper_id as string) ?? null,
        code_commit: (obj.code_commit as string) ?? (obj.commit as string) ?? null,
        config_hash: (obj.config_hash as string) ?? null,
        dataset_fingerprint: (obj.dataset_fingerprint as string) ?? null,
        seed: typeof obj.seed === "number" ? obj.seed : null,
        environment: (obj.environment as Record<string, string>) ?? {},
        hardware: (obj.hardware as Record<string, string>) ?? {},
        metrics,
        artifacts: (obj.artifacts as string[]) ?? [],
        started_at: (obj.started_at as string) ?? null,
        finished_at: (obj.finished_at as string) ?? null,
        source: obj.tracker === "mlflow" ? "mlflow" : "imported_jsonl",
      });
    } catch {
      errors.push(`Line ${i + 1}: invalid JSON.`);
    }
  });
  return { runs, errors };
}

/** Minimal CSV run importer: header row with metric columns + seed/commit columns. */
export function parseRunsCsv(text: string): { runs: RunManifest[]; errors: string[] } {
  const errors: string[] = [];
  const rows = text.split(/\r?\n/).filter((l) => l.trim());
  if (rows.length < 2) return { runs: [], errors: ["CSV needs a header row and at least one data row."] };
  const headers = rows[0].split(",").map((h) => h.trim().toLowerCase());
  const runs: RunManifest[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(",").map((c) => c.trim());
    if (cells.length !== headers.length) {
      errors.push(`Row ${i + 1}: column count mismatch.`);
      continue;
    }
    const rec: Record<string, string> = {};
    headers.forEach((h, j) => (rec[h] = cells[j]));
    const metrics: RunManifest["metrics"] = [];
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
      source: "imported_csv",
    });
  }
  return { runs, errors };
}
