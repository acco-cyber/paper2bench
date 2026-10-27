/**
 * Paper2Bench Reproducibility Benchmark — extraction accuracy measurement.
 *
 * Methodology (see benchmark/README.md):
 *  - Corpus: real arXiv papers (benchmark/corpus, fetched by fetch_corpus.py).
 *  - Ground truth: hand-annotated reference claims (benchmark/annotations)
 *    whose must_contain strings are text-verified by validate_corpus.py.
 *  - The heuristic extractor runs on the raw corpus text exactly as the app
 *    would run it — no fixture cleanup, no special-casing.
 *
 * Metrics per paper and aggregate:
 *  - correct        reference matched by field_path AND value within tolerance
 *  - wrong_value    reference path extracted, but value differs
 *  - missing        reference not extracted at all
 *  - precision      correct / (correct + wrong_value)      [of referenced paths]
 *  - recall         correct / references
 *  - evidence_ok    of correct claims: fraction whose cited evidence text
 *                   actually contains the ground-truth value context
 *
 * Usage:  npx tsx scripts/benchmark-extraction.ts [--save]
 */
import * as fs from "fs";
import * as path from "path";
import { extractClaimsHeuristic } from "../src/lib/p2b/extract-heuristic";

const ROOT = path.resolve(__dirname, "..");
const CORPUS = path.join(ROOT, "benchmark", "corpus");
const ANN = path.join(ROOT, "benchmark", "annotations");

interface Reference {
  field_path: string;
  value?: number | string;
  value_variants?: (number | string)[];
  must_contain: string[];
  hint?: string;
}
interface AnnotationFile {
  paper_id: string;
  title: string;
  references: Reference[];
}
interface RefResult {
  field_path: string;
  ref: Reference;
  status: "correct" | "wrong_value" | "missing";
  extracted_value: number | string | boolean | null | undefined;
  evidence_ok: boolean | null;
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function valuesMatch(ref: Reference, extracted: unknown): boolean {
  const candidates = ref.value_variants ?? (ref.value !== undefined ? [ref.value] : []);
  if (candidates.length === 0) return false;
  for (const c of candidates) {
    if (typeof c === "number" && typeof extracted === "number") {
      const tol = Math.max(Math.abs(c) * 1e-6, 1e-12);
      if (Math.abs(extracted - c) <= tol) return true;
    } else if (typeof c === "string" && typeof extracted === "string") {
      if (c.toLowerCase() === extracted.toLowerCase()) return true;
    } else if (typeof c === "number" && typeof extracted === "string") {
      // Structured string values like "8x P100" carry the number as a prefix.
      const n = Number.parseFloat(extracted);
      if (Number.isFinite(n)) {
        const tol = Math.max(Math.abs(c) * 1e-6, 1e-12);
        if (Math.abs(n - c) <= tol) return true;
      }
    } else if (String(c) === String(extracted)) {
      return true;
    }
  }
  return false;
}

function evidenceContains(evidenceText: string, mustContain: string[]): boolean {
  const ev = normalizeText(evidenceText);
  return mustContain.some((mc) => ev.includes(normalizeText(mc)));
}

function runForPaper(ann: AnnotationFile): { results: RefResult[]; totalClaims: number } {
  const textPath = path.join(CORPUS, `${ann.paper_id}.txt`);
  const text = fs.readFileSync(textPath, "utf-8");
  const { claims } = extractClaimsHeuristic(text, ann.paper_id);
  const byPath = new Map(claims.map((c) => [c.field_path, c]));

  const results: RefResult[] = ann.references.map((ref) => {
    const claim = byPath.get(ref.field_path);
    if (!claim) {
      return { field_path: ref.field_path, ref, status: "missing", extracted_value: null, evidence_ok: null };
    }
    const ok = valuesMatch(ref, claim.value);
    if (!ok) {
      return {
        field_path: ref.field_path,
        ref,
        status: "wrong_value",
        extracted_value: claim.value,
        evidence_ok: null,
      };
    }
    const evText = claim.evidence?.[0]?.text ?? "";
    return {
      field_path: ref.field_path,
      ref,
      status: "correct",
      extracted_value: claim.value,
      evidence_ok: evText ? evidenceContains(evText, ref.must_contain) : false,
    };
  });
  return { results, totalClaims: claims.length };
}

function fmtPct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`;
}

function main(): number {
  const files = fs.readdirSync(ANN).filter((f) => f.endsWith(".json")).sort();
  const perPaper: Array<{
    paper_id: string;
    title: string;
    refs: number;
    correct: number;
    wrong_value: number;
    missing: number;
    evidence_ok: number;
    total_claims: number;
  }> = [];

  let refsTotal = 0, correctTotal = 0, wrongTotal = 0, missingTotal = 0, evTotal = 0, claimsTotal = 0;
  const details: Record<string, unknown> = {};

  for (const f of files) {
    const ann: AnnotationFile = JSON.parse(fs.readFileSync(path.join(ANN, f), "utf-8"));
    const { results, totalClaims } = runForPaper(ann);
    const correct = results.filter((r) => r.status === "correct");
    const wrong = results.filter((r) => r.status === "wrong_value");
    const missing = results.filter((r) => r.status === "missing");
    const evOk = correct.filter((r) => r.evidence_ok === true).length;
    perPaper.push({
      paper_id: ann.paper_id,
      title: ann.title,
      refs: results.length,
      correct: correct.length,
      wrong_value: wrong.length,
      missing: missing.length,
      evidence_ok: evOk,
      total_claims: totalClaims,
    });
    details[ann.paper_id] = results.map((r) => ({
      field_path: r.field_path,
      status: r.status,
      expected: r.ref.value_variants ?? r.ref.value,
      extracted: r.extracted_value,
      evidence_ok: r.evidence_ok,
    }));
    refsTotal += results.length;
    correctTotal += correct.length;
    wrongTotal += wrong.length;
    missingTotal += missing.length;
    evTotal += evOk;
    claimsTotal += totalClaims;
  }

  // ---------- console report ----------
  console.log("Paper2Bench Reproducibility Benchmark — heuristic extraction accuracy\n");
  console.log(
    "paper".padEnd(12) + "refs".padEnd(6) + "correct".padEnd(9) + "wrong".padEnd(7) +
    "missing".padEnd(9) + "evid-ok".padEnd(9) + "P".padEnd(8) + "R".padEnd(8) + "title"
  );
  for (const p of perPaper) {
    console.log(
      p.paper_id.padEnd(12) +
      String(p.refs).padEnd(6) +
      String(p.correct).padEnd(9) +
      String(p.wrong_value).padEnd(7) +
      String(p.missing).padEnd(9) +
      String(p.evidence_ok).padEnd(9) +
      fmtPct(p.correct, p.correct + p.wrong_value).padEnd(8) +
      fmtPct(p.correct, p.refs).padEnd(8) +
      p.title.slice(0, 46)
    );
  }
  console.log("-".repeat(110));
  console.log(
    "TOTAL".padEnd(12) +
    String(refsTotal).padEnd(6) +
    String(correctTotal).padEnd(9) +
    String(wrongTotal).padEnd(7) +
    String(missingTotal).padEnd(9) +
    String(evTotal).padEnd(9) +
    fmtPct(correctTotal, correctTotal + wrongTotal).padEnd(8) +
    fmtPct(correctTotal, refsTotal).padEnd(8) +
    `${claimsTotal} raw claims extracted`
  );
  console.log("\nDefinitions: P = correct / (correct + wrong_value) over referenced paths;");
  console.log("R = correct / references; evid-ok = correct claims whose cited evidence contains the value context.");

  if (process.argv.includes("--save")) {
    const out = {
      benchmark: "paper2bench-extraction-v1",
      generated_at: new Date().toISOString(),
      corpus_papers: perPaper.length,
      totals: {
        references: refsTotal,
        correct: correctTotal,
        wrong_value: wrongTotal,
        missing: missingTotal,
        evidence_ok: evTotal,
        precision: correctTotal + wrongTotal > 0 ? Number((correctTotal / (correctTotal + wrongTotal)).toFixed(4)) : null,
        recall: refsTotal > 0 ? Number((correctTotal / refsTotal).toFixed(4)) : null,
        evidence_rate: correctTotal > 0 ? Number((evTotal / correctTotal).toFixed(4)) : null,
        raw_claims_extracted: claimsTotal,
      },
      per_paper: perPaper,
      details,
    };
    const outPath = path.join(ROOT, "benchmark", "results.json");
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(`\nSaved: benchmark/results.json`);
  }
  return 0;
}

main();
