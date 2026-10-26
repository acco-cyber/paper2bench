import JSZip from "jszip";
import type { Project, GeneratedFile } from "./types";
import { runValidation, scanSecrets } from "./validation";
import { compareAll, REPRO_STATE_LABELS } from "./comparison";
import {
  EVIDENCE_STATUS_META,
  IMPACT_META,
  reviewedCriticalCount,
  unresolvedCriticalCount,
  conflictCount,
  shortHash,
} from "./semantics";
import { TEMPLATE_VERSION } from "./scaffold";

/**
 * F19 — Export and reproduction report. Produces a self-contained ZIP:
 * scaffold files + evidence JSON/CSV/MD + runs + validation + reproduction report.
 * Secret scan runs on every file before packaging; export is blocked on hits.
 */

export function evidenceToCsv(project: Project): string {
  const header = [
    "claim_id",
    "category",
    "value",
    "unit",
    "evidence_status",
    "impact",
    "confidence",
    "review_status",
    "source_page",
    "source_section",
    "source_text",
  ].join(",");
  const esc = (s: string | number | boolean | null) =>
    `"${String(s ?? "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  const rows = project.claims.map((c) => {
    const ev = c.evidence[0];
    return [
      c.claim_id,
      c.category,
      esc(c.value),
      esc(c.unit ?? ""),
      c.evidence_status,
      c.impact,
      c.confidence,
      c.review_status,
      ev?.page ?? "",
      esc(ev?.section ?? ""),
      esc(ev?.text ?? ""),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

export function evidenceToMarkdown(project: Project): string {
  const lines = [
    `# Evidence export — ${project.paper.title}`,
    "",
    `Source: ${project.paper.source_url} · version hash: \`${project.paper.source_version}\``,
    `Exported: ${new Date().toISOString()} · generator: paper2bench-web ${TEMPLATE_VERSION}`,
    "",
    "Statuses: " +
      Object.entries(EVIDENCE_STATUS_META)
        .map(([k, v]) => `**${k}** = ${v.definition}`)
        .join(" "),
    "",
    "| Claim | Value | Status | Impact | Review | Source |",
    "|---|---|---|---|---|---|",
  ];
  for (const c of project.claims) {
    const ev = c.evidence[0];
    lines.push(
      `| \`${c.field_path}\` | ${c.value === null ? "— unspecified —" : `\`${String(c.value)}\`${c.unit ? ` ${c.unit}` : ""}`} | ${c.evidence_status} | ${c.impact} | ${c.review_status} | ${ev ? `${ev.section ?? "?"}${ev.page ? ` p.${ev.page}` : ""}` : "—"} |`
    );
  }
  return lines.join("\n") + "\n";
}

export function buildReproductionReport(project: Project): string {
  const crit = reviewedCriticalCount(project.claims);
  const blockers = unresolvedCriticalCount(project.claims);
  const conflicts = conflictCount(project.claims);
  const coverage =
    project.claims.filter((c) => c.evidence.length > 0).length /
    Math.max(1, project.claims.filter((c) => c.value !== null).length);
  const cmp = compareAll(project);

  const lines: string[] = [
    `# Reproduction report — ${project.paper.title}`,
    "",
    `Generated: ${new Date().toISOString()} by Paper2Bench web (${TEMPLATE_VERSION}).`,
    `Source: ${project.paper.source_url} · content hash \`${project.paper.source_version}\` · retrieved ${project.paper.retrieved_at}.`,
    `Extraction scope: ${project.paper.extraction_scope}. Parser: ${project.coverage?.parser ?? "n/a"}.`,
    "",
    "## Review status",
    "",
    `- Critical claims reviewed: ${crit.reviewed}/${crit.total}`,
    `- Unresolved blockers: ${blockers}`,
    `- Unresolved conflicts: ${conflicts}`,
    `- Evidence coverage (populated claims with spans): ${(coverage * 100).toFixed(0)}%`,
    project.provisional
      ? "- **Project is PROVISIONAL: unresolved critical items exist and were explicitly accepted to proceed.**"
      : "- All critical claims reviewed before generation.",
    "",
    "## What was followed, deviated, and remains unverified",
    "",
  ];

  const corrected = project.claims.filter((c) => c.review_status === "corrected");
  if (corrected.length) {
    lines.push("### Human corrections applied");
    for (const c of corrected) {
      const last = c.revisions[c.revisions.length - 1];
      lines.push(
        `- \`${c.field_path}\`: now \`${String(c.value)}\` (${last?.reason ?? "user correction"}). Original extraction: ${c.revisions[0]?.value === null || c.revisions[0]?.value === undefined ? "*(unspecified/conflicting)*" : `\`${String(c.revisions[0].value)}\``}.`
      );
    }
  } else {
    lines.push("### Human corrections applied", "- none recorded");
  }
  lines.push("");

  const unspecified = project.claims.filter((c) => c.evidence_status === "unspecified" && c.impact !== "informational");
  lines.push("### Remains unverified / unknown");
  if (unspecified.length === 0) lines.push("- nothing critical — informational unknowns may still exist");
  for (const c of unspecified) {
    lines.push(`- \`${c.field_path}\` (${c.impact}): unspecified in inspected source${c.notes.length ? ` — notes: ${c.notes.join("; ")}` : ""}`);
  }
  lines.push("");

  lines.push("## Reported vs measured");
  lines.push("");
  if (!project.runs.length) {
    lines.push("No run manifests imported yet. Nothing is claimed about reproduction.");
  } else {
    lines.push("| Metric | Reported (source) | Run | Measured | Abs Δ | Rel Δ | Assessment |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const r of cmp) {
      lines.push(
        `| ${r.metric} | ${r.reported} (${r.reportedSource}) | ${r.run_id ?? "—"}${r.is_example_run ? " *(example)*" : ""} | ${r.measured ?? "—"} | ${r.abs_delta ?? "—"} | ${r.rel_delta_meaningful && r.rel_delta !== null ? `${(r.rel_delta * 100).toFixed(1)}%` : "n/a"} | ${r.run_id ? REPRO_STATE_LABELS[r.suggested_state] : "Not run"} |`
      );
    }
    lines.push("");
    lines.push(
      "> Absolute difference is the default. Relative difference is shown only where the reported baseline is positive and nonzero; it is meaningless for zero/signed metrics."
    );
    lines.push("");
    const mismatches = cmp.flatMap((r) => r.mismatches.map((m) => `- **${r.metric}${r.run_id ? ` / ${r.run_id}` : ""}**: ${m}`));
    lines.push("### Protocol mismatches", "");
    if (mismatches.length) lines.push(...mismatches);
    else lines.push("- none detected");
  }
  lines.push("");

  const val = project.validation;
  lines.push("## Validation summary");
  lines.push("");
  if (!val) {
    lines.push("Validation has not been run in this session.");
  } else {
    for (const c of val.checks) {
      lines.push(`- **${c.result.toUpperCase()}** — ${c.name}: ${c.detail}`);
    }
  }
  lines.push("");
  lines.push("## Limitations of this report");
  lines.push("");
  lines.push(
    "- Extraction can verify that a value appears supported by source text; it cannot prove the paper itself is correct.",
    "- A scaffold passing smoke tests can still fail scientific replication.",
    "- A close metric match can be coincidental when protocols differ — check the mismatch list above.",
    "- Compute estimates are ranges from documented heuristics, never measurements."
  );
  return lines.join("\n") + "\n";
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  secretHits: { name: string; sample: string }[];
}

export async function exportProjectZip(project: Project): Promise<ExportResult> {
  const zip = new JSZip();
  const files: GeneratedFile[] = project.scaffold?.files ?? [];

  for (const f of files) zip.file(`paper2bench-project/${f.path}`, f.content);

  // Evidence
  zip.file("paper2bench-project/evidence/claims_export.json", JSON.stringify(project.claims, null, 2));
  zip.file("paper2bench-project/evidence/claims_export.csv", evidenceToCsv(project));
  zip.file("paper2bench-project/evidence/evidence_export.md", evidenceToMarkdown(project));
  zip.file(
    "paper2bench-project/evidence/reported_metrics.json",
    JSON.stringify(project.reported_metrics, null, 2)
  );

  // Runs
  zip.file(
    "paper2bench-project/runs/runs.jsonl",
    project.runs.map((r) => JSON.stringify(r)).join("\n") + (project.runs.length ? "\n" : "")
  );

  // Validation + assessment
  const checks = project.validation?.checks ?? runValidation(project);
  zip.file(
    "paper2bench-project/reports/validation_report.md",
    `# Validation report\n\nRan: ${project.validation?.ran_at ?? "not run in session"}\n\n` +
      checks
        .map((c) => `- **${c.result.toUpperCase()}** ${c.name}\n  - ${c.detail}\n  - Proves: ${c.proves}\n  - Does NOT prove: ${c.does_not_prove}`)
        .join("\n") +
      "\n"
  );

  // Reproduction report
  zip.file("paper2bench-project/reports/reproduction_report.md", buildReproductionReport(project));

  // Full project snapshot (machine-readable)
  zip.file(
    "paper2bench-project/paper2bench_project.json",
    JSON.stringify(
      { export_version: TEMPLATE_VERSION, exported_at: new Date().toISOString(), project },
      null,
      2
    )
  );

  // Secret scan across all text
  let allText = "";
  for (const f of files) allText += f.content + "\n";
  allText += JSON.stringify(project.claims) + JSON.stringify(project.runs);
  const secretHits = scanSecrets(allText);

  if (secretHits.length) {
    // Block export — caller shows the error.
    throw new Error(
      `SECRET SCAN FAILED: export blocked. Detected ${secretHits.map((h) => h.name).join(", ")}. Remove the secret and retry.`
    );
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const filename = `paper2bench_${shortHash(project.id, 8)}_${new Date().toISOString().slice(0, 10)}.zip`;
  return { blob, filename, secretHits: [] };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, mime = "text/plain") {
  downloadBlob(new Blob([text], { type: mime }), filename);
}
