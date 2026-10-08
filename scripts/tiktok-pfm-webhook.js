#!/usr/bin/env node
'use strict';
/*
 * Points Post For Me's result webhook at the tiktok-upload function (OPEN_REPAIRS 370), through the function
 * itself, which holds the Post For Me key. Nothing here sees or prints a secret: Post For Me gives the
 * webhook's secret to the function, and the function checks every delivery against it.
 *
 *   SYNCVIEW_ADMIN_KEY=... node scripts/tiktok-pfm-webhook.js                 list the webhooks (ids, urls, events)
 *   SYNCVIEW_ADMIN_KEY=... node scripts/tiktok-pfm-webhook.js --register      add one for the function (once)
 *   SYNCVIEW_ADMIN_KEY=... node scripts/tiktok-pfm-webhook.js --remove=<id>   remove another webhook, by its id
 *
 * SYNCVIEW_ADMIN_KEY is the admin role key you sign in to SyncView with; it is read from the environment and
 * never printed. --remove refuses the function's own webhook.
 */
const FN_URL = process.env.TIKTOK_UPLOAD_FN_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/tiktok-upload';

async function call(key, body) {
  const resp = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': key, 'X-Syncview-Actor': 'tiktok-pfm-webhook', 'X-Syncview-Role': 'admin' },
    body: JSON.stringify(body),
  });
  let out = null;
  try { out = await resp.json(); } catch { out = null; }
  if (!resp.ok || !out || out.ok !== true) throw new Error('HTTP ' + resp.status + (out && out.error ? ' (' + out.error + ')' : ''));
  return out;
}

async function main() {
  const key = String(process.env.SYNCVIEW_ADMIN_KEY || '').trim();
  if (!key) { console.error('Set SYNCVIEW_ADMIN_KEY to your SyncView admin key first (it is not printed).'); process.exit(2); }
  const remove = (process.argv.find((a) => a.startsWith('--remove=')) || '').slice('--remove='.length);
  if (process.argv.includes('--register')) {
    const out = await call(key, { action: 'webhook_register' });
    console.log((out.created ? 'Added: ' : 'Already there: ') + out.webhook.id + ' -> ' + out.webhook.url + ' [' + out.webhook.event_types.join(', ') + ']');
  } else if (remove) {
    const out = await call(key, { action: 'webhook_remove', id: remove });
    console.log('Removed: ' + out.removed.id + ' -> ' + out.removed.url);
  }
  const st = await call(key, { action: 'webhook_status' });
  console.log('Post For Me webhooks (the function listens at ' + st.webhook_url + '):');
  for (const w of st.webhooks) console.log('  ' + w.id + '  ' + (w.points_here ? '[this function] ' : '') + w.url + '  [' + (w.event_types || []).join(', ') + ']');
  if (!st.webhooks.some((w) => w.points_here)) console.log('  (none points at the function yet: run with --register)');
}

main().catch((e) => { console.error('Failed: ' + (e && e.message ? e.message : String(e))); process.exit(1); });
