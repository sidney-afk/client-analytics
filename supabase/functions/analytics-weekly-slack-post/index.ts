// analytics-weekly-slack-post — step 3 of the weekly client analytics snapshot: the SyncView bot posts each
// client's built weekly message (analytics_weekly_messages, step 2) in that client's PRIVATE Slack channel
// (client_profiles.slack_channel_id, never creative_channel_id), tagging the client the same way the
// "Notify client" button does (client_profiles.slack_mention_user_id; no id = no tag).
//
// OFF BY DEFAULT. Switch: syncview_runtime_flags key analytics_weekly_slack_post, value {"mode":"off" |
// "allow_list" | "all"} (see the migration). In allow_list mode only clients in analytics_weekly_slack_allow
// post. Anything else is off: the function answers {"mode":"off"} and touches nothing.
//
// Never twice for the same week: a post is claimed (a "pending" row) BEFORE Slack is called, and a client with
// a pending, sent or unknown row is never claimed again. A Slack answer that is not a confirmed post (timeout,
// 5xx) is recorded "unknown" and never retried by a timer. A failure or a skip (no channel) is recorded with
// its class in analytics_weekly_slack_posts and retried at most 3 times, 5 minutes apart. Nothing is logged
// but error names: no channel id, token, name or message text.
//
// Needs: SLACK_BOT_TOKEN (the same bot as client-review-alert), ANALYTICS_COLLECT_KEY (the same key as steps 1
// and 2). Actions (POST, header x-analytics-collect-key; not browser callable):
//   tick    the cron call: one client per call.
//   run     {"action":"run","slugs":["<slug>", ...]} up to 3 named clients, same switch and allow-list; a failed or
//           skipped post starts over, a sent, pending or unknown one is never re-posted.
//   status  counts for this week by status and error class. No names, no text.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import { weekOf } from "../_shared/analytics-weekly-followers.mjs";
import { mentionIdOf } from "../_shared/client-review-alert.mjs";
import { makeSlack } from "../_shared/client-review-alert-slack.mjs";
import { buildSlackMessage, FLAG_KEY, modeOf } from "../_shared/analytics-weekly-slack.mjs";

type JsonMap = Record<string, unknown>;

const clean = (v: unknown) => String(v == null ? "" : v).trim();
const slack = makeSlack(fetch);
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function requireKey(req: Request): boolean {
  const secret = Deno.env.get("ANALYTICS_COLLECT_KEY") || "";
  const given = clean(req.headers.get("x-analytics-collect-key"));
  return secret.length >= 32 && !!given && timingSafeEqual(given, secret);
}

async function readMode(db: SupabaseClient): Promise<string> {
  try {
    const { data, error } = await db.from("syncview_runtime_flags").select("value").eq("key", FLAG_KEY).maybeSingle();
    return error ? "off" : modeOf(data?.value);
  } catch (_e) { return "off"; }
}

// The client's linked Slack person, read on its own so a database without the column still posts untagged
// (same rule as client-review-alert).
async function mentionOf(db: SupabaseClient, slug: string): Promise<string> {
  try {
    const res = await db.from("client_profiles").select("slack_mention_user_id,archived_at").eq("slug", slug).maybeSingle();
    if (res.error) return "";
    return res.data && !res.data.archived_at ? mentionIdOf(res.data.slack_mention_user_id) : "";
  } catch (_e) { return ""; }
}

async function finish(db: SupabaseClient, week: string, slug: string, status: string, ts: string | null, cls: string | null): Promise<void> {
  const { error } = await db.rpc("analytics_weekly_slack_finish", { p_week_of: week, p_client_slug: slug, p_status: status, p_slack_ts: ts, p_error_class: cls });
  if (error) throw error;
}

async function postOne(db: SupabaseClient, week: string, slug: string, token: string): Promise<string> {
  const { data: client, error: ce } = await db.from("clients").select("slug,kind,active").eq("slug", slug).maybeSingle();
  if (ce) throw ce;
  if (!client || client.active !== true || !["client", "test"].includes(clean(client.kind))) { await finish(db, week, slug, "skipped", null, "inactive_client"); return "skipped"; }
  const { data: p, error: pe } = await db.from("client_profiles").select("slack_channel_id,archived_at").eq("slug", slug).maybeSingle();
  if (pe) throw pe;
  const channel = p && !p.archived_at ? clean(p.slack_channel_id) : "";
  if (!channel) { await finish(db, week, slug, "skipped", null, "no_channel"); return "skipped"; }
  const { data: m, error: me } = await db.from("analytics_weekly_messages").select("text").eq("client_slug", slug).eq("week_of", week).maybeSingle();
  if (me) throw me;
  const text = clean(m?.text);
  if (!text) { await finish(db, week, slug, "skipped", null, "no_message"); return "skipped"; }
  const message = buildSlackMessage(text, await mentionOf(db, slug));
  const out = await slack.postChannel(token, channel, message);
  if (out.kind === "sent") {
    // The post happened. If the receipt cannot be saved the row stays pending and turns unknown: never re-posted.
    await finish(db, week, slug, "sent", out.messageId, null);
    return "sent";
  }
  const status = out.kind === "unknown" ? "unknown" : "failed";
  await finish(db, week, slug, status, null, out.code ?? "slack_rejected");
  return status;
}

async function work(db: SupabaseClient, week: string, limit: number, slugs: string[] | null): Promise<JsonMap> {
  const mode = await readMode(db);
  if (mode === "off") return { ok: true, mode, week_of: week, results: {} };
  const token = clean(Deno.env.get("SLACK_BOT_TOKEN"));
  if (!token) return { ok: false, error: "slack_not_configured", mode, week_of: week };
  const results: Record<string, number> = {};
  const bump = (k: string) => { results[k] = (results[k] || 0) + 1; };
  // A named client is handled once per call: it leaves the list after its turn, so a post that just failed is not claimed again.
  let remaining = slugs ? [...slugs] : null;
  for (let i = 0; i < limit; i++) {
    const { data: slug, error } = await db.rpc("analytics_weekly_slack_claim", { p_week_of: week, p_mode: mode, p_slugs: remaining, p_reset: slugs !== null });
    if (error) throw error;
    if (!slug) break;
    if (remaining) remaining = remaining.filter((s) => s !== String(slug));
    try { bump(await postOne(db, week, String(slug), token)); } catch (e) {
      // Never log slugs or channels: the error text only. The row stays pending; it is never posted again.
      bump("error");
      console.error("weekly slack post failed", e instanceof Error ? e.message : String(e));
    }
  }
  return { ok: true, mode, week_of: week, results };
}

async function status(db: SupabaseClient, week: string): Promise<JsonMap> {
  const { data, error } = await db.from("analytics_weekly_slack_posts").select("status,error_class").eq("week_of", week);
  if (error) throw error;
  const posts = ((data || []) as JsonMap[]).reduce((m: Record<string, number>, r) => { const k = `${r.status}${r.error_class ? ":" + r.error_class : ""}`; m[k] = (m[k] || 0) + 1; return m; }, {});
  return { ok: true, week_of: week, mode: await readMode(db), posts };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!requireKey(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 500);
  try {
    let body: JsonMap = {};
    try { const raw = await req.text(); body = raw ? JSON.parse(raw) as JsonMap : {}; } catch (_e) { return json({ ok: false, error: "bad_json" }, 400); }
    const action = clean(body.action) || "tick";
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });
    const week = weekOf();
    if (action === "status") return json(await status(db, week));
    if (action === "tick") return json(await work(db, week, 1, null));
    if (action === "run") {
      const slugs = Array.isArray(body.slugs) ? (body.slugs as unknown[]).map(clean).filter(Boolean) : [];
      if (!slugs.length || slugs.length > 3 || slugs.some((s) => !/^[a-z0-9&]+$/.test(s))) return json({ ok: false, error: "slugs_1_to_3_required" }, 400);
      return json(await work(db, week, slugs.length, slugs));
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("analytics-weekly-slack-post failed", e instanceof Error ? e.message : String(e));
    return json({ ok: false, error: "weekly_slack_post_failed" }, 500);
  }
});
