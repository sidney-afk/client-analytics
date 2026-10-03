'use strict';
/*
 * analytics-market-research-collect.js: the Edge Function's port of the n8n workflow
 * "MARKET RESEARCH", branch generate-market-brief, must give the SAME answers as the n8n nodes.
 *
 * test/fixtures/n8n-market-research-code.js holds the Code nodes of that branch exactly as they ran,
 * and the body expression of its Claude call. This test feeds the same random inputs (search results
 * of both platforms for several keywords, error-shaped answers, videos of every size, Whisper answers
 * of every kind, Claude answers with and without code fences, broken or oversized) through the n8n
 * code with small stand-ins for n8n's $input / $('Node') helpers and through
 * supabase/functions/_shared/analytics-market-research-collect.mjs, and compares every stage:
 * the ranked reels, the hooks, the order, the Claude input, the prompt (character for character) and
 * the row that would be stored. Offline; no network, no database.
 */
const assert = require('assert/strict');
const crypto = require('crypto');
const path = require('path');
const { pathToFileURL } = require('url');
const N8N = require('./fixtures/n8n-market-research-code.js');

const ROOT = path.resolve(__dirname, '..');
const NOW_ISO = '2026-10-02T09:30:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
class FixedDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(NOW_MS); }
  static now() { return NOW_MS; }
}

// n8n's Code-node helpers, reduced to what these nodes call. A node that did not run throws, as in n8n.
function runNode(name, { input = [], nodes = {}, item = null, binary = null }) {
  const wrap = arr => arr.map(json => ({ json }));
  const $ = nodeName => {
    const n = nodes[nodeName];
    if (!n) throw new Error('Node not run: ' + nodeName);
    return { first: () => (n.all.length ? { json: n.all[0] } : undefined), all: () => wrap(n.all), item: { json: n.item ?? n.all[0] } };
  };
  const $input = { all: () => wrap(input), first: () => (input.length ? { json: input[0] } : undefined), item: item ? { json: item, binary } : undefined };
  const res = new Function('$', '$input', 'Date', N8N[name])($, $input, FixedDate);
  return Array.isArray(res) ? res.map(i => i.json) : res.json;
}
const claudeBody = $json => JSON.parse(new Function('$json', 'Date', 'return (' + N8N['Claude API1 body'].replace(/^=\{\{/, '').replace(/\}\}\s*$/, '') + ')')($json, FixedDate));

// ---- seeded random inputs ----
let seed = 20261002;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = arr => arr[int(0, arr.length - 1)];
const maybe = p => rnd() < p;
const text = () => pick(['short caption', 'two  spaces\nand a newline', 'x'.repeat(200), '', 'emoji 😀 end', 'lone surrogate \ud83d here']);
const day = back => new Date(NOW_MS - back * 86400000 - int(0, 80000) * 1000).toISOString();

function igItem(i) {
  const o = { code: 'ig' + int(0, 400), user: maybe(0.9) ? { username: 'u' + i } : undefined, like_count: maybe(0.8) ? int(0, 9000) : undefined,
    comment_count: int(0, 300), share_count: maybe(0.7) ? int(0, 900) : undefined, caption: maybe(0.8) ? { text: text() } : undefined,
    video_url: maybe(0.8) ? 'https://cdn.example/v' + int(0, 400) : undefined, taken_at_date: maybe(0.9) ? day(int(0, 45)) : undefined, junk: 'z'.repeat(300) };
  o[pick(['ig_play_count', 'play_count', 'video_play_count'])] = maybe(0.9) ? pick([int(1, 90000), int(100000, 3000000)]) : 0;
  return o;
}
function ttItem(i) {
  return { id: maybe(0.9) ? 'tt' + int(0, 300) : undefined, webVideoUrl: maybe(0.8) ? 'https://www.tiktok.com/@a/video/' + i : undefined,
    playCount: maybe(0.95) ? pick([int(1, 90000), int(100000, 3000000)]) : 0, diggCount: int(0, 9000), commentCount: int(0, 300), shareCount: maybe(0.7) ? int(0, 900) : undefined,
    text: maybe(0.8) ? text() : undefined, createTimeISO: maybe(0.9) ? day(int(0, 45)) : undefined,
    videoMeta: maybe(0.5) ? { subtitleLinks: [{ downloadLink: 'https://sub.example/' + i }] } : undefined,
    authorMeta: maybe(0.9) ? { name: 'a' + i } : undefined, author: maybe(0.3) ? { uniqueId: 'b' + i } : undefined };
}
const answers = (kind, n) => (maybe(0.05) ? [{ error: 'boom' }] : maybe(0.04) ? [] : Array.from({ length: n }, (_, i) => (kind === 'ig' ? igItem(i) : ttItem(i))));

// A downloaded size that stays clear of the thresholds (n8n reads a rounded "x MB" text, the port the bytes).
const sizeBytes = () => pick([int(1, 400000), int(600000, 20000000), int(28000000, 60000000)]);
const sizeText = b => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(1) + ' kB');
const whisper = () => {
  const r = rnd();
  if (r < 0.1) return { error: { message: 'x' } };
  if (r < 0.15) return {};
  const vocab = Array.from({ length: 60 }, (_, i) => 'word' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + ((i * 7) % 26)));
  const words = n => Array.from({ length: n }, () => pick(vocab)).join(' ');
  const sentence = () => words(int(3, 12)) + pick(['.', '!', '?']);
  const base = Array.from({ length: pick([int(0, 3), int(3, 9)]) }, sentence).join(' ');
  return { language: pick(['en', 'en', 'en', 'english', 'es']), text: maybe(0.1) ? words(int(20, 60)) : base,
    segments: maybe(0.7) ? Array.from({ length: int(1, 4) }, () => ({ no_speech_prob: rnd() * 0.7, avg_logprob: -rnd() * 1.6 })) : undefined };
};
const claudeText = () => {
  const ok = JSON.stringify({ clientName: pick(['Client A', 'Client B']), date: pick(['2026-10-02', '2026-10-01']), totalReels: 3, keywords: ['x'], landscapeAnalysis: [], filler: 'f'.repeat(pick([10, 50000, 100000, 130000])) });
  return pick([ok, '```json\n' + ok + '\n```', '```\n' + ok + '```', ok.slice(0, 500), 'not json at all', '  ' + ok + '  ', '{"clientName":"Z"', '']);
};

async function main() {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/analytics-market-research-collect.mjs')).href);
  let briefs = 0, ranked300 = 0, usable = 0, skipped = {}, chunked = 0, noReels = 0;

  async function oneRun(n, P) {
    const keywords = Array.from({ length: pick([int(0, 2), int(2, 5)]) }, (_, k) => 'kw' + n + '_' + k);
    const cfg = { clientName: 'Client ' + n, clientNiche: maybe(0.8) ? text() : '', contentDescription: maybe(0.7) ? text() : '', keywords };
    const nodes = { Webhook4: { all: [{ body: { clientName: cfg.clientName, keywords } }] }, 'Parse Client Config2': { all: [cfg] } };

    // scrapes: per keyword, a failed scrape is skipped (n8n's error output loops back)
    const raw = keywords.map(k => ({ k, ig: maybe(0.1) ? null : answers('ig', pick([int(0, 30), int(60, 140)])), tt: maybe(0.1) ? null : answers('tt', pick([int(0, 30), int(60, 140)])) }));
    const n8nIg = [], n8nTt = [];
    for (const r of raw) {
      const kn = { 'Loop Over Items3': { all: [{ keyword: r.k }], item: { keyword: r.k } }, 'Loop Over Items6': { all: [{ keyword: r.k }], item: { keyword: r.k } } };
      if (r.ig) n8nIg.push(...runNode('Normalize Instagram Results2', { input: r.ig, nodes: kn }));
      if (r.tt) n8nTt.push(...runNode('Normalize TikTok2', { input: r.tt, nodes: kn }));
    }
    const portIg = raw.flatMap(r => (r.ig ? P.normalizeInstagram(r.ig, r.k) : []));
    const portTt = raw.flatMap(r => (r.tt ? P.normalizeTikTok(r.tt, r.k) : []));
    assert.deepEqual(portIg, n8nIg, 'normalized Instagram, run ' + n);
    assert.deepEqual(portTt, n8nTt, 'normalized TikTok, run ' + n);

    // merge (an error when nothing came back), then sort and filter
    let merged;
    const mnodes = { 'Aggregate TikTok': { all: [{ allReels: n8nTt }] }, 'Aggregate Instagram': { all: [{ allReels: n8nIg }] } };
    try { merged = runNode('Code in JavaScript6', { nodes: mnodes })[0]; } catch (e) { merged = null; }
    if (!merged) { assert.throws(() => P.mergeScrapes(portIg, portTt), /No reels/); noReels++; return null; }
    assert.deepEqual(P.mergeScrapes(portIg, portTt), merged.allReels);
    const n8nRanked = runNode('Sort and Filter2', { input: [merged] });
    const rankedPort = P.sortAndFilter(P.mergeScrapes(portIg, portTt), new FixedDate());
    assert.deepEqual(rankedPort, n8nRanked, 'ranked reels, run ' + n);
    if (rankedPort.length === 300) ranked300++;

    // transcription, ten at a time. n8n tries every reel with a link; the port only those that can stay.
    const dl = {}; // rank -> { bytes, whisper } the world answers with, the same for both
    for (const r of rankedPort) if (r.videoUrl) dl[r.rank] = { bytes: maybe(0.07) ? null : sizeBytes(), whisper: whisper() };
    const n8nOut = [];
    for (let i = 0; i < n8nRanked.length; i += 10) {
      const batch = n8nRanked.slice(i, i + 10);
      const withLink = [], without = [];
      for (const it of batch) {
        if (!it.videoUrl) { without.push(...runNode('Code in JavaScript11', { input: [it] })); continue; }
        const d = dl[it.rank];
        const bn = { 'Loop Over Items4': { all: [it], item: it } };
        const checked = (() => {
          const out = new Function('$', '$input', 'Date', N8N['Check File Size'])((nn) => ({ item: { json: bn[nn].item } }), { item: { json: it, binary: d.bytes == null ? undefined : { data: { fileSize: sizeText(d.bytes) } } } }, FixedDate);
          return out.json;
        })();
        const cn = { 'Check File Size': { all: [checked], item: checked } };
        // Whisper only runs for a video that passed the size check; a skipped item reaches Extract Hook1 as it left Check File Size
        const w = checked.hookSkipped === true ? {} : d.whisper;
        withLink.push(runNode('Extract Hook1', { nodes: cn, item: w }));
      }
      n8nOut.push(...withLink, ...without);
    }
    const outcomes = {};
    for (const r of rankedPort) {
      if (!P.needsTranscript(r)) continue;
      const d = dl[r.rank];
      const sk = P.checkFileSize(d.bytes);
      outcomes[r.rank] = sk ? { transcript: '', hook: null, hookSkipped: true, skipReason: sk } : P.extractHook(d.whisper);
    }
    const portOut = P.assembleReels(rankedPort, outcomes);
    // what n8n keeps after the 100,000 views filter must be what the port keeps, in the same order
    const n8nKept = runNode('Deduplicate Final Results', { input: [{ reels: n8nOut }] })[0].reels;
    const portKept = P.dedupeFilter(portOut);
    const slimKeep = r => ({ rank: r.rank, platform: r.platform, code: r.code, transcript: r.transcript, hook: r.hook, hookSkipped: r.hookSkipped === true });
    assert.deepEqual(portKept.map(slimKeep), n8nKept.map(slimKeep), 'kept reels and their hooks, run ' + n);
    for (const r of portKept) if (r.hookSkipped) skipped[r.skipReason || 'x'] = (skipped[r.skipReason || 'x'] || 0) + 1;

    // the Claude input and the prompt
    const n8nIn = runNode('Build Claude Input1', { input: [{ reels: n8nKept }], nodes })[0];
    const portIn = P.buildClaudeInput(portKept, cfg);
    assert.deepEqual(portIn, n8nIn, 'Claude input, run ' + n);
    usable += portIn.transcribedCount;
    const n8nBody = claudeBody(n8nIn);
    const portBody = P.claudeRequest(P.buildPrompt(portIn, NOW_MS));
    assert.equal(portBody.messages[0].content, n8nBody.messages[0].content, 'prompt, character for character, run ' + n);
    assert.deepEqual(portBody, n8nBody, 'whole request body, run ' + n);

    // the answer and the stored row
    const answer = claudeText();
    const n8nRow = runNode('Code in JavaScript1', { input: [{ content: [{ text: answer }] }], nodes })[0];
    const portRow = P.parseBrief(answer, keywords, NOW_MS);
    assert.deepEqual(portRow, n8nRow, 'stored row, run ' + n);
    if (n8nRow.rawJson2) chunked++;
    briefs++;
    return portBody.messages[0].content.length;
  }

  async function sweep(P) {
    seed = 20261002;
    let bad = 0;
    for (let n = 0; n < 250; n++) {
      try { await oneRun(n, P); } catch (e) { if (P === L) throw e; bad++; }
    }
    return bad;
  }
  await sweep(L);
  const cov = { briefs, ranked300, usable, chunked, noReels };
  assert(briefs > 150 && ranked300 >= 1 && usable > 200 && chunked > 5 && noReels > 3 && Object.keys(skipped).length >= 5, 'the random runs exercise every branch: ' + JSON.stringify({ briefs, ranked300, usable, chunked, noReels, skipped }));

  // Deliberate breakages of the port must be caught by the same comparison.
  const swappedScore = { ...L, sortAndFilter: (flat, now) => L.sortAndFilter(flat.map(r => ({ ...r, views: r.views, shares: (r.shares || 0) * 3 })), now) };
  const plainOrder = { ...L, assembleReels: (ranked, outcomes) => ranked.map(r => ({ ...r, ...(r.videoUrl ? (outcomes[r.rank] ?? { transcript: '', hook: null, hookSkipped: true }) : { hook: '', transcript: '' }) })) };
  const lowBar = { ...L, dedupeFilter: reels => L.dedupeFilter(reels).concat(reels.filter(r => (r.views || 0) < 100000).slice(0, 1)) };
  const b1 = await sweep(swappedScore), b2 = await sweep(plainOrder), b3 = await sweep(lowBar);
  assert(b1 > 20 && b2 > 20 && b3 > 20, 'deliberate breakages are caught: ' + [b1, b2, b3]);

  // Stated rules, one by one.
  assert.equal(L.checkFileSize(511999), 'file_too_small');
  assert.equal(L.checkFileSize(512000), null);
  assert.equal(L.checkFileSize(26214399), null);
  assert.equal(L.checkFileSize(26214400), 'file_too_large');
  assert.equal(L.checkFileSize(null), 'no_binary');
  assert.deepEqual(L.dedupeFilter([{ platform: 'instagram', code: 'a', views: 99999 }, { platform: 'instagram', code: 'b', views: 100000 }, { platform: 'instagram', code: 'b', views: 500000 }]).map(r => r.code), ['b']);
  assert.equal(L.needsTranscript({ videoUrl: 'u', views: 99999 }), false, 'a reel under 100,000 views can never reach the brief, so it is not transcribed');
  assert.equal(L.needsTranscript({ videoUrl: '', views: 999999 }), false);
  assert.equal(L.needsTranscript({ videoUrl: 'u', views: 100000 }), true);
  assert.equal(L.buildPrompt({ clientName: 'C', keywords: null, totalReels: 1, transcribedCount: 0, instagramInTop100: 1, tiktokInTop100: 0, instagramScraped: 1, tiktokScraped: 0, landscapeBlock: '', transcriptBlock: '' }, NOW_MS).includes('Keywords used: not specified'), true);
  const sha = crypto.createHash('sha256').update(L.buildPrompt({ clientName: 'C', clientNiche: 'n', contentDescription: '', keywords: ['k'], totalReels: 0, transcribedCount: 0, instagramInTop100: 0, tiktokInTop100: 0, instagramScraped: 0, tiktokScraped: 0, landscapeBlock: '', transcriptBlock: '' }, NOW_MS)).digest('hex');
  assert.match(sha, /^[0-9a-f]{64}$/);

  // The request statement the owner pastes: slug and keywords are inputs, anything else is refused.
  const { build } = require('../scripts/analytics-market-research-request.js');
  const run = a => { const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'scripts/analytics-market-research-request.js'), ...a], { encoding: 'utf8' }); return { status: r.status, out: r.stdout.trim() }; };
  assert.deepEqual(run(['--client=aaa', '--keyword=one', '--keyword=it\'s two', '--keyword=one']), { status: 0, out: `insert into public.analytics_market_research_collect_queue (client_slug, keywords, requested_by) values ('aaa', '["one","it''s two"]'::jsonb, 'script');` }, 'quotes doubled, duplicates dropped');
  for (const bad of [[], ['--client=aaa'], ['--keyword=x'], ['--client=a b', '--keyword=x'], ["--client=a'b", '--keyword=x'], ['--client=a', '--client=b', '--keyword=x'], ['--client=a', '--keyword=' + 'x'.repeat(81)], ['--client=a', '--keyword=bad\nnewline'],
    ['--client=a', ...Array.from({ length: 11 }, (_, i) => '--keyword=k' + i)]]) assert.equal(run(bad).status, 2, 'refused: ' + bad.join(' ').slice(0, 60));
  assert.equal(run(['--switch-off']).out, `update public.syncview_runtime_flags set value = '{"mode":"off"}'::jsonb where key = 'analytics_market_research_collect';`);
  assert.equal(run(['--switch-shadow', '--client=aaa', '--client=aaa']).out, `update public.syncview_runtime_flags set value = '{"mode":"shadow","clients":["aaa"],"max_new_per_day":2}'::jsonb where key = 'analytics_market_research_collect';`);
  for (const bad of [['--switch-shadow'], ['--switch-shadow', "--client=a'b"], ['--switch-shadow', '--client=a', '--max-new-per-day=11'], ['--switch-shadow', '--client=a', '--max-new-per-day=x']]) assert.equal(run(bad).status, 2, 'refused: ' + bad.join(' '));
  assert.equal(typeof build, 'function');

  console.log(`ANALYTICS_MARKET_RESEARCH_COLLECT_OK: 250 random runs identical to the n8n nodes at every stage (${cov.briefs} briefs built, ${cov.noReels} "no reels" errors, ${cov.ranked300} full 300-reel rankings, ${cov.usable} transcribed reels used, ${cov.chunked} briefs over 45,000 characters stored in pieces); prompt and request body equal character for character; 3 deliberate breakages caught (${b1}, ${b2}, ${b3} of 250)`);
}
main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
