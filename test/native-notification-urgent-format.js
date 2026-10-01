'use strict';
/*
 * The urgent editor ping in Slack: root cause of the dead link, and the new
 * layout (mention, URGENT marker, client, card title, what is needed, who
 * pinged, a real "Open in SyncView" link) in the three creative-channel
 * styles. Synthetic ids and names only; no network, no Slack, no database.
 *
 * Why the old link was not clickable: every post is sent with parse:"none",
 * which Slack documents as "remove the hyperlinks", and the address was
 * appended bare. Explicit <url|text> markup is honoured whatever `parse` says.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
if (!process.execArgv.includes('--experimental-strip-types')) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', __filename], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
const root = path.resolve(__dirname, '..');
const fn = path.join(root, 'supabase/functions/notify');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-urgent-format-'));
let passed = 0;
const ok = (name, value) => { assert.ok(value, name); passed += 1; };

const EDITOR = 'U0SYNTHEDIT';
const OWNER = 'U0SYNTHOWNR';
const ACTOR = 'U0SYNTHACTR';
const DEL = 'del_synthetic-1';
const SITE_LINK = 'https://syncview.synchrosocial.com/synclinear/' + DEL;
const input = (over = {}) => ({ editorSlackId: EDITOR, title: 'Synthetic Video 1', clientName: 'Synthetic Client', deliverableId: DEL, pingedBy: 'Synthetic Manager', ...over });

// The layouts as they were before the card's lead line became mention-only (synthetic values).
// compact and line must not change at all; the card itself (everything under the lead line) must not change.
const BEFORE = {"compact": {"text": "<@U0SYNTHEDIT> URGENT: Synthetic Video 1 needs tweaks (Synthetic Client), pinged by Synthetic Manager. <https://syncview.synchrosocial.com/synclinear/del_synthetic-1|Open in SyncView>", "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": "<@U0SYNTHEDIT>  🚨 *URGENT*: needs tweaks", "verbatim": true}}, {"type": "section", "text": {"type": "mrkdwn", "text": "*Synthetic Video 1*  ·  Synthetic Client\n🔧 *Needs tweaks*  ·  pinged by Synthetic Manager", "verbatim": true}}, {"type": "context", "elements": [{"type": "mrkdwn", "text": "<https://syncview.synchrosocial.com/synclinear/del_synthetic-1|Open in SyncView>", "verbatim": true}]}]}, "line": {"text": "<@U0SYNTHEDIT> URGENT: Synthetic Video 1 needs tweaks (Synthetic Client), pinged by Synthetic Manager. <https://syncview.synchrosocial.com/synclinear/del_synthetic-1|Open in SyncView>", "blocks": [{"type": "section", "text": {"type": "mrkdwn", "text": "🚨 *URGENT* <@U0SYNTHEDIT> · *Synthetic Video 1* · Synthetic Client · 🔧 *Needs tweaks* · pinged by Synthetic Manager\n<https://syncview.synchrosocial.com/synclinear/del_synthetic-1|Open in SyncView>", "verbatim": true}}]}, "cardBlocks": [{"type": "header", "text": {"type": "plain_text", "text": "Synthetic Video 1", "emoji": true}}, {"type": "section", "fields": [{"type": "mrkdwn", "text": "*Client*\nSynthetic Client", "verbatim": true}, {"type": "mrkdwn", "text": "*Needs*\n🔧 Tweaks", "verbatim": true}, {"type": "mrkdwn", "text": "*Pinged by*\nSynthetic Manager", "verbatim": true}]}, {"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Open in SyncView"}, "url": "https://syncview.synchrosocial.com/synclinear/del_synthetic-1"}]}], "cardAttachments": [{"color": "#E01E5A", "fallback": "<@U0SYNTHEDIT> URGENT: Synthetic Video 1 needs tweaks (Synthetic Client), pinged by Synthetic Manager.", "blocks": [{"type": "header", "text": {"type": "plain_text", "text": "Synthetic Video 1", "emoji": true}}, {"type": "section", "fields": [{"type": "mrkdwn", "text": "*Client*\nSynthetic Client", "verbatim": true}, {"type": "mrkdwn", "text": "*Needs*\n🔧 Tweaks", "verbatim": true}, {"type": "mrkdwn", "text": "*Pinged by*\nSynthetic Manager", "verbatim": true}]}, {"type": "actions", "elements": [{"type": "button", "text": {"type": "plain_text", "text": "Open in SyncView"}, "url": "https://syncview.synchrosocial.com/synclinear/del_synthetic-1"}]}]}]};

(async () => {
  const originalDeno = globalThis.Deno, originalFetch = globalThis.fetch;
  try {
    const format = await import(pathToFileURL(path.join(fn, 'format.ts')).href);
    const api = await import(pathToFileURL(path.join(fn, 'slack-api.ts')).href);

    /* ---- 1. the layouts -------------------------------------------------- */
    const flat = (m) => JSON.stringify(m);
    for (const variant of format.NOTIFY_VARIANTS) {
      const m = format.formatUrgent(input(), variant);
      const all = flat(m);
      ok(variant + ': names the editor with a real mention exactly once in the visible text/blocks',
        (all.match(new RegExp('<@' + EDITOR + '>', 'g')) || []).length >= 1 && !/<@(?!U0SYNTHEDIT>)/.test(all));
      ok(variant + ': says URGENT and what is needed', /URGENT/.test(all) && /needs tweaks|Needs tweaks|Tweaks/i.test(all));
      ok(variant + ': shows the client, the title and who pinged', /Synthetic Client/.test(all) && /Synthetic Video 1/.test(all) && /Synthetic Manager/.test(all));
      ok(variant + ': the top-level text (phone notification, screen reader) mentions the editor and carries every fact and the link',
        m.text.startsWith('<@' + EDITOR + '>') && /URGENT/.test(m.text) && /Synthetic Video 1/.test(m.text)
        && /Synthetic Client/.test(m.text) && /Synthetic Manager/.test(m.text) && m.text.includes('<' + SITE_LINK + '|Open in SyncView>'));
      if (variant === 'card') {
        const card = m.attachments[0];
        ok('card: the visible line above the card is ONE block holding only the editor mention',
          m.blocks.length === 1 && m.blocks[0].type === 'section' && m.blocks[0].text.text === '<@' + EDITOR + '>' && m.blocks[0].text.verbatim === true
          && !/URGENT|Synthetic|https?:|tweaks/i.test(flat(m.blocks)));
        ok('card: the mention appears only in that lead line, never inside the card', !flat(card.blocks).includes('<@') && card.fallback.includes('<@' + EDITOR + '>'));
        ok('card: the card itself (title, Client, Needs, Pinged by, button, colour) is exactly what it was',
          JSON.stringify(card.blocks) === JSON.stringify(BEFORE.cardBlocks) && JSON.stringify(m.attachments) === JSON.stringify(BEFORE.cardAttachments));
        ok('card: a red bar and the plain line as the attachment fallback', card.color === '#E01E5A' && /Synthetic Client/.test(card.fallback) && card.fallback.includes('<@' + EDITOR + '>'));
        ok('card: the sentence above the card is the same text, and the attachment keeps the plain link-free fallback', m.text.startsWith(card.fallback) && !/https?:/.test(card.fallback));
        const button = card.blocks.find((b) => b.type === 'actions').elements[0];
        ok('card: a real button named "Open in SyncView" with the production-card address', button.type === 'button' && button.text.text === 'Open in SyncView' && button.url === SITE_LINK);
        ok('card: Block Kit limits hold (header 150, button text 75, fields 2000)',
          card.blocks[0].text.text.length <= 150 && button.text.text.length <= 75
          && card.blocks[1].fields.every((f) => f.text.length <= 2000) && card.blocks[1].fields.length <= 10);
      } else {
        ok(variant + ': the link is explicit <url|Open in SyncView> markup', all.includes('<' + SITE_LINK + '|Open in SyncView>'));
        ok(variant + ': every occurrence of the address is inside that markup, never bare', all.split(SITE_LINK).length === all.split('<' + SITE_LINK + '|Open in SyncView>').length);
      }
    }
    ok('compact and line are byte for byte what they were',
      JSON.stringify(format.formatUrgent(input(), 'compact')) === JSON.stringify(BEFORE.compact)
      && JSON.stringify(format.formatUrgent(input(), 'line')) === JSON.stringify(BEFORE.line));
    ok('an invalid editor id is refused before anything is built', (() => { try { format.formatUrgent(input({ editorSlackId: 'not an id' }), 'card'); return false; } catch (e) { return /urgent_editor_id_invalid/.test(String(e.message)); } })());

    /* ---- 2. hostile stored text cannot add a mention, a link or @channel --- */
    const hostile = '<!channel> <@U0EVILEVIL> <https://evil.example|click> & *bold* @here `x`';
    for (const variant of format.NOTIFY_VARIANTS) {
      const m = format.formatUrgent(input({ title: hostile, clientName: hostile, pingedBy: hostile }), variant);
      const all = flat(m).replace(/\\u003c/gi, '<');
      const controls = all.match(/<[^>]*>/g) || [];
      const allowed = controls.filter((c) => c === '<@' + EDITOR + '>' || c === '<' + SITE_LINK + '|Open in SyncView>');
      ok(variant + ': the only control sequences are the editor mention and our own link', controls.length === allowed.length);
      ok(variant + ': no other mention, no @channel/@here command, no foreign address survives as markup',
        !/<!/.test(all) && !/<@U0EVILEVIL>/.test(all) && !/<https:\/\/evil/.test(all));
    }
    const long = format.formatUrgent(input({ title: 'T'.repeat(600), clientName: 'C'.repeat(600), pingedBy: 'P'.repeat(600) }), 'card');
    ok('long values are capped for the header and the fields', long.attachments[0].blocks[0].text.text.length <= 140
      && long.attachments[0].blocks[1].fields.every((f) => f.text.length <= 100));
    const ownText = format.formatUrgent(input(), 'card').text + format.urgentFallbackText(input());
    ok('none of the fixed wording uses a dash character', !/[–—]/.test(ownText));

    /* ---- 3. what is actually sent to Slack -------------------------------- */
    const msg = format.formatUrgent(input(), 'card');
    const body = api.urgentRequestBody('C1234567890', msg, 'dedupe-id');
    ok('send settings: parse none, link_names false, mrkdwn true, no unfurl, dedupe id kept',
      body.parse === 'none' && body.link_names === false && body.mrkdwn === true
      && body.unfurl_links === false && body.unfurl_media === false && body.client_msg_id === 'dedupe-id');
    ok('card posts the full-facts text, the mention-only block and the card together (with blocks present, Slack shows the blocks and uses text only as the notification and screen-reader fallback)',
      body.text === msg.text && Array.isArray(body.blocks) && body.blocks.length === 1 && body.blocks[0].text.text === '<@' + EDITOR + '>'
      && Array.isArray(body.attachments) && body.attachments.length === 1);
    ok('the fallback text still carries mention, URGENT, title, client, who pinged and the link',
      /URGENT/.test(body.text) && /Synthetic Video 1/.test(body.text) && /Synthetic Client/.test(body.text) && /Synthetic Manager/.test(body.text) && body.text.includes('|Open in SyncView>'));
    const compactBody = api.urgentRequestBody('C1234567890', format.formatUrgent(input(), 'compact'), 'x');
    ok('compact/line post text + blocks', Array.isArray(compactBody.blocks) && compactBody.attachments === undefined);
    ok('the preview body is the channel body minus the dedupe id', (() => {
      const dm = api.urgentRequestBody('D1', msg);
      const ch = api.urgentRequestBody('C1', msg, 'z');
      delete ch.client_msg_id; ch.channel = dm.channel;
      return JSON.stringify(dm) === JSON.stringify(ch) && !('client_msg_id' in dm);
    })());
    let seen;
    const fetchOk = (channel) => async (_u, o) => { seen = JSON.parse(o.body); return new Response(JSON.stringify({ ok: true, channel, ts: '1788800000.123456' }), { status: 200 }); };
    ok('channel post: sent only when Slack echoes the same channel and a timestamp',
      (await api.postSlackUrgentMessage('t', 'C1234567890', msg, 'id', fetchOk('C1234567890'))).kind === 'sent' && seen.channel === 'C1234567890');
    ok('channel post: a different channel in the answer is not a delivery',
      (await api.postSlackUrgentMessage('t', 'C1234567890', msg, 'id', fetchOk('C9999999999'))).kind === 'blocked');
    ok('channel post: 429 retryable, 5xx unknown, transport unknown',
      (await api.postSlackUrgentMessage('t', 'C1234567890', msg, 'id', async () => new Response('{}', { status: 429 }))).kind === 'retryable'
      && (await api.postSlackUrgentMessage('t', 'C1234567890', msg, 'id', async () => new Response('x', { status: 502 }))).kind === 'unknown'
      && (await api.postSlackUrgentMessage('t', 'C1234567890', msg, 'id', async () => { throw new Error('net'); })).kind === 'unknown');
    ok('direct preview: refuses a channel id and accepts only a person', (await api.postSlackDirectUrgentPreview('t', 'C1234567890', msg)).kind === 'blocked'
      && (await api.postSlackDirectUrgentPreview('t', OWNER, msg, fetchOk('D0SYNTHDM00'))).kind === 'sent' && !('client_msg_id' in seen));
    ok('direct preview: an answer from a channel is not accepted', (await api.postSlackDirectUrgentPreview('t', OWNER, msg, fetchOk('C1234567890'))).kind === 'blocked');

    /* ---- 4. the real handler ---------------------------------------------- */
    const env = { NOTIFY_RUNNER_KEY: 'synthetic-private-key', SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', SLACK_BOT_TOKEN: 'synthetic-token' };
    let external = 0;
    globalThis.fetch = async () => { external++; throw Error('external transport refused'); };
    let handler;
    globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
    let claim, intent, tables, receipts, plain, rich, dms, dmUrgent;
    const chain = (resolve) => {
      const q = {};
      for (const k of ['select', 'eq', 'in', 'not', 'order', 'limit', 'is']) q[k] = () => q;
      q.single = async () => resolve();
      q.maybeSingle = async () => resolve();
      q.then = (ok2, bad) => Promise.resolve(resolve()).then(ok2, bad);
      return q;
    };
    globalThis.__db = {
      rpc: async (name, args) => {
        if (name === 'production_notification_claim') return { data: [claim], error: null };
        assert.equal(name, 'production_notification_record_delivery'); receipts.push(args); return { error: null };
      },
      from: (name) => chain(() => tables[name]()),
    };
    globalThis.__plain = async (...a) => { plain.push(a); return { kind: 'sent', messageId: '1788800000.123456' }; };
    globalThis.__rich = async (...a) => { rich.push(a); return { kind: 'sent', messageId: '1788800000.123456' }; };
    globalThis.__dm = async (...a) => { dms.push(a); return { kind: 'sent', messageId: '1788800000.123456' }; };
    globalThis.__dmUrgent = async (...a) => { dmUrgent.push(a); return { kind: 'sent', messageId: '1788800000.123456' }; };
    let source = fs.readFileSync(path.join(fn, 'index.ts'), 'utf8');
    const sdk = 'import { createClient } from "npm:@supabase/supabase-js@2.49.8";';
    assert.equal(source.split(sdk).length, 2);
    source = source.replace(sdk, 'const createClient = () => globalThis.__db;');
    const url = (f) => JSON.stringify(pathToFileURL(path.join(root, f)).href);
    source = source.replace('"../_shared/staff-role-auth.ts"', url('supabase/functions/_shared/staff-role-auth.ts'))
      .replace('"./format.ts"', url('supabase/functions/notify/format.ts'))
      .replace('"./urgent-link.ts"', url('supabase/functions/notify/urgent-link.ts'))
      .replace(/import \{ postSlackChannelMessage \} from [^;]+;/, 'const postSlackChannelMessage = (...a) => globalThis.__plain(...a);')
      .replace('import { postSlackDirectPreview } from "./slack-api.ts";', 'const postSlackDirectPreview = (...a) => globalThis.__dm(...a);')
      .replace('import { postSlackDirectUrgentPreview, postSlackUrgentMessage } from "./slack-api.ts";',
        'const postSlackUrgentMessage = (...a) => globalThis.__rich(...a);const postSlackDirectUrgentPreview = (...a) => globalThis.__dmUrgent(...a);');
    const file = path.join(tmp, 'notify.ts'); fs.writeFileSync(file, source, { flag: 'wx' });
    await import(pathToFileURL(file));
    assert.equal(typeof handler, 'function');

    const id = '00000000-0000-4000-8000-0000000000aa';
    const base = { intent_id: id, attempt: 1, destination_channel_id: 'C1234567890', text: '<@' + EDITOR + '> URGENT: Synthetic Video 1 needs tweaks.', client_msg_id: id, allow_mentions: true };
    const stored = { id, kind: 'urgent', state: 'sending', attempt_count: 1, destination_channel_id: base.destination_channel_id, deliverable_id: DEL,
      client_slug: 'synthetic-client', actor_member_id: 'm-actor', intended_member_id: 'm-editor', message: { text: base.text, allow_mentions: true } };
    const goodTables = () => ({
      production_notification_intents: () => ({ data: intent, error: null }),
      deliverables: () => ({ data: { id: DEL, title: 'Synthetic Video 1', client_slug: 'synthetic-client' }, error: null }),
      clients: () => ({ data: { slug: 'synthetic-client', display_name: 'Synthetic Client' }, error: null }),
      production_comments: () => ({ data: null, error: null }),
      team_members: () => ({ data: [{ id: 'm-editor', name: 'Synthetic Editor', slack_user_id: EDITOR }, { id: 'm-actor', name: 'Synthetic Manager', slack_user_id: ACTOR }], error: null }),
    });
    async function run(over = {}) {
      claim = over.claim || base; intent = over.intent || stored; tables = Object.assign(goodTables(), over.tables || {});
      plain = []; rich = []; receipts = []; dms = []; dmUrgent = [];
      for (const k of ['NOTIFY_URGENT_FORMAT']) { if (over.format) env[k] = over.format; else delete env[k]; }
      const r = await handler(new Request('http://127.0.0.1/notify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-notify-runner-key': env.NOTIFY_RUNNER_KEY }, body: '{}' }));
      return r.json();
    }

    let r = await run();
    ok('flag unset: today\'s plain line goes out unchanged, bare address and all',
      r.sent === 1 && plain.length === 1 && rich.length === 0 && plain[0][2] === base.text + '\nOpen in SyncView: ' + SITE_LINK);
    r = await run({ format: 'card' });
    ok('flag set: one rich post to the claimed channel with the dedupe id, no plain post',
      r.sent === 1 && rich.length === 1 && plain.length === 0 && rich[0][1] === 'C1234567890' && rich[0][3] === id && rich[0][0] === 'synthetic-token');
    const richMsg = rich[0][2];
    ok('flag set: the message carries editor, URGENT, client, title, who pinged, and the button',
      richMsg.text.startsWith('<@' + EDITOR + '>') && /Synthetic Client/.test(flat(richMsg)) && /Synthetic Video 1/.test(flat(richMsg)) && /Synthetic Manager/.test(flat(richMsg)) && /Open in SyncView/.test(flat(richMsg)));
    r = await run({ format: 'line' });
    ok('flag set (line): the link is explicit markup', rich[0][2].blocks[0].text.text.includes('<' + SITE_LINK + '|Open in SyncView>'));
    r = await run({ format: 'compact' });
    ok('flag set (compact): blocks, not attachments', Array.isArray(rich[0][2].blocks) && !rich[0][2].attachments);
    r = await run({ format: 'bogus' });
    ok('an unknown flag value behaves as unset', plain.length === 1 && rich.length === 0 && plain[0][2].includes('Open in SyncView: https://'));

    r = await run({ format: 'card', tables: { clients: () => ({ data: null, error: { message: 'down' } }) } });
    ok('context read fails: the plain line goes out with an EXPLICIT link, delivery is not stopped',
      r.sent === 1 && rich.length === 0 && plain.length === 1 && plain[0][2] === base.text + '\n<' + SITE_LINK + '|Open in SyncView>');
    r = await run({ format: 'card', tables: { team_members: () => ({ data: [{ id: 'm-editor', name: 'Someone Else', slack_user_id: 'U0OTHERPERS' }], error: null }) } });
    ok('assigned editor id differs from the mention in the claim: no rich post, explicit-link plain line',
      r.sent === 1 && rich.length === 0 && plain[0][2].endsWith('|Open in SyncView>'));
    r = await run({ format: 'card', tables: { deliverables: () => ({ data: { id: DEL, title: 'X', client_slug: 'another-client' }, error: null }) } });
    ok('deliverable belongs to another client: no rich post', rich.length === 0 && plain.length === 1);
    r = await run({ format: 'card', claim: { ...base, text: 'URGENT without a mention' }, intent: { ...stored, message: { text: 'URGENT without a mention', allow_mentions: true } } });
    ok('claim text without the leading mention: no rich post', rich.length === 0 && plain.length === 1);
    r = await run({ format: 'card', intent: { ...stored, state: 'sent' } });
    ok('the existing claim validation still refuses a mismatched intent before any layout work', r.retryable === 1 && rich.length === 0 && plain.length === 0);
    r = await run({ format: 'card', claim: { ...base, allow_mentions: false }, intent: null });
    ok('a non-urgent claim never takes the urgent path', rich.length === 0);

    /* ---- 5. the owner-only preview ----------------------------------------- */
    env.NOTIFY_PREVIEW_SLACK_USER_ID = OWNER;
    async function preview(kind, variant) {
      tables = Object.assign(goodTables(), {
        deliverables: () => ({ data: { id: DEL, title: 'Synthetic Video 1', client_slug: 'synthetic-client', origin: 'calendar', card_id: 'c1' }, error: null }),
      });
      plain = []; rich = []; dms = []; dmUrgent = [];
      const body = { action: 'preview', client_slug: 'synthetic-client', ...(kind ? { kind } : {}), ...(variant ? { variant } : {}) };
      const res = await handler(new Request('http://127.0.0.1/notify', { method: 'POST', headers: { 'content-type': 'application/json', 'x-notify-runner-key': env.NOTIFY_RUNNER_KEY }, body: JSON.stringify(body) }));
      return { status: res.status, body: await res.json() };
    }
    let p = await preview('urgent');
    ok('urgent preview: three variants, each an intro plus the message, all to the pinned person only',
      p.status === 200 && p.body.sent === 6 && dms.length === 3 && dmUrgent.length === 3 && dms.every((c) => c[1] === OWNER) && dmUrgent.every((c) => c[1] === OWNER));
    ok('urgent preview: the mention is the person running it, never an editor, and nothing reaches a channel',
      dmUrgent.every((c) => c[2].text.includes('<@' + OWNER + '>') && !flat(c[2]).includes(EDITOR)) && plain.length === 0 && rich.length === 0);
    ok('urgent preview: marked as a preview, not a real ping', dmUrgent.every((c) => /Preview \(not a real ping\)/.test(flat(c[2]))));
    p = await preview('urgent', 'card');
    ok('urgent preview: one variant when asked', p.body.sent === 2 && dmUrgent.length === 1);
    p = await preview(null, 'card');
    ok('creative preview is unchanged and never uses the urgent path', dmUrgent.length === 0);
    p = await preview('anything-else');
    ok('an unknown preview kind is refused', p.status === 400 && p.body.error === 'kind');
    delete env.NOTIFY_PREVIEW_SLACK_USER_ID;
    p = await preview('urgent');
    ok('without the pinned person the preview is refused', p.status === 400 && p.body.error === 'preview_target');

    ok('no external call was made by any of this', external === 0);

    /* ---- 6. the preview lane --------------------------------------------- */
    const wf = fs.readFileSync(path.join(root, '.github/workflows/native-notification-preview.yml'), 'utf8');
    ok('preview workflow: a message choice [creative, urgent] that defaults to creative and is passed through',
      /message:[\s\S]*default: creative[\s\S]*options: \[creative, urgent\]/.test(wf) && /KIND: \$\{\{ inputs\.message \}\}/.test(wf) && /b\.kind="urgent"/.test(wf));
    ok('preview workflow: still prints counts only', /Print counts only/.test(wf));

    console.log('NATIVE_NOTIFICATION_URGENT_FORMAT_OK ' + passed + ' checks; external calls 0');
  } finally {
    globalThis.Deno = originalDeno; globalThis.fetch = originalFetch;
    delete globalThis.__db; delete globalThis.__plain; delete globalThis.__rich; delete globalThis.__dm; delete globalThis.__dmUrgent;
    assert(fs.realpathSync(tmp).startsWith(fs.realpathSync(os.tmpdir())));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
