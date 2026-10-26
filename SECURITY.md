# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.0.x | yes |
| < 1.0 | no |

## Reporting a vulnerability

Please open a **private security advisory** via GitHub's "Report a
vulnerability" button on the Security tab, or email the maintainer contact in
the repository settings. Do **not** open a public issue for exploitable bugs.

Include: affected component, reproduction steps, impact assessment, and any
known mitigations. We aim to acknowledge within 72 hours and publish a fix or
mitigation plan within 14 days for high-severity issues.

## Security model (what this app promises)

1. **No arbitrary fetch.** Ingestion accepts only arxiv.org / doi.org
   identifiers, validated client- and server-side. Private-network hosts
   (localhost, RFC1918, link-local, metadata) are rejected.
2. **No code execution.** The hosted app never executes generated or
   paper-derived code. Executable validation checks are reported as `blocked`
   with local instructions.
3. **No secret persistence.** Provider credentials are never written to
   project state; exports are secret-scanned and blocked on detection.
4. **Local-first state.** Projects live in browser `localStorage`. Remote LLM
   extraction requires explicit opt-in with disclosure of what is transmitted.
5. **No gated downloads.** Dataset records never trigger downloads of
   restricted data; licence state must be user-confirmed.
6. **File limits.** PDF uploads are capped (40 MB / 60 parsed pages) with
   timeouts to bound resource use.

## Known limitations

- The heuristic extractor is pattern-based; it can miss claims or, rarely,
  bind a value to the wrong sentence — the ledger marks all anchors `weak`
  until human review.
- The LLM path depends on the configured provider's security posture;
  paper text is transmitted only after opt-in.
