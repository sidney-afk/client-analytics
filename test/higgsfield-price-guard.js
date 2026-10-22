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
  const to = src.indexOf('// Long side over short side');
  assert.ok(from > 0 && to > from, 'describedPrice is where this test expects it');
  const body = stripTypeScriptTypes(src.slice(from, to).replace(/^const SHORT_SIDE: Record<string, number>/m, 'const SHORT_SIDE'));
  const imageShapes = { 'https://img/wide': 21 / 9, 'https://img/tall': 16 / 9 };
  const make = (schema) => new Function('BY_ID', 'directEstimate', 'videoSeconds', 'money', 'imageRatio', body + '\nreturn describedPrice;')(
    new Map([['m/x', { schema }]]), () => ({ usd: 0.05 }), async () => null, (n) => '$' + Number(n).toFixed(2), async (link) => (link in imageShapes ? imageShapes[link] : null));
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

  // Seedance 2.5's real sentence (read live 2026-10-22): the per second summary
  // and the token rates are both in it, and the token rate is the one to use.
  const s25 = 'For 16:9 video without video input, your request costs roughly $0.2056 per second of generated video at 480p, $0.4622 at 720p, and $1.1372 at 1080p. Each 1,000 video tokens costs $0.0214 at 480p or 720p and $0.0234 at 1080p. Billable video tokens = ceil(output height \u00d7 output width \u00d7 (input video duration + generated video duration) \u00d7 24 / 1024). Image and audio references do not count as video input. Actual pricing depends on output dimensions and billable duration.';
  const near = (got, want) => 'usd' in got && Math.abs(got.usd - want) < 0.02;
  assert.ok(near(await priced('m/x', { duration: 5, resolution: '720p' }, s25), 2.54), 'Seedance 2.5, 5 s at 720p, is about $2.31 plus the 10% margin: ' + JSON.stringify(await priced('m/x', { duration: 5, resolution: '720p' }, s25)));
  assert.ok(near(await priced('m/x', { duration: 5, resolution: '480p' }, s25), 1.13), 'and 5 s at 480p about $1.03 plus the margin');
  assert.ok(near(await priced('m/x', { duration: 5, resolution: '1080p' }, s25), 6.26), 'and 5 s at 1080p about $6.26 with the margin');

  // Source-framed models (no aspect_ratio setting) are priced on the image's own shape.
  const framed = (img) => priced('m/x', { duration: 5, resolution: '720p', image_url: img }, s25);
  assert.ok(near(await framed('https://img/tall'), 2.54), 'a 16:9 or 9:16 image: about $2.54: ' + JSON.stringify(await framed('https://img/tall')));
  assert.ok(near(await framed('https://img/wide'), 3.34), 'a 21:9 image: about $3.34, not the 16:9 price');
  assert.ok(near(await framed('https://img/unreadable'), 3.34), 'an unreadable image is quoted at the widest shape, never below the charge');
  const { imageSize } = await import(path.join(dir, 'imagesize.mjs'));
  const png = (w, h) => { const b = new Uint8Array(32); b.set([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
  assert.deepStrictEqual(imageSize(png(1680, 720)), { w: 1680, h: 720 }, 'PNG size is read');
  const jpg = new Uint8Array(40); jpg.set([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x04, 0x38, 0x07, 0x80, 3]);
  assert.deepStrictEqual(imageSize(jpg), { w: 1920, h: 1080 }, 'JPEG size is read');
  const gif = new Uint8Array(32); gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
  assert.deepStrictEqual(imageSize(gif), { w: 320, h: 240 }, 'GIF size is read');
  assert.strictEqual(imageSize(new Uint8Array(40)), null, 'unknown bytes give null');

  const cat = fs.readFileSync(path.join(dir, 'catalog.ts'), 'utf8');
  const list = JSON.parse(cat.slice(cat.indexOf('= [') + 2, cat.lastIndexOf('];') + 1));
  for (const kind of ['image-to-video', 'text-to-video', 'reference-to-video', 'video-edit', 'video-extend']) {
    const m = list.find((x) => x.id === 'bytedance/seedance-2.5/' + kind);
    assert.ok(m, kind + ' is in the catalog');
    assert.ok(m.schema.properties.resolution.enum.includes('1080p'), 'Seedance 2.5 ' + kind + ' offers 1080p');
  }
  // The model list refreshes itself from the live docs.
  const { parseDocs } = await import(path.join(dir, 'catalogparse.mjs'));
  const doc = (quoted) => {
    const schema = JSON.stringify({ type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, resolution: { enum: ['720p', '1080p'], default: '720p' } } }, null, 2);
    const block = quoted ? schema.split('\n').map((l) => '> ' + l).join('\n') : schema;
    return '# Brand New Video API\nSource: x\n\n**Endpoint ID:** `acme/new-video/text-to-video`\n\n## Usage notes\n\n* A note.\n\n## Input schema\n\n' + (quoted ? '> **Complete JSON schema**\n>\n> ```json theme={"theme":{}}\n' + block + '\n> ```\n' : '<Accordion title="Complete JSON schema">\n```json theme={"theme":{}}\n' + block + '\n```\n</Accordion>\n') + '\n## Next\n';
  };
  for (const quoted of [true, false]) {
    const got = parseDocs(doc(quoted));
    assert.strictEqual(got.length, 1, 'one model read from the ' + (quoted ? 'quoted' : 'older') + ' docs layout');
    assert.strictEqual(got[0].id, 'acme/new-video/text-to-video');
    assert.strictEqual(got[0].category, 'text-to-video');
    assert.deepStrictEqual(got[0].schema.properties.resolution.enum, ['720p', '1080p']);
  }
  const rs = src.indexOf('const CATALOG_TTL_MS');
  const re = src.indexOf('\n}\n', src.indexOf('function refreshCatalog')) + 3;
  const refreshSrc = stripTypeScriptTypes(src.slice(rs, re).replace('let ALL_MODELS', 'var ALL_MODELS'));
  const known = Array.from({ length: 10 }, (_, i) => ({ id: 'k/m' + i, name: 'M' + i, category: 'text-to-video', notes: [], schema: {} }));
  const build = (reply) => {
    const state = { all: null, calls: 0 };
    const fetcher = async () => { state.calls++; return reply(); };
    const run = new Function('CATALOG', 'DIRECT_MODELS', 'DOCS_URL', 'parseDocs', 'fetch', 'state',
      'let ALL_MODELS = [...DIRECT_MODELS, ...CATALOG]; let BY_ID = new Map(ALL_MODELS.map((m) => [m.id, m]));\n' + refreshSrc.replace(/^let ALL_MODELS[^\n]*\nlet BY_ID[^\n]*\n/m, '') +
      '\nreturn { refresh: refreshCatalog, ids: () => [...BY_ID.keys()] };')(known, [{ id: 'direct/x' }], 'https://docs.example/x', (t) => JSON.parse(t), fetcher, state);
    return { run, state };
  };
  const mk = (n, extra) => ({ ok: true, text: async () => JSON.stringify([...known.slice(0, n), ...extra]) });
  let t = build(() => mk(10, [{ id: 'k/new', name: 'New', category: 'text-to-video', notes: [], schema: {} }]));
  await t.run.refresh();
  assert.ok(t.run.ids().includes('k/new') && t.run.ids().includes('direct/x'), 'a new model in the docs is added');
  await t.run.refresh();
  assert.strictEqual(t.state.calls, 1, 'and the docs are read once per few hours, not on every call');
  t = build(() => mk(5, []));
  await t.run.refresh();
  assert.strictEqual(t.run.ids().length, 11, 'a docs reply with far fewer models is a format change: the list is kept');
  t = build(() => mk(9, []));
  await t.run.refresh();
  assert.ok(t.run.ids().includes('k/m9'), 'a model missing from the docs is never dropped by a refresh');
  t = build(() => { throw new Error('offline'); });
  await t.run.refresh();
  assert.strictEqual(t.run.ids().length, 11, 'a failed read keeps the list');
  assert.ok(/async function callTool[^\n]*\n  await refreshCatalog\(\);/.test(src), 'every tool call refreshes first');

  console.log('higgsfield-price-guard: ok');
})().catch((e) => { console.error(e); process.exit(1); });
