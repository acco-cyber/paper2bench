# Privacy & data handling

## What stays on your machine (default)

- Uploaded PDF text is parsed in-browser (pdf.js) and held in memory.
- Projects, claims, corrections, runs, settings: browser `localStorage`.
- Heuristic extraction is fully offline.

## What can leave your machine (only with opt-in)

- With **Remote extraction** enabled, paper text (title, abstract, and full
  text when available) is sent to the configured model provider via
  `/api/extract`. The disclosure is shown before first use; the setting is
  never enabled silently or by default.
- arXiv/DOI **metadata** lookups (title/authors/abstract) go to the allow-listed
  public APIs; these requests contain identifiers only, never your notes.

## Retention & deletion

- Local data persists until you delete it: per-project delete, "Clear all" on
  the import page, or Settings → Delete all local data (clears localStorage).
- Server-side retention: none. The app stores no projects server-side; PDF
  bytes never reach the server.

## Exports

- Secret scan runs on every export (GitHub/HF/OpenAI-style tokens, AWS keys,
  private keys, bearer headers) and blocks the download on detection.
- Reports never include local filesystem paths by construction; the
  "share safely" checklist reminds you to review claim notes before sharing.

## Analytics

None. The telemetry switch exists to record your preference; no analytics
collection is implemented in this build.
