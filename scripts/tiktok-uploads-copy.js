#!/usr/bin/env node
'use strict';
/*
 * One-time copy of the TikTokUpload Sheet tab into the table tiktok_uploads (OPEN_REPAIRS 362), so the TikTok
 * queue keeps its history after the move off n8n and the Sheet. It asks the deployed tiktok-upload function to
 * do the copy (action "import_sheet"): the function reads the Sheet with its own Google service account and
 * adds every row the table does not have yet. A row already in the table is never changed, so running it again
 * is safe and only adds what is new.
 *
 *   SYNCVIEW_ADMIN_KEY=... node scripts/tiktok-uploads-copy.js           dry run: counts only, writes nothing
 *   SYNCVIEW_ADMIN_KEY=... node scripts/tiktok-uploads-copy.js --apply   copies
 *
 * SYNCVIEW_ADMIN_KEY is the admin role key you sign in to SyncView with. It is read from the environment,
 * sent only to the function, and never printed. The output is counts only: no client names, no captions.
 */
const FN_URL = process.env.TIKTOK_UPLOAD_FN_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/tiktok-upload';

async function main() {
  const key = String(process.env.SYNCVIEW_ADMIN_KEY || '').trim();
  if (!key) {
    console.error('Set SYNCVIEW_ADMIN_KEY to your SyncView admin key first (it is not printed).');
    process.exit(2);
  }
  const apply = process.argv.includes('--apply');
  const resp = await fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': key, 'X-Syncview-Actor': 'tiktok-uploads-copy', 'X-Syncview-Role': 'admin' },
    body: JSON.stringify({ action: 'import_sheet', dry_run: !apply }),
  });
  let out = null;
  try { out = await resp.json(); } catch { out = null; }
  if (!resp.ok || !out || out.ok !== true) {
    console.error('Copy refused: HTTP ' + resp.status + (out && out.error ? ' (' + out.error + ')' : ''));
    process.exit(1);
  }
  const c = out.counts || {};
  console.log((apply ? 'Copied.' : 'Dry run, nothing written.') + ' Sheet rows: ' + (c.sheet_rows || 0) + ', usable: ' + (c.valid || 0) +
    ', skipped (bad id): ' + (c.skipped_bad_id || 0) + ', skipped (no client): ' + (c.skipped_no_client || 0) +
    ', unknown status kept as failed: ' + (c.unknown_status || 0) + ', repeated ids: ' + (c.repeated_id || 0) +
    (apply ? ', added: ' + (c.copied || 0) + ', already in the table: ' + (c.already_here || 0) : ''));
}

main().catch((e) => { console.error('Copy failed: ' + (e && e.message ? e.message : String(e))); process.exit(1); });
