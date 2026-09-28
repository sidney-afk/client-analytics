#!/usr/bin/env node
'use strict';
/*
 * Time the analytics-read Edge Function for ONE client against today's cost of
 * the same data: downloading the Google Sheets tabs the page reads.
 * Read-only; writes nothing anywhere.
 *
 *   SYNCVIEW_STAFF_KEY=... node scripts/sheets-mirror-read-timing.js --slug=<client slug> [--runs=5]
 *   SYNCVIEW_STAFF_KEY=... node scripts/sheets-mirror-read-timing.js --scope=overview|extras [--runs=5]
 *     the staff answers for every client, against the tabs they replace
 *     (overview: Metrics + Clients Info; extras: the other three). Bytes are
 *     shown as sent (gzipped, what the browser downloads) and unpacked.
 *
 * Run it after the migration is applied, the functions are deployed and the
 * backfill has run (docs/plans/2026-09-24-sheets-to-supabase.md, Phase 1).
 * Uses a staff role key, so it works while analytics_mirror_read_enabled is
 * still off. Prints timings and byte counts only, never row contents.
 */
// The workbook the page reads, taken from the page source so there is one copy.
const SHEET_ID = (require('fs').readFileSync(require('path').join(__dirname, '..', 'src/index/040-shared-briefs.js.part'), 'utf8')
  .match(/const SHEET_ID\s*=\s*'([^']+)'/) || [])[1];
if (!SHEET_ID) throw new Error('SHEET_ID not found in src/index/040-shared-briefs.js.part');
const BASE = process.env.SYNCVIEW_SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const TABS = ['Metrics', 'Clients Info', 'TopVideos', 'Market Research Briefs', 'ContentSummaries'];
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(n + '=')); return a ? a.slice(n.length + 1) : d; };
const slug = arg('--slug', '');
const scope = arg('--scope', '');
const SCOPE_TABS = { overview: ['Metrics', 'Clients Info'], extras: ['TopVideos', 'Market Research Briefs', 'ContentSummaries'] };
const runs = Math.max(1, Number(arg('--runs', '5')) || 5);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

async function timed(fn) {
  const t = performance.now();
  const bytes = await fn();
  return { ms: Math.round(performance.now() - t), bytes };
}

(async () => {
  const key = process.env.SYNCVIEW_STAFF_KEY || '';
  if (!key) throw new Error('set SYNCVIEW_STAFF_KEY (a staff role key) in the environment');
  if (scope && !SCOPE_TABS[scope]) throw new Error('--scope must be overview or extras');
  if (!slug && !scope) throw new Error('pass --slug=<client slug> (the test client, for example) or --scope=overview|extras');
  const tabs = scope ? SCOPE_TABS[scope] : TABS;
  const zlib = require('zlib');
  const fn = [];
  const sheets = [];
  for (let i = 0; i < runs; i++) {
    fn.push(await timed(async () => {
      const r = await fetch(BASE + '/functions/v1/analytics-read', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-syncview-key': key },
        body: JSON.stringify(scope ? { scope } : { slug }),
      });
      const text = await r.text();
      const out = JSON.parse(text);
      if (!out.ok) throw new Error('analytics-read refused: ' + (out.error || r.status));
      return scope ? zlib.gzipSync(text).length + ' sent / ' + Buffer.byteLength(text) + ' unpacked' : Buffer.byteLength(text);
    }));
    // Today: the page downloads these tabs in parallel for every client at once.
    sheets.push(await timed(async () => {
      const sizes = await Promise.all(tabs.map(async t => {
        const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(t)}`);
        return Buffer.byteLength(await r.text());
      }));
      return sizes.reduce((a, b) => a + b, 0);
    }));
  }
  console.log(`analytics-read, ${scope ? scope + ', every client' : 'one client'}: median ${median(fn.map(x => x.ms))} ms, ${fn[0].bytes} bytes  (runs: ${fn.map(x => x.ms).join(', ')})`);
  console.log(`Sheets today (${tabs.length} tabs), all clients: median ${median(sheets.map(x => x.ms))} ms, ${sheets[0].bytes} bytes  (runs: ${sheets.map(x => x.ms).join(', ')})`);
})().catch(e => { console.error('timing failed: ' + e.message); process.exit(1); });
