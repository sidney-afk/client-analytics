'use strict';
// caption-jobs Edge Function (docs/plans/2026-09-30-n8n-exit-phase-2.md, step B, backend only): the pure logic
// under Node, plus static wiring checks on the handler, the migration and the deploy lane. No network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const HANDLER = read('supabase/functions/caption-jobs/index.ts');
const MIGRATION = read('migrations/2026-09-30-caption-jobs.sql');
const DEPLOY = read('.github/workflows/deploy-single-function.yml');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

(async () => {
  const J = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/caption-jobs/jobs.mjs')).href);
  const NOW = '2026-09-30T12:00:00.000Z', NOWMS = Date.parse(NOW);

  // --- update: a partial patch, only the keys sent are written
  let r = J.buildPatch({ jobId: 'job_a', status: 'running', stage: 'scraping' }, NOW);
  eq(r, { ok: true, patch: { job_id: 'job_a', updated_at: NOW, status: 'running', stage: 'scraping' } }, 'only the keys sent are written');
  r = J.buildPatch({ job_id: 'job_b', post_id: 'p1', cancel_requested: true }, NOW);
  eq(r.patch, { job_id: 'job_b', updated_at: NOW, post_id: 'p1', cancel_requested: true }, 'snake_case ids and the cancel flag are accepted');
  eq(J.buildPatch({ jobId: 'j', cancel_requested: 'true' }, NOW).patch.cancel_requested, true, 'the string true counts');
  eq(J.buildPatch({ jobId: 'j', cancel_requested: 'no' }, NOW).patch.cancel_requested, false, 'anything else is false');
  ok(J.buildPatch({}, NOW).ok === false && /jobId/.test(J.buildPatch({}, NOW).error), 'a missing jobId is refused');
  ok(J.buildPatch({ jobId: 'x'.repeat(121) }, NOW).ok === false, 'a jobId over 120 characters is refused');
  eq(J.buildPatch({ jobId: 'x'.repeat(120) }, NOW).ok, true, 'exactly 120 is accepted');
  eq(J.buildPatch({ jobId: 'j', caption: 'c'.repeat(6000) }, NOW).patch.caption.length, 5000, 'caption is cut at 5000');
  eq(J.buildPatch({ jobId: 'j', error: 'e'.repeat(900) }, NOW).patch.error.length, 600, 'error is cut at 600');
  eq(J.buildPatch({ jobId: 'j', caption: '' }, NOW).patch.caption, '', 'an empty caption clears it');
  eq(J.buildPatch({ jobId: 'j', started_at: '' }, NOW).patch.started_at, null, 'an empty start time is null');
  eq(J.pruneCutoffIso(NOWMS), '2026-09-16T12:00:00.000Z', 'rows older than 14 days are pruned');

  // --- status: the same selection the n8n flow made
  const row = (id, post, ago, extra = {}) => ({ job_id: id, client: 'c', post_id: post, status: 'running', stage: 'writing', caption: '', error: '', cancel_requested: false, started_at: null, updated_at: new Date(NOWMS - ago).toISOString(), ...extra });
  const H = 3600000;
  const rows = [row('old', 'p1', 30 * H), row('new1', 'p1', 1 * H), row('new2', 'p2', 2 * H), { updated_at: NOW }];
  eq(J.selectJobs(rows, {}, NOWMS).map((x) => x.jobId), ['new1', 'new2'], 'no jobId: only the last 24 hours, newest first, rows without a job id skipped');
  eq(J.selectJobs(rows, { postId: 'p1' }, NOWMS).map((x) => x.jobId), ['new1'], 'postId filters');
  eq(J.selectJobs(rows, { jobId: 'old' }, NOWMS).map((x) => x.jobId), ['old'], 'a jobId lookup ignores the 24 hour window');
  eq(Object.keys(J.selectJobs([row('k', 'p', 1)], {}, NOWMS)[0]).sort(),
    ['caption', 'cancel_requested', 'client', 'error', 'jobId', 'postId', 'stage', 'started_at', 'status', 'updated_at'].sort(),
    'the row has exactly the keys the page reads');
  eq(J.selectJobs([row('k', 'p', 1, { cancel_requested: true })], {}, NOWMS)[0].cancel_requested, true, 'the cancel flag is a boolean');
  eq(J.selectJobs(Array.from({ length: 250 }, (_, i) => row('j' + i, 'p', i * 1000)), {}, NOWMS).length, 200, 'at most 200 rows');

  // --- handler wiring
  ok(/authorizeStaffKey\(clean\(req\.headers\.get\("x-syncview-key"\)\), \["admin", "smm", "creative"\]\)/.test(HANDLER), 'a staff role key is required');
  ok(/staffAuthFailureStatus/.test(HANDLER), 'an unknown key is refused with the shared status');
  ok(/"Cache-Control": "no-store"/.test(HANDLER), 'answers are not cached');
  ok(/onConflict: "job_id"/.test(HANDLER), 'an update is an upsert on job_id');
  ok(!/fetch\(|n8n/.test(HANDLER.replace(/\/\/[^\n]*/g, '')), 'the handler makes no outside request and never calls n8n');
  ok(/\.eq\("client", client\)/.test(HANDLER), 'the read is filtered by client');
  ok(!/_t=/.test(HANDLER), 'no cache buster');

  // --- migration wiring: service_role only, no browser role
  ok(/create table if not exists public\.caption_jobs/.test(MIGRATION), 'the table is created');
  ok(/enable row level security/.test(MIGRATION), 'row level security is on');
  ok(/revoke all on table public\.caption_jobs from public, anon, authenticated, service_role/.test(MIGRATION), 'every role is revoked first');
  ok(/grant select, insert, update, delete on table public\.caption_jobs to service_role/.test(MIGRATION), 'service_role gets back only what it needs');
  ok(/NOT APPLIED/.test(MIGRATION), 'the file says it is not applied');

  // --- deploy lane and config
  // supabase/config.toml is deliberately NOT edited: two other workflows redeploy on any change to it, and the
  // one-function lane already deploys with --no-verify-jwt.
  ok(/--no-verify-jwt/.test(DEPLOY), 'the one-function lane deploys with --no-verify-jwt, so no config entry is needed');
  ok((DEPLOY.match(/caption-jobs/g) || []).length === 3, 'the one-function lane lists it in its options, its case and its loop');

  console.log(`caption-jobs-source: ${checks} checks passed ✅`);
})().catch((e) => { console.error(e); process.exit(1); });
