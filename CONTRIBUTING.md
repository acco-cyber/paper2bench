# Contributing to Paper2Bench

Thanks for helping make ML reproduction more honest. This project values
**correctness of claims over volume of features**: a smaller, truthful ledger
beats a rich fabricated one.

## Ways to contribute

1. **Extraction fixtures** — take a paper the extractor handles badly, add a
   redacted/minimal fixture plus expected claims. Regression fixtures from real
   failures are the most valuable contributions.
2. **Heuristic patterns** — new optimizer/schedule/dataset/metric patterns with
   tests. Every pattern must attach the matched sentence as evidence.
3. **Scaffold templates** — improvements to the PyTorch / Hugging Face
   templates. Templates must stay deterministic: same inputs → byte-identical
   output.
4. **Domain adapters** — extend coverage (vision, NLP, speech). Add fixtures
   first, patterns second.
5. **Docs** — clarify supported scope, privacy notes, and known limitations.

## Ground rules

- **No fabricated values.** If the paper does not state it, the claim stays
  `unspecified`. This is enforced in review.
- **Every value needs a source span.** Patterns must capture the sentence.
- **Status semantics are fixed** (see `src/lib/p2b/types.ts` and the blueprint
  section in README): `reported`, `derived`, `inferred`, `unspecified`,
  `conflicting`, `user_confirmed`, `not_applicable`. Do not add statuses that
  blur these.
- **Never portray skipped checks as passed.** Executable checks are `blocked`
  with local instructions.
- **Determinism:** generators must be pure functions of their inputs.

## Development setup

```bash
npm install        # or bun install
npm run dev        # dev server on :3000
bun run scripts/verify-core.ts   # core-logic suite (must pass)
bun run lint                     # ESLint (must pass)
```

## Pull requests

1. Fork, create a branch (`feat/...` or `fix/...`).
2. Add/adjust tests for your change (the core suite or a new fixture).
3. Run the full suite and lint.
4. Describe *what the extraction/generation now does differently* and include a
   before/after example when touching extractors or templates.
5. Keep PRs focused; one behaviour change per PR.

## Reporting extraction failures

Open an issue with:

- Paper identifier (arXiv id/DOI) or the uploaded fixture,
- expected claims vs extracted claims,
- the coverage report output,
- whether the failure is a *miss*, a *wrong value*, or a *wrong status*.

## Code of conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
