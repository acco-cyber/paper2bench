import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/ingest — metadata lookup for allow-listed sources only (arXiv / Crossref).
 * SSRF policy: identifiers are pre-normalized client-side and re-validated here;
 * we only ever call api.crossref.org and export.arxiv.org with constructed URLs —
 * never a user-supplied URL.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 8000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Paper2Bench/1.0 (metadata lookup; local-first tool)" },
    });
  } finally {
    clearTimeout(t);
  }
}

function bad(error: string, hint: string, status = 400) {
  return NextResponse.json({ error, hint }, { status });
}

export async function POST(req: NextRequest) {
  let body: { kind?: string; identifier?: string };
  try {
    body = (await req.json()) as { kind?: string; identifier?: string };
  } catch {
    return bad("Request body must be JSON.", "Send {kind, identifier}.");
  }
  const kind = body.kind;
  const identifier = (body.identifier ?? "").trim();

  if (!identifier) return bad("Missing identifier.", "Provide an arXiv id or DOI.");

  try {
    if (kind === "arxiv") {
      const arxivId = identifier.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//, "").replace(/\.pdf$/, "");
      if (!/^[a-z-]+\/\d{7}|\d{4}\.\d{4,5}(v\d+)?$/i.test(arxivId)) {
        return bad("Invalid arXiv identifier.", "Expected e.g. 1706.03762 or cs.CL/0703120.");
      }
      const res = await fetchWithTimeout(
        `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}&max_results=1`
      );
      if (!res.ok) {
        return bad(`arXiv API returned HTTP ${res.status}.`, "arXiv may be rate-limiting; retry shortly or upload the PDF.");
      }
      const xml = await res.text();
      const title = xml.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
      // first <title> is the feed title; entries follow
      const titles = [...xml.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
      const realTitle = titles.length > 1 ? titles[1] : titles[0] ?? "";
      const authors = [...xml.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => m[1].trim());
      const abstract =
        xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
      const published = xml.match(/<published>([\d-]{4})/)?.[1];
      return NextResponse.json({
        title: realTitle || title,
        authors,
        year: published ? Number(published) : null,
        abstract,
        venue: "arXiv",
      });
    }

    if (kind === "doi") {
      const doi = identifier.replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
      if (!/^10\.\d{4,9}\//.test(doi)) {
        return bad("Invalid DOI.", "A DOI looks like 10.5555/3295222.3295349.");
      }
      const res = await fetchWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      if (res.status === 404) {
        return bad("DOI not found in Crossref.", "Check the DOI string, or upload the PDF instead.");
      }
      if (!res.ok) {
        return bad(`Crossref API returned HTTP ${res.status}.`, "Retry shortly or upload the PDF.");
      }
      const json = (await res.json()) as {
        message?: {
          title?: string[];
          author?: { given?: string; family?: string; name?: string }[];
          "published-print"?: { "date-parts"?: number[][] };
          "published-online"?: { "date-parts"?: number[][] };
          "container-title"?: string[];
          abstract?: string;
        };
      };
      const m = json.message ?? {};
      const year =
        m["published-online"]?.["date-parts"]?.[0]?.[0] ??
        m["published-print"]?.["date-parts"]?.[0]?.[0] ??
        null;
      return NextResponse.json({
        title: m.title?.[0] ?? "",
        authors: (m.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")),
        year,
        abstract: m.abstract ?? null,
        venue: m["container-title"]?.[0] ?? null,
      });
    }

    return bad("Unsupported kind.", "Use kind: 'arxiv' or 'doi'.");
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Source lookup timed out." : "Metadata lookup failed.";
    return NextResponse.json(
      { error: msg, hint: "Network may be unavailable in this environment — use 'Load guided example' or upload a PDF." },
      { status: 502 }
    );
  }
}
