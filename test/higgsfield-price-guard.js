'use strict';
/*
 * Safeguards on what the connector quotes (2026-10-22). Seedance 2.5 image to
 * video was quoted at $54.91 for a 5 second clip (about 30 times Seedance
 * 2.0), the team was shown it, and the monthly budget would have been charged
 * against it.
 *
 * - describedPrice and rateFor (taken from index.ts and run for real, with
 *   Higgsfield's sentence supplied): a normal per-second sentence still
 *   prices; a reading above the per-second ceiling is refused with the
 *   sentence shown, not quoted.
 * - catalog.ts: Seedance 2.5 offers every resolution Higgsfield's docs list
 *   (1080p was missing because the docs changed shape and the generator read
 *   no models at all).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { stripTypeScriptTypes } = require('module');

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');
const src = fs.readFileSync(path.join(dir, 'index.ts'), 'utf8');

(async () => {
  const from = src.indexOf('const VIDEO_BUDGET_S');
  const to = src.indexOf('// Length in seconds of an MP4/MOV');
  assert.ok(from > 0 && to > from, 'describedPrice is where this test expects it');
  const body = stripTypeScriptTypes(src.slice(from, to).replace(/^const SHORT_SIDE: Record<string, number>/m, 'const SHORT_SIDE'));
  const make = (schema) => new Function('BY_ID', 'directEstimate', 'videoSeconds', 'money', body + '\nreturn describedPrice;')(
    new Map([['m/x', { schema }]]), () => ({ usd: 0.05 }), async () => null, (n) => '$' + Number(n).toFixed(2));
  const schema = { properties: { resolution: { default: '720p' }, duration: { default: 5 } } };
  const priced = make(schema);

  const ok = await priced('m/x', { duration: 5, resolution: '720p' }, 'Priced per generated second by resolution: 480p $0.05, 720p $0.10');
  assert.deepStrictEqual(ok, { usd: 0.55 }, 'a normal per-second sentence still prices (5 s x $0.10 + 10%)');

  const top = await priced('m/x', { duration: 5, resolution: '4k' }, 'Priced per generated second by resolution: 720p $0.30, 4k $1.55');
  assert.ok('usd' in top && top.usd > 8 && top.usd < 9, 'the dearest real tier (about $1.7 a second) is still quoted: ' + JSON.stringify(top));

  const wild = 'Priced per generated second by resolution: 480p $1.97, 720p $9.98';
  const bad = await priced('m/x', { duration: 5, resolution: '720p' }, wild);
  assert.ok('error' in bad, 'a reading of about $11 a second is refused');
  assert.ok(/will not quote or charge it/.test(bad.error) && bad.error.includes(wild), 'and the refusal shows Higgsfield\'s sentence');
  assert.ok(!/cannot read/.test(bad.error), 'it is not the "work it out yourself" path, which would let a guess through');

  const cat = fs.readFileSync(path.join(dir, 'catalog.ts'), 'utf8');
  const list = JSON.parse(cat.slice(cat.indexOf('= [') + 2, cat.lastIndexOf('];') + 1));
  for (const kind of ['image-to-video', 'text-to-video', 'reference-to-video', 'video-edit', 'video-extend']) {
    const m = list.find((x) => x.id === 'bytedance/seedance-2.5/' + kind);
    assert.ok(m, kind + ' is in the catalog');
    assert.ok(m.schema.properties.resolution.enum.includes('1080p'), 'Seedance 2.5 ' + kind + ' offers 1080p');
  }
  console.log('higgsfield-price-guard: ok');
})().catch((e) => { console.error(e); process.exit(1); });
