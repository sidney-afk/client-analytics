// Supabase Edge Function: pipeline-social
//
// The filming plan pipeline's door to ScrapeCreators (Sidney, 2026-10-23): idea
// research on TikTok, YouTube Shorts and Reddit, and the words of a video. The
// pipeline reaches it the same way it reaches Google through pipeline-google:
// with a filming pipeline pass (the connector's pipeline_pass tool), so no key
// sits on anyone's computer. The ScrapeCreators key is the Supabase secret
// SCRAPECREATORS_API_KEY and never leaves this function.
//
//   POST { action, ... }   header x-pipeline-pass: <a filming pipeline pass>
//
//   tiktok.search    { query, sort_by?, date_posted?, region?, cursor? }
//   youtube.search   { query, type? (shorts|videos), uploadDate?, sortBy?, region?, continuationToken? }
//   reddit.search    { query, filter?, sort?, timeframe?, after? }
//   reddit.subreddit { subreddit, sort?, timeframe?, cache_max_age?, after? }
//   transcript       { url, language? }       a TikTok, Instagram or YouTube link
//   credits          {}                       the ScrapeCreators credit balance
//
// What each action may send is fixed in rules.mjs (no free choice of endpoint,
// host or paid option). Every pass call first re-checks the member is still on
// the filming plan list (the same gate as pipeline-google). Each call is logged
// in hf_activity as tool "scrapecreators.<action>" with who ran it, and calls
// count against a monthly cap (fp_settings key scrapecreators_monthly_calls,
// default 2000; credits does not count). Refusals are plain English, ok:false.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { PASS_HEADER, isPassToken, passHash } from "../pipeline-google/pass.mjs";
import { pipelineGate } from "../pipeline-google/users.mjs";
import { BASE, CAP_KEY, buildRequest, capFrom, logLine, monthStart } from "./rules.mjs";

const clean = (v: unknown) => String(v == null ? "" : v).trim();
const json = (obj: unknown, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });
const refused = (error: string, status = 403) => json({ ok: false, error }, status);

function db() {
  const url = clean(Deno.env.get("SUPABASE_URL"));
  const key = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

type Db = NonNullable<ReturnType<typeof db>>;

// What buildRequest (rules.mjs) answers: a refusal, or the request to make.
type Plan = { ok: boolean; error?: string; path: string; query: Record<string, string>; counts: boolean; site?: string };

function readSetting(sb: Db) {
  return async (key: string) => {
    const { data, error } = await sb.from("fp_settings").select("value").eq("key", key).maybeSingle();
    if (error) throw new Error(`the settings: ${error.message || "no answer"}`);
    return data ? data.value : null;
  };
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return refused("Send a POST with an action.", 405);
  const raw = clean(req.headers.get(PASS_HEADER));
  if (!isPassToken(raw)) return refused("Send a filming pipeline pass in the x-pipeline-pass header. Ask the connector for one (pipeline_pass).", 401);
  const sb = db();
  if (!sb) return refused("not set up: the database connection is missing", 503);

  const { data: rows, error: useError } = await sb.rpc("fp_pass_use", { p_token_hash: await passHash(raw) });
  if (useError) return refused("Could not check the pipeline pass.", 503);
  const pass = Array.isArray(rows) ? rows[0] : null;
  if (!pass) return refused("That pipeline pass is not known. Ask the connector for a new one (pipeline_pass).", 401);
  if (pass.expired) return refused(`That pipeline pass ran out at ${String(pass.expires_at)}. Ask the connector for a new one (pipeline_pass).`, 401);
  const gate = await pipelineGate(readSetting(sb), { member: String(pass.member ?? ""), teamLink: pass.via !== "personal" });
  if (gate) return refused(gate.text, gate.status);

  // deno-lint-ignore no-explicit-any
  const b = await req.json().catch(() => ({})) as Record<string, any>;
  const action = clean(b.action);
  const plan = buildRequest(action, b) as Plan;
  if (!plan.ok) return refused(String(plan.error), 400);

  const key = clean(Deno.env.get("SCRAPECREATORS_API_KEY"));
  if (!key) return refused("ScrapeCreators is not set up yet (the key is missing in Supabase). Tell the Connector supervisor.", 503);

  const member = String(pass.member ?? "");
  const line = logLine(action, plan, b);
  const log = (ok: boolean, error = "") =>
    sb.from("hf_activity").insert({ member_name: member, tool: line.tool, client: String(pass.client_slug ?? ""), summary: line.summary, ok, error: error || null })
      .then(() => undefined, () => undefined);

  if (plan.counts) {
    let cap: number;
    try { cap = capFrom(await readSetting(sb)(CAP_KEY)); } catch (_e) { return refused("Could not read the monthly limit, so the call was not made.", 503); }
    const used = await sb.from("hf_activity").select("id", { count: "exact", head: true })
      .like("tool", "scrapecreators.%").neq("tool", "scrapecreators.credits").eq("ok", true).gte("created_at", monthStart());
    if (used.error) return refused("Could not count this month's calls, so the call was not made.", 503);
    if ((used.count ?? 0) >= cap) {
      await log(false, "monthly limit reached");
      return refused(`The monthly ScrapeCreators limit (${cap} calls) is used up. Ask the account owner to raise it.`, 429);
    }
  }

  const url = new URL(BASE + plan.path);
  for (const [k, v] of Object.entries(plan.query)) url.searchParams.set(k, v);
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { "x-api-key": key, Accept: "application/json" } });
  } catch (_e) {
    await log(false, "no answer from ScrapeCreators");
    return refused("ScrapeCreators did not answer. Try again in a minute.", 502);
  }
  const text = await resp.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch (_e) { /* not JSON */ }
  if (!resp.ok) {
    const why = resp.status === 401 || resp.status === 402 ? "ScrapeCreators refused the key or is out of credits. Tell the Connector supervisor."
      : resp.status === 429 ? "ScrapeCreators says too many calls at once. Wait a moment and try again."
      : resp.status === 404 ? "ScrapeCreators found nothing for that."
      : `ScrapeCreators could not do that (status ${resp.status}).`;
    await log(false, `status ${resp.status}`);
    return json({ ok: false, error: why, status: resp.status }, resp.status === 404 ? 404 : 502);
  }
  await log(true);
  return json({ ok: true, action, result: data ?? text });
}

Deno.serve(async (req) => {
  try { return await handle(req); } catch (_e) { return refused("Something went wrong in pipeline-social.", 500); }
});
