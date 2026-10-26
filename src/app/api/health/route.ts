import { NextResponse } from "next/server";

/** GET /api/health — liveness + capability probe used by the Settings view. */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    product: "Paper2Bench",
    version: "1.0.0",
    capabilities: {
      local_pdf_parsing: true,
      arxiv_metadata: true,
      crossref_metadata: true,
      llm_extraction_endpoint: "/api/extract",
      code_execution: false, // by policy: the hosted app never executes generated code
    },
    time: new Date().toISOString(),
  });
}
