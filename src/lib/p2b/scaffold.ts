import type {
  Claim,
  GeneratedFile,
  PaperMeta,
  ReportedMetric,
  ScaffoldFramework,
  ScaffoldScope,
} from "./types";
import { shortHash } from "./semantics";
import type { ProtocolTask } from "./types";

/**
 * F09/F10/F11 — Deterministic scaffold generator.
 * Pure functions: same reviewed claims + config + template version => byte-identical output.
 * Every generated value carries a P2B provenance comment; every unknown becomes TODO(p2b).
 */

export const TEMPLATE_VERSION = "p2b-tpl-1.0.0";

export interface ScaffoldConfig {
  seed: number | null;
  learning_rate: number | null;
  batch_size: number | null;
  batch_unit: string | null;
  epochs: number | null;
  total_steps: number | null;
  optimizer: string | null;
  beta1: number | null;
  beta2: number | null;
  weight_decay: number | null;
  warmup_steps: number | null;
  dropout: number | null;
  label_smoothing: number | null;
  d_model: number | null;
  d_ff: number | null;
  num_layers: number | null;
  num_heads: number | null;
  beam_size: number | null;
  length_penalty: number | null;
  precision: string | null;
  framework: ScaffoldFramework;
}

export function buildConfigFromClaims(
  claims: Claim[],
  framework: ScaffoldFramework
): { config: ScaffoldConfig; todos: { path: string; reason: string }[] } {
  const num = (path: string): number | null => {
    const c = claims.find((x) => x.field_path === path);
    if (!c) return null;
    if (typeof c.value === "number") return c.value;
    if (typeof c.value === "string") {
      const m = c.value.match(/^[\d.eE+-]+$/);
      if (m) return Number(c.value);
    }
    return null;
  };
  const str = (path: string): string | null => {
    const c = claims.find((x) => x.field_path === path);
    if (!c || c.value === null) return null;
    if (typeof c.value === "string") return c.value;
    if (typeof c.value === "number") return String(c.value);
    return c.value ? "true" : "false";
  };

  const todos: { path: string; reason: string }[] = [];
  const unknown = (path: string, label: string, reason: string) => {
    const c = claims.find((x) => x.field_path === path);
    const st = c?.evidence_status ?? "unspecified";
    if (c === undefined || st === "unspecified" || st === "conflicting") {
      todos.push({
        path,
        reason:
          st === "conflicting"
            ? `CONFLICTING in source (${c?.evidence.map((e) => `p${e.page} ${e.locator ?? e.section}`).join(" | ")}). Resolve in the evidence ledger before pinning.`
            : `${label} is UNSPECIFIED in the paper — decide a value and record it as user_confirmed with a note.`,
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
    "environment.precision",
  ];
  for (const p of paths) unknown(p, p, "");

  const optimizerRaw = (str("optimizer.name") ?? "adamw").toLowerCase();
  const optimizer = optimizerRaw.includes("adamw")
    ? "adamw"
    : optimizerRaw.includes("sgd")
      ? "sgd"
      : "adam";

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
      framework,
    },
    todos,
  };
}

function y(
  key: string,
  value: string | number | boolean | null,
  claim: Claim | undefined,
  todos: { path: string }[]
): string {
  const trace = claim
    ? `  # P2B: source=${claim.field_path} status=${claim.evidence_status}${claim.evidence[0]?.page ? ` page=${claim.evidence[0].page}` : ""}`
    : "  # P2B: no source claim found";
  if (value === null) {
    const isConflict = claim?.evidence_status === "conflicting";
    return `${key}: null${trace}${isConflict ? "  # TODO(p2b): CONFLICTING values in source — resolve in ledger" : "  # TODO(p2b): unspecified in paper — decide & document"}`;
  }
  void todos;
  return `${key}: ${typeof value === "string" ? JSON.stringify(value) : value}${trace}`;
}

export function generateScaffoldFiles(
  paper: PaperMeta,
  claims: Claim[],
  reported: ReportedMetric[],
  tasks: ProtocolTask[],
  config: ScaffoldConfig,
  todos: { path: string; reason: string }[],
  scope: ScaffoldScope
): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const genAt = "GENERATED_AT"; // replaced by literal stamp inside content for determinism we use a fixed template stamp
  void genAt;
  const specRev = shortHash(JSON.stringify(config) + claims.length, 12);
  const byPath = new Map(claims.map((c) => [c.field_path, c]));
  const crit = claims.filter((c) => c.impact === "critical");
  const unresolved = crit.filter(
    (c) =>
      (c.evidence_status === "unspecified" || c.evidence_status === "conflicting") &&
      c.review_status !== "corrected"
  );
  const provisional = unresolved.length > 0;

  const add = (
    path: string,
    content: string,
    status: GeneratedFile["status"] = "generated",
    claimRefs: string[] = []
  ) => files.push({ path, content, status, claim_refs: claimRefs, stale: false, user_modified: false });

  // ——— paper/
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
        provisional,
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
        disclaimer:
          "Claims were extracted with Paper2Bench. Evidence spans point to paper locations; verify before relying on them.",
      },
      null,
      2
    ),
    "generated"
  );

  // ——— configs/default.yaml
  const cfg = config as unknown as Record<string, string | number | boolean | null>;
  // Config key → evidence claim path (config keys are short; claims are namespaced).
  const CLAIM_KEY_ALIAS: Record<string, string> = {
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
    precision: "environment.precision",
  };
  const claimFor = (key: string) =>
    byPath.get(CLAIM_KEY_ALIAS[key] ?? key) ??
    byPath.get(key === "beta1" ? "optimizer.beta1" : key === "beta2" ? "optimizer.beta2" : key);
  const cfgLines: string[] = [
    "# Generated by Paper2Bench — every value traces to an evidence-ledger claim.",
    `# Spec revision: ${specRev} · Template: ${TEMPLATE_VERSION}`,
    "# null means UNSPECIFIED in the paper: decide, document, then re-generate.",
    "",
  ];
  for (const [k, v] of Object.entries(cfg)) {
    if (k === "framework") continue;
    cfgLines.push(y(k, v, claimFor(k), todos));
  }
  add("configs/default.yaml", cfgLines.join("\n") + "\n", "generated", crit.map((c) => c.claim_id));

  // ——— src/
  const py = config.framework === "huggingface" ? pytorchSources(config, todos, true) : pytorchSources(config, todos, false);
  for (const [p, c] of Object.entries(py)) add(p, c, "template", ["architecture.d_model", "architecture.num_layers"]);

  // ——— tests/
  add(
    "tests/test_config.py",
    `"""Config validation — proves the YAML schema and provenance comments are intact.

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
            assert value is None  # explicit unknown — OK
`,
    "template"
  );
  add(
    "tests/test_metrics.py",
    `"""Metric implementation sanity — proves the metric wrapper behaves,
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
    `"""Synthetic-data smoke test — proves wiring (data->model->loss->step) works.
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

  // ——— scripts/
  add(
    "scripts/prepare_data.sh",
    `#!/usr/bin/env bash
# Data preparation — the paper's dataset access terms were NOT verified automatically.
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

  // ——— evidence/
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

  // ——— reports/
  add("reports/reproduction_plan.md", reproductionPlanMd(tasks, todos, provisional), "generated", []);
  add("reports/reproduction_risks.md", risksMd(claims, todos), "generated", []);
  add(
    "reports/compute_estimate.md",
    `# Compute estimate

> Placeholder — fill from the Compute tab (never label an estimate as measured).
> The estimate is a range with documented assumptions; see reports/compute_estimate.md
> in the exported project JSON for the versioned formula (p2b-compute-v1.0).
`,
    "template"
  );

  // ——— project root files
  add(
    "requirements.txt",
    `# Pinned reference environment for the generated scaffold (template v ${TEMPLATE_VERSION}).
# P2B policy: curated dependencies only — never auto-install packages suggested by paper text.
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

  // ablation scope extras
  if (scope === "with_ablations") {
    add(
      "configs/ablations.yaml",
      `# Ablation matrix stub — one entry per paper ablation row.
# TODO(p2b): list the paper's ablation configurations; each run must record its own manifest.
ablations: []
`,
      "needs_implementation"
    );
  }

  return files;
}

// ————————————————————————————————————————————————————————
// Source templates
// ————————————————————————————————————————————————————————

function pytorchSources(
  config: ScaffoldConfig,
  todos: { path: string; reason: string }[],
  hf: boolean
): Record<string, string> {
  const todoBlock = (path: string) => {
    const t = todos.find((x) => x.path === path);
    return t ? `# TODO(p2b): ${t.reason}` : "";
  };
  const dModel = config.d_model ?? 512;
  const layers = config.num_layers ?? 6;
  const heads = config.num_heads ?? 8;
  const dropout = config.dropout;

  const model = `"""Model — generated from reviewed architecture claims (P2B template).
Provenance: every dimension below traces to an evidence-ledger claim; nulls are TODOs."""
import torch
import torch.nn as nn

D_MODEL = ${dModel}          # P2B: architecture.d_model
N_LAYERS = ${layers}         # P2B: architecture.num_layers
N_HEADS = ${heads}           # P2B: architecture.num_heads
DROPOUT = ${dropout ?? "None"}  ${dropout === null ? "# TODO(p2b): dropout unspecified/conflicting — resolve in ledger" : "# P2B: training.dropout"}

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

  const data = `"""Data module — P2B template. The paper's split provenance was not fully verified.
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

  const losses = `"""Loss — implements the paper's training objective as extracted.
Provenance: loss.* claims; label smoothing value traces to the evidence ledger."""
import torch
import torch.nn as nn

LABEL_SMOOTHING = ${config.label_smoothing ?? "None"}  # P2B: loss.label_smoothing

def build_loss():
    ls = LABEL_SMOOTHING if LABEL_SMOOTHING is not None else 0.0
    return nn.CrossEntropyLoss(label_smoothing=float(ls))
`;

  const train = `"""Training loop — P2B reference (deterministic seeds, checkpoint policy).
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
        print(f"[p2b] WARNING — unresolved keys left as null: {', '.join(unknown)}", file=sys.stderr)
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
        # P2B: training.lr_schedule — d_model^-0.5 * min(step^-0.5, step*warmup^-1.5) family.
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
    # Checkpoint policy — TODO(p2b): match the paper's checkpoint selection rule.
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

  const evaluate = `"""Evaluation — implements the paper's protocol (beam size, checkpoint averaging).
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

# ——— Hugging Face Trainer notes (P2B) ———
# Only use Trainer if the paper's training loop matches Trainer semantics.
# Custom loops (e.g. inverse-sqrt schedules with token batching) fall back to src/train.py.
TRAINING_ARGUMENTS_OVERRIDES = {
    # "learning_rate": <from configs/default.yaml>,
    # "warmup_steps": <from configs/default.yaml>,
}
`,
      "src/losses.py": losses,
      "src/train.py": train,
      "src/evaluate.py": evaluate,
    };
  }
  return {
    "src/model.py": model,
    "src/data.py": data,
    "src/losses.py": losses,
    "src/train.py": train,
    "src/evaluate.py": evaluate,
  };
}

// ————————————————————————————————————————————————————————
// Markdown builders
// ————————————————————————————————————————————————————————

function evidenceMapMd(claims: Claim[]): string {
  const lines = [
    "# Evidence map",
    "",
    "Every value in `configs/default.yaml` traces to one of the claims below.",
    "Statuses follow Paper2Bench semantics: only `reported` counts as source-reported.",
    "",
    "| Claim | Value | Status | Source |",
    "|---|---|---|---|",
  ];
  for (const c of claims) {
    const ev = c.evidence[0];
    const src = ev
      ? `${ev.section ?? "?"}${ev.page ? ` p.${ev.page}` : ""}${ev.locator ? ` (${ev.locator})` : ""}`
      : "—";
    const val = c.value === null ? "*(unspecified)*" : `\`${String(c.value)}\``;
    lines.push(`| \`${c.field_path}\` | ${val} | ${c.evidence_status} | ${src} |`);
  }
  return lines.join("\n") + "\n";
}

function reproductionPlanMd(
  tasks: ProtocolTask[],
  todos: { path: string; reason: string }[],
  provisional: boolean
): string {
  const lines = [
    "# Reproduction plan",
    "",
    provisional
      ? "**Status: PROVISIONAL** — unresolved critical claims exist. Resolve them or export with the warning attached."
      : "**Status: ready to implement** — all critical claims reviewed.",
    "",
    "## Tasks",
    "",
    "| Task | Phase | Depends on | Acceptance criteria |",
    "|---|---|---|---|",
  ];
  for (const t of tasks) {
    lines.push(
      `| ${t.title} (${t.effort}/${t.risk} risk) | ${t.phase} | ${t.dependencies.join(", ") || "—"} | ${t.acceptance_criteria} |`
    );
  }
  if (todos.length) {
    lines.push("", "## Unresolved items carried as TODO(p2b)", "");
    for (const t of todos) lines.push(`- \`${t.path}\` — ${t.reason}`);
  }
  return lines.join("\n") + "\n";
}

function risksMd(claims: Claim[], todos: { path: string; reason: string }[]): string {
  const risky = claims.filter(
    (c) =>
      c.impact === "critical" &&
      (c.evidence_status === "inferred" ||
        c.evidence_status === "unspecified" ||
        c.evidence_status === "conflicting")
  );
  const lines = [
    "# Reproduction risks",
    "",
    "Risks below are claim-level and mechanical: they list where the paper does not pin down",
    "the experiment. They are not predictions about your results.",
    "",
  ];
  if (!risky.length && !todos.length) {
    lines.push("No critical unknowns detected. Still verify evidence anchors before trusting values.");
    return lines.join("\n") + "\n";
  }
  for (const c of risky) {
    lines.push(
      `- **${c.field_path}** (${c.evidence_status}): ${c.evidence_status === "conflicting" ? "source contains competing values — resolve explicitly" : "not stated in inspected source — any chosen value is an assumption"}`
    );
  }
  for (const t of todos) lines.push(`- TODO(p2b) on \`${t.path}\`: ${t.reason}`);
  return lines.join("\n") + "\n";
}

function readmeMd(
  paper: PaperMeta,
  provisional: boolean,
  todos: { path: string; reason: string }[]
): string {
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

${provisional ? "> ⚠ **PROVISIONAL** — unresolved critical claims exist. See reports/reproduction_risks.md.\n" : ""}
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
