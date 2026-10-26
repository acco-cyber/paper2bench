import type { SourceKind } from "./types";
import { shortHash } from "./semantics";

/**
 * F01 — Paper ingestion and identity.
 * Strict allow-list for remote sources; anything else is rejected with an actionable error.
 * No arbitrary URL fetching is permitted by design.
 */

export const ALLOWED_HOSTS = [
  "arxiv.org",
  "www.arxiv.org",
  "export.arxiv.org",
  "doi.org",
  "www.doi.org",
  "dx.doi.org",
];

export const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /\.local$/i,
  /^metadata\./i,
];

export interface NormalizedSource {
  kind: SourceKind;
  normalized: string;
  identifier: string; // arXiv id or DOI
  displayHost: string;
}

export class IngestError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

function isPrivateHost(host: string): boolean {
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) return true;
  // IP-literal host that is not a blocked private range still fails allow-list below.
  return false;
}

export function normalizePaperInput(input: string): NormalizedSource {
  const raw = input.trim();
  if (!raw) {
    throw new IngestError(
      "The paper field is empty.",
      "Paste an arXiv link (e.g. https://arxiv.org/abs/1706.03762), a DOI URL, or upload a PDF."
    );
  }

  // Bare arXiv id e.g. 1706.03762 or 1706.03762v5
  const bareArxiv = raw.match(/^(\d{4}\.\d{4,5})(v\d+)?$/);
  if (bareArxiv) {
    return {
      kind: "arxiv",
      normalized: `https://arxiv.org/abs/${bareArxiv[1]}${bareArxiv[2] ?? ""}`,
      identifier: bareArxiv[1] + (bareArxiv[2] ?? ""),
      displayHost: "arxiv.org",
    };
  }

  // Bare DOI e.g. 10.1000/xyz123
  const bareDoi = raw.match(/^(10\.\d{4,9}\/\S+)$/);
  if (bareDoi) {
    return {
      kind: "doi",
      normalized: `https://doi.org/${bareDoi[1]}`,
      identifier: bareDoi[1].replace(/\/$/, ""),
      displayHost: "doi.org",
    };
  }

  let url: URL;
  try {
    url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new IngestError(
      `"${raw.slice(0, 80)}" is not a valid URL.`,
      "Use an arXiv link like https://arxiv.org/abs/1706.03762, a DOI link, or upload a PDF instead."
    );
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new IngestError(
      `Unsupported URL scheme "${url.protocol}".`,
      "Only http(s) links to arXiv or DOI are supported. Upload a PDF for other sources."
    );
  }

  const host = url.hostname.toLowerCase();
  if (isPrivateHost(host)) {
    throw new IngestError(
      `"${host}" resolves to a private or restricted network address.`,
      "Paper2Bench never fetches private network destinations. Use a public arXiv/DOI link or upload the PDF."
    );
  }
  if (!ALLOWED_HOSTS.includes(host)) {
    throw new IngestError(
      `"${host}" is not an approved paper source.`,
      "Supported: arxiv.org (abstract/pdf links) and doi.org. For other venues, download the PDF and upload it."
    );
  }

  // arXiv shapes: /abs/<id>, /pdf/<id>, export.arxiv.org/abs/<id>
  if (host.endsWith("arxiv.org")) {
    const m = url.pathname.match(
      /\/(?:abs|pdf|format)\/((?:[a-z-]+\/)?(?:\d{4}\.\d{4,5}|\d{7}))(v\d+)?/i
    );
    if (!m) {
      throw new IngestError(
        "Could not find an arXiv identifier in that link.",
        "Use the abstract or PDF link, e.g. https://arxiv.org/abs/1706.03762 or https://arxiv.org/pdf/1706.03762."
      );
    }
    const id = m[1] + (m[2] ?? "");
    return {
      kind: "arxiv",
      normalized: `https://arxiv.org/abs/${id}`,
      identifier: id,
      displayHost: "arxiv.org",
    };
  }

  // DOI shapes
  const doiPath = url.pathname.replace(/^\/+/, "");
  if (!doiPath.startsWith("10.")) {
    throw new IngestError(
      "That DOI link does not include a valid DOI path.",
      "A DOI looks like https://doi.org/10.5555/3295222.3295349."
    );
  }
  return {
    kind: "doi",
    normalized: `https://doi.org/${doiPath.replace(/\/$/, "")}`,
    identifier: doiPath.replace(/\/$/, ""),
    displayHost: "doi.org",
  };
}

/** SHA-256 of content via WebCrypto; falls back to a deterministic short hash. */
export async function contentHash(text: string): Promise<string> {
  try {
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text)
      );
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // fall through
  }
  // deterministic fallback (FNV-1a x2, same style as shortHash)
  return `fnv-${shortHash(text, 16)}${shortHash(text + "|s", 16)}`;
}

/** Re-ingest identity check: identical vs changed content. */
export function compareSourceHash(
  existingHash: string,
  newHash: string
): "identical" | "changed" {
  return existingHash === newHash ? "identical" : "changed";
}
