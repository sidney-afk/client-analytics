// Supabase Edge Function: quiz-capture
//
// Public capture endpoint for the synchrosocial.com Growth Bottleneck Quiz
// (/quiz). Writes to public.quiz_responses (service role; the table has no
// anon access — run 2026-08-24-quiz-responses.sql first). Same posture as
// the 2026-08-24 public_intake_log pattern this is modeled on: a fail-closed
// runtime flag, a durable DB-backed rate limit (Edge instances share no
// memory and are recycled constantly, so an in-process counter is a rate
// limit in name only), and a log-before-write ordering so a retry storm
// still consumes its slot even if the write later fails.
//
// No CAPTCHA/honeypot — an explicit decision (2026-08-24), not an
// oversight: the flag + rate limit are the whole defense, same as every
// other public-write surface in this repo.
//
// Deploy: supabase functions deploy quiz-capture --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
// (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected; no secrets needed.)

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

const QUIZ_INTAKE_FLAG = "quiz_intake_enabled";
const QUIZ_INTAKE_WINDOW_MINUTES = 60;
const QUIZ_INTAKE_MAX_TOTAL = 120; // public marketing surface — higher ceiling than the internal footage-submission link (60/hr)
const MAX_ANSWER_KEYS = 32; // 8 questions today; generous headroom without being unbounded
const RESULT_CATEGORIES = new Set(["reach", "positioning", "profile", "consistency"]);
const ATTR_FIELDS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "fbclid", "gclid", "ttclid", "referrer",
];

function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function clean(v: unknown, max = 300): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

async function quizIntakeEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase.from("syncview_runtime_flags")
      .select("value")
      .eq("key", QUIZ_INTAKE_FLAG)
      .maybeSingle();
    if (error || !data) return false;
    const value = (data as { value: unknown }).value;
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return !!parsed && (parsed as Record<string, unknown>).enabled === true;
  } catch (_error) {
    return false;
  }
}

async function withinRate(supabase: SupabaseClient): Promise<boolean> {
  const since = new Date(Date.now() - QUIZ_INTAKE_WINDOW_MINUTES * 60_000).toISOString();
  const { data, error } = await supabase.from("quiz_intake_log")
    .select("id")
    .gte("created_at", since);
  if (error || !Array.isArray(data)) return false; // read failure fails closed
  return data.length < QUIZ_INTAKE_MAX_TOTAL;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(await req.text());
  } catch (_e) {
    body = null;
  }
  if (!body || typeof body !== "object") return json({ ok: false, error: "invalid_body" }, 400);

  const responseId = clean(body.response_id, 64);
  if (!responseId) return json({ ok: false, error: "response_id_required" }, 400);

  const resultCategory = clean(body.result_category, 32);
  if (resultCategory && !RESULT_CATEGORIES.has(resultCategory)) {
    return json({ ok: false, error: "invalid_result_category" }, 400);
  }

  const answers = (body.answers && typeof body.answers === "object") ? body.answers as Record<string, unknown> : {};
  if (Object.keys(answers).length > MAX_ANSWER_KEYS) {
    return json({ ok: false, error: "answers_too_large" }, 413);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!await quizIntakeEnabled(supabase)) {
    return json({ ok: false, error: "quiz_intake_disabled" }, 403);
  }
  if (!await withinRate(supabase)) {
    return json({ ok: false, error: "quiz_intake_rate_limited" }, 429);
  }

  // Log before the write, so a retry storm consumes its rate-limit slot even
  // if the write below fails.
  const { error: logError } = await supabase.from("quiz_intake_log").insert({ request_id: responseId });
  if (logError) return json({ ok: false, error: "rate_log_failed" }, 503);

  const row: Record<string, unknown> = {
    response_id: responseId,
    quiz_slug: clean(body.quiz_slug, 64) || "growth-bottleneck",
    contact_name: clean(body.contact_name, 200),
    contact_email: clean(body.contact_email, 254),
    answers,
    result_category: resultCategory || null,
    result_scores: (body.result_scores && typeof body.result_scores === "object") ? body.result_scores : null,
    headline_variant: clean(body.headline_variant, 32) || "control",
    created_by: "public-quiz",
  };
  for (const field of ATTR_FIELDS) {
    const value = clean((body as Record<string, unknown>)[field]);
    if (value) row[field] = value;
  }

  const { error } = await supabase.from("quiz_responses").upsert(row, { onConflict: "response_id" });
  if (error) return json({ ok: false, error: error.message }, 500);

  return json({ ok: true, response_id: responseId }, 200);
});
