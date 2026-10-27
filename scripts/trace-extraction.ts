/* Instrument the extractor on specific corpus texts to trace remaining misses. */
import { extractClaimsHeuristic } from "../src/lib/p2b/extract-heuristic";
import * as fs from "fs";

const checks: Array<[string, string[]]> = [
  ["1706.03762", ["metrics.bleu", "loss.label_smoothing"]],
  ["1905.11946", ["training.learning_rate"]],
  ["2010.11929", ["architecture.num_layers"]],
  ["1801.04381", ["training.weight_decay", "training.batch_size"]],
];

for (const [pid, paths] of checks) {
  const text = fs.readFileSync(`benchmark/corpus/${pid}.txt`, "utf-8");
  const { claims } = extractClaimsHeuristic(text, pid);
  console.log(`\n== ${pid} ==`);
  for (const p of paths) {
    const c = claims.find((x) => x.field_path === p);
    if (!c) {
      console.log(`  ${p}: NOT EXTRACTED`);
    } else {
      console.log(`  ${p}: value=${JSON.stringify(c.value)}`);
      console.log(`    evidence: ${c.evidence[0]?.text.slice(0, 180)}`);
    }
  }
}
