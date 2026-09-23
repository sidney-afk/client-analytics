// Manual-only notification sender. SQL triggers commit durable intents; this
// function does not run automatically and never invokes n8n.
//
// Required deployment configuration before a deliberate manual invocation:
//   NOTIFY_RUNNER_KEY  service-only caller secret, sent as X-Notify-Runner-Key
//   SLACK_BOT_TOKEN    Slack bot token allowed to post in configured channels
// Optional:
//   NOTIFY_FORMAT      "compact" | "card" | "line" turns on the rich layout for
//                      creative-channel posts. Unset keeps the plain SQL text.
//   NOTIFY_PREVIEW_SLACK_USER_ID  the only DM the preview action may post to.
//                      Kept out of the repo. Unset means preview is refused.

import { createClient } from "npm:@supabase/supabase-js@2.49.8";
import { timingSafeEqual } from "../_shared/staff-role-auth.ts";
import { postSlackChannelMessage } from "./slack-api.ts";
import { postSlackDirectPreview } from "./slack-api.ts";
import { formatNotification, isNotifyVariant, NOTIFY_VARIANTS, type NotifyInput, type NotifyVariant, type SlackMessage } from "./format.ts";
import { urgentWebsiteText } from "./urgent-link.ts";

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
  if (action !== "send" && action !== "health" && action !== "preview") return json({ ok: false, error: "action" }, 400);
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
        || keys.some(key => typeof data[key] !== "number" || !Number.isSafeInteger(data[key]) || Number(data[key]) < 0)) {
      return json({ ok: false, error: "notification_monitor_unavailable" }, 503);
    }
    const counts = Object.fromEntries(keys.map(key => [key, Number(data[key])]));
    const debt = counts.pending_stale + counts.sending_stale + counts.blocked + counts.unknown + counts.retryable_overdue;
    if (!Number.isSafeInteger(debt) || debt > counts.total_open) {
      return json({ ok: false, error: "notification_monitor_unavailable" }, 503);
    }
    return json({ ok: debt === 0, ...counts }, debt ? 503 : 200);
  }
  const slackToken = clean(Deno.env.get("SLACK_BOT_TOKEN"));
  if (!slackToken) return json({ ok: false, error: "server_not_configured" }, 503);
  if (action === "preview") return await preview(supabase, slackToken, body);
  const format = clean(Deno.env.get("NOTIFY_FORMAT"));
  const claim = await supabase.rpc("production_notification_claim", { p_limit: limit });
  if (claim.error || !Array.isArray(claim.data)) return json({ ok: false, error: "notification_claim_unavailable" }, 503);

  const counts = { sent: 0, retryable: 0, blocked: 0, unknown: 0, receipt_failed: 0 };
  const rows = claim.data as Claim[];
  const rich = isNotifyVariant(format) ? await richPlan(supabase, rows, format) : new Map<string, RichPlan>();
  const done = new Map<string, { kind: string; messageId?: string; code?: string }>();
  for (const row of rows) {
    let text = clean(row.text);
    const plan = rich.get(row.intent_id);
    const earlier = plan?.partnerId ? done.get(plan.partnerId) : undefined;
    let lookupFailed = false;
    if (row.allow_mentions === true) {
      try {
        const intent = await supabase.from("production_notification_intents")
          .select("id,kind,state,attempt_count,destination_channel_id,deliverable_id,message")
          .eq("id", row.intent_id).single();
        if (intent.error) throw new Error("urgent_link_lookup_failed");
        text = urgentWebsiteText(row, intent.data);
      } catch { lookupFailed = true; }
    }
    // The second half of a merged status+comment pair shares its partner's one
    // post: it records the same Slack receipt instead of posting again.
    // Any outcome is mirrored, never re-posted: an unknown merged post may
    // already be in the channel, so the partner must not post again.
    const result = earlier && plan?.skip
      ? (earlier.kind === "sent" ? { kind: "sent" as const, messageId: earlier.messageId as string }
        : { kind: earlier.kind as "retryable" | "blocked" | "unknown", code: earlier.code || "merged_partner_not_sent" })
      : lookupFailed
      ? { kind: "retryable" as const, code: "urgent_link_context_unavailable" }
      : plan && !plan.skip
      ? await postSlackChannelMessage(slackToken, clean(row.destination_channel_id), plan.message.text, clean(row.client_msg_id), false, fetch, plan.message.blocks, plan.message.attachments)
      : await postSlackChannelMessage(slackToken, clean(row.destination_channel_id), text, clean(row.client_msg_id), row.allow_mentions === true);
    done.set(row.intent_id, result.kind === "sent" ? { kind: "sent", messageId: result.messageId } : { kind: result.kind, code: result.code });
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

type RichPlan = { message: SlackMessage; partnerId?: string; skip?: boolean };
const MERGE_WINDOW_MS = 120_000;
// deno-lint-ignore no-explicit-any
type Db = any;

// Everything the layout needs, read once per batch. Any read that fails leaves
// the row on its plain SQL text: a formatting problem never stops a delivery.
async function loadContext(supabase: Db, intentIds: string[]) {
  const intents = await supabase.from("production_notification_intents")
    .select("id,kind,destination_kind,destination_channel_id,client_slug,deliverable_id,source_comment_id,actor_member_id,created_at")
    .in("id", intentIds);
  if (intents.error || !Array.isArray(intents.data)) return null;
  const rows = (intents.data as JsonMap[]).filter(r => r.destination_kind === "client_creative_channel" && r.kind !== "urgent");
  const ids = (key: string) => [...new Set(rows.map(r => clean(r[key])).filter(Boolean))];
  const [dels, clients, comments] = await Promise.all([
    ids("deliverable_id").length ? supabase.from("deliverables").select("id,title,client_slug,origin,card_id").in("id", ids("deliverable_id")) : { data: [] },
    ids("client_slug").length ? supabase.from("clients").select("slug,display_name").in("slug", ids("client_slug")) : { data: [] },
    ids("source_comment_id").length ? supabase.from("production_comments").select("id,author_name,body").in("id", ids("source_comment_id")) : { data: [] },
  ]);
  if (dels.error || clients.error || comments.error) return null;
  const byKey = (list: unknown, key: string) => new Map(((list || []) as JsonMap[]).map(r => [clean(r[key]), r]));
  return { rows, dels: byKey(dels.data, "id"), clients: byKey(clients.data, "slug"), comments: byKey(comments.data, "id") };
}

function inputFor(ctx: NonNullable<Awaited<ReturnType<typeof loadContext>>>, status: JsonMap | null, comment: JsonMap | null): NotifyInput | null {
  const anchor = (status || comment) as JsonMap;
  const del = ctx.dels.get(clean(anchor.deliverable_id));
  if (!del || clean(del.client_slug) !== clean(anchor.client_slug)) return null;
  const client = ctx.clients.get(clean(anchor.client_slug));
  const c = comment ? ctx.comments.get(clean(comment.source_comment_id)) : null;
  if (comment && !c) return null;
  return {
    status: status ? clean(status.kind) as NotifyInput["status"] : null,
    title: clean(del.title), clientName: client ? clean(client.display_name) : "",
    deliverableId: clean(del.id), clientSlug: clean(del.client_slug),
    cardId: clean(del.origin) === "calendar" ? clean(del.card_id) || null : null,
    comment: c ? { author: clean(c.author_name), body: clean(c.body) } : null,
  };
}

// A status change and the comment that came with it (same card, same person,
// within two minutes, both in this batch) become one post, sent on whichever
// comes first; the other intent records the same Slack receipt.
async function richPlan(supabase: Db, claims: Claim[], variant: NotifyVariant): Promise<Map<string, RichPlan>> {
  const plans = new Map<string, RichPlan>();
  let ctx;
  try { ctx = await loadContext(supabase, claims.filter(c => c.allow_mentions !== true).map(c => c.intent_id)); } catch { return plans; }
  if (!ctx) return plans;
  const byId = new Map(ctx.rows.map(r => [clean(r.id), r]));
  const paired = new Set<string>();
  const order = claims.map(c => c.intent_id).filter(id => byId.has(id));
  for (const id of order) {
    if (paired.has(id)) continue;
    const row = byId.get(id) as JsonMap;
    const isStatus = clean(row.kind).startsWith("status_");
    const partner = order.map(o => byId.get(o) as JsonMap).find(o => o !== row && !paired.has(clean(o.id))
      && clean(o.kind).startsWith("status_") !== isStatus && clean(o.deliverable_id) === clean(row.deliverable_id)
      && clean(o.destination_channel_id) === clean(row.destination_channel_id)
      && row.actor_member_id != null && clean(o.actor_member_id) === clean(row.actor_member_id)
      && Math.abs(Date.parse(clean(o.created_at)) - Date.parse(clean(row.created_at))) <= MERGE_WINDOW_MS);
    const status = isStatus ? row : partner && !isStatus ? partner : null;
    const comment = isStatus ? partner || null : row;
    const input = inputFor(ctx, status, comment);
    if (!input) continue;
    const message = formatNotification(input, variant);
    plans.set(id, { message });
    if (partner) {
      const pid = clean(partner.id);
      paired.add(id); paired.add(pid);
      plans.set(pid, { message, partnerId: id, skip: true });
    }
  }
  return plans;
}

// Owner-only preview. Renders sample posts from real rows of ONE named client
// through formatNotification and sends them to one person's DM with the bot.
// It reads nothing from, and writes nothing to, the notification outbox.
async function preview(supabase: Db, token: string, body: JsonMap): Promise<Response> {
  // Only the pinned secret decides the recipient; the runner key is shared
  // with automated callers and does not prove who is asking.
  const target = clean(Deno.env.get("NOTIFY_PREVIEW_SLACK_USER_ID"));
  if (!/^[UW][A-Z0-9]{8,}$/.test(target)) return json({ ok: false, error: "preview_target" }, 400);
  const slug = clean(body.client_slug);
  if (!/^[a-z0-9][a-z0-9_-]{1,80}$/.test(slug)) return json({ ok: false, error: "client_slug" }, 400);
  const variants = body.variant == null ? NOTIFY_VARIANTS : isNotifyVariant(body.variant) ? [body.variant] : null;
  if (!variants) return json({ ok: false, error: "variant" }, 400);
  const client = await supabase.from("clients").select("slug,display_name").eq("slug", slug).maybeSingle();
  const del = await supabase.from("deliverables").select("id,title,client_slug,origin,card_id")
    .eq("client_slug", slug).eq("origin", "calendar").not("card_id", "is", null)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (client.error || del.error || !client.data || !del.data) return json({ ok: false, error: "preview_data_unavailable" }, 404);
  const comment = await supabase.from("production_comments").select("author_name,body")
    .eq("client_slug", slug).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const base: NotifyInput = {
    title: clean(del.data.title), clientName: clean(client.data.display_name), deliverableId: clean(del.data.id),
    clientSlug: slug, cardId: clean(del.data.card_id) || null,
  };
  const sampleComment = comment.data ? { author: clean(comment.data.author_name), body: clean(comment.data.body) } : { author: "Preview", body: "Sample comment text." };
  const samples: NotifyInput[] = [
    { ...base, status: "status_tweak", comment: sampleComment },
    { ...base, status: "status_smm_approval" },
    { ...base, comment: sampleComment },
  ];
  const results: string[] = [];
  for (const variant of variants) {
    const intro = await postSlackDirectPreview(token, target, "Preview: " + variant, [{ type: "section", text: { type: "mrkdwn", text: "*Preview · variant `" + variant + "`* (status + comment, status only, comment only)", verbatim: true } }]);
    results.push(intro.kind);
    if (intro.kind !== "sent") break;
    for (const sample of samples) {
      const message = formatNotification(sample, variant);
      results.push((await postSlackDirectPreview(token, target, message.text, message.blocks, fetch, message.attachments)).kind);
    }
  }
  const sent = results.filter(r => r === "sent").length;
  return json({ ok: sent === results.length, sent, attempted: results.length }, sent === results.length ? 200 : 502);
}
