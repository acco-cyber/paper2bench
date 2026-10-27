/**
 * Paper2Bench CLI — inspect, validate, compare and generate outside the UI.
 *
 *   paper2bench inspect   <project.json>            summarize evidence + readiness
 *   paper2bench validate  <project.json>            honest validation checks
 *   paper2bench compare   <project.json> --runs f   reported vs measured table
 *   paper2bench create    <project.json> --out dir  generate the experiment scaffold
 *
 * Input is a project JSON as exported by the app (bare project object or the
 * {export_version, project} workspace-export wrapper). The CLI reuses the exact
 * same pure modules as the web app — no logic duplication.
 */
import * as fs from "fs";
import * as path from "path";
import type { Project } from "../../src/lib/p2b/types";
import { readinessScore } from "../../src/lib/p2b/insights";
import { runValidation, scanSecrets } from "../../src/lib/p2b/validation";
import { compareAll } from "../../src/lib/p2b/comparison";
import { buildConfigFromClaims, generateScaffoldFiles, TEMPLATE_VERSION } from "../../src/lib/p2b/scaffold";
import { parseRunsJsonl, parseRunsCsv } from "../../src/lib/p2b/extract-heuristic";

function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(2);
}

function loadProject(file: string): Project {
  if (!fs.existsSync(file)) die(`file not found: ${file}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (e) {
    die(`not valid JSON: ${(e as Error).message.slice(0, 120)}`);
  }
  const p =
    raw && typeof raw === "object" && "project" in (raw as Record<string, unknown>)
      ? (raw as { project: Project }).project
      : (raw as Project);
  if (!p || typeof p !== "object" || !Array.isArray((p as Project).claims) || typeof (p as Project).paper !== "object") {
    die("not a Paper2Bench project (needs .paper and .claims) — export from the app first");
  }
  return p;
}

function loadRuns(file: string) {
  if (!fs.existsSync(file)) die(`runs file not found: ${file}`);
  const text = fs.readFileSync(file, "utf-8");
  const isCsv = file.toLowerCase().endsWith(".csv");
  const parsed = isCsv ? parseRunsCsv(text) : parseRunsJsonl(text);
  for (const e of parsed.errors.slice(0, 5)) console.error(`warn: ${e}`);
  if (parsed.runs.length === 0) die("no runs could be imported from the file");
  return parsed.runs;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

function cmdInspect(file: string): void {
  const p = loadProject(file);
  const score = readinessScore(p);
  console.log(`Paper2Bench — ${p.paper.title || p.paper.id || p.id}`);
  console.log("");
  console.log(`  claims:            ${p.claims.length} (${p.claims.filter((c) => c.evidence_status === "conflict").length} conflicts, ${p.claims.filter((c) => c.evidence_status === "unspecified").length} unspecified)`);
  console.log(`  review:            ${p.claims.filter((c) => c.review_status === "accepted").length} accepted / ${p.claims.filter((c) => c.review_status === "not_reviewed").length} pending`);
  console.log(`  plan tasks:        ${p.tasks.length} (${p.tasks.filter((t) => t.status === "done").length} done)`);
  console.log(`  scaffold files:    ${p.scaffold?.files.length ?? 0}`);
  console.log(`  runs imported:     ${p.runs.length}`);
  console.log(`  reported metrics:  ${p.reported_metrics.length}`);
  console.log("");
  console.log(`  readiness: ${score.total}/100 — ${score.verdict_label}`);
  for (const sub of score.subs) {
    console.log(`    ${pad(sub.label, 10)} ${String(sub.score).padStart(3)}/100`);
  }
  if (score.recommendations.length > 0) {
    console.log("");
    console.log("  next actions:");
    for (const r of score.recommendations) console.log(`    - ${r.label} (${r.view})`);
  }
}

function cmdValidate(file: string): void {
  const p = loadProject(file);
  const checks = runValidation(p);
  const passed = checks.filter((c) => c.result === "pass").length;
  const blocked = checks.filter((c) => c.result === "blocked").length;
  const failed = checks.filter((c) => c.result === "fail").length;
  for (const c of checks) {
    const mark = c.result === "pass" ? "PASS" : c.result === "blocked" ? "BLKD" : "FAIL";
    console.log(`  [${mark}] ${c.name} (${c.group})`);
    if (c.detail) console.log(`         ${c.detail}`);
    if (c.does_not_prove) console.log(`         does not prove: ${c.does_not_prove}`);
  }
  console.log("");
  console.log(`${passed} passed, ${failed} failed, ${blocked} blocked (blocked != failed — see docs/limitations)`);
  let secrets = 0;
  for (const f of p.scaffold?.files ?? []) secrets += scanSecrets(f.content).length;
  if (secrets > 0) {
    console.error(`SECRET SCAN: ${secrets} potential credential(s) found in scaffold files`);
    process.exit(1);
  }
  process.exit(failed > 0 ? 1 : 0);
}

function cmdCompare(file: string, runsFile: string | null): void {
  let p = loadProject(file);
  if (runsFile) {
    p = { ...p, runs: loadRuns(runsFile) };
  }
  if (p.runs.length === 0) die("no runs in the project — pass --runs <runs.jsonl|csv>");
  const rows = compareAll(p);
  if (rows.length === 0) {
    console.log("no (metric, run) pairs matched — check metric names on both sides");
    return;
  }
  console.log(pad("metric", 14) + pad("reported", 11) + pad("measured", 11) + pad("rel-delta", 11) + pad("protocol", 12) + "notes");
  for (const r of rows) {
    const rel = r.rel_delta != null ? `${r.rel_delta > 0 ? "+" : ""}${(r.rel_delta * 100).toFixed(1)}%` : "—";
    const notes = [r.runLabel, ...r.mismatches].filter(Boolean).join("; ");
    console.log(
      pad(r.metric, 14) +
        pad(String(r.reported ?? "—"), 11) +
        pad(String(r.measured ?? "—"), 11) +
        pad(rel, 11) +
        pad(r.mismatches.length === 0 ? "match" : "MISMATCH", 12) +
        notes
    );
  }
  console.log("");
  console.log("Auto-awarding criteria_passed is forbidden: a human decides whether deltas reproduce the claim.");
}

function cmdCreate(file: string, outDir: string, framework: string, scope: string): void {
  const p = loadProject(file);
  const fw: "pytorch" | "huggingface" = framework === "huggingface" ? "huggingface" : "pytorch";
  const sc: "full" | "minimal" = scope === "minimal" ? "minimal" : "full";
  const { config, todos } = buildConfigFromClaims(p.claims, fw);
  const files = generateScaffoldFiles(p.paper, p.claims, p.reported_metrics, p.tasks, config, todos, sc);
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const dest = path.join(outDir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.content);
  }
  console.log(`wrote ${files.length} files to ${outDir} (${fw}, ${sc} scope, ${todos.length} explicit TODO(p2b) items)`);
  console.log("unknowns are explicit nulls with provenance comments — decide, document, re-generate.");
  console.log("generated code is never executed by Paper2Bench; see scripts/validate-scaffolds.ts for what is verified.");
}

function usage(): never {
  console.log(`paper2bench ${TEMPLATE_VERSION} — from paper to an inspectable reproduction

usage:
  paper2bench inspect   <project.json>
  paper2bench validate  <project.json>
  paper2bench compare   <project.json> --runs <runs.jsonl|csv>
  paper2bench create    <project.json> --out <dir> [--framework pytorch|huggingface] [--scope full|minimal]

project.json is an app export (bare project or {export_version, project} wrapper).`);
  process.exit(0);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") usage();
  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(TEMPLATE_VERSION);
    return;
  }
  const cmd = argv[0];
  const flag = (name: string): string | null => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
  };
  const valueFlags = new Set(["--runs", "--out", "--framework", "--scope"]);
  const positional = argv.filter((a, i) => i > 0 && !a.startsWith("--") && !valueFlags.has(argv[i - 1]));
  const file = positional[0];

  switch (cmd) {
    case "inspect":
      if (!file) die("inspect needs a project.json path");
      cmdInspect(file);
      break;
    case "validate":
      if (!file) die("validate needs a project.json path");
      cmdValidate(file);
      break;
    case "compare":
      if (!file) die("compare needs a project.json path");
      cmdCompare(file, flag("--runs"));
      break;
    case "create": {
      if (!file) die("create needs a project.json path");
      const out = flag("--out") ?? "./p2b-scaffold";
      cmdCreate(file, out, flag("--framework") ?? "pytorch", flag("--scope") ?? "full");
      break;
    }
    default:
      die(`unknown command: ${cmd} (try --help)`);
  }
}

main();
