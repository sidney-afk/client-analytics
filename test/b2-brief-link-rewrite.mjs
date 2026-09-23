/*
 * B2 brief-link rewrite: the pure transform (scripts/b2-brief-link-rewrite.mjs),
 * the server projection's new `syncview-media:<occurrence id>` form
 * (supabase/functions/_shared/native-brief-media.mjs, NEEDS an owner deploy of
 * production-write), and the SHIPPED browser renderers out of index.html.
 * Fully offline; all data is synthetic.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as R from '../scripts/b2-brief-link-rewrite.mjs';
import * as M from '../supabase/functions/_shared/native-brief-media.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const L1 = 'https://uploads.linear.app/aaa/bbb/one.png?signature=x';
const L2 = 'https://uploads.linear.app/aaa/ccc/two.jpg';

function occ(row, link, id, extra = {}) {
  return { id, deliverable_id: row.id, client_slug: row.client_slug, team: row.team, source_kind: 'native_brief',
    source_entity_id: row.id, state: 'verified', audience: 'staff', source_sha256: sha(row.brief),
    source_offset: link.offset, source_length: link.length, original_url_sha256: sha(link.url),
    source_updated_at: '2026-09-20T00:00:00Z', content_sha256: 'c'.repeat(64), readback_sha256: 'c'.repeat(64),
    mime_type: 'image/png', byte_length: 10, verified_at: '2026-09-20T00:00:00Z', storage_path: 'c'.repeat(64) + '/' + id, ...extra };
}
function fixture(brief, n = 1) {
  const row = { id: 'D-' + n, client_slug: 'test-client', team: 'video', status: 'todo', brief, updated_at: '2026-09-21T00:00:00Z' };
  const links = M.briefMediaOccurrences(brief);
  return { row, links, occs: links.map((l, i) => occ(row, l, uuid(n * 100 + i))) };
}

console.log('transform');
{
  // Angle + plain forms, a duplicate URL, and a non-BMP character before a link (UTF-16 offsets).
  const brief = 'Hi 😀\n![one](<' + L1 + '>)\ntext ![two](' + L2 + ') and again ![](' + L2 + ')\n' + L1 + ' end';
  const { row, links, occs } = fixture(brief);
  ok(links.length === 4, 'fixture has 4 Linear links (one repeated URL, one bare)');
  const p = R.planRewrite(row, occs);
  ok(p.status === 'rewrite' && p.mapped === 4, 'every link maps to exactly one verified occurrence');
  ok(!/uploads\.linear\.app/.test(p.brief), 'no Linear URL remains');
  ok(p.brief === 'Hi 😀\n![one](<syncview-media:' + uuid(100) + '>)\ntext ![two](syncview-media:' + uuid(101)
    + ') and again ![](syncview-media:' + uuid(102) + ')\nsyncview-media:' + uuid(103) + ' end',
    'only the URL characters change; Markdown and the duplicate get their own occurrence ids');
  ok(M.briefMediaReferences(p.brief).map(r => r.occurrence_id).join() === [100, 101, 102, 103].map(uuid).join(), 'references scan back in order');
  ok(!/signature|sign\//.test(p.brief), 'no signed URL is stored');
  // Idempotent
  ok(R.planRewrite({ ...row, brief: p.brief }, occs).status === 'noop', 'a rewritten brief is a no-op on re-run');
  // Edited brief: occurrences recorded for older text
  const edited = { ...row, brief: 'EDIT ' + brief };
  ok(R.planRewrite(edited, occs).status === 'skip_edited', 'a brief edited since the copy is skipped (source_sha256 mismatch)');
  // Offset mismatch with same sha is refused
  const bad = occs.map((o, i) => i === 1 ? { ...o, source_offset: o.source_offset + 1 } : o);
  ok(R.planRewrite(row, bad).status === 'skip_unmapped', 'an occurrence at the wrong offset is never guessed');
  ok(R.planRewrite(row, occs.slice(1)).status === 'skip_unmapped', 'a link with no verified copy skips the whole brief');
  ok(R.planRewrite(row, occs.map(o => ({ ...o, state: 'pending' }))).status === 'skip_unmapped', 'unverified copies are ignored');
  ok(R.planRewrite(row, occs.map(o => ({ ...o, client_slug: 'other' }))).status === 'skip_unmapped', 'another client\'s copies are ignored');
  ok(R.planRewrite(row, [...occs, { ...occs[0], id: uuid(999) }]).status === 'skip_unmapped', 'two candidates for one link is ambiguity, refused');
  const c = R.summarize([row, edited, { ...row, id: 'D-x', brief: 'none' }], occs);
  ok(c.deliverables === 2 && c.links === 8 && c.rewrite_deliverables === 1 && c.rewrite_links === 4 && c.skipped_edited === 1 && c.already_clean === 1,
    'summary counts deliverables, links, rewrites and skips');
  let threw = 0;
  for (const argv of [['--apply'], ['--apply', '--client=x'], ['--bogus']]) { try { R.parseArgs(argv); } catch { threw++; } }
  ok(threw === 3, '--apply requires a client allowlist and a snapshot; unknown flags refused');
  ok(R.parseArgs([]).apply === false, 'dry-run is the default');
}

console.log('projection (server source; needs an owner deploy of production-write)');
function mockDb(row, occs) {
  const q = (table) => {
    const chain = { select: () => chain, eq: () => chain, limit: async () => ({ data: occs, error: null }),
      maybeSingle: async () => table === 'syncview_runtime_flags'
        ? { data: { value: { mode: 'required', contract: 'native_brief_media_v1', recovery_contract: 'native_brief_media_recovery_v1',
          recovery_receipt_sha256: 'a'.repeat(64), coverage_receipt_sha256: 'b'.repeat(64) } }, error: null }
        : { data: row, error: null } };
    return chain;
  };
  return { from: q, storage: { from: () => ({ createSignedUrl: async (p) => ({ data: { signedUrl: 'https://proj.example/storage/v1/object/sign/syncview-native-brief-media/' + p + '?token=t' }, error: null }) }) } };
}
{
  const brief = 'x ![one](<' + L1 + '>) y ![two](' + L2 + ')';
  const { row, occs } = fixture(brief, 2);
  const legacy = await M.projectBriefMedia(mockDb(row, occs), row, 'https://proj.example', Date.parse('2026-09-23T00:00:00Z'));
  ok(legacy.complete && legacy.copied === 2, 'legacy Linear links still resolve');
  const rewritten = { ...row, brief: R.planRewrite(row, occs).brief };
  const now = await M.projectBriefMedia(mockDb(rewritten, occs), rewritten, 'https://proj.example', Date.parse('2026-09-23T00:00:00Z'));
  ok(now.complete && now.copied === 2 && now.occurrences === 2, 'syncview-media references resolve through the same projection');
  ok(now.render_brief === legacy.render_brief, 'and render exactly what the legacy links rendered');
  ok(!/syncview-media:|uploads\.linear/.test(now.render_brief), 'no reference or Linear URL survives into the render');
  const mixed = { ...row, brief: 'a ![one](<syncview-media:' + occs[0].id + '>) b ![two](' + L2 + ')' };
  const mixedOcc = occs.map((o, i) => i === 1 ? { ...o, source_sha256: sha(brief) } : o);
  const m = await M.projectBriefMedia(mockDb(mixed, mixedOcc), mixed, 'https://proj.example', Date.parse('2026-09-23T00:00:00Z'));
  ok(m.complete && m.copied === 2, 'a brief mixing both forms resolves both');
  const foreign = { ...row, brief: '![x](syncview-media:' + uuid(4242) + ')' };
  const f = await M.projectBriefMedia(mockDb(foreign, occs), foreign, 'https://proj.example', Date.parse('2026-09-23T00:00:00Z'));
  ok(!f.complete && f.render_brief === null, 'an id that is not one of this row\'s verified copies is unresolved, never guessed');
  ok(M.briefMediaReferences('syncview-media:' + uuid(1) + 'x').length === 0, 'a reference glued to more id characters is not matched');
}

console.log('browser renderers (shipped index.html)');
{
  const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const grab = sig => {
    const start = INDEX.indexOf(sig); if (start < 0) throw Error('not found ' + sig);
    let depth = 0, quote = '', comment = '', esc = false;
    for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
      const c = INDEX[i], n = INDEX[i + 1];
      if (comment === 'line') { if (c === '\n') comment = ''; continue; }
      if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
      if (quote) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === quote) quote = ''; continue; }
      if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
      if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++; else if (c === '}' && --depth === 0) return INDEX.slice(start, i + 1);
    }
    throw Error('unclosed ' + sig);
  };
  const line = sig => { const s = INDEX.indexOf(sig); return INDEX.slice(s, INDEX.indexOf('\n', s)).trim(); };
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext([line('function _calEsc('), grab('function _prodNormalizeMarkdownLine('), grab('function _prodMarkdownBlockish('),
    grab('function _prodLinkifyInline('), grab('function _prodLinkify('),
    'const PROD_DESC_RICH_PLACEHOLDER_RE = /!\\[Uploading image (\\d+)…\\]\\(\\)/;',
    grab('function _prodDescRichAttr('), grab('function _prodDescRichInline('), grab('function _prodDescRichSerializeInline('),
    'this.inline = _prodLinkifyInline; this.rich = _prodDescRichInline; this.ser = _prodDescRichSerializeInline;'].join('\n'), ctx);
  const id = uuid(7);
  for (const src of ['![shot](syncview-media:' + id + ')', '![shot](<syncview-media:' + id + '>)']) {
    const html = ctx.inline(src, true);
    ok(/data-syncview-media-pending="1"/.test(html) && /Image not loaded: shot/.test(html) && !/<img|<a /.test(html),
      'unresolved reference renders an honest placeholder, not an image or link: ' + (src.includes('<') ? 'angle' : 'plain'));
  }
  ok(/data-syncview-media-pending/.test(ctx.inline('see syncview-media:' + id, false)), 'a bare reference is a placeholder even where images are off');
  ok(/<img [^>]*src="https:\/\/cdn\.example\/a\.png"/.test(ctx.inline('![a](https://cdn.example/a.png)', true)), 'resolved https images still render as images');
  ok(/<img /.test(ctx.inline('![a](' + L1 + ')', true)), 'legacy Linear links render as today');
  const xss = ctx.inline('![<img src=x onerror=alert(1)>](syncview-media:' + id + ')', true);
  ok(!/<img/.test(xss), 'alt text in the placeholder is escaped');
  // Rich editor: chip + exact serialization back
  for (const src of ['![shot](syncview-media:' + id + ')', '![a "q"](<syncview-media:' + id + '>)']) {
    const html = ctx.rich(src);
    const m = /<span class="prod-desc-media-ref" data-md-media="([^"]+)" data-md-media-form="([^"]+)" data-md-media-alt="([^"]*)" contenteditable="false">/.exec(html);
    ok(!!m && m[1] === id && !/<img/.test(html), 'editor shows a non-editable chip, never an <img>');
    const dec = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const attrs = { 'data-md-media': m[1], 'data-md-media-form': m[2], 'data-md-media-alt': dec(m[3]) };
    const span = { nodeType: 1, tagName: 'SPAN', childNodes: [], classList: { contains: () => false },
      getAttribute: k => attrs[k] ?? null, hasAttribute: k => k in attrs };
    ok(ctx.ser({ childNodes: [span] }) === src, 'chip serializes back to the exact source');
  }
}

if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('b2-brief-link-rewrite: all ok');
