#!/usr/bin/env bash
# Prepare + build the static export for Hugging Face Spaces (free static SDK).
# The main repo keeps the full server (Docker/self-host); this produces out/ only.
set -euo pipefail
cd /home/z/my-project/hf-deploy

# 1. Static-export config (does not affect the main repo copy)
cat > next.config.ts << 'EOF'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
};

export default nextConfig;
EOF

# 2. Route handlers cannot be statically exported — remove API routes for this build.
rm -rf src/app/api

# 3. HF Space README frontmatter (before app README)
cat > README.md << 'EOF'
---
title: Paper2Bench
emoji: 📜
colorFrom: gray
colorTo: yellow
sdk: static
pinned: true
license: mit
short_description: Turn an ML paper into an evidence-backed experiment.
---

# Paper2Bench — Hugging Face Space (static build)

Evidence-first research engineering workspace. This is the fully client-side
static build: PDF parsing (pdf.js) and heuristic claim extraction run entirely
in your browser; projects persist in `localStorage`. Nothing is uploaded.

Notes vs the full (Docker/self-hosted) deployment:
- No server metadata proxy → arXiv lookups are unavailable; **DOI lookups work
  via direct Crossref (CORS)**, PDF upload and the guided example always work.
- LLM-assisted extraction is unavailable (requires the server route); the
  deterministic heuristic extractor is used instead.

See the GitHub repository for the complete server build, API routes and docs.
EOF

# 4. Build
npm run build 2>&1 | tail -6

# 5. Show result
ls out/ | head -12
echo "--- export ready ---"
