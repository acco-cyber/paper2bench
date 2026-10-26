"use client";

import type { Claim, PaperMeta, ParseCoverage, Project, ReportedMetric } from "./types";
import { normalizePaperInput, contentHash, IngestError } from "./ingest";
import { extractClaimsHeuristic } from "./extract-heuristic";
import { shortHash } from "./semantics";
import { useP2B } from "./store";

/**
 * End-to-end client pipeline with real staged progress (blueprint §4.2):
 * resolve → parse → segment → extract → verify → schema → prepare.
 * PDF parsing is fully local (pdf.js). Remote metadata lookup only for
 * arXiv/DOI and only when the user opted in via input choice.
 */

export interface PipelineInput {
  kind: "url" | "pdf";
  urlText?: string;
  file?: File;
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
async function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist");
    const pdfjs = await pdfjsPromise;
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  return pdfjsPromise;
}

export interface PdfParseResult {
  text: string;
  pages: number;
  sections: string[];
  tables: number;
  equations: number;
  imageOnlyPages: number[];
}

export async function parsePdfLocally(file: File): Promise<PdfParseResult> {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pageTexts: string[] = [];
  const imageOnlyPages: number[] = [];
  let sections: string[] = [];
  let tables = 0;
  let equations = 0;

  const maxPages = Math.min(doc.numPages, 60); // resource cap: 60 pages
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const items = tc.items as { str?: string; transform?: number[] }[];
    // sort by y (desc) then x for reading order
    const withPos = items
      .filter((it) => typeof it.str === "string")
      .map((it) => ({ s: it.str as string, y: it.transform?.[5] ?? 0, x: it.transform?.[4] ?? 0 }));
    withPos.sort((a, b) => (Math.abs(a.y - b.y) > 2 ? b.y - a.y : a.x - b.x));
    const text = withPos.map((it) => it.s).join(" ").replace(/\s+/g, " ").trim();
    pageTexts.push(text);
    if (text.length < 40) imageOnlyPages.push(i);
    if (/Table\s+\d+/i.test(text)) tables++;
    if (/=|\u2211|arg\s?min|arg\s?max|\\frac/i.test(text)) equations++;
    // heading heuristic
    const headings = text.match(/(?:^|\s)(\d{1,2}(?:\.\d{1,2})*)\s+([A-Z][A-Za-z\s\-:]{3,60})(?=\s\d|$)/g);
    if (headings) {
      sections = sections.concat(
        headings.map((h) => h.trim()).filter((h) => h.length < 80).slice(0, 6)
      );
    }
  }
  sections = Array.from(new Set(sections)).slice(0, 24);
  return {
    text: pageTexts.join("\f"),
    pages: doc.numPages,
    sections,
    tables,
    equations,
    imageOnlyPages,
  };
}

export interface MetadataResult {
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  venue: string | null;
}

/** Server-side metadata fetch for arXiv/DOI (allow-listed hosts only). */
export async function fetchRemoteMetadata(
  normalized: ReturnType<typeof normalizePaperInput>
): Promise<MetadataResult> {
  try {
    const res = await fetch("/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: normalized.kind, identifier: normalized.identifier }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
      throw new IngestError(j.error ?? `Metadata lookup failed (HTTP ${res.status}).`, j.hint ?? "Try the PDF upload path instead.");
    }
    return (await res.json()) as MetadataResult;
  } catch (e) {
    if (e instanceof IngestError) throw e;
    // Server route unreachable (e.g. static hosting): fall back to a
    // browser-direct Crossref lookup for DOIs — Crossref sends CORS headers.
    if (normalized.kind === "doi") return crossrefDirect(normalized.identifier);
    throw new IngestError(
      "The metadata service is not reachable in this deployment.",
      "Static deployments have no metadata proxy: use a DOI (direct Crossref lookup works), the guided example, or upload the PDF."
    );
  }
}

/** Browser-direct Crossref metadata (CORS-enabled) — used when /api/ingest is unavailable. */
async function crossrefDirect(doiRaw: string): Promise<MetadataResult> {
  const doi = doiRaw.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi\.org\//, "");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Paper2Bench/1.0 (local-first tool)" },
    });
    if (!res.ok) {
      throw new IngestError(
        res.status === 404 ? "DOI not found in Crossref." : `Crossref returned HTTP ${res.status}.`,
        "Check the DOI string, or upload the PDF instead."
      );
    }
    const json = (await res.json()) as {
      message?: {
        title?: string[];
        author?: { given?: string; family?: string; name?: string }[];
        "published-online"?: { "date-parts"?: number[][] };
        "published-print"?: { "date-parts"?: number[][] };
        "container-title"?: string[];
        abstract?: string;
      };
    };
    const m = json.message ?? {};
    return {
      title: m.title?.[0] ?? "",
      authors: (m.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")),
      year: m["published-online"]?.["date-parts"]?.[0]?.[0] ?? m["published-print"]?.["date-parts"]?.[0]?.[0] ?? null,
      abstract: m.abstract ?? null,
      venue: m["container-title"]?.[0] ?? null,
    };
  } catch (e) {
    if (e instanceof IngestError) throw e;
    throw new IngestError(
      e instanceof Error && e.name === "AbortError" ? "Crossref lookup timed out." : "Direct Crossref lookup failed.",
      "Network may be unavailable — use 'Load guided example' or upload a PDF."
    );
  } finally {
    clearTimeout(t);
  }
}

/** LLM-assisted structured extraction (server-side SDK). Returns null on any failure. */
export async function llmExtract(
  title: string,
  abstract: string | null,
  fullText: string | null
): Promise<{ claims: Claim[]; reportedMetrics: ReportedMetric[] } | null> {
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, abstract, full_text: fullText ? fullText.slice(0, 60000) : null }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      claims?: Claim[];
      reported_metrics?: ReportedMetric[];
      error?: string;
    };
    if (!j.claims || !Array.isArray(j.claims) || j.claims.length === 0) return null;
    return { claims: j.claims, reportedMetrics: j.reported_metrics ?? [] };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runPipeline(input: PipelineInput, onDone: (id: string) => void) {
  const store = useP2B.getState();
  const cancelled = () => !useP2B.getState().processing?.active;
  try {
    // Stage 1: resolve
    store.updateStage("resolve", "running");
    await sleep(220);
    let normalized: ReturnType<typeof normalizePaperInput> | null = null;
    let meta: MetadataResult = { title: "", authors: [], year: null, abstract: null, venue: null };
    let sourceKind: PaperMeta["source_kind"] = "pdf";
    let sourceUrl = "";

    if (input.kind === "url") {
      normalized = normalizePaperInput(input.urlText ?? "");
      sourceKind = normalized.kind;
      sourceUrl = normalized.normalized;
      if (cancelled()) return;
      try {
        meta = await fetchRemoteMetadata(normalized);
      } catch (e) {
        if (cancelled()) return;
        // actionable failure — surface in stage detail, abort pipeline
        store.updateStage("resolve", "failed", e instanceof Error ? e.message : "Lookup failed");
        return;
      }
      if (!meta.title) {
        store.updateStage("resolve", "failed", "Source resolved but returned no title. Upload the PDF for a full extraction.");
        return;
      }
    }
    store.updateStage("resolve", "done", normalized ? `${normalized.displayHost} · ${normalized.identifier}` : "local PDF upload");

    // Stage 2: parse
    store.updateStage("parse", "running");
    await sleep(180);
    let pdf: PdfParseResult | null = null;
    if (input.kind === "pdf" && input.file) {
      if (cancelled()) return;
      try {
        pdf = await parsePdfLocally(input.file);
        sourceUrl = input.file.name;
      } catch (e) {
        const detail = e instanceof Error ? e.message : "unknown error";
        store.updateStage(
          "parse",
          "failed",
          `Could not read that PDF (${detail}). If it is a scan or password-protected, use the arXiv link or a text PDF instead.`
        );
        return;
      }
      if (pdf.imageOnlyPages.length === pdf.pages && pdf.pages > 0) {
        store.updateStage("parse", "failed", "All pages appear image-only (scanned). OCR is not available in this workspace — use the arXiv link or a text PDF.");
        return;
      }
      if (!meta.title) {
        const guess = pdf.text.slice(0, 400).match(/([A-Z][^\n.]{10,120})/);
        meta.title = (guess?.[1] ?? input.file.name.replace(/\.pdf$/i, "")).trim();
      }
    } else if (meta.abstract) {
      // metadata-only path: parse = abstract segmentation
    }
    store.updateStage("parse", "done", pdf ? `${pdf.pages} pages, ${pdf.imageOnlyPages.length} image-only` : "abstract metadata only");

    // Stage 3: segment
    store.updateStage("segment", "running");
    await sleep(160);
    const coverage: ParseCoverage = pdf
      ? {
          parser: "pdf.js local text extraction (p2b-web v1)",
          pages: pdf.pages,
          sections_detected: pdf.sections,
          tables_detected: pdf.tables,
          equations_detected: pdf.equations,
          image_only_pages: pdf.imageOnlyPages,
          warnings: [
            ...(pdf.imageOnlyPages.length ? [`${pdf.imageOnlyPages.length} page(s) appear image-only; their text was NOT extracted.`] : []),
            "Section headings are heuristic — verify anchors in the ledger.",
          ],
          coverage_pct: pdf.pages ? (pdf.pages - pdf.imageOnlyPages.length) / pdf.pages : 1,
        }
      : {
          parser: "arXiv/Crossref metadata (abstract-level)",
          pages: 0,
          sections_detected: ["Abstract"],
          tables_detected: 0,
          equations_detected: 0,
          image_only_pages: [],
          warnings: [
            "Only the abstract/metadata was available — hyperparameters and setup claims need the full text. Upload the PDF for a complete ledger.",
          ],
          coverage_pct: 0.15,
        };
    store.updateStage("segment", "done", `${coverage.sections_detected.length} sections, ${coverage.tables_detected} tables`);

    // Stage 4: extract
    store.updateStage("extract", "running");
    await sleep(160);
    if (cancelled()) return;
    const text = pdf?.text ?? meta.abstract ?? "";
    let claims: Claim[] = [];
    let reported: ReportedMetric[] = [];
    let extractionScope: PaperMeta["extraction_scope"] = pdf ? "full_text" : "abstract_only";

    const settings = useP2B.getState().settings;
    if (settings.extraction_engine === "llm" && settings.privacy_mode === "remote_optin") {
      const llm = await llmExtract(meta.title, meta.abstract, pdf?.text ?? null);
      if (llm) {
        claims = llm.claims;
        reported = llm.reportedMetrics;
        extractionScope = "full_text_llm";
      }
    }
    if (claims.length === 0) {
      const heur = extractClaimsHeuristic(text, meta.title || "paper");
      claims = heur.claims;
      reported = heur.reportedMetrics;
    }
    store.updateStage("extract", "done", `${claims.length} candidate claims (${claims.filter((c) => c.evidence_status === "reported").length} reported)`);

    // Stage 5: verify anchors
    store.updateStage("verify", "running");
    await sleep(160);
    const anchored = claims.filter((c) => c.evidence.length > 0).length;
    store.updateStage("verify", "done", `${anchored}/${claims.length} claims carry evidence spans (weak anchors need review)`);

    // Stage 6: schema validation
    store.updateStage("schema", "running");
    await sleep(140);
    const valid = claims.filter(
      (c) => c.claim_id && c.category && ["reported", "derived", "inferred", "unspecified", "conflicting", "user_confirmed", "not_applicable"].includes(c.evidence_status)
    );
    store.updateStage("schema", "done", `${valid.length}/${claims.length} claims passed schema checks`);
    claims = valid;

    // Stage 7: hash + create project
    store.updateStage("prepare", "running");
    await sleep(140);
    if (cancelled()) return;
    const hash = await contentHash((pdf?.text ?? "") + meta.title + (normalized?.identifier ?? ""));
    const existing = Object.values(useP2B.getState().projects).find(
      (p: Project) => p.paper.source_version === hash
    );
    if (existing) {
      store.updateStage("prepare", "done", `Identical source already exists as "${existing.paper.title}" — opening it (re-ingest identity check).`);
      await sleep(500);
      useP2B.getState().finishProcessing();
      useP2B.getState().setView("overview");
      useP2B.getState().setView("overview");
      onDone(existing.id);
      return;
    }

    const paper: PaperMeta = {
      paper_id: `paper_${shortHash(meta.title + sourceUrl, 10)}`,
      title: meta.title || "Untitled paper",
      authors: meta.authors,
      year: meta.year,
      venue: meta.venue,
      source_url: sourceUrl,
      source_kind: sourceKind,
      source_version: hash.slice(0, 16),
      retrieved_at: new Date().toISOString(),
      abstract: meta.abstract,
      full_text_available: Boolean(pdf),
      extraction_scope: extractionScope,
    };

    const pid = useP2B.getState().createProject(paper, claims, reported, coverage);
    store.updateStage("prepare", "done", "Workspace ready.");
    await sleep(400);
    useP2B.getState().finishProcessing();
    onDone(pid);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unexpected pipeline failure.";
    // Attribute the failure to the stage that was actually running (or the first pending one).
    const stages = useP2B.getState().processing?.stages ?? [];
    const running = stages.find((s) => s.status === "running") ?? stages.find((s) => s.status === "pending") ?? stages[stages.length - 1];
    if (running) useP2B.getState().updateStage(running.id, "failed", msg);
    else useP2B.getState().updateStage("prepare", "failed", msg);
  }
}
