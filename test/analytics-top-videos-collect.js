'use strict';
/*
 * analytics-top-videos-collect.js: the Edge Function's port of the n8n workflow
 * "TOP VIDEOS" must give the SAME rows as the n8n nodes themselves.
 *
 * test/fixtures/n8n-top-videos-code.js holds the four Code nodes (three "Process ..." and
 * "Unpack Rows") exactly as they ran. This test feeds the same random inputs (reels,
 * TikToks, YouTube videos, error-shaped and empty provider answers, failed providers,
 * clients with and without each platform) through the n8n code, through small stand-ins for
 * n8n's $input / $('Node') helpers, and through supabase/functions/_shared/
 * analytics-top-videos-collect.mjs, and compares the rows that would be mirrored (also
 * against the real mirror's own row preparation). Inputs to the port go through the slim
 * functions the Edge Function uses, so the slimming is proven harmless too.
 * Offline; no network, no database.
 */
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const N8N = require('./fixtures/n8n-top-videos-code.js');

const ROOT = path.resolve(__dirname, '..');
const NOW_ISO = '2026-10-02T09:30:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

class FixedDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(NOW_MS); }
  static now() { return NOW_MS; }
}

// n8n's Code-node helpers, reduced to what these nodes call. A node that did not run throws, as in n8n.
function runNode(name, { input = [], nodes = {} }) {
  const wrap = arr => arr.map(json => ({ json }));
  const $ = nodeName => {
    const n = nodes[nodeName];
    if (!n) throw new Error('Node not run: ' + nodeName);
    return { first: () => (n.all.length ? { json: n.all[0] } : undefined), all: () => wrap(n.all), item: { json: n.item ?? n.all[0] } };
  };
  const $input = { all: () => wrap(input), first: () => (input.length ? { json: input[0] } : undefined) };
  return new Function('$', '$input', 'Date', N8N[name])($, $input, FixedDate).map(i => i.json);
}

// ---- seeded random inputs ----
let seed = 20261002;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = arr => arr[int(0, arr.length - 1)];
const maybe = p => rnd() < p;
const longText = () => pick(['short', 'two  spaces\nand\ta newline', 'x'.repeat(150) + '   ' + 'y'.repeat(100), '', ' lead and trail ', '#a  #b   #c']);
const when = () => {
  const ms = NOW_MS - int(0, 40) * 86400000 - int(0, 86000) * 1000;
  return pick([() => new Date(ms).toISOString(), () => Math.floor(ms / 1000), () => ms, () => '', () => 'garbage', () => new Date(NOW_MS + 5 * 86400000).toISOString(), () => '2010-01-01T00:00:00Z', () => undefined])();
};

function reel(i) {
  const o = { id: maybe(0.8) ? 'r' + i : undefined, shortCode: maybe(0.5) ? 'sc' + i : undefined, url: maybe(0.8) ? 'https://x/' + i : undefined,
    likesCount: maybe(0.9) ? int(0, 5000) : undefined, commentsCount: maybe(0.8) ? int(0, 300) : undefined, sharesCount: maybe(0.2) ? int(0, 50) : undefined, shareCount: maybe(0.2) ? int(0, 50) : undefined,
    caption: maybe(0.8) ? longText() : undefined, text: maybe(0.3) ? longText() : undefined, webVideoUrl: maybe(0.2) ? 'https://w/' + i : undefined,
    junk: 'z'.repeat(500), latestComments: [1, 2, 3] };
  o[pick(['videoPlayCount', 'playCount', 'videoViewCount'])] = maybe(0.9) ? int(0, 3_000_000) : 0;
  if (maybe(0.3)) o.playCount = int(0, 100);
  o[pick(['taken_at', 'timestamp', 'date'])] = when();
  return o;
}
function tiktok(i) {
  return { id: maybe(0.9) ? 't' + i : undefined, text: maybe(0.8) ? longText() : undefined, webVideoUrl: maybe(0.9) ? 'https://t/' + i : undefined,
    playCount: maybe(0.95) ? int(0, 900000) : undefined, diggCount: int(0, 9000), commentCount: int(0, 400), shareCount: maybe(0.7) ? int(0, 60) : undefined,
    createTime: maybe(0.5) ? when() : undefined, createTimestamp: maybe(0.3) ? when() : undefined, authorMeta: { fans: 5 } };
}
function video(i) {
  return { id: 'v' + i, snippet: maybe(0.95) ? { publishedAt: maybe(0.95) ? new Date(NOW_MS - int(0, 35) * 86400000 - int(0, 80000) * 1000).toISOString() : undefined, title: maybe(0.9) ? longText() : undefined, description: 'd'.repeat(300) } : undefined,
    statistics: maybe(0.93) ? { viewCount: maybe(0.95) ? String(int(0, 1_000_000)) : undefined, likeCount: maybe(0.9) ? String(int(0, 9000)) : undefined, commentCount: maybe(0.8) ? String(int(0, 300)) : undefined } : undefined };
}
function items(kind, n) {
  const r = rnd();
  if (r < 0.1) return [{ error: 'no_items', errorDescription: 'nothing' }];   // an error-shaped answer is still an answer
  if (r < 0.15) return [];
  return Array.from({ length: n }, (_, i) => (kind === 'ig' ? reel(i) : kind === 'tt' ? tiktok(i) : video(i)));
}
const source = (kind, n) => (maybe(0.12) ? { failed: true, items: [] } : { failed: false, items: items(kind, n) });

const COLS = ['scraped_date', 'client_name', 'platform', 'period', 'rank', 'caption', 'video_url', 'views', 'likes', 'comments', 'shares'];

async function main() {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/analytics-top-videos-collect.mjs')).href);
  const M = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/sheets-mirror.mjs')).href);

  // What the real mirror would store for the rows n8n sends (rows travel as JSON).
  const mirrorRecords = async rows => {
    const { records } = await M.prepareRows('top_videos', JSON.parse(JSON.stringify(rows)), { source: 'n8n', runId: 'x' });
    return records.map(r => Object.fromEntries(COLS.map(c => [c, c === 'client_name' ? r.client_name : r[c] ?? null])));
  };

  async function oneClient(n, port) {
    const name = 'Client ' + n;
    const cfg = { ig: maybe(0.8), tt: maybe(0.7), yt: maybe(0.6) };
    const src = { ig: cfg.ig ? source('ig', int(0, 50)) : undefined, tt: cfg.tt ? source('tt', int(0, 50)) : undefined, yt: cfg.yt ? source('yt', int(0, 20)) : undefined };

    // --- n8n: each platform's node runs only when its provider call did not take the error output
    const nodes = { 'Loop Over Clients': { all: [{ client_name: name }], item: { client_name: name } } };
    if (src.ig && !src.ig.failed) nodes['Process Instagram Top Videos'] = { all: runNode('Process Instagram Top Videos', { input: src.ig.items, nodes }) };
    // No Instagram configured: n8n's Instagram branch still runs, with nothing usable in it
    // (live table, 2026-10-06: every client without Instagram has the "no new posts" row).
    if (!src.ig) nodes['Process Instagram Top Videos'] = { all: runNode('Process Instagram Top Videos', { input: [{}], nodes }) };
    if (src.tt && !src.tt.failed) nodes['Process TikTok Top Videos'] = { all: runNode('Process TikTok Top Videos', { input: src.tt.items, nodes }) };
    let unpackInput = [{ skip: true }]; // "No YouTube"
    if (src.yt && !src.yt.failed) unpackInput = runNode('Process YouTube Top Videos', { input: [{ items: src.yt.items }], nodes });
    const unpacked = runNode('Unpack Rows', { input: unpackInput, nodes });
    const n8nRows = unpacked.filter(r => r.skip !== true);

    // --- the port, fed the slimmed items the Edge Function keeps
    const slim = (s, f) => (s ? { failed: s.failed, items: s.items.map(f) } : undefined);
    const built = port({ clientName: name, ig: slim(src.ig, L.slimReel), tt: slim(src.tt, L.slimTikTok), yt: slim(src.yt, L.slimVideo) }, new Date(NOW_MS));
    const want = await mirrorRecords(n8nRows);
    const got = built.rows.map(L.toShadowRecord);
    return { want, got, rows: n8nRows.length, states: built.states, src, cfg };
  }

  async function sweep(port) {
    seed = 20261002;
    let compared = 0, mismatches = 0, rowTotal = 0, emptyWeek = 0, failedPlat = 0, none = 0;
    for (let n = 0; n < 600; n++) {
      const r = await oneClient(n, port);
      compared++;
      rowTotal += r.rows;
      if (r.rows === 0) none++;
      emptyWeek += r.got.filter(x => x.rank === '0').length;
      failedPlat += Object.values(r.states).filter(s => s === 'provider_failed').length;
      try { assert.deepEqual(r.got, r.want, 'client ' + n); } catch (e) { mismatches++; if (port === L.buildClientRows) throw e; }
    }
    return { compared, mismatches, rowTotal, emptyWeek, failedPlat, none };
  }

  const good = await sweep(L.buildClientRows);
  assert.equal(good.mismatches, 0);
  assert(good.rowTotal > 3000 && good.emptyWeek > 100 && good.failedPlat > 100 && good.none > 5, 'the random inputs exercise every branch: ' + JSON.stringify(good));

  // Two deliberate breakages of the port must be caught.
  const wrongWindow = (s, now) => L.buildClientRows(s, new Date(now.getTime() + 2 * 86400000));
  const noEmptyRow = (s, now) => { const b = L.buildClientRows(s, now); return { ...b, rows: b.rows.filter(r => r.rank !== 0) }; };
  const b1 = await sweep(wrongWindow), b2 = await sweep(noEmptyRow);
  assert(b1.mismatches > 20, 'a shifted week window is caught (' + b1.mismatches + ')');
  assert(b2.mismatches > 20, 'a dropped "no new posts" row is caught (' + b2.mismatches + ')');

  // Stated rules, one by one.
  const now = new Date(NOW_MS);
  const rows = L.processYouTube([], 'C', now);
  assert.deepEqual(rows.map(r => [r.platform, r.period, r.rank, r.caption, r.views]), [['youtube', 'week', 0, 'No new posts in the last 7 days', 0]], 'no shorts: one empty-week row');
  assert.deepEqual(L.buildClientRows({ clientName: 'C', ig: { failed: true, items: [] } }, now), { rows: [], states: { instagram: 'provider_failed', tiktok: 'not_configured', youtube: 'not_configured' } }, 'a failed provider writes no rows');
  assert.equal(L.buildClientRows({ clientName: 'C', ig: { failed: false, items: [{ error: 'no_items' }] } }, now).rows.length, 1, 'an error-shaped answer from a working provider is the "no new posts" row');
  assert.equal(L.slimReel({ caption: 'a'.repeat(500) }).caption.length, 200, 'captions are cut where the rules cut them');
  assert.equal(L.toShadowRecord({ views: NaN, caption: '  ', rank: 0, likes: 1.5 }).views, null, 'a number JSON cannot carry is empty, as the mirror stores it');
  assert.equal(L.toShadowRecord({ rank: 0 }).rank, '0', 'rank 0 is kept as text');

  // The switch statement the owner pastes: slugs are inputs, anything else is refused.
  const { build } = require('../scripts/analytics-top-videos-flag.js');
  const run = a => { const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts/analytics-top-videos-flag.js'), ...a], { encoding: 'utf8' }); return { status: r.status, out: r.stdout.trim() }; };
  assert.deepEqual(run(['--off']), { status: 0, out: `update public.syncview_runtime_flags set value = '{"mode":"off"}'::jsonb where key = 'analytics_top_videos_collect';` });
  assert.equal(run(['--all']).out.includes(`'{"mode":"shadow"}'`), true);
  assert.equal(run(['--clients=aaa,b&b,aaa']).out.includes(`'{"mode":"shadow","clients":["aaa","b&b"]}'`), true, 'slugs are de-duplicated and kept as given');
  for (const bad of [[], ['--clients='], ['--clients=a;drop table x'], ["--clients=it's"], ['--clients=Aaa'], ['--all', '--off']]) assert.equal(run(bad).status, 2, 'refused: ' + bad.join(' '));
  assert.equal(typeof build, 'function');

  console.log(`ANALYTICS_TOP_VIDEOS_COLLECT_OK: ${good.compared} random clients identical to the n8n nodes and the mirror's rows (${good.rowTotal} rows, ${good.emptyWeek} "no new posts" rows, ${good.failedPlat} failed platforms, ${good.none} clients with no rows); 2 deliberate breakages caught (${b1.mismatches}, ${b2.mismatches})`);
}
main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
