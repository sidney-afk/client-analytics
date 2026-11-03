'use strict';
/* trial-v4-review-live-walk.js -- the V4 live walk's own rules, offline (OPEN_REPAIRS 663).
 *
 * scripts/trial-v4-review-live-walk.js drives the live review page read only. Proven here without a browser: every
 * write the page could send is recognised and blocked (the Calendar, Production and comment writers, any trial-reels
 * action but a read, any REST write) while the reads it needs pass; a surface's line keeps counts and true/false only;
 * a run that blocked a write, or whose surface failed or scrolled sideways, fails; and the workflow takes no link. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const W = require('../scripts/trial-v4-review-live-walk.js');

let passed = 0;
function ok(c, m) { assert.ok(c, m); passed += 1; console.log('  ok  ' + m); }
const S = 'https://uzltbbrjidmjwwfakwve.supabase.co';

for (const fn of ['calendar-upsert', 'calendar-card-write', 'production-write', 'deliverable-write', 'batch-write']) {
  ok(W.isWrite('POST', S + '/functions/v1/' + fn, {}), 'a POST to ' + fn + ' is blocked');
}
ok(W.isWrite('POST', S + '/functions/v1/trial-reels', { action: 'answer' }) && W.isWrite('POST', S + '/functions/v1/trial-reels', { action: 'version_fields_set' })
  && W.isWrite('POST', S + '/functions/v1/trial-reels', {}), 'any trial-reels action but a read is blocked, an empty one too');
ok(!W.isWrite('POST', S + '/functions/v1/trial-reels', { action: 'read' }) && !W.isWrite('POST', S + '/functions/v1/trial-reels', { action: 'list' }),
  'a trial-reels read or list passes');
ok(W.isWrite('PATCH', S + '/rest/v1/calendar_posts?id=eq.x', {}) && W.isWrite('POST', S + '/rest/v1/rpc/anything', {}) && W.isWrite('DELETE', S + '/rest/v1/t', {}),
  'every REST write is blocked');
ok(!W.isWrite('GET', S + '/rest/v1/calendar_posts?select=id', {}), 'a REST read passes');
ok(!W.isWrite('POST', S + '/functions/v1/frameio-view', { part: 'list' }) && !W.isWrite('POST', S + '/functions/v1/client-review-link', {}),
  'the player and the review link pass');
ok(!W.isWrite('POST', 'https://e.example/x', {}), 'a request off the backend is left alone');

const line = W.surfaceLine({ surface: 'client', width: 390, engine: 'webkit', withFields: 2, pickerParts: 'video*,thumbnail,caption', caption: 'secret words', link: 'https://f.io/x', id: 'p_secret' });
ok(line.withFields === 2 && line.pickerParts === 'video*,thumbnail,caption' && !('caption' in line) && !('link' in line) && !('id' in line),
  'a surface line keeps counts and true/false, and drops anything else');
ok(!JSON.stringify(W.surfaceLine({ surface: 'https://f.io/abc', error: 'TypeError: at p_secret_card' })).includes('https://'), 'a surface line strips a link even from its own fields');

ok(W.verdict([{ surface: 'client' }, { surface: 'smm' }], 0).passed, 'a run with nothing written and no failed surface passes');
ok(!W.verdict([{ surface: 'client' }], 1).passed, 'a run that blocked a write fails');
ok(!W.verdict([{ surface: 'client', error: 'TimeoutError' }], 0).passed && !W.verdict([{ surface: 'client', sidewaysScroll: true }], 0).passed,
  'a failed surface or a sideways scroll fails the run');
ok(W.SURFACES.join() === 'client,smm,kasper' && W.WIDTHS.join() === '1440,390', 'it walks the client link, the SMM tab and Kasper at 1440 and 390');

const wf = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/trial-v4-review-live-walk.yml'), 'utf8');
const inputsBlock = wf.split(/\n {4}inputs:\n/)[1].split(/\n\S/)[0];
const inputs = [...inputsBlock.matchAll(/^ {6}([a-z_]+):\s*$/gm)].map((m) => m[1]);
ok(inputs.join() === 'engine,card', 'the workflow takes the engine and an optional card id, nothing else (' + inputs.join() + ')');
ok(!/https?:\/\//.test(inputsBlock.replace(/description:.*$/gm, '')) && /options:\s*\n\s*- webkit\s*\n\s*- chromium/.test(wf), 'no input is a link, and the engine is webkit or chromium');
ok(!/upload-artifact/i.test(wf) && !/\.screenshot\(/.test(fs.readFileSync(path.resolve(__dirname, '../scripts/trial-v4-review-live-walk.js'), 'utf8')),
  'the walk takes no screenshot and uploads nothing (Kasper\'s queue holds other clients\' cards)');
console.log(`\ntrial-v4-review-live-walk: ${passed} passed, 0 failed`);
