'use strict';
/*
 * Templates: multiple links per link field (client photos, thumbnail /
 * editable Canva, reference reel).
 *
 * Verifies, by exercising the REAL helpers extracted from index.html:
 *   1. the additive migration shape — a legacy single string renders as a
 *      one-item list; the full list lives in a new sibling `<field>_list`
 *      column while the legacy `<field>` column keeps the FIRST link so old
 *      rows, old Sheet data and unflagged n8n clients keep working;
 *   2. the add / remove render (same UX as the existing color-set control);
 *   3. that saving rides the EXISTING flag-routed flow — the n8n Sheet webhook
 *      AND the templates-save Edge Function — with no new endpoint and no
 *      Edge Function shape change (patchObject already stores string keys).
 *
 * Run:  node test/templates-multilink.js   (exit 0 = all good)
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const EF = fs.readFileSync(path.join(ROOT, 'supabase/functions/templates-save/index.ts'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

let failures = 0;
function check(label, cond) {
  if (!cond) failures++;
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`);
}

const iconMatch = INDEX.match(/const _TPL_LINK_ICON = '[^']*';/);
assert(iconMatch, '_TPL_LINK_ICON const not found');
const maxMatch = INDEX.match(/const TPL_MAX_LINKS = (\d+);/);
assert(maxMatch, 'TPL_MAX_LINKS const not found');
const TPL_MAX_LINKS = parseInt(maxMatch[1], 10);

// Build a sandbox holding the REAL link helpers + recording stubs. Assembled by
// concatenation (not a template literal) so the grabbed sources' own `${...}`
// template placeholders survive verbatim.
const sandbox = [
  maxMatch[0],
  iconMatch[0],
  'const templatesData = deps.templatesData;',
  'const queued = deps.queued;',
  'let _templatesSelected = null;',
  'const document = { getElementById: function () { return null; } };',
  'function renderClientTemplate() { return ""; }',
  'function mountTemplatesView() {}',
  'function _tplGet(name, field) { return (templatesData[name] && templatesData[name][field]) || ""; }',
  'function _tplQueueSave(name, field, value, immediate) {',
  '  if (!templatesData[name]) templatesData[name] = { client_name: name };',
  '  templatesData[name][field] = value;',
  '  queued.push({ name: name, field: field, value: value });',
  '}',
  'function _tplEsc(s) { return String(s == null ? "" : s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }',
  'function _calEscAttr(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&#39;"); }',
  'function _jsAttrArg(v) { return _calEscAttr(JSON.stringify(String(v == null ? "" : v))); }',
  'var _NOT_SET = "<span class=\\"tpl-not-set\\">Not set</span>";',
  grabFunc('_tplGetLinks'),
  grabFunc('_tplSaveLinks'),
  grabFunc('_tplAddLink'),
  grabFunc('_tplRemoveLink'),
  grabFunc('_tplRenderLinksEdit'),
  grabFunc('_tplRenderLinksView'),
  'return { _tplGetLinks: _tplGetLinks, _tplSaveLinks: _tplSaveLinks, _tplAddLink: _tplAddLink,',
  '  _tplRemoveLink: _tplRemoveLink, _tplRenderLinksEdit: _tplRenderLinksEdit, _tplRenderLinksView: _tplRenderLinksView };',
].join('\n');

function makeApi(templatesData, queued) {
  return new Function('deps', sandbox)({ templatesData: templatesData, queued: queued || [] });
}

// ── 1. Migration shape (string → list) ──────────────────────────────────────
{
  const api = makeApi({ Acme: { reels_reference_link: 'https://a.com' } });
  const list = api._tplGetLinks('Acme', 'reels_reference_link');
  check('legacy single string migrates to a one-item list',
    Array.isArray(list) && list.length === 1 && list[0] === 'https://a.com');
}
{
  const api = makeApi({ Acme: {
    reels_reference_link: 'https://a.com',
    reels_reference_link_list: JSON.stringify(['https://a.com', 'https://b.com']),
  } });
  const list = api._tplGetLinks('Acme', 'reels_reference_link');
  check('the sibling _list array is the source of truth when present',
    list.length === 2 && list[0] === 'https://a.com' && list[1] === 'https://b.com');
}
{
  const api = makeApi({ Acme: {} });
  const list = api._tplGetLinks('Acme', 'thumbnails_photos_link');
  check('no value yet → a single empty row', list.length === 1 && list[0] === '');
}
{
  // A malformed _list JSON string must not throw; it falls back to the legacy value.
  const api = makeApi({ Acme: { thumbnails_photos_link: 'https://ok.com', thumbnails_photos_link_list: '{bad json' } });
  const list = api._tplGetLinks('Acme', 'thumbnails_photos_link');
  check('malformed _list JSON falls back to the legacy single link', list.length === 1 && list[0] === 'https://ok.com');
}

// ── 2. Save payload — legacy mirror + sibling list (same on both paths) ──────
{
  const templatesData = { Acme: {} };
  const queued = [];
  const api = makeApi(templatesData, queued);
  api._tplSaveLinks('Acme', 'thumbnails_photos_link', ['https://one.com', 'https://two.com', '']);
  const listSave = queued.find(q => q.field === 'thumbnails_photos_link_list');
  const legacySave = queued.find(q => q.field === 'thumbnails_photos_link');
  check('the full list is persisted in the new sibling column',
    !!listSave && JSON.parse(listSave.value).length === 3 && JSON.parse(listSave.value)[1] === 'https://two.com');
  check('the legacy single column keeps the FIRST link (backward-compatible)',
    !!legacySave && legacySave.value === 'https://one.com');
  check('templatesData reflects both columns for the next read',
    templatesData.Acme.thumbnails_photos_link === 'https://one.com' &&
    JSON.parse(templatesData.Acme.thumbnails_photos_link_list).length === 3);
}
{
  const queued = [];
  const api = makeApi({ Acme: {} }, queued);
  api._tplSaveLinks('Acme', 'reels_reference_link', []);
  const legacySave = queued.find(q => q.field === 'reels_reference_link');
  const listSave = queued.find(q => q.field === 'reels_reference_link_list');
  check('empty list mirrors an empty legacy cell', legacySave && legacySave.value === '');
  check('empty list still persists a (single empty) sibling array', listSave && JSON.parse(listSave.value).length === 1);
}

// ── 3. Add / remove behaviour (mirrors the color-set control) ────────────────
{
  const api = makeApi({ Acme: { thumbnails_canva_link: 'https://c.com' } });
  api._tplAddLink('Acme', 'thumbnails_canva_link');
  let list = api._tplGetLinks('Acme', 'thumbnails_canva_link');
  check('Add link appends a blank row to the (migrated) list',
    list.length === 2 && list[0] === 'https://c.com' && list[1] === '');
  api._tplRemoveLink('Acme', 'thumbnails_canva_link', 0);
  list = api._tplGetLinks('Acme', 'thumbnails_canva_link');
  check('Remove drops the row at the given index', list.length === 1 && list[0] === '');
}
{
  const api = makeApi({ Acme: { reels_reference_link: 'https://x.com' } });
  api._tplRemoveLink('Acme', 'reels_reference_link', 0);
  const list = api._tplGetLinks('Acme', 'reels_reference_link');
  check('removing the last link leaves one empty row (never zero)', list.length === 1 && list[0] === '');
}
{
  const api = makeApi({ Acme: {} });
  for (let i = 0; i < TPL_MAX_LINKS + 4; i++) api._tplAddLink('Acme', 'reels_reference_link');
  const list = api._tplGetLinks('Acme', 'reels_reference_link');
  check('Add link is capped at TPL_MAX_LINKS', list.length === TPL_MAX_LINKS);
}

// ── 4. Render (edit + view) ──────────────────────────────────────────────────
{
  const api = makeApi({ Acme: { thumbnails_photos_link_list: JSON.stringify(['https://p1.com', 'https://p2.com']) } });
  const html = api._tplRenderLinksEdit('Acme', 'thumbnails_photos_link', 'Client photos', 'https://…');
  check('edit render shows one input row per link', (html.match(/data-tpl-link-set=/g) || []).length === 2);
  check('edit render carries the container wiring hooks',
    /data-tpl-links\b/.test(html) && /data-tpl-link-field="thumbnails_photos_link"/.test(html));
  check('edit render offers an Add link control', /_tplAddLink\(/.test(html) && /Add link/.test(html));
  check('edit render shows a remove control per row when >1 link', (html.match(/_tplRemoveLink\(/g) || []).length === 2);
}
{
  const api = makeApi({ Acme: { reels_reference_link: 'https://only.com' } });
  const html = api._tplRenderLinksEdit('Acme', 'reels_reference_link', 'Reference reel', 'https://…');
  check('a single (migrated) link shows no remove control — matches color-set UX', !/_tplRemoveLink\(/.test(html));
  check('the single migrated link is populated in the input', /value="https:\/\/only.com"/.test(html));
}
{
  const api = makeApi({ Acme: { thumbnails_canva_link_list: JSON.stringify(['https://x.com', 'not-a-url', 'https://y.com']) } });
  const html = api._tplRenderLinksView('Acme', 'thumbnails_canva_link', 'Editable Canva', 'Open Canva');
  check('view render lists only valid http(s) links', (html.match(/class="tpl-view-link"/g) || []).length === 2);
}
{
  const api = makeApi({ Acme: {} });
  const html = api._tplRenderLinksView('Acme', 'thumbnails_canva_link', 'Editable Canva', 'Open Canva');
  check('view render with nothing set shows Not set', /tpl-not-set/.test(html));
}

// ── 5. Wiring + both save paths unchanged (source assertions) ────────────────
check('reels_reference_link (reference reel) uses the multi-link renderers',
  INDEX.includes("_tplRenderLinksEdit(name, 'reels_reference_link'") && INDEX.includes("_tplRenderLinksView(name, 'reels_reference_link'"));
check('thumbnails_photos_link (client photos) uses the multi-link renderers',
  INDEX.includes("_tplRenderLinksEdit(name, 'thumbnails_photos_link'") && INDEX.includes("_tplRenderLinksView(name, 'thumbnails_photos_link'"));
check('thumbnails_canva_link (thumbnail) uses the multi-link renderers',
  INDEX.includes("_tplRenderLinksEdit(name, 'thumbnails_canva_link'") && INDEX.includes("_tplRenderLinksView(name, 'thumbnails_canva_link'"));
check('the multi-link containers are wired in mountTemplatesView',
  INDEX.includes("root.querySelectorAll('[data-tpl-links]')"));
check('saving still rides the existing flag-routed templates flow (n8n webhook + EF), no new endpoint',
  INDEX.includes('_settingsWriteUrlForClient(name, TEMPLATES_SAVE_EF_URL, TEMPLATES_SAVE_URL)'));
check('templates-save Edge Function already stores arbitrary string patch keys (no shape change needed)',
  /function patchObject/.test(EF) && /out\[k\] = String\(/.test(EF));

if (failures) { console.error(`\n${failures} check(s) failed ❌`); process.exit(1); }
console.log('\nAll templates-multilink checks passed ✅');
