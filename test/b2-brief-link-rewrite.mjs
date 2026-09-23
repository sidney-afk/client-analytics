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
  const row = { id: 'D-' + n, client_slug: 'fixture-client', team: 'video', status: 'todo', brief, updated_at: '2026-09-21T00:00:00Z' };
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

console.log('capability probe (apply aborts unless the deployed gateway proves support)');
{
  process.env.SUPABASE_URL = 'https://proj.example'; process.env.SUPABASE_PUBLISHABLE_KEY = 'pk';
  process.env.SYNCVIEW_STAFF_KEY = 'sk'; process.env.SYNCVIEW_ACTOR = 'actor';
  const row = { id: 'D-9', client_slug: 'fixture-client' };
  const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
  const good = { ok: true, row: { id: 'D-9' }, media: { reference_forms: ['uploads_linear_app', 'syncview_media_v1'] } };
  ok((await R.probeCapability(row, reply(200, good))).ok === true, 'a gateway advertising syncview_media_v1 passes');
  const cases = [
    [reply(200, { ok: true, row: { id: 'D-9' }, media: { contract: 'native_brief_media_v1' } }), 'gateway_lacks_syncview_media_support', 'older deploy (no marker)'],
    [reply(200, { ok: true, row: { id: 'D-9' }, media: { reference_forms: ['uploads_linear_app'] } }), 'gateway_lacks_syncview_media_support', 'marker without the new form'],
    [reply(200, { ok: true, row: { id: 'OTHER' }, media: good.media }), 'probe_ambiguous_response', 'answer for another row'],
    [reply(401, { error: 'x' }), 'probe_http_401', 'refused request'],
    [async () => { throw Error('net'); }, 'probe_unreachable', 'network failure'],
  ];
  for (const [f, reason, label] of cases) {
    const r = await R.probeCapability(row, f);
    ok(r.ok === false && r.reason === reason, 'probe refuses: ' + label);
  }
  const { row: prow } = fixture('![a](' + L1 + ')', 3);
  const p = await M.projectBriefMedia({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }, prow, 'https://proj.example');
  ok(Array.isArray(p.reference_forms) && p.reference_forms.includes(R.REQUIRED_REFERENCE_FORM),
    'the projection source advertises syncview_media_v1 even on its refusal path');
}

console.log('gateway read/write/readback, occurrences file, stop-on-first-failure (mocked fetch)');
{
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b2rw-'));
  process.env.SUPABASE_URL = 'https://proj.example'; process.env.SUPABASE_PUBLISHABLE_KEY = 'pk';
  process.env.SYNCVIEW_STAFF_KEY = 'sk'; process.env.SYNCVIEW_ACTOR = 'actor';
  delete process.env.B2_TEST_CLIENT_SLUG; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const meta = o => Object.fromEntries(R.OCCURRENCE_FIELDS.map(f => [f, o[f]]));
  const f1 = fixture('a ![one](' + L1 + ') b ![two](' + L2 + ')', 11), f2 = fixture('c ![two](<' + L2 + '>) d', 12);
  const f3 = { ...fixture('e ' + L1, 13) }; f3.row.client_slug = 'fixture-other'; f3.occs = f3.links.map((l, i) => occ(f3.row, l, uuid(1300 + i)));
  const allOcc = [...f1.occs, ...f2.occs, ...f3.occs].map(meta);
  const occFile = path.join(tmp, 'occ.json'); fs.writeFileSync(occFile, JSON.stringify(allOcc));

  // loader
  ok(R.loadOccurrences(occFile).length === allOcc.length, 'occurrences file loads');
  let bad = 0;
  for (const t of ['{', '{}', '[1]', JSON.stringify([{ id: 'x' }]), JSON.stringify([{ ...allOcc[0], brief: 't' }])]) {
    try { R.parseOccurrences(t); } catch { bad++; }
  }
  ok(bad === 5, 'loader refuses non-JSON, non-array, non-object, missing fields, and rows carrying brief text');
  const tg = R.targetsFrom(allOcc, []);
  ok(tg.length === 3, 'targets are distinct (deliverable_id, client_slug)');
  ok(R.targetsFrom(allOcc, ['fixture-client']).length === 2, '--client filters the targets');
  let threw = 0; try { R.parseArgs(['--apply', '--client=x', '--snapshot=s']); } catch { threw++; }
  ok(threw === 1, '--apply requires --occurrences');
  ok(R.parseArgs([]).stopOnFirstFailure === true && R.parseArgs(['--no-stop-on-first-failure']).stopOnFirstFailure === false,
    '--stop-on-first-failure defaults ON');

  // mocked gateway
  function gateway(rows, { failWriteFor = new Set(), unresolved = 0, forms = ['uploads_linear_app', 'syncview_media_v1'] } = {}) {
    const db = new Map(rows.map(r => [r.id, { ...r }]));
    const calls = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url, headers: init.headers, body });
      const reply = (status, j) => ({ ok: status < 300, status, json: async () => j });
      if (url !== 'https://proj.example/functions/v1/production-write') return reply(404, {});
      const r = db.get(body.id);
      if (!r || r.client_slug !== body.client_slug) return reply(404, { ok: false });
      if (body.action === 'description_read') return reply(200, { ok: true, complete: true, row: { ...r, extra: 1 },
        media: { reference_forms: forms, unresolved, images: [] } });
      if (body.operation === 'description') {
        if (failWriteFor.has(body.id) || body.expected_updated_at !== r.updated_at) return reply(409, { ok: false, error: 'stale' });
        r.brief = body.description; r.updated_at = '2026-09-23T00:00:0' + calls.length + 'Z';
        return reply(200, { ok: true });
      }
      return reply(400, {});
    };
    return { db, calls, fetchImpl };
  }
  const rowsAll = [f1.row, f2.row, f3.row];
  const logs = [];
  const log = s => logs.push(s);

  // no service-role env is read for non-test rows
  const realEnv = process.env; const touched = new Set();
  process.env = new Proxy(realEnv, { get(t, k) { touched.add(k); return t[k]; } });
  try {
    const g = gateway(rowsAll);
    const dry = await R.run(['--occurrences=' + occFile], { fetchImpl: g.fetchImpl, log });
    ok(dry.rewrite_deliverables === 3 && dry.rewrite_links === 4, 'live dry-run reads briefs through description_read');
    ok(g.calls.every(c => c.body.action === 'description_read' && c.headers['x-syncview-key'] === 'sk'
      && c.headers.apikey === 'pk' && c.headers.Authorization === 'Bearer pk' && c.headers['x-syncview-actor'] === 'actor'),
      'reads carry the staff headers only');
    realEnv.B2_BRIEF_REWRITE_CONFIRM = 'REWRITE_BRIEF_LINKS';
    const snap = path.join(tmp, 'snap1.json');
    const out = await R.run(['--apply', '--occurrences=' + occFile, '--client=fixture-client', '--expect-deliverables=2', '--expect-links=3', '--snapshot=' + snap], { fetchImpl: g.fetchImpl, log });
    ok(out.written === 2 && out.verified === 2 && out.failed === 0 && !out.stopped, 'apply writes and verifies the allowlisted client only');
    ok(g.db.get(f3.row.id).brief === f3.row.brief, 'the other client is untouched');
    ok(!/uploads\.linear/.test(g.db.get(f1.row.id).brief), 'written brief holds no Linear link');
    ok((fs.statSync(snap).mode & 0o777) === 0o600, 'snapshot is 0600');
    let dup = 0; try { await R.run(['--apply', '--occurrences=' + occFile, '--client=fixture-client', '--expect-deliverables=2', '--expect-links=3', '--snapshot=' + snap], { fetchImpl: g.fetchImpl, log }); } catch { dup++; }
    ok(dup === 1, 'an existing snapshot file is never overwritten (wx)');
    const w = g.calls.filter(c => c.body.operation === 'description');
    ok(w.length === 2 && w.every(c => c.body.expected_updated_at && c.headers['x-syncview-key'] === 'sk'), 'writes are guarded by expected_updated_at');
    const rb = await R.run(['--rollback=' + snap], { fetchImpl: g.fetchImpl, log });
    ok(rb.restored === 2 && g.db.get(f1.row.id).brief === f1.row.brief, 'rollback reads via the gateway and restores');
    const rb2 = await R.run(['--rollback=' + snap], { fetchImpl: g.fetchImpl, log });
    ok(rb2.restored === 0 && rb2.skipped_changed_since === 2, 'rollback skips rows whose brief no longer equals the new text');
  } finally { process.env = realEnv; }
  ok(!touched.has('SUPABASE_SERVICE_ROLE_KEY'), 'no service-role env is read for non-test rows');

  // stop-on-first-failure
  {
    const g = gateway(rowsAll, { failWriteFor: new Set([f1.row.id]) });
    const out = await R.run(['--apply', '--occurrences=' + occFile, '--client=fixture-client,fixture-other', '--expect-deliverables=3', '--expect-links=4', '--snapshot=' + path.join(tmp, 's2.json')], { fetchImpl: g.fetchImpl, log });
    ok(out.failed === 1 && out.stopped && out.written === 0 && g.calls.filter(c => c.body.operation === 'description').length === 1,
      'the first write failure stops the run');
    const g2 = gateway(rowsAll, { failWriteFor: new Set([f1.row.id]) });
    const out2 = await R.run(['--apply', '--no-stop-on-first-failure', '--occurrences=' + occFile, '--client=fixture-client,fixture-other', '--expect-deliverables=3', '--expect-links=4', '--snapshot=' + path.join(tmp, 's3.json')], { fetchImpl: g2.fetchImpl, log });
    ok(out2.failed === 1 && !out2.stopped && out2.verified === 2, '--no-stop-on-first-failure continues');
    const g3 = gateway(rowsAll, { unresolved: 1 });
    const out3 = await R.run(['--apply', '--occurrences=' + occFile, '--client=fixture-client', '--expect-deliverables=2', '--expect-links=3', '--snapshot=' + path.join(tmp, 's4.json')], { fetchImpl: g3.fetchImpl, log });
    ok(out3.written === 1 && out3.verified === 0 && out3.failed === 1 && out3.stopped, 'readback with unresolved media fails and stops');
    const g4 = gateway(rowsAll, { forms: ['uploads_linear_app'] });
    const s5 = path.join(tmp, 's5.json'); let ab = 0;
    try { await R.run(['--apply', '--occurrences=' + occFile, '--client=fixture-client', '--expect-deliverables=2', '--expect-links=3', '--snapshot=' + s5], { fetchImpl: g4.fetchImpl, log }); } catch { ab++; }
    ok(ab === 1 && !fs.existsSync(s5) && !g4.calls.some(c => c.body.operation), 'probe failure aborts before snapshot or any write');
  }
  // P1: independent reconciliation
  {
    const g = gateway(rowsAll); const s6 = path.join(tmp, 's6.json'); let msg = '';
    try { await R.run(['--apply', '--occurrences=' + occFile, '--client=fixture-client', '--expect-deliverables=3', '--expect-links=3', '--snapshot=' + s6], { fetchImpl: g.fetchImpl, log }); }
    catch (e) { msg = e.message; }
    ok(/^ABORTED before any write: expected 3 deliverables \/ 3 links, occurrences file yields 2 \/ 3$/.test(msg), 'a deliverable-count mismatch aborts with counts only');
    ok(!fs.existsSync(s6) && g.calls.every(c => c.body.action === 'description_read') && g.calls.length === 2,
      'mismatch aborts before the probe, the snapshot and any write');
    let lm = 0;
    try { await R.run(['--apply', '--occurrences=' + occFile, '--client=fixture-client', '--expect-deliverables=2', '--expect-links=4', '--snapshot=' + s6], { fetchImpl: g.fetchImpl, log }); } catch { lm++; }
    ok(lm === 1 && !fs.existsSync(s6), 'a link-count mismatch aborts too');
    let missing = 0; try { R.parseArgs(['--apply', '--client=x', '--snapshot=s', '--occurrences=o']); } catch { missing++; }
    ok(missing === 1, '--apply requires --expect-deliverables and --expect-links');
    const out = await R.run(['--apply', '--occurrences=' + occFile, '--client=fixture-client', '--expect-deliverables=2', '--expect-links=3', '--snapshot=' + s6], { fetchImpl: g.fetchImpl, log });
    ok(out.verified === 2, 'an exact match proceeds');
    const dry = await R.run(['--occurrences=' + occFile, '--expect-deliverables=5', '--expect-links=9'], { fetchImpl: gateway(rowsAll).fetchImpl, log });
    ok(dry.expected_deliverables === 5 && dry.expected_links === 9 && dry.file_deliverables === 3 && dry.file_links === 4
      && /"expected_deliverables":5.*"file_deliverables":3/.test(logs[logs.length - 1]), 'dry-run prints expected and file counts side by side');
  }
  // P2: nonzero exit on failure
  {
    const prev = process.exitCode;
    process.exitCode = 0;
    await R.cli(['--apply', '--occurrences=' + occFile, '--client=fixture-client', '--expect-deliverables=2', '--expect-links=3', '--snapshot=' + path.join(tmp, 's7.json')],
      { fetchImpl: gateway(rowsAll, { failWriteFor: new Set([f1.row.id]) }).fetchImpl, log });
    ok(process.exitCode === 1, 'apply with a failure exits nonzero');
    process.exitCode = 0;
    await R.cli(['--apply', '--occurrences=' + occFile, '--client=fixture-client', '--expect-deliverables=2', '--expect-links=3', '--snapshot=' + path.join(tmp, 's8.json')],
      { fetchImpl: gateway(rowsAll).fetchImpl, log });
    ok(process.exitCode === 0, 'a clean apply exits zero');
    const g = gateway(rowsAll, { failWriteFor: new Set([f1.row.id]) });
    const s9 = path.join(tmp, 's9.json');
    fs.writeFileSync(s9, JSON.stringify({ entries: [{ id: f1.row.id, client_slug: f1.row.client_slug, old_brief: 'x', old_sha256: sha('x'), new_sha256: sha(f1.row.brief) }] }));
    await R.cli(['--rollback=' + s9], { fetchImpl: g.fetchImpl, log });
    ok(process.exitCode === 1, 'rollback with a failure exits nonzero');
    process.exitCode = prev;
  }
  let noOcc = 0; try { await R.run([], { fetchImpl: async () => { throw Error('no'); }, log }); } catch { noOcc++; }
  ok(noOcc === 1, 'a live dry-run without --occurrences is refused');
  const secretish = /uploads\.linear|syncview-media|fixture-|D-1\d|0000-4000/;
  ok(logs.length > 0 && logs.every(l => !secretish.test(l)), 'stdout carries counts only (no text, URLs, slugs or ids)');
  delete process.env.B2_BRIEF_REWRITE_CONFIRM;
  fs.rmSync(tmp, { recursive: true, force: true });
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
