'use strict';
// A whole-card calendar save (v1 mode, or a forced resend) must not send the
// tab's stale status columns unless this save edited them: on 2026-09-26 an
// asset-only save moved an approved video back to In Progress.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src/index/170-calendar-links-status.js.part'), 'utf8');
const thumb = fs.readFileSync(path.join(__dirname, '..', 'src/index/160-calendar-organize-ui.js.part'), 'utf8');
let passed = 0;
function ok(c, m) { if (!c) { console.error('FAIL ' + m); process.exit(1); } passed++; console.log('  ok  ' + m); }
const m = src.match(/const CAL_WHOLE_CARD_STATUS_FIELDS = (\[[^\]]*\]);/);
ok(m, 'the status field list exists');
const fields = JSON.parse(m[1].replace(/'/g, '"'));
ok(['status', 'video_status', 'graphic_status', 'caption_status', 'title_status'].every(f => fields.includes(f)), 'it names every status column');
const body = src.slice(src.indexOf('async function _calFlushCardSave('));
const guard = /if \(!wasNewRow && Object\.keys\(edits\)\.length > 0\) \{\s*for \(const k of CAL_WHOLE_CARD_STATUS_FIELDS\) \{\s*if \(!\(k in edits\)\) delete wirePost\[k\];/;
ok(guard.test(body), 'the whole-card branch strips unedited status columns (not on new rows or empty resends)');
// Behaviour of the guard itself.
function strip(wirePost, edits, wasNewRow) {
  if (!wasNewRow && Object.keys(edits).length > 0) for (const k of fields) if (!(k in edits)) delete wirePost[k];
  return wirePost;
}
const w = strip({ id: 'p', asset_url: 'u', video_status: 'In Progress', status: 'x' }, { asset_url: 'u' }, false);
ok(!('video_status' in w) && !('status' in w) && w.asset_url === 'u', 'an asset-only save sends no status');
ok(strip({ video_status: 'Approved' }, { video_status: 'Approved' }, false).video_status === 'Approved', 'an edited status is kept');
ok(strip({ video_status: 'In Progress' }, {}, true).video_status === 'In Progress', 'a new row keeps its statuses');
ok(/if \(!headers\['X-Syncview-Key'\] && !headers\['X-Syncview-Client-Token'\]\) return;/.test(thumb), 'the thumbnail probe skips a request with no credential');
ok(/response\.status === 401 \|\| response\.status === 403/.test(thumb), 'a refused thumbnail probe is cached per version');
console.log(`calendar-whole-card-status-guard: ${passed} checks passed`);
