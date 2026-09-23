#!/usr/bin/env node
/*
 * b2-brief-link-rewrite.mjs — B2 (Linear cleanup), "Brief images on Linear's
 * servers" (docs/ops/B2_LINEAR_CLEANUP_PLAN.md section 4).
 *
 * Replaces every `https://uploads.linear.app/...` link inside a deliverable's
 * `brief` with the stable internal reference `syncview-media:<occurrence id>`
 * of its VERIFIED copy in `native_brief_media_occurrences`. Only the URL
 * characters are replaced (exact UTF-16 offset + length, as recorded on the
 * occurrence row), so the Markdown around them (`![alt](...)`, `<...>`) is
 * byte-for-byte untouched. A signed URL is never written: it expires in five
 * minutes. The production-write `description_read` projection
 * (supabase/functions/_shared/native-brief-media.mjs) signs the reference at
 * read time.
 *
 * PRECONDITION: production-write must be deployed with the projection that
 * understands `syncview-media:` (owner, Section 4 lane) BEFORE any --apply on
 * a real client; otherwise the Production tab shows a placeholder where the
 * image was.
 *
 * A brief is rewritten only when EVERY Linear link in it maps to exactly one
 * verified occurrence whose source_sha256 equals the sha256 of the CURRENT
 * brief and whose source_offset/source_length/original_url_sha256 match that
 * link. A brief edited since the copy (sha mismatch) is skipped and counted.
 *
 * Modes (dry-run is the default and prints COUNTS ONLY, never content, URLs,
 * slugs or ids):
 *   node scripts/b2-brief-link-rewrite.mjs --input=<rows.json> [--statuses=a,b]          (offline)
 *   node scripts/b2-brief-link-rewrite.mjs --occurrences=<occ.json> [--client=<slug>]      (live dry-run)
 *   node scripts/b2-brief-link-rewrite.mjs --apply --occurrences=<occ.json> --client=<slug>[,<slug>] --snapshot=<file.json>
 *   node scripts/b2-brief-link-rewrite.mjs --rollback=<snapshot.json>
 *
 * --input reads a pre-extracted file `{ deliverables: [...], occurrences: [...] }`
 * (no network). Live runs read each brief through production-write
 * `description_read` (staff headers; the anon key cannot read
 * `deliverables.brief`). The target list comes from --occurrences: a JSON
 * array of occurrence METADATA rows (id, deliverable_id, client_slug, team,
 * source_kind, source_entity_id, state, source_sha256, source_offset,
 * source_length, original_url_sha256; no brief text) exported read-only out
 * of band, because `native_brief_media_occurrences` is service-only and the
 * gateway does not expose occurrence ids. Deliverables processed = distinct
 * (deliverable_id, client_slug) in that file, filtered by --client.
 * --stop-on-first-failure is ON by default (--no-stop-on-first-failure to
 * disable): the first write/readback failure stops the run and prints counts.
 * Readback passes only if the brief equals the planned text, holds 0 Linear
 * links, and the projection reports media.unresolved === 0.
 *
 * Env (secrets are env-only, never args, never logged):
 *   SUPABASE_URL                              project URL (required; https://<ref>.supabase.co)
 *   SUPABASE_PUBLISHABLE_KEY, SYNCVIEW_STAFF_KEY,
 *   SYNCVIEW_ACTOR                            staff reads and audited writes via production-write
 *   B2_BRIEF_REWRITE_CONFIRM=REWRITE_BRIEF_LINKS   required for --apply / --rollback
 *   B2_TEST_CLIENT_SLUG (optional, private operator config) — a row whose slug
 *     equals it is sent through production-write's service test_override path
 *     (only then is SUPABASE_SERVICE_ROLE_KEY read); the SERVER still decides
 *     whether that slug is the canonical test client.
 * Before the first write, --apply probes the DEPLOYED production-write
 * (description_read on one target) and aborts unless its media projection
 * advertises reference form `syncview_media_v1`.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { briefMediaOccurrences, briefMediaReferences, BRIEF_MEDIA_REF_PREFIX }
  from '../supabase/functions/_shared/native-brief-media.mjs';

export const IN_PROGRESS = ['todo', 'backlog', 'smm_approval', 'kasper_approval', 'client_approval'];
const CONFIRM = 'REWRITE_BRIEF_LINKS';
export const sha256 = s => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

/* Pure transform. Returns { status, brief?, links, mapped } where status is
   'rewrite' | 'noop' (no Linear link left: idempotent) | 'skip_edited'
   (a copy exists but for an older brief text) | 'skip_unmapped'. */
export function planRewrite(row, occurrences) {
  const brief = typeof row.brief === 'string' ? row.brief : '';
  const links = briefMediaOccurrences(brief);
  if (!links.length) return { status: 'noop', links: 0, mapped: 0 };
  const digest = sha256(brief);
  const mine = (occurrences || []).filter(o => o && o.deliverable_id === row.id
    && o.client_slug === row.client_slug && o.team === row.team
    && o.source_kind === 'native_brief' && o.source_entity_id === row.id && o.state === 'verified'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(o.id));
  const mapped = [];
  for (const link of links) {
    const hit = mine.filter(o => o.source_sha256 === digest && o.source_offset === link.offset
      && o.source_length === link.length && o.original_url_sha256 === sha256(link.url));
    if (hit.length !== 1) {
      const edited = mine.some(o => o.source_sha256 !== digest && o.original_url_sha256 === sha256(link.url));
      return { status: edited ? 'skip_edited' : 'skip_unmapped', links: links.length, mapped: 0 };
    }
    mapped.push({ ...link, id: hit[0].id });
  }
  let out = brief;
  for (const m of [...mapped].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, m.offset) + BRIEF_MEDIA_REF_PREFIX + m.id + out.slice(m.offset + m.length);
  }
  // Self-check: no Linear link left, and the references are exactly the mapped ids in order.
  const back = briefMediaReferences(out).map(r => r.occurrence_id);
  const before = briefMediaReferences(brief).map(r => r.occurrence_id);
  const want = [...before, ...mapped.map(m => m.id)];
  if (briefMediaOccurrences(out).length || back.length !== want.length
      || want.some(id => back.filter(x => x === id).length !== want.filter(x => x === id).length)) {
    return { status: 'skip_unmapped', links: links.length, mapped: 0 };
  }
  return { status: 'rewrite', brief: out, links: links.length, mapped: mapped.length };
}

export function summarize(deliverables, occurrences) {
  const c = { deliverables: 0, links: 0, rewrite_deliverables: 0, rewrite_links: 0,
    skipped_edited: 0, skipped_unmapped: 0, already_clean: 0 };
  for (const row of deliverables) {
    const p = planRewrite(row, occurrences);
    if (p.status === 'noop') { c.already_clean++; continue; }
    c.deliverables++; c.links += p.links;
    if (p.status === 'rewrite') { c.rewrite_deliverables++; c.rewrite_links += p.mapped; }
    else if (p.status === 'skip_edited') c.skipped_edited++;
    else c.skipped_unmapped++;
  }
  return c;
}

export function parseArgs(argv) {
  const a = { apply: false, clients: [], statuses: IN_PROGRESS, input: '', snapshot: '', rollback: '', occurrences: '',
    stopOnFirstFailure: true };
  for (const arg of argv) {
    if (arg === '--apply') a.apply = true;
    else if (arg.startsWith('--client=')) a.clients = arg.slice(9).split(',').map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith('--statuses=')) a.statuses = arg.slice(11).split(',').map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith('--input=')) a.input = arg.slice(8);
    else if (arg.startsWith('--snapshot=')) a.snapshot = arg.slice(11);
    else if (arg.startsWith('--rollback=')) a.rollback = arg.slice(11);
    else if (arg.startsWith('--occurrences=')) a.occurrences = arg.slice(14);
    else if (arg === '--stop-on-first-failure') a.stopOnFirstFailure = true;
    else if (arg === '--no-stop-on-first-failure') a.stopOnFirstFailure = false;
    else throw Error('unknown argument ' + arg.split('=')[0]);
  }
  if (a.apply && !a.clients.length) throw Error('--apply requires an explicit --client=<slug> allowlist');
  if (a.apply && !a.snapshot) throw Error('--apply requires --snapshot=<file> (rollback source)');
  if (a.apply && !a.occurrences) throw Error('--apply requires --occurrences=<file.json>');
  if (a.apply && a.rollback) throw Error('--apply and --rollback are exclusive');
  return a;
}

/* ---------------- occurrence metadata file ---------------- */
export const OCCURRENCE_FIELDS = ['id', 'deliverable_id', 'client_slug', 'team', 'source_kind', 'source_entity_id',
  'state', 'source_sha256', 'source_offset', 'source_length', 'original_url_sha256'];
/* The occurrence rows (metadata only, never brief text) come from a file the
   operator exported read-only out of band: `native_brief_media_occurrences`
   is service-only over REST and the gateway does not expose occurrence ids. */
export function parseOccurrences(text) {
  let rows;
  try { rows = JSON.parse(text); } catch { throw Error('--occurrences file is not valid JSON'); }
  if (!Array.isArray(rows)) throw Error('--occurrences file must be a JSON array of occurrence rows');
  rows.forEach((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error('--occurrences row ' + i + ' is not an object');
    for (const f of OCCURRENCE_FIELDS) if (!(f in r)) throw Error('--occurrences row ' + i + ' lacks field ' + f);
    if ('brief' in r || 'description' in r) throw Error('--occurrences row ' + i + ' carries brief text; export metadata only');
  });
  return rows;
}
export function loadOccurrences(file) { return parseOccurrences(fs.readFileSync(file, 'utf8')); }
export function targetsFrom(occurrences, clients) {
  const seen = new Map();
  for (const o of occurrences) {
    if (clients.length && !clients.includes(o.client_slug)) continue;
    const k = o.deliverable_id + '\u0000' + o.client_slug;
    if (!seen.has(k)) seen.set(k, { id: o.deliverable_id, client_slug: o.client_slug });
  }
  return [...seen.values()];
}

/* ---------------- network (tests inject fetchImpl; nothing here runs offline by default) ---------------- */
function env(name) { const v = String(process.env[name] || ''); if (!v) throw Error('missing env ' + name); return v; }
function gatewayUrl() { return env('SUPABASE_URL').replace(/\/+$/, '') + '/functions/v1/production-write'; }
function isTestRow(row) { const t = String(process.env.B2_TEST_CLIENT_SLUG || ''); return !!t && row.client_slug === t; }
function testOverride(row) { return isTestRow(row) ? { test_override: true, confirm: 'B4_TEST_ONLY' } : {}; }
/* Real clients: staff headers only. The service role is read ONLY for the
   documented test-client override row. */
function authHeaders(row) {
  if (isTestRow(row)) return { Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY') };
  const pk = env('SUPABASE_PUBLISHABLE_KEY');
  return { apikey: pk, Authorization: 'Bearer ' + pk, 'x-syncview-key': env('SYNCVIEW_STAFF_KEY'),
    'x-syncview-actor': env('SYNCVIEW_ACTOR') };
}
async function post(row, body, fetchImpl) {
  const r = await fetchImpl(gatewayUrl(), { method: 'POST',
    headers: { ...authHeaders(row), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => null);
  return { r, json };
}
/* description_read through production-write. Returns { row, media } or throws
   (message carries no id, slug or text). */
export async function gatewayRead(target, fetchImpl = fetch) {
  const { r, json } = await post(target, { action: 'description_read', surface: 'production', id: target.id,
    client_slug: target.client_slug, ...testOverride(target) }, fetchImpl);
  if (!r.ok || !json || json.ok !== true || !json.row) throw Error('read refused HTTP ' + r.status);
  const x = json.row;
  if (x.id !== target.id || x.client_slug !== target.client_slug) throw Error('read answered for another row');
  return { row: { id: x.id, client_slug: x.client_slug, team: x.team, status: x.status, brief: x.brief,
    updated_at: x.updated_at }, media: json.media || null };
}
export async function readRow(id, client, fetchImpl = fetch) {
  return (await gatewayRead({ id, client_slug: client }, fetchImpl)).row;
}
export async function loadLive(occurrences, clients, fetchImpl = fetch) {
  const deliverables = [];
  for (const t of targetsFrom(occurrences, clients)) deliverables.push((await gatewayRead(t, fetchImpl)).row);
  return { deliverables, occurrences };
}
export const REQUIRED_REFERENCE_FORM = 'syncview_media_v1';
/* Machine-checked capability probe: the deployed gateway must answer a
   description_read for one target row with a media projection that lists the
   new reference form. Anything else (older deploy, error, missing field,
   wrong row) is a refusal: apply aborts before any write. */
export async function probeCapability(row, fetchImpl = fetch) {
  let json;
  try {
    const res = await post(row, { action: 'description_read', surface: 'production', id: row.id,
      client_slug: row.client_slug, ...testOverride(row) }, fetchImpl);
    json = res.json;
    if (!res.r.ok) return { ok: false, reason: 'probe_http_' + res.r.status };
  } catch { return { ok: false, reason: 'probe_unreachable' }; }
  if (!json || json.ok !== true || !json.row || json.row.id !== row.id) return { ok: false, reason: 'probe_ambiguous_response' };
  const forms = json.media && json.media.reference_forms;
  if (!Array.isArray(forms) || !forms.includes(REQUIRED_REFERENCE_FORM)) return { ok: false, reason: 'gateway_lacks_syncview_media_support' };
  return { ok: true };
}
export async function gatewayWrite(row, description, fetchImpl = fetch) {
  const body = { operation: 'description', surface: 'production', entity: 'deliverable', id: row.id,
    client_slug: row.client_slug, expected_updated_at: row.updated_at, description,
    request_id: 'b2-brief-link-rewrite:' + row.id + ':' + sha256(description).slice(0, 16), ...testOverride(row) };
  const { r, json } = await post(row, body, fetchImpl);
  if (!r.ok || !json || json.ok !== true) throw Error('write refused HTTP ' + r.status);
  return json;
}
/* Readback passes only when the stored brief equals the planned text, holds
   no Linear link, and the projection resolved every image. */
export async function verifyReadback(row, planned, fetchImpl = fetch) {
  const back = await gatewayRead(row, fetchImpl);
  return back.row.brief === planned && !briefMediaOccurrences(back.row.brief || '').length
    && !!back.media && back.media.unresolved === 0;
}

export async function run(argv, { fetchImpl = fetch, log = s => console.log(s) } = {}) {
  const a = parseArgs(argv);
  if (a.rollback) {
    if (process.env.B2_BRIEF_REWRITE_CONFIRM !== CONFIRM) throw Error('set B2_BRIEF_REWRITE_CONFIRM to roll back');
    const snap = JSON.parse(fs.readFileSync(a.rollback, 'utf8'));
    const out = { restored: 0, skipped_changed_since: 0, failed: 0, stopped: false };
    for (const e of snap.entries) {
      let row;
      try { row = await readRow(e.id, e.client_slug, fetchImpl); } catch { out.failed++; if (a.stopOnFirstFailure) { out.stopped = true; break; } continue; }
      if (!row || sha256(row.brief || '') !== e.new_sha256) { out.skipped_changed_since++; continue; }
      if (sha256(e.old_brief) !== e.old_sha256) { out.failed++; if (a.stopOnFirstFailure) { out.stopped = true; break; } continue; }
      try { await gatewayWrite(row, e.old_brief, fetchImpl); out.restored++; }
      catch { out.failed++; if (a.stopOnFirstFailure) { out.stopped = true; break; } }
    }
    log(JSON.stringify({ mode: 'rollback', ...out }));
    return out;
  }
  let data;
  if (a.input) data = JSON.parse(fs.readFileSync(a.input, 'utf8'));
  else {
    if (!a.occurrences) throw Error('live runs need --occurrences=<file.json> (occurrence metadata exported read-only)');
    data = await loadLive(loadOccurrences(a.occurrences), a.clients, fetchImpl);
  }
  const statusOk = new Set(a.statuses);
  let rows = data.deliverables.filter(d => statusOk.has(String(d.status || '').toLowerCase()));
  if (a.clients.length) rows = rows.filter(d => a.clients.includes(d.client_slug));
  const counts = summarize(rows, data.occurrences);
  if (!a.apply) { log(JSON.stringify({ mode: 'dry-run', ...counts })); return counts; }
  if (a.input) throw Error('--apply reads live rows; --input is dry-run only');
  if (process.env.B2_BRIEF_REWRITE_CONFIRM !== CONFIRM) throw Error('set B2_BRIEF_REWRITE_CONFIRM to apply');
  const plans = rows.map(row => ({ row, plan: planRewrite(row, data.occurrences) })).filter(x => x.plan.status === 'rewrite');
  if (plans.length) {
    const probe = await probeCapability(plans[0].row, fetchImpl);
    if (!probe.ok) throw Error('ABORTED before any write: deployed production-write does not prove support for '
      + REQUIRED_REFERENCE_FORM + ' (' + probe.reason + '). Deploy production-write first.');
  }
  // Snapshot BEFORE any write; written with owner-only permissions. It holds brief text: keep it out of the repo.
  const snapshot = { format: 'b2-brief-link-rewrite-snapshot-v1', taken_at: new Date().toISOString(),
    entries: plans.map(({ row, plan }) => ({ id: row.id, client_slug: row.client_slug, updated_at: row.updated_at,
      old_sha256: sha256(row.brief), old_brief: row.brief, new_sha256: sha256(plan.brief) })) };
  fs.writeFileSync(a.snapshot, JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' });
  const out = { planned: plans.length, written: 0, verified: 0, failed: 0, stopped: false };
  for (const { row, plan } of plans) {
    let good = false;
    try {
      await gatewayWrite(row, plan.brief, fetchImpl); out.written++;
      good = await verifyReadback(row, plan.brief, fetchImpl);
    } catch { good = false; }
    if (good) out.verified++;
    else { out.failed++; if (a.stopOnFirstFailure) { out.stopped = true; break; } }
  }
  log(JSON.stringify({ mode: 'apply', ...counts, ...out }));
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run(process.argv.slice(2)).catch(e => { console.error(String(e && e.message || e)); process.exitCode = 1; });
}
