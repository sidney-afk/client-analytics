'use strict';
/*
 * OPEN_REPAIRS 314, item 2: two people on one Calendar card get a notice, not a
 * silent overwrite. Source-shape checks (offline); the behaviour is proven in a
 * browser by docs/syncview-design/tests/lost-work-conflict-browser.js (mocked).
 *
 *   - the comparison is by VALUE of the one field being saved (not by updated_at,
 *     which triggers bump after the person's own write);
 *   - the fresh read is narrow, time-limited, and a failed or slow read lets the
 *     save go ahead (the permissive choice);
 *   - it never runs for a client link or a new card;
 *   - the Calendar still sends no comments_base_at, and nothing server-side moved.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { stripComments } = require('./helpers/strip-comments');
const ROOT = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, 'src/index/170-calendar-links-status.js.part'), 'utf8');
const src = stripComments(raw);
let failures = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures++; };

ok(/const CAL_CONFLICT_FIELDS = \['caption', 'video_status', 'graphic_status', 'caption_status', 'title_status'\];/.test(src), 'covers the caption and the four component statuses, nothing else');
const gate = (src.match(/async function _calConflictGate\([\s\S]*?\n    \}\n/) || [''])[0];
ok(gate.length > 500, 'gate found');
ok(/_calNormForCompare\(theirs\) === _calNormForCompare\(mine\) \|\| _calNormForCompare\(theirs\) === _calNormForCompare\(base\)\) return;/.test(gate), 'no notice when the server value equals mine or equals what the person was looking at');
ok(!/updated_at/.test(gate), 'the gate never compares updated_at');
ok(/const fresh = real\.length \? await _calFreshFields/.test(gate) && /if \(fresh\) \{/.test(gate), 'a missing fresh read holds nothing (save proceeds)');
const read = (src.match(/async function _calFreshFields\([\s\S]*?\n    \}\n/) || [''])[0];
ok(/select=' \+ \['id'\]\.concat\(fields\)/.test(read) && /&limit=1/.test(read), 'the read asks for the edited field(s) of one row only');
ok(/catch \(e\) \{ return null; \}/.test(read) && /if \(!resp\.ok\) return null;/.test(read), 'a failed read returns nothing instead of blocking');
ok(/CAL_CONFLICT_READ_TIMEOUT_MS = 2500/.test(src) && /ctl\.abort\(\)/.test(read), 'a slow read is cut off after 2.5 seconds');
ok(/if \(!isBlank && !_isClientLink && calState\.posts\.some\(p => p\.id === realId\)\) \{[\s\S]*?_calConflictGate\(realId, _saveSlug, edits\)/.test(src), 'only for staff, on an existing card');
ok(/if \(hadKeys && !Object\.keys\(edits\)\.length\) return;/.test(src), 'when every field was held or unchanged nothing is sent');
ok(/_calBaseAfterSave\(realId, edits, saved\);/.test(src), 'a landed save moves the base forward (continued typing stays unflagged)');
ok(/const _baseAtToSend = _calV2Enabled\(\) \? '' : /.test(src), 'the Calendar still sends no comments_base_at (the server guard is untouched)');
ok(/data-conflict-mine/.test(src) && /data-conflict-theirs/.test(src) && /data-conflict-restore/.test(src), 'Keep mine, Use theirs and Put mine back are all offered');
ok(/_calKeepMineNext/.test(src) && /< 60000/.test(gate), 'Keep mine skips the check once, for a short time');
// Frozen writers and server code are not part of this change.
try {
  const base = execSync('git merge-base HEAD origin/main', { cwd: ROOT, encoding: 'utf8' }).trim();
  const changed = execSync('git diff --name-only ' + base + ' HEAD', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  // Scoped to the frozen writers this change promised not to touch. It used to
  // forbid ANY Edge Function change on the branch, which fails every later
  // branch that legitimately adds or edits one (found 2026-10-02).
  ok(!changed.some(f => /^supabase\/functions\/(calendar-upsert|sample-review-upsert)\//.test(f)), 'the frozen Calendar and Samples writers are not changed on this branch');
} catch (e) { console.log('  --  skipped the server-source check (no origin/main here)'); }

if (failures) { console.error('\nlost-work-conflict-gate: ' + failures + ' FAILED'); process.exit(1); }
console.log('\nlost-work-conflict-gate: all checks passed');
