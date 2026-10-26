# Architecture

## Design principle

**Schema + provenance first.** UI, templates, validation, and comparison are
thin clients over one data model. A beautiful dashboard on top of unreliable
run records only makes wrong information look authoritative — so the evidence
semantics stabilize before anything consumes them.

## Layer map

```
Input adapters      arXiv / DOI / PDF  →  PaperMeta (immutable identity + content hash)
Parsing adapters    pdf.js (local) / metadata-only  →  ParseArtifact + coverage
Extraction service  text windows → candidate claims → schema validation
Evidence validator  claims × spans  →  anchor validity (verified / weak)
Planning service    reviewed claims → task plan, dataset audit, compute assumptions
Template engine     reviewed spec + config → deterministic files (P2B provenance comments)
Validation service  string/static checks → honest pass / warning / blocked / skipped
Run ingestion       JSONL / CSV / MLflow-ish → RunManifest records
Assessment service  reported × measured × protocol → comparison + human-confirmed states
UI                  single-surface client app over the same store
```

## Data model (src/lib/p2b/types.ts)

Core entities: `PaperMeta`, `ParseCoverage`, `Claim` (with `EvidenceSpan[]`,
`ClaimRevision[]`), `ReportedMetric`, `RunManifest`, `ProtocolTask`,
`DatasetRecord`, `ComputeEstimate`, `GeneratedFile`, `ValidationCheck`,
`ReproductionAssessment`.

**Evidence statuses are a closed set:** `reported | derived | inferred |
unspecified | conflicting | user_confirmed | not_applicable`. Only `reported`
counts as source-reported, and only with a valid span. Confidence never
promotes a claim.

## State & persistence

- Zustand store, persisted to `localStorage` (`paper2bench-store-v1`).
- Every mutation appends an `ActivityEvent` — the audit trail shown on Overview.
- Claim edits create revisions (old value, new value, actor, reason, time) and
  mark downstream artifacts stale.
- No server-side project storage in v0.1: local-first keeps the privacy story
  simple and the export portable.

## Extraction pipeline stages

resolve → parse → segment → extract → verify anchors → schema validate →
prepare workspace. Progress reflects real completed stages. Re-ingesting the
same source content-hash short-circuits to the existing project (identity
check). Immutable parse attempts; notes survive retries.

## Determinism contract

`generateScaffoldFiles(paper, claims, reported, tasks, config, todos, scope)`
is pure. `configs/default.yaml` carries `# P2B: source=<claim_path>
status=<status> page=<n>` comments; unknowns are `null` + `TODO(p2b)`.
Regeneration with unchanged claims is byte-identical (covered by tests).

## Security boundaries

- Client: strict input normalization (allow-list hosts, private-range blocks).
- Server: `/api/ingest` and `/api/extract` accept only normalized identifiers
  and constructed URLs; `/api/extract` treats paper text strictly as data.
- Export: secret scan on all packaged text; blocked on detection.
