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
