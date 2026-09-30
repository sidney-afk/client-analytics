'use strict';
// Calendar page and the caption-jobs function (docs/plans/2026-09-30-n8n-exit-phase-2.md, step B, page side):
// progress is read from, and cancel is sent to, the caption-jobs function with the staff headers; the two old n8n caption job
// webhooks are gone from the page. Static checks on the source fragments and on the built page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const C100 = read('src/index/100-onboarding-staff-controls.js.part');
const C180 = read('src/index/180-calendar-native-post-media.js.part');
const FN = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/caption-jobs';
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

ok(C100.includes("const CAPTION_JOB_STATUS_URL = '" + FN + "';"), 'the status URL is the caption-jobs function');
ok(/const CAPTION_JOB_UPDATE_URL = CAPTION_JOB_STATUS_URL;/.test(C100), 'the update URL is the same function');
for (const f of ['src/index/100-onboarding-staff-controls.js.part', 'src/index/180-calendar-native-post-media.js.part', 'src/index/120-calendar-flags-write-repair.js.part', 'src/index/170-calendar-links-status.js.part']) {
  const t = read(f);
  ok(!/webhook\/caption-job-(status|update)/.test(t), f + ' no longer names the n8n caption job webhooks');
}
// status read: fresh, staff headers, no cache-buster
const reads = C180.match(/fetch\(CAPTION_JOB_STATUS_URL[^\n]*\n/g) || [];
ok(reads.length === 1, 'one status read');
ok(/cache: 'no-store'/.test(reads[0]) && /_syncviewEfHeaders\(\{ Accept: 'application\/json' \}, CAPTION_JOB_STATUS_URL\)/.test(reads[0]) && !/_t=/.test(reads[0]), 'the status read is uncached, carries the staff headers and has no cache-buster');
// cancel: three places, all with staff headers and the same body
const posts = C180.match(/fetch\(CAPTION_JOB_UPDATE_URL[\s\S]{0,260}?cancel_requested: true \}\)/g) || [];
ok(posts.length === 3, 'three cancel sends (user cancel, cancel grace, stale timeout), got ' + posts.length);
for (const p of posts) ok(/_syncviewEfHeaders\(\{ 'Content-Type': 'application\/json' \}, CAPTION_JOB_UPDATE_URL\)/.test(p) && /JSON\.stringify\(\{ jobId: job\.jobId, cancel_requested: true \}\)/.test(p), 'a cancel send keeps its body and carries the staff headers');
ok(!/CAPTION_JOB_UPDATE_URL, \{ method: 'POST', headers: \{ 'Content-Type'/.test(C180), 'no cancel send is left with bare headers');
ok(/_syncviewEfHeaders/.test(C180.split('\n').slice(0, 30).join('\n')), 'the header helper is imported from the flags fragment');
// the response shape the poll reads is unchanged
ok(/j && j\.ok && Array\.isArray\(j\.jobs\)/.test(C180), 'the poll still reads { ok, jobs }');
console.log(`caption-jobs-page-wiring: ${checks} checks passed ✅`);
