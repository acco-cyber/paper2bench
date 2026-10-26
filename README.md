# Paper2Bench

**Turn an ML paper into an evidence-backed, inspectable experiment.**

Paper2Bench is an evidence-first research engineering workspace. Give it an arXiv link, a DOI, or a paper PDF — it extracts a structured record of the paper's method, data, training setup, loss, metrics and reported results; links every claim to its source; keeps what is *known, inferred, missing or conflicting* visibly separate; generates a deterministic project scaffold; and records what you actually ran — apart from what the paper claims.

> **The one-sentence promise:** from paper to an inspectable reproduction plan and experiment repository, without hiding what is known, inferred, missing, or actually reproduced.

---

## Why it exists

- Paper prose is not a machine-readable experiment specification; seemingly minor details change results.
- Generated code can look convincing while silently inventing preprocessing, seeds, data splits or hyperparameters.
- Training success does not establish scientific reproduction if the dataset, metric, or split differs.
- Researchers rebuild the same project structure, checklists and comparison tables by hand, every time.

Paper2Bench answers these with a **claim ledger** (one atomic fact per claim, each with a source span), **honest status semantics**, a **deterministic scaffold generator**, and a **run-provenance-aware comparison** that never awards "reproduced" automatically.

## What's new in v2.0

| Feature | What you get |
|---|---|
| **Reproduction readiness score** | Deterministic, auditable 0–100 score with four sub-scores (Evidence / Plan / Build / Verify). Every deduction is listed with the exact reason and a one-click fix target — process completeness, never scientific success. |
| **Command palette (⌘K / Ctrl+K)** | One surface for navigation, cross-project search, claim/task/run lookup and every power action. Keyboard-first. |
| **Projects dashboard** | Local library of all projects with search, sort (recent / title / readiness), pin, archive, duplicate and delete-with-confirm. Workspace aggregates included. |
| **Keyboard shortcuts** | `⌘K` palette, `?` reference dialog, `Alt+1…9` direct view jumps. Every view reachable without the mouse. |
| **Project switcher** | Switch projects from the header with per-project readiness, or jump to the library. |
| **Workspace backup & restore** | Single restore-compatible JSON of all projects + settings. Import is structurally validated — corrupt payloads are refused with an explanation, never silently merged. |
| **Pre-project settings access** | Privacy decisions happen before ingestion — Settings is reachable with zero projects. |
| **PWA manifest** | Installable as a standalone app. |

## Feature map

| Area | What you get |
|---|---|
| **Ingestion** | arXiv URL / DOI / local PDF. Strict allow-list (arxiv.org, doi.org). Re-ingesting the same source detects identical vs changed content. No arbitrary URL fetching. |
| **Workspace** | Multi-project library with readiness scores, archive/pin/duplicate, workspace aggregates, command palette, keyboard shortcuts, backup/restore. Local-first, no account. |
| **Parsing** | Local, in-browser PDF text extraction (pdf.js) with page mapping, section/table/equation counts, image-only page detection, and a coverage report. |
| **Claim extraction** | Deterministic heuristic extractor (works fully offline) plus optional LLM-assisted extraction (explicit opt-in). Absent fields stay `unspecified` — never fabricated. |
| **Evidence ledger** | Filter/search/review every claim; every populated claim carries a source span with page/section. Bulk-accept is restricted to low-risk claims. |
| **Review & conflicts** | Correct values with revision history; resolve conflicts by choosing a source; conflicts stay visible until explicitly resolved. |
| **Reproduction plan** | Dependency-aware task queue (data → env → model → loss → training → eval → comparison → report) with acceptance criteria and claim references. Scope presets: smoke / main / full. |
| **Dataset audit** | Access-state ladder (mentioned → linked → verified → downloaded → fingerprinted → preprocessed), licence honesty (unknown ≠ permissive), leakage-hazard checks. Gated data is never downloaded automatically. |
| **Compute estimate** | Memory / runtime / storage **ranges** from a versioned documented formula, with token-vs-example batch semantics, assumptions, and missing-input lists. Never labelled as measured. |
| **Scaffold generator** | Deterministic PyTorch and Hugging Face Trainer templates: configs with provenance comments, src modules, tests, scripts, evidence map, reproduction plan/risks, README. Regeneration is byte-identical; user edits are backed up, never silently overwritten. |
| **Validation** | Config/schema, provenance integrity, imports, seed handling, dependency pinning, test presence, data-access state. Executable checks are reported as **blocked** (with local instructions) — never silently skipped or faked. |
| **Runs & comparison** | Import JSONL/CSV/MLflow-style manifests. Reported vs measured with absolute deltas (relative only when meaningful), protocol-mismatch panel, and honest state labels. `criteria_passed` requires explicit human confirmation. |
| **Sweep analytics** | Metric curves from imported history, run-comparison table (CSV export), best-run card under declared rules, discrepancy panel. Every chart has a data-table alternative. |
| **Export** | Self-contained ZIP: scaffold + evidence (JSON/CSV/MD) + reported metrics + run manifests + validation + reproduction report + machine-readable project snapshot. Secret scan blocks export on detected credentials. |
| **Privacy** | Local-first: PDF parsing happens in your browser, projects live in `localStorage`. Remote LLM extraction requires explicit opt-in. No account, no telemetry. |

## Screenshots

The UI ships in **brown & black** with full **dark and light modes**.

| Dark (default) | Light |
|---|---|
| Deep brown-black canvas, caramel primary | Warm paper white, coffee-brown primary |

## Quick start

```bash
# requirements: Node.js 20+ (or Bun 1.1+)
npm install
npm run dev          # http://localhost:3000
```

Then click **“Load guided example (no network needed)”** — a curated fixture for
*Attention Is All You Need* (Vaswani et al., 2017) with a genuine conflict
(residual dropout: §5.4 says 0.1, Table 2 lists P_drop 0.3 for the big variant)
and unspecified fields, so every review/resolution mechanism can be exercised
honestly. Two example runs are pre-loaded (clearly labelled **EXAMPLE — not real
executions**).

### Production build

```bash
npm run build
npm start
```

### Docker (Hugging Face Spaces / any container host)

```bash
docker build -t paper2bench .
docker run -p 7860:7860 paper2bench
```

## Honesty rules (non-negotiable)

These are enforced in code and in the UI copy:

1. `null` in generated configs means *the paper does not specify it*. Decide, document, re-generate.
2. `reported` claims link to the paper location. Confidence scores never promote a claim to reported.
3. Reported metrics and your measured runs live in separate panels and separate files.
4. `Reproduction criteria passed` is a human decision with an explicit confirmation checkbox — never automatic.
5. Executable validation checks are `blocked` in hosted mode (the app never executes generated code), with local instructions attached.
6. Compute estimates are ranges with documented assumptions — never "measured".
7. Exports carry unresolved-blocker warnings; provisional projects are labelled provisional.

## Extraction engines

| Engine | Where it runs | Notes |
|---|---|---|
| **Heuristic** (default) | Browser, offline | Deterministic pattern extraction: optimizer, LR, schedule, batch (incl. token-vs-example), epochs/steps, dropout, smoothing, weight decay, seeds, layers/heads/dims, hardware, precision, losses, datasets, beam/checkpoint policy, headline metrics. Every hit carries the matched sentence as evidence. |
| **LLM** (opt-in) | Server (provider) | Strict evidence-first prompt: unsupported values must be returned `unspecified`; every value needs a verbatim supporting quote; conflicting sources must both be surfaced. Falls back to heuristic automatically if the provider is unreachable. |

## API surface (thin, local-first)

| Endpoint | Purpose |
|---|---|
| `POST /api/ingest` | Metadata lookup for allow-listed sources (arXiv export API, Crossref). Constructed URLs only — never user-supplied fetch targets. |
| `POST /api/extract` | LLM-assisted claim extraction (requires explicit opt-in; graceful fallback). |
| `GET /api/health` | Capability probe (used by Settings). |

All other state is client-side (`localStorage`) by design: local-first artifacts remain useful without a hosted backend.

## Generated project layout

```
paper2bench-project/
  paper/                 metadata.json, source_manifest.json
  evidence/              claims.json, evidence_map.md, reported_metrics.json
  reports/               reproduction_plan.md, reproduction_risks.md,
                         compute_estimate.md, validation_report.md, reproduction_report.md
  configs/default.yaml   # every value: "# P2B: source=<claim> status=<status> page=<n>"
  src/                   data.py, model.py, losses.py, train.py, evaluate.py
  tests/                 test_config.py, test_metrics.py, test_smoke.py
  scripts/               prepare_data.sh (licence-gated), run_experiment.sh
  requirements.txt       pinned
  README.md
```

## CLI contract (reference)

```
paper2bench create <paper-url-or-file> --output ./experiment
paper2bench inspect ./experiment
paper2bench validate ./experiment
paper2bench plan ./experiment --scope main-results
paper2bench estimate ./experiment --hardware auto
paper2bench compare ./experiment --runs ./runs.jsonl
paper2bench export ./experiment --format zip
```

The web app is the reference implementation; the CLI wraps the same core contracts (schema, statuses, semantics). Every command must be idempotent, provide `--json` output, and never destroy user files silently.

## Supported scope (v0.1)

**In scope:** supervised CV and standard NLP / Transformer workflows; classification and sequence modelling.

**Explicitly supported states** (not failures): *not applicable*, *data unavailable*, *partial reproduction*, *verification blocked*. Pure theory, surveys, and papers with proprietary infrastructure may not need a training scaffold — the ledger still captures what is known.

**Out of scope for v0.1:** RL, distributed training semantics, JAX/TF templates, autonomous code-writing agents, cloud GPU orchestration, automatic gated-dataset downloads.

## Security & privacy

- **SSRF policy:** only arxiv.org/doi.org metadata lookups via constructed URLs; private-network hosts rejected client- and server-side.
- **No code execution:** ingestion and validation never execute paper-derived or generated code.
- **Secret hygiene:** exports are scanned (GitHub/HF/OpenAI-style tokens, AWS keys, private keys, bearer headers) and blocked on hits; settings export contains no credentials.
- **Privacy modes:** Local-only (default) vs Remote extraction (explicit opt-in with disclosure). Deletion reports what is local.

See [SECURITY.md](SECURITY.md) to report vulnerabilities.

## Testing

```bash
bun run scripts/verify-core.ts    # 102-assertion core-logic suite:
                                  # ingestion policy, extraction patterns, run importers,
                                  # scaffold determinism, validation honesty, comparison rules,
                                  # compute estimator, secret scan, conflict provenance,
                                  # readiness scoring, workspace organization, backup integrity
bun run lint                      # ESLint (Next.js + TypeScript)
```

## Contributing

Contributions welcome — parsers, fixtures, templates, domain adapters, docs. See [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues are labelled `good-first-issue`; regression fixtures from real failures are the most valuable contributions.

## Citation

See [CITATION.cff](CITATION.cff).

## License

MIT — see [LICENSE](LICENSE).
