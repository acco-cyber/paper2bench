import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/extract — LLM-assisted structured claim extraction.
 * Uses z-ai-web-dev-sdk (server-side only) with a strict evidence-first prompt:
 * the model must return source spans with each claim; if a value is not in the
 * provided text it MUST be returned as unspecified — never invented.
 * Falls back gracefully: the client runs its local heuristic extractor when this
 * endpoint is unavailable (e.g. self-hosted without SDK credentials).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ClaimOut {
  claim_id: string;
  category: string;
  field_path: string;
  label: string;
  value: string | number | boolean | null;
  unit: string | null;
  evidence_status: string;
  impact: string;
  confidence: number;
  page?: number | null;
  section?: string | null;
  supporting_text?: string | null;
  locator?: string | null;
}

const SYSTEM_PROMPT = `You are the extraction engine of Paper2Bench, an evidence-first ML reproduction tool.
You receive the title, and optionally the abstract and/or full text, of one ML paper.

Extract ATOMIC claims — one fact per claim — for these categories:
architecture (layers, dims, heads, model family), dataset (names, sizes, splits),
preprocessing (tokenization, augmentation), loss (objective, coefficients, label smoothing),
optimizer (name, betas, epsilon, momentum), training (learning rate, schedule, warmup, batch size + unit,
epochs/steps, dropout, weight decay, seeds, gradient clipping), evaluation (beam size, checkpoint selection, decoding),
metrics (metric names with direction), compute (hardware, precision), reported_results (headline numbers with table/row).

STRICT RULES:
1. NEVER invent a value. If the text does not state it, either omit the claim or return evidence_status "unspecified" with value null.
2. Every claim with a non-null value MUST include supporting_text — a short verbatim quote from the provided text — plus page/section when inferable. If you cannot quote the source, set evidence_status to "inferred" and explain.
3. If two parts of the text disagree (e.g. main text vs table), emit evidence_status "conflicting" and include BOTH values in supporting_text.
4. Use stable dotted field paths like training.learning_rate, architecture.d_model, dataset.wmt14_ende, evaluation.beam_size.
5. impact: "critical" for split/loss/lr/batch/seeds/metric-definition/architecture dims; "important" for most others; "informational" for context.
6. Numbers must be plain JSON numbers (1e-4 -> 0.0001). Include unit when applicable (e.g. "tokens").
7. Return ONLY valid JSON, no markdown fences, matching:
{"claims":[{...}],"reported_metrics":[{"metric_id":"rm_x","name":"BLEU","value":28.4,"unit":"BLEU","dataset":"...","split":"newstest2014","direction":"maximize","aggregation":"single run","source":"Table 2","variability":null}]}

Return 12-30 claims. Prefer precision over recall; a smaller honest ledger beats a rich fabricated one.`;

function validateClaim(c: ClaimOut): boolean {
  if (!c.claim_id || !c.field_path || !c.label) return false;
  const allowedStatus = ["reported", "derived", "inferred", "unspecified", "conflicting", "user_confirmed", "not_applicable"];
  if (!allowedStatus.includes(c.evidence_status)) return false;
  if (c.value !== null && c.supporting_text === undefined) {
    // value without any source span: reject per evidence-first policy
    return false;
  }
  return true;
}

export async function POST(req: NextRequest) {
  let body: { title?: string; abstract?: string | null; full_text?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const title = (body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "Missing paper title." }, { status: 400 });
  }

  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();

    const userContent = [
      `PAPER TITLE: ${title}`,
      body.abstract ? `\nABSTRACT:\n${body.abstract.slice(0, 4000)}` : "",
      body.full_text
        ? `\nFULL TEXT (truncated):\n${body.full_text.slice(0, 56000)}`
        : "\nFULL TEXT: not available — extract only what the title/abstract support and mark everything else unspecified.",
      `\nTASK: Return the JSON ledger now.`,
    ].join("\n");

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    // strip potential fences
    const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return NextResponse.json({ error: "Model returned non-JSON output." }, { status: 502 });
    }
    let parsed: { claims?: ClaimOut[]; reported_metrics?: unknown[] };
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return NextResponse.json({ error: "Model output failed JSON parsing." }, { status: 502 });
    }

    const categories = new Set([
      "architecture", "dataset", "preprocessing", "loss", "optimizer",
      "training", "evaluation", "metrics", "compute", "environment", "reported_results",
    ]);
    const claims = (parsed.claims ?? []).filter(validateClaim).map((c) => ({
      ...c,
      category: categories.has(c.category) ? c.category : "training",
      impact: ["critical", "important", "informational"].includes(c.impact) ? c.impact : "important",
      confidence: typeof c.confidence === "number" ? Math.min(1, Math.max(0, c.confidence)) : 0.7,
      extractor: "llm",
    }));

    if (claims.length === 0) {
      return NextResponse.json({ error: "No schema-valid claims extracted." }, { status: 502 });
    }

    return NextResponse.json({
      claims,
      reported_metrics: (parsed.reported_metrics as ClaimOut[]) ?? [],
      extractor: "llm",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "LLM extraction unavailable.";
    // Graceful degradation: client falls back to local heuristic extraction.
    return NextResponse.json({ error: msg, fallback: "heuristic" }, { status: 503 });
  }
}
