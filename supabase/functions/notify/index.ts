// Manual-only notification sender. SQL triggers commit durable intents; this
// function does not run automatically and never invokes n8n.
//
// Required deployment configuration before a deliberate manual invocation:
//   NOTIFY_RUNNER_KEY  service-only caller secret, sent as X-Notify-Runner-Key
//   SLACK_BOT_TOKEN    Slack bot token allowed to post in configured channels

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import { postSlackChannelMessage } from "./slack-api.ts";

type Claim = { intent_id: string; attempt: number; destination_channel_id: string; text: string; client_msg_id: string; allow_mentions: boolean };
type JsonMap = Record<string, unknown>;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-notify-runner-key",
  "Cache-Control": "no-store",
};
const MAX_BODY_BYTES = 2048;
const MAX_LIMIT = 10;

function clean(value: unknown): string { return String(value == null ? "" : value).trim(); }
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { ...CORS, "content-type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const runnerKey = clean(Deno.env.get("NOTIFY_RUNNER_KEY"));
  if (!runnerKey) return json({ ok: false, error: "server_not_configured" }, 503);
  if (!timingSafeEqual(clean(req.headers.get("x-notify-runner-key")), runnerKey)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  let body: JsonMap = {};
  try {
    const declared = Number(req.headers.get("content-length") || 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);
    const parsed = JSON.parse(raw || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ ok: false, error: "invalid_body" }, 400);
    body = parsed as JsonMap;
  } catch { return json({ ok: false, error: "invalid_body" }, 400); }
  const action = clean(body.action || "send");
  if (action !== "send" && action !== "health") return json({ ok: false, error: "action" }, 400);
  const limit = body.limit == null ? 10 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return json({ ok: false, error: "limit" }, 400);

  const url = clean(Deno.env.get("SUPABASE_URL"));
  const serviceKey = clean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!url || !serviceKey) return json({ ok: false, error: "server_not_configured" }, 503);
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  if (action === "health") {
    const health = await supabase.rpc("production_notification_health_summary");
    const data = health.data as JsonMap | null;
    const keys = ["pending_stale", "sending_stale", "blocked", "unknown", "retryable_overdue", "total_open"];
    if (health.error || !data || typeof data !== "object" || Array.isArray(data)
        || keys.some(key => !Number.isSafeInteger(Number(data[key])) || Number(data[key]) < 0)) {
      return json({ ok: false, error: "notification_monitor_unavailable" }, 503);
    }
    const counts = Object.fromEntries(keys.map(key => [key, Number(data[key])]));
    const debt = counts.pending_stale + counts.sending_stale + counts.blocked + counts.unknown;
    return json({ ok: debt === 0, ...counts }, debt ? 503 : 200);
  }
  const slackToken = clean(Deno.env.get("SLACK_BOT_TOKEN"));
  if (!slackToken) return json({ ok: false, error: "server_not_configured" }, 503);
  const claim = await supabase.rpc("production_notification_claim", { p_limit: limit });
  if (claim.error || !Array.isArray(claim.data)) return json({ ok: false, error: "notification_claim_unavailable" }, 503);

  const counts = { sent: 0, retryable: 0, blocked: 0, unknown: 0, receipt_failed: 0 };
  for (const row of claim.data as Claim[]) {
    const result = await postSlackChannelMessage(slackToken, clean(row.destination_channel_id), clean(row.text), clean(row.client_msg_id), row.allow_mentions === true);
    const args = result.kind === "sent"
      ? { p_intent_id: row.intent_id, p_attempt: row.attempt, p_outcome: "sent", p_provider_message_id: result.messageId, p_failure_code: null }
      : { p_intent_id: row.intent_id, p_attempt: row.attempt, p_outcome: result.kind, p_provider_message_id: null, p_failure_code: result.code };
    const receipt = await supabase.rpc("production_notification_record_delivery", args);
    if (receipt.error) { counts.receipt_failed++; continue; }
    counts[result.kind]++;
  }
  const failed = counts.receipt_failed + counts.blocked + counts.unknown;
  return json({ ok: failed === 0, claimed: claim.data.length, ...counts }, failed ? 502 : 200);
});
