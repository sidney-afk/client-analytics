// client-review-alert: the "Notify client" button's server half.
//
// One general Slack alert to a client's PRIVATE channel (the roster's
// slack_channel_id, never creative_channel_id) saying new content or new
// samples are ready for review, with one button to that client's review page.
//
// The browser sends only { action, client, surface }. The channel and the link
// are looked up here, so a caller can never aim a message at another channel or
// attach another address. Staff keys only (admin, smm); a client token is not a
// staff key and never authorises anything here. The logic lives in this file so
// it can be tested in Node; supabase/functions/client-review-alert/index.ts only
// wires it to Deno, the role-key gate, Slack and a service-role client.
//
// Actions:
//   status   admin|smm  what the confirm box shows: the exact words, the channel
//                       name, the last alert for this client and surface.
//   send     admin|smm  posts the alert to the client's private channel. Records
//                       every attempt first, so "last sent" is always true.
//   preview  admin      posts the exact same message to the owner's DM only
//                       (NOTIFY_PREVIEW_SLACK_USER_ID), never to a channel.
//   audit    admin      counts of active clients with no private channel and
//                       with a channel the bot is not a member of.
//
// Needs migration 20261014120000_client_review_alerts.sql applied first. Until
// it is, "send" answers log_unavailable and posts nothing.
import { normalizeWriteClient } from './browser-write-auth-policy.mjs';
import { reviewTokenAction } from './client-review-token-policy.mjs';

export const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-syncview-key, x-syncview-actor, x-syncview-role',
  'Cache-Control': 'no-store',
});
export const ACTIONS = Object.freeze(['status', 'send', 'preview', 'audit']);
export const MAX_BODY = 4096;
export const RECENT_MS = 6 * 60 * 60 * 1000;
// A send that was recorded but not yet answered by Slack counts as "just sent"
// for this long, so a double click cannot post twice.
export const PENDING_MS = 2 * 60 * 1000;
export const DEFAULT_ORIGIN = 'https://syncview.synchrosocial.com';
export const BUTTON_LABEL = 'Review now';
export const SURFACES = Object.freeze({
  calendar: Object.freeze({ view: 'calendar', headline: 'New content is ready for your review.' }),
  samples: Object.freeze({ view: 'sample-reviews', headline: 'New samples are ready for your review.' }),
});

const clean = (value) => String(value == null ? '' : value).trim();
const respond = (cors, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// The same address the page's "Copy client link" builds (see
// _syncviewIssueClientShareUrl): samples carry sxr=1, then c, v and t.
export function buildReviewLink({ origin, displayName, surface, token }) {
  const s = SURFACES[surface];
  if (!s) throw new Error('unknown_surface');
  const q = new URLSearchParams();
  if (surface === 'samples') q.set('sxr', '1');
  q.set('c', displayName);
  q.set('v', s.view);
  q.set('t', token);
  return clean(origin).replace(/\/+$/, '') + '/?' + q.toString();
}

// Slack blocks: one bold line and one button. No name, no count, no emoji.
export function buildMessage(surface, link) {
  const s = SURFACES[surface];
  if (!s) throw new Error('unknown_surface');
  return {
    text: s.headline + ' ' + BUTTON_LABEL + ': ' + link,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: '*' + s.headline + '*' } },
      { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: BUTTON_LABEL }, url: link }] },
    ],
  };
}

// The words the confirm box shows. Same headline and button label as the
// message above, with no address in it (the link carries the client's token).
export function previewWords(surface) {
  const s = SURFACES[surface];
  return { headline: s.headline, button: BUTTON_LABEL };
}

// Was an alert sent for this client and surface inside the last six hours? A
// failed attempt does not count; one still waiting on Slack or whose outcome is
// unknown does, because it may already be in the channel.
export function lastCounted(rows, now) {
  let best = null;
  for (const r of rows || []) {
    const at = Date.parse(clean(r && r.created_at));
    if (!Number.isFinite(at)) continue;
    const status = clean(r.status);
    const counts = status === 'sent' || status === 'unknown' || (status === 'pending' && now - at < PENDING_MS);
    if (counts && (!best || at > best.at)) best = { at, row: r };
  }
  if (!best) return { last: null, recent: false };
  return {
    last: { at: new Date(best.at).toISOString(), by: clean(best.row.actor) || null, status: clean(best.row.status) },
    recent: now - best.at < RECENT_MS,
  };
}

export function buildHandler(deps) {
  // index.ts passes its own CORS table (the deploy checks read the literal there); CORS above is the same table.
  const cors = deps.cors || CORS;
  const json = (body, status = 200) => respond(cors, body, status);
  const now = () => (typeof deps.now === 'function' ? deps.now() : Date.now());

  async function context(db, slug, surface) {
    const client = await db.from('clients').select('slug,display_name,active').eq('slug', slug).maybeSingle();
    if (client.error) return { fail: json({ ok: false, error: 'lookup_unavailable' }, 503) };
    if (!client.data) return { fail: json({ ok: false, error: 'unknown_client' }, 404) };
    if (client.data.active !== true) return { fail: json({ ok: false, error: 'inactive_client' }, 410) };
    // Only the private channel is ever read. creative_channel_id is not selected.
    const profile = await db.from('client_profiles').select('slack_channel_id,archived_at').eq('slug', slug).maybeSingle();
    if (profile.error) return { fail: json({ ok: false, error: 'lookup_unavailable' }, 503) };
    const channelId = profile.data && !profile.data.archived_at ? clean(profile.data.slack_channel_id) : '';
    const access = await db.from('client_access').select('review_token').eq('slug', slug).maybeSingle();
    if (access.error) return { fail: json({ ok: false, error: 'lookup_unavailable' }, 503) };
    const decision = reviewTokenAction(access.data || null);
    const token = decision.action === 'reuse' ? clean(decision.token) : '';
    return { displayName: clean(client.data.display_name) || slug, channelId, token };
  }

  async function history(db, slug, surface) {
    const res = await db.from('client_review_alerts').select('created_at,actor,status')
      .eq('client_slug', slug).eq('surface', surface).eq('mode', 'send')
      .order('created_at', { ascending: false }).limit(20);
    if (res.error) return null;
    return res.data || [];
  }

  return async function handle(req) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

    // Staff keys only, checked before the body is read or a database client is
    // made. A client review token is a different header and is never looked at.
    const staffKey = clean(req.headers.get('x-syncview-key'));
    const auth = staffKey ? deps.authorize(staffKey, ['admin', 'smm']) : { ok: false, role: null };
    if (!auth.ok || (auth.role !== 'admin' && auth.role !== 'smm')) {
      return json({ ok: false, error: 'unauthorized' }, auth.role ? 403 : 401);
    }
    const role = auth.role;

    try {
      const raw = await req.text();
      if (raw.length > MAX_BODY) return json({ ok: false, error: 'body_too_large' }, 413);
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (_e) { return json({ ok: false, error: 'bad_json' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ ok: false, error: 'bad_json' }, 400);
      const action = clean(body.action);
      if (!ACTIONS.includes(action)) return json({ ok: false, error: 'unknown_action' }, 400);
      if ((action === 'preview' || action === 'audit') && role !== 'admin') return json({ ok: false, error: 'unauthorized' }, 403);

      const db = deps.makeClient();
      if (!db) return json({ ok: false, error: 'server_not_configured' }, 503);
      const slackToken = clean(deps.slackToken());
      const slack = deps.slack;

      if (action === 'audit') {
        if (!slackToken) return json({ ok: false, error: 'slack_not_configured' }, 503);
        return await audit(db, slack, slackToken, body, json);
      }

      const slug = normalizeWriteClient(body.client);
      if (!slug) return json({ ok: false, error: 'invalid_client' }, 400);
      const surface = clean(body.surface);
      if (!SURFACES[surface]) return json({ ok: false, error: 'invalid_surface' }, 400);
      const ctx = await context(db, slug, surface);
      if (ctx.fail) return ctx.fail;
      const previewTarget = clean(deps.previewUserId());
      const canPreview = role === 'admin' && /^[UW][A-Z0-9]{8,}$/.test(previewTarget);

      if (action === 'status') {
        const rows = await history(db, slug, surface);
        const { last, recent } = rows ? lastCounted(rows, now()) : { last: null, recent: false };
        let channel = { name: null, bot_member: null };
        if (ctx.channelId && slackToken) {
          const info = await slack.channelInfo(slackToken, ctx.channelId);
          channel = { name: info.name || null, bot_member: info.ok ? info.member : (info.code === 'bot_not_in_channel' ? false : null) };
        }
        return json({
          ok: true, client: slug, surface, ...previewWords(surface),
          has_channel: !!ctx.channelId, channel, link_ready: !!ctx.token,
          last, recent, recent_hours: RECENT_MS / 3600000,
          log_available: rows !== null, sending_enabled: deps.sendingEnabled() === true, can_preview: canPreview,
        });
      }

      if (!ctx.token) return json({ ok: false, error: 'review_token_missing' }, 409);
      const link = buildReviewLink({ origin: deps.origin() || DEFAULT_ORIGIN, displayName: ctx.displayName, surface, token: ctx.token });
      const message = buildMessage(surface, link);
      if (!slackToken) return json({ ok: false, error: 'slack_not_configured' }, 503);

      if (action === 'preview') {
        if (!canPreview) return json({ ok: false, error: 'preview_target' }, 400);
        const out = await slack.postDirect(slackToken, previewTarget, message);
        await record(db, deps, { slug, surface, mode: 'preview', actor: actorOf(req, role), role, channelId: '', out, at: now() });
        if (out.kind !== 'sent') return json({ ok: false, error: out.code }, 502);
        return json({ ok: true, previewed: true });
      }

      // action === 'send'
      if (deps.sendingEnabled() !== true) return json({ ok: false, error: 'sending_not_enabled' }, 403);
      if (!ctx.channelId) return json({ ok: false, error: 'no_slack_channel' }, 409);
      const rows = await history(db, slug, surface);
      if (rows === null) return json({ ok: false, error: 'log_unavailable' }, 503);
      const { last, recent } = lastCounted(rows, now());
      if (recent && body.confirm_recent !== true) return json({ ok: false, error: 'recently_sent', last }, 409);
      // The attempt is written BEFORE Slack is called. If that write fails,
      // nothing is posted: an alert with no record would break "last sent".
      const id = deps.newId();
      const started = await db.from('client_review_alerts').insert({
        id, client_slug: slug, surface, mode: 'send', actor: actorOf(req, role), role, channel_id: ctx.channelId, status: 'pending',
        created_at: new Date(now()).toISOString(),
      });
      if (started.error) return json({ ok: false, error: 'log_unavailable' }, 503);
      const out = await slack.postChannel(slackToken, ctx.channelId, message, id);
      const status = out.kind === 'sent' ? 'sent' : out.kind === 'unknown' ? 'unknown' : 'failed';
      const finished = await db.from('client_review_alerts').update({
        status, slack_ts: out.kind === 'sent' ? out.messageId : null, slack_error: out.kind === 'sent' ? null : clean(out.code).slice(0, 80),
        finished_at: new Date(now()).toISOString(),
      }).eq('id', id);
      // The post already happened (or is unknown). A receipt that will not save
      // is reported, never retried into a second post.
      if (out.kind === 'sent') return json({ ok: true, sent: true, receipt_saved: !finished.error });
      return json({ ok: false, error: out.code, unconfirmed: out.kind === 'unknown' }, 502);
    } catch (_e) {
      return json({ ok: false, error: 'request_failed' }, 500);
    }
  };
}

function actorOf(req, role) {
  // Attribution only. The role comes from the key; the name comes from the
  // header the page attaches and never widens what a caller may do.
  const name = clean(req.headers.get('x-syncview-actor')).replace(/[^\p{L}\p{N} .'_-]/gu, '').slice(0, 80);
  return name || 'staff:' + role;
}

async function record(db, deps, r) {
  try {
    await db.from('client_review_alerts').insert({
      id: deps.newId(), client_slug: r.slug, surface: r.surface, mode: r.mode, actor: r.actor, role: r.role,
      channel_id: r.channelId || null, status: r.out.kind === 'sent' ? 'sent' : r.out.kind === 'unknown' ? 'unknown' : 'failed',
      slack_ts: r.out.kind === 'sent' ? r.out.messageId : null, slack_error: r.out.kind === 'sent' ? null : clean(r.out.code).slice(0, 80),
      created_at: new Date(r.at).toISOString(), finished_at: new Date(r.at).toISOString(),
    });
  } catch (_e) { /* the preview's record is best effort */ }
}

// Counts only by default. The names of the clients behind each count are
// returned for the admin who asked, in `detail`, and are never stored.
async function audit(db, slack, token, body, json) {
  const clients = await db.from('clients').select('slug,kind,active').eq('active', true);
  const profiles = await db.from('client_profiles').select('slug,slack_channel_id,archived_at');
  if (clients.error || profiles.error) return json({ ok: false, error: 'lookup_unavailable' }, 503);
  const byProfile = new Map((profiles.data || []).map((p) => [clean(p.slug), p]));
  const real = (clients.data || []).filter((c) => clean(c.kind) === 'client');
  const noChannel = [], notMember = [], unchecked = [];
  for (const c of real) {
    const p = byProfile.get(clean(c.slug));
    const channel = p && !p.archived_at ? clean(p.slack_channel_id) : '';
    if (!channel) { noChannel.push(clean(c.slug)); continue; }
    const info = await slack.channelInfo(token, channel);
    if (info.ok && info.member === false) notMember.push(clean(c.slug));
    else if (!info.ok && info.code === 'bot_not_in_channel') notMember.push(clean(c.slug));
    else if (!info.ok) unchecked.push(clean(c.slug));
  }
  const out = { ok: true, active_clients: real.length, without_channel: noChannel.length, bot_not_member: notMember.length, not_checked: unchecked.length };
  if (body.detail === true) out.detail = { without_channel: noChannel, bot_not_member: notMember, not_checked: unchecked };
  return json(out);
}
