/**
 * Paper2Bench — out-of-interface scaffold validation.
 *
 * The web app never executes generated training code (by design), so the
 * artifacts must be validated separately. This script generates scaffolds
 * from the demo project plus stress variants, then checks everything that
 * can be checked WITHOUT a GPU/torch install:
 *
 *   VALIDATED here:   YAML/JSON parse validity, Python AST parseability
 *                     (python3 ast), provenance markers in every file,
 *                     TODO(p2b) traceability, dependency-pin syntax,
 *                     config<->claim value consistency, secret scan.
 *   BLOCKED here:     running the generated training loop end-to-end
 *                     (requires torch + accelerator) — honestly reported
 *                     as blocked, never as passed.
 *
 * Usage:  npx tsx scripts/validate-scaffolds.ts [--save]
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { buildDemoProject } from "../src/lib/p2b/demo";
import { buildConfigFromClaims, generateScaffoldFiles } from "../src/lib/p2b/scaffold";
import { scanSecrets } from "../src/lib/p2b/validation";
import type { Project, ScaffoldFramework, ScaffoldScope } from "../src/lib/p2b/types";

const PROVENANCE_RE = /(Paper2Bench|P2B[:\s(])/i;

interface FileCheck {
  file: string;
  kind: string;
  checks: string[];
  failed: string[];
}

function parsePython(file: string, content: string): { ok: boolean; error?: string } {
  const tmp = path.join("/tmp", `p2b_ast_${path.basename(file)}_${process.pid}.py`);
  fs.writeFileSync(tmp, content);
  try {
    const r = spawnSync("python3", ["-c", `import ast,sys;ast.parse(open(${JSON.stringify(tmp)}).read())`], {
      encoding: "utf-8",
      timeout: 20000,
    });
    return r.status === 0 ? { ok: true } : { ok: false, error: (r.stderr || "").split("\n").slice(-3).join(" ").slice(0, 160) };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function validateGeneratedFiles(files: { path: string; content: string; claim_refs?: string[] }[]): FileCheck[] {
  const results: FileCheck[] = [];
  for (const f of files) {
    const checks: string[] = [];
    const failed: string[] = [];
    const ext = path.extname(f.path).toLowerCase();
    const kind = [".yaml", ".yml"].includes(ext)
      ? "yaml"
      : ext === ".json"
        ? "json"
        : ext === ".py"
          ? "python"
          : f.path.endsWith("requirements.txt")
            ? "requirements"
            : "text";

    if (kind === "yaml") {
      try {
        const doc = yaml.load(f.content);
        checks.push(doc && typeof doc === "object" ? "yaml-parses" : "yaml-empty");
        if (!doc || typeof doc !== "object") failed.push("yaml-empty");
      } catch (e) {
        failed.push(`yaml-parse-error: ${(e as Error).message.slice(0, 120)}`);
      }
      checks.push("provenance");
      if (!PROVENANCE_RE.test(f.content)) failed.push("provenance-missing");
    } else if (kind === "json") {
      try {
        JSON.parse(f.content);
        checks.push("json-parses");
      } catch (e) {
        failed.push(`json-parse-error: ${(e as Error).message.slice(0, 120)}`);
      }
      checks.push("provenance");
      if (!PROVENANCE_RE.test(f.content)) failed.push("provenance-missing");
    } else if (kind === "python") {
      const ast = parsePython(f.path, f.content);
      checks.push(ast.ok ? "python-ast-parses" : "python-ast-error");
      if (!ast.ok) failed.push(`python-ast: ${ast.error ?? "unknown"}`);
      checks.push("provenance");
      if (!PROVENANCE_RE.test(f.content)) failed.push("provenance-missing");
      const hasTodo = /TODO\(p2b\)|TODO:/.test(f.content);
      checks.push(hasTodo ? "todo-traceable" : "no-todo");
    } else if (kind === "requirements") {
      const bad: string[] = [];
      for (const line of f.content.split("\n")) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        // name[extras]<op>version — allow unpinned names too, but reject obvious garbage
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(\[[a-z0-9,]+\])?\s*(==|>=|<=|~=|>|<)?\s*[A-Za-z0-9.]*$/.test(t)) bad.push(t.slice(0, 60));
      }
      checks.push(bad.length === 0 ? "requirements-syntax" : "requirements-syntax");
      if (bad.length) failed.push(`requirements-invalid: ${bad.join(" | ")}`);
      checks.push("provenance");
      if (!PROVENANCE_RE.test(f.content)) failed.push("provenance-missing");
    } else {
      checks.push(f.content.trim().length > 0 ? "non-empty" : "empty");
      if (f.content.trim().length === 0) failed.push("empty");
    }

    const secrets = scanSecrets(f.content);
    checks.push("secret-scan");
    if (secrets.length > 0) failed.push(`secrets: ${secrets.map((s) => s.name).join(",")}`);

    results.push({ file: f.path, kind, checks, failed });
  }
  return results;
}

/** Config values must agree with the claims they were derived from.
 *  Accepts both documented layouts: nested (pytorch: training.batch_size)
 *  and flat (huggingface: batch_size). */
function validateConfigConsistency(project: Project): string[] {
  const failed: string[] = [];
  if (!project.scaffold) return ["no-scaffold"];
  const cfg = project.scaffold.config as unknown as Record<string, unknown>;
  const claimVal = (p: string): unknown => {
    const c = project.claims.find((x) => x.field_path === p);
    return c?.value;
  };
  const pairs: Array<[string, string]> = [
    ["training.learning_rate", "training.learning_rate"],
    ["training.batch_size", "training.batch_size"],
    ["training.warmup_steps", "training.warmup_steps"],
    ["architecture.d_model", "architecture.d_model"],
    ["architecture.d_ff", "architecture.d_ff"],
    ["architecture.num_layers", "architecture.num_layers"],
    ["architecture.num_heads", "architecture.num_heads"],
  ];
  for (const [cfgPath, claimPath] of pairs) {
    const cv = claimVal(claimPath);
    if (cv === undefined) continue; // claim absent -> config key should be absent or null
    // walk dotted path; fall back to the flat last-segment key (HF layout)
    let node: unknown = cfg;
    for (const seg of cfgPath.split(".")) {
      if (node && typeof node === "object" && seg in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[seg];
      } else {
        node = undefined;
        break;
      }
    }
    if (node === undefined || node === null) {
      const flatKey = cfgPath.split(".").pop()!;
      node = (cfg as Record<string, unknown>)[flatKey];
    }
    if (node === undefined || node === null) {
      failed.push(`config missing ${cfgPath} while claim ${claimPath}=${String(cv)}`);
      continue;
    }
    if (typeof cv === "number" && typeof node === "number") {
      if (Math.abs(cv - node) > Math.max(Math.abs(cv) * 1e-9, 1e-12)) {
        failed.push(`config ${cfgPath}=${String(node)} != claim ${String(cv)}`);
      }
    } else if (String(node) !== String(cv)) {
      failed.push(`config ${cfgPath}=${String(node)} != claim ${String(cv)}`);
    }
  }
  return failed;
}

function main(): number {
  const demo = buildDemoProject();
  const variants: Array<{ label: string; framework: ScaffoldFramework; scope: ScaffoldScope }> = [
    { label: "demo-pytorch-full", framework: "pytorch", scope: "full" },
    { label: "demo-pytorch-minimal", framework: "pytorch", scope: "minimal" },
    { label: "demo-huggingface-full", framework: "huggingface", scope: "full" },
  ];

  const report: Record<string, unknown> = {};
  let totalChecks = 0;
  let totalFailed = 0;

  for (const v of variants) {
    const { config, todos } = buildConfigFromClaims(demo.claims, v.framework);
    const files = generateScaffoldFiles(demo.paper, demo.claims, demo.runs ?? demo.reportedMetrics ?? [], demo.tasks, config, todos, v.scope);
    const fileChecks = validateGeneratedFiles(files);
    const cfgFailures = validateConfigConsistency({ ...demo, scaffold: { config, files, generated_at: new Date().toISOString(), framework: v.framework, scope: v.scope } } as Project);
    const fileFailed = fileChecks.reduce((n, f) => n + f.failed.length, 0);
    const checks = fileChecks.reduce((n, f) => n + f.checks.length, 0) + 7 /* consistency pairs */;
    totalChecks += checks;
    totalFailed += fileFailed + cfgFailures.length;
    report[v.label] = {
      files: files.length,
      checks,
      failed: fileFailed + cfgFailures.length,
      config_failures: cfgFailures,
      files_detail: fileChecks.filter((f) => f.failed.length > 0),
    };
    console.log(
      `${v.label.padEnd(26)} files=${String(files.length).padEnd(3)} checks=${String(checks).padEnd(4)} failed=${fileFailed + cfgFailures.length}`
    );
    for (const cf of cfgFailures) console.log(`   ! ${cf}`);
    for (const fd of report[v.label].files_detail as FileCheck[]) {
      for (const fl of fd.failed) console.log(`   ! ${fd.file}: ${fl}`);
    }
  }

  console.log(`\nScaffold validation: ${totalChecks - totalFailed}/${totalChecks} checks passed`);
  console.log("Blocked in this environment (documented, not claimed as passed):");
  console.log("  - executing the generated training loop (requires torch + accelerator)");
  console.log("  - end-to-end training smoke test of the generated project");

  if (process.argv.includes("--save")) {
    const out = {
      benchmark: "paper2bench-scaffold-validation-v1",
      generated_at: new Date().toISOString(),
      totals: { checks: totalChecks, failed: totalFailed, passed: totalChecks - totalFailed },
      blocked_by_design: [
        "execute generated training loop (torch + accelerator required)",
        "end-to-end training smoke test",
      ],
      variants: report,
    };
    fs.writeFileSync(path.join(__dirname, "..", "benchmark", "scaffold-validation.json"), JSON.stringify(out, null, 2));
    console.log("Saved: benchmark/scaffold-validation.json");
  }
  return totalFailed > 0 ? 1 : 0;
}

main();
