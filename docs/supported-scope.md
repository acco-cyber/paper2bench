# Supported scope (v0.1)

## Good fit

- Supervised computer vision (classification, detection-style single-model
  experiments with standard datasets).
- Standard NLP / Transformer training (encoder-decoder, fine-tuning, seq2seq).
- Papers with conventional training loops (Adam/AdamW/SGD families, warmup +
  decay schedules, single- or few-device runs).

## Supported non-failure states

Reproduction work is not binary. The product models:

- **not applicable** — field does not apply to this contribution.
- **data unavailable** — dataset referenced but not obtainable; ledger records
  access state and licence honestly.
- **partial reproduction** — some protocol elements checked.
- **verification blocked** — missing credentials, hardware, or proprietary
  infrastructure; documented, not hidden.

## Poor fit (for scaffold generation)

- Pure theory / surveys / position papers (ledger still useful; scaffold is not).
- RL environments with non-trivial rollout semantics (planned later).
- Distributed-training-specific claims (multi-node topologies, sharding).
- Papers whose primary contribution is non-code (humanities-style analysis).

## Known extractor limitations

- Two-column PDFs parse in reading-order heuristic; complex tables are counted
  but not structured.
- Equations are detected, not parsed. Loss terms are captured by name, not
  symbolic form.
- Scanned/image-only PDFs are detected and refused with guidance (no OCR in
  browser build).
- Metric extraction handles common names (BLEU, accuracy, F1, mAP, top-1/5,
  perplexity, AUC); exotic metrics may be missed — fixtures welcome.
