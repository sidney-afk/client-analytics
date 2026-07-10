'use strict';
/*
 * URGENT ping persistence lifecycle.
 *
 * The Sent state is durable only for the current Tweaks Needed episode:
 * video_urgent_status_at must match the row's current video_status_at.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CAL_EF = fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-upsert/index.ts'), 'utf8');
const SXR_EF = fs.readFileSync(path.join(ROOT, 'supabase/functions/sample-review-upsert/index.ts'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-10-urgent-tweak-pings.sql'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(at, j + 1);
    }
  }
  throw new Error('unbalanced braces: ' + name);
}

function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

const REAL = [
  grabConst('CAL_STATUSES'),
  grabFunc('_calNormStatus'),
  grabFunc('_calShowUrgent'),
  grabFunc('_calUrgentSameRound'),
  grabFunc('_calUrgentSentForCurrentRound'),
  grabFunc('_calUrgentButtonHtml'),
].join('\n\n');

const mod = new Function(REAL + ';return { _calShowUrgent, _calUrgentSentForCurrentRound, _calUrgentButtonHtml };')();
const VID = 'https://linear.app/synchro-social/issue/VID-123/video';
const ROUND1 = '2026-07-10T12:00:00.000Z';
const ROUND2 = '2026-07-10T13:00:00.000Z';

let failures = 0;
function check(label, cond) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK' : 'FAIL'}  ${label}`);
}
function post(extra) {
  return Object.assign({
    id: 'p1',
    video_status: 'Tweaks Needed',
    linear_issue_id: VID,
    video_status_at: ROUND1,
    video_urgent_pinged_at: '',
    video_urgent_status_at: '',
    video_urgent_issue: '',
    video_urgent_editor: '',
  }, extra || {});
}

console.log('-- lifecycle predicate --');
check('unsent current Tweaks Needed round shows URGENT',
  mod._calShowUrgent(post(), 'video') && !mod._calUrgentSentForCurrentRound(post()));

const sentCurrent = post({ video_urgent_pinged_at: '2026-07-10T12:05:00.000Z', video_urgent_status_at: ROUND1 });
check('matching urgent status timestamp renders Sent',
  mod._calUrgentSentForCurrentRound(sentCurrent));

const sentHtml = mod._calUrgentButtonHtml('p1', '_calSendUrgentSlack', sentCurrent);
check('Sent button is disabled and green-classed',
  /data-urgent-sent="1"/.test(sentHtml) && /\bis-sent\b/.test(sentHtml) && /\sdisabled\b/.test(sentHtml) && />Sent<\/button>/.test(sentHtml));

const nextRound = post({ video_status_at: ROUND2, video_urgent_pinged_at: '2026-07-10T12:05:00.000Z', video_urgent_status_at: ROUND1 });
check('new Tweaks Needed round resets to URGENT',
  mod._calShowUrgent(nextRound, 'video') && !mod._calUrgentSentForCurrentRound(nextRound));

const resolved = post({ video_status: 'Kasper Approval', video_urgent_pinged_at: '2026-07-10T12:05:00.000Z', video_urgent_status_at: ROUND1 });
check('leaving Tweaks Needed hides the urgent affordance',
  !mod._calShowUrgent(resolved, 'video') && !mod._calUrgentSentForCurrentRound(resolved));

console.log('\n-- source guards --');
check('Calendar render uses shared urgent button HTML',
  /_calUrgentButtonHtml\(pid, '_calSendUrgentSlack', p\)/.test(INDEX));
check('Samples render uses shared urgent button HTML',
  /_calUrgentButtonHtml\(pid, '_sxrSendUrgentSlack', p\)/.test(INDEX));
check('Kasper queues use shared urgent button HTML',
  /_calUrgentButtonHtml\(_calEscAttr\(pid\), '_kasperSendUrgentSlack'/.test(INDEX)
  && /_calUrgentButtonHtml\(_sxrEscAttr\(pid\), '_sxrKasperSendUrgentSlack'/.test(INDEX));
check('Calendar EF allowlists and ledgers urgent marker fields',
  /URGENT_MARKER_FIELDS/.test(CAL_EF) && /video_urgent_status_at/.test(CAL_EF) && /urgent_ping/.test(CAL_EF));
check('Samples EF allowlists and ledgers urgent marker fields',
  /URGENT_MARKER_FIELDS/.test(SXR_EF) && /video_urgent_status_at/.test(SXR_EF) && /urgent_ping/.test(SXR_EF));
check('migration adds marker columns to both tables',
  /alter table public\.calendar_posts[\s\S]*video_urgent_status_at/.test(MIGRATION)
  && /alter table public\.sample_reviews[\s\S]*video_urgent_status_at/.test(MIGRATION));

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll urgent-ping persistence checks passed.');
