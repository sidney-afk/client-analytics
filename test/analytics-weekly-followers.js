'use strict';
/* analytics-weekly-followers: the pure rules and the migration's promises, read offline. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const m = await import(path.join(ROOT, 'supabase/functions/_shared/analytics-weekly-followers.mjs'));
  // week_of is the Monday, UTC
  assert.equal(m.weekOf(new Date('2026-11-04T16:10:00Z')), '2026-11-02');
  assert.equal(m.weekOf(new Date('2026-11-02T00:00:00Z')), '2026-11-02');
  assert.equal(m.weekOf(new Date('2026-11-08T23:59:59Z')), '2026-11-02', 'Sunday belongs to the week before the next Monday');
  assert.equal(m.weekOf(new Date('2026-11-09T00:00:00Z')), '2026-11-09');
  assert.equal(m.weekOf(new Date('2027-01-01T12:00:00Z')), '2026-12-28', 'across a year end');
  for (const v of ['N/A', 'n/a', ' ', '', null, undefined]) assert.equal(m.configured(v), false);
  assert.equal(m.configured('x'), true);

  const ig = (user) => m.readScrapeCreators('instagram', 200, { data: { user } });
  assert.deepEqual(ig({ is_private: false, edge_followed_by: { count: 12 } }), { followers: 12 });
  assert.deepEqual(ig({ is_private: true, edge_followed_by: { count: 12 } }), { error_class: 'private_profile' });
  assert.deepEqual(ig({ edge_followed_by: {} }), { error_class: 'unexpected_shape' });
  assert.deepEqual(ig({ edge_followed_by: { count: -1 } }), { error_class: 'unexpected_shape' });
  assert.deepEqual(ig({ edge_followed_by: { count: 'many' } }), { error_class: 'unexpected_shape' });
  assert.deepEqual(m.readScrapeCreators('instagram', 200, { data: {} }), { error_class: 'unexpected_shape' });
  assert.deepEqual(m.readScrapeCreators('instagram', 200, null), { error_class: 'unexpected_shape' });
  assert.deepEqual(m.readScrapeCreators('tiktok', 200, { user: { privateAccount: true }, stats: { followerCount: 4 } }), { error_class: 'private_profile' });
  assert.deepEqual(m.readScrapeCreators('tiktok', 200, { user: {}, stats: { followerCount: 4 } }), { followers: 4 });
  assert.deepEqual(m.readScrapeCreators('tiktok', 200, { user: {}, stats: {} }), { error_class: 'unexpected_shape' });
  assert.deepEqual(m.readScrapeCreators('youtube', 200, { subscriberCount: 2750000 }), { followers: 2750000 });
  assert.deepEqual(m.readScrapeCreators('youtube', 200, {}), { error_class: 'unexpected_shape' });
  assert.deepEqual(m.readScrapeCreators('instagram', 429, {}), { error_class: 'rate_limited' });
  assert.deepEqual(m.readScrapeCreators('instagram', 404, {}), { error_class: 'not_found' });
  assert.deepEqual(m.readScrapeCreators('instagram', 502, {}), { error_class: 'provider_error' });
  assert.deepEqual(m.readScrapeCreators('instagram', 401, {}), { error_class: 'provider_refused' });
  assert.deepEqual(m.readYoutubeApi(200, { items: [{ statistics: { subscriberCount: '77' } }] }), { followers: 77 });
  assert.deepEqual(m.readYoutubeApi(200, { items: [] }), { error_class: 'not_found' });
  assert.deepEqual(m.readYoutubeApi(200, { items: [{ statistics: { hiddenSubscriberCount: true, subscriberCount: '5' } }] }), { error_class: 'hidden_count' });
  assert.deepEqual(m.readYoutubeApi(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }), { error_class: 'rate_limited' });
  assert(m.TRANSIENT.has('rate_limited') && m.TRANSIENT.has('timeout') && !m.TRANSIENT.has('private_profile') && !m.TRANSIENT.has('not_found'));

  // the migration's promises
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/2026-11-04-analytics-weekly-followers.sql'), 'utf8');
  assert(/^-- ef-auto-deploy-applied-when: select .*to_regclass\('public\.analytics_weekly_snapshot'\)/m.test(sql), 'says how to tell it is applied');
  assert(!/functions-cope-without-this/.test(sql));
  assert.equal((sql.match(/^-- ef-auto-deploy-applied-when:/gm) || []).length, 1);
  assert(sql.includes("revoke all on table public.%I from public, anon, authenticated, service_role"), 'tables revoked from all four');
  assert.equal((sql.match(/from public, anon, authenticated, service_role/g) || []).length, 2, 'tables and functions both name all four roles');
  assert(!/grant [^;]*\b(anon|authenticated)\b/i.test(sql.replace(/revoke[^;]*;/gi, '')), 'no grant to a browser role');
  assert(!/grant [^;]*on public\.analytics_weekly_top_posts/i.test(sql), 'top-post table gets no grant yet');
  assert(!/grant [^;]*\binsert\b[^;]*analytics_weekly_snapshot/i.test(sql), 'the snapshot is written only through the commit function');
  assert(sql.includes("'* 5-7 * * 1'"), 'cron runs Mondays, early UTC');
  assert(/primary key \(client_slug, platform, week_of\)/.test(sql), 'one row per client, platform and week');
  assert(/isodow from week_of\) = 1/.test(sql), 'week_of must be a Monday');
  assert(!/[A-Za-z0-9_-]{30,}[A-Za-z0-9_-]{10,}.*vault\.create_secret\('[^<]/.test(sql), 'no secret value in the file');
  console.log('analytics-weekly-followers rules and migration: all checks passed ✅');
})().catch(e => { console.error(e); process.exit(1); });
