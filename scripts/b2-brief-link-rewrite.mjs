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
 * Modes (dry-run is the default and prints COUNTS ONLY, never content):
 *   node scripts/b2-brief-link-rewrite.mjs [--input=<rows.json>] [--statuses=a,b]
 *   node scripts/b2-brief-link-rewrite.mjs --apply --client=<slug>[,<slug>] --snapshot=<file.json>
 *   node scripts/b2-brief-link-rewrite.mjs --rollback=<snapshot.json>
 *
 * --input reads a pre-extracted file `{ deliverables: [...], occurrences: [...] }`
 * (no network). Without it, rows are read over REST with the service role.
 *
 * Env (secrets are env-only, never args, never logged):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   reads (occurrences are service-only)
 *   SYNCVIEW_STAFF_KEY, SYNCVIEW_ACTOR,
 *   SUPABASE_PUBLISHABLE_KEY                  audited staff writes via production-write
 *   B2_BRIEF_REWRITE_CONFIRM=REWRITE_BRIEF_LINKS   required for --apply / --rollback
 *   B2_TEST_CLIENT_SLUG (optional, private operator config) — a row whose slug
 *     equals it is sent through production-write's service test_override path;
 *     the SERVER still decides whether that slug is the canonical test client.
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
  const a = { apply: false, clients: [], statuses: IN_PROGRESS, input: '', snapshot: '', rollback: '' };
  for (const arg of argv) {
    if (arg === '--apply') a.apply = true;
    else if (arg.startsWith('--client=')) a.clients = arg.slice(9).split(',').map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith('--statuses=')) a.statuses = arg.slice(11).split(',').map(s => s.trim()).filter(Boolean);
    else if (arg.startsWith('--input=')) a.input = arg.slice(8);
    else if (arg.startsWith('--snapshot=')) a.snapshot = arg.slice(11);
    else if (arg.startsWith('--rollback=')) a.rollback = arg.slice(11);
    else throw Error('unknown argument ' + arg.split('=')[0]);
  }
  if (a.apply && !a.clients.length) throw Error('--apply requires an explicit --client=<slug> allowlist');
  if (a.apply && !a.snapshot) throw Error('--apply requires --snapshot=<file> (rollback source)');
  if (a.apply && a.rollback) throw Error('--apply and --rollback are exclusive');
  return a;
}

/* ---------------- network (not exercised by unit tests) ---------------- */
function env(name) { const v = String(process.env[name] || ''); if (!v) throw Error('missing env ' + name); return v; }
async function rest(pathAndQuery) {
  const url = env('SUPABASE_URL').replace(/\/+$/, '') + '/rest/v1/' + pathAndQuery;
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(url, { headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' } });
  if (!r.ok) throw Error('read failed HTTP ' + r.status);
  return r.json();
}
async function loadLive(statuses, clients) {
  let q = 'deliverables?select=id,client_slug,team,status,brief,updated_at&brief=ilike.*uploads.linear.app*'
    + '&status=in.(' + statuses.join(',') + ')';
  if (clients.length) q += '&client_slug=in.(' + clients.join(',') + ')';
  const deliverables = await rest(q);
  const ids = deliverables.map(d => d.id);
  const occurrences = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).map(encodeURIComponent).join(',');
    occurrences.push(...await rest('native_brief_media_occurrences?select=*&state=eq.verified&deliverable_id=in.(' + chunk + ')'));
  }
  return { deliverables, occurrences };
}
async function readRow(id, client) {
  const rows = await rest('deliverables?select=id,client_slug,team,status,brief,updated_at&id=eq.' + encodeURIComponent(id)
    + '&client_slug=eq.' + encodeURIComponent(client));
  return rows[0] || null;
}
export const REQUIRED_REFERENCE_FORM = 'syncview_media_v1';
/* Machine-checked capability probe: the deployed gateway must answer a
   description_read for one target row with a media projection that lists the
   new reference form. Anything else (older deploy, error, missing field,
   wrong row) is a refusal: apply aborts before any write. */
export async function probeCapability(row, fetchImpl = fetch) {
  let json;
  try {
    const r = await fetchImpl(gatewayUrl(), { method: 'POST', headers: { ...authHeaders(row), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'description_read', surface: 'production', id: row.id, client_slug: row.client_slug,
        ...testOverride(row) }) });
    json = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, reason: 'probe_http_' + r.status };
  } catch { return { ok: false, reason: 'probe_unreachable' }; }
  if (!json || json.ok !== true || !json.row || json.row.id !== row.id) return { ok: false, reason: 'probe_ambiguous_response' };
  const forms = json.media && json.media.reference_forms;
  if (!Array.isArray(forms) || !forms.includes(REQUIRED_REFERENCE_FORM)) return { ok: false, reason: 'gateway_lacks_syncview_media_support' };
  return { ok: true };
}
function gatewayUrl() { return env('SUPABASE_URL').replace(/\/+$/, '') + '/functions/v1/production-write'; }
function isTestRow(row) { const t = String(process.env.B2_TEST_CLIENT_SLUG || ''); return !!t && row.client_slug === t; }
function testOverride(row) { return isTestRow(row) ? { test_override: true, confirm: 'B4_TEST_ONLY' } : {}; }
function authHeaders(row) {
  if (isTestRow(row)) return { Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY') };
  const pk = env('SUPABASE_PUBLISHABLE_KEY');
  return { apikey: pk, Authorization: 'Bearer ' + pk, 'x-syncview-key': env('SYNCVIEW_STAFF_KEY'),
    'x-syncview-actor': env('SYNCVIEW_ACTOR') };
}
async function gatewayWrite(row, description) {
  const base = env('SUPABASE_URL').replace(/\/+$/, '');
  const body = { operation: 'description', surface: 'production', entity: 'deliverable', id: row.id,
    client_slug: row.client_slug, expected_updated_at: row.updated_at, description,
    request_id: 'b2-brief-link-rewrite:' + row.id + ':' + sha256(description).slice(0, 16) };
  let headers;
  if (isTestRow(row)) {
    Object.assign(body, { test_override: true, confirm: 'B4_TEST_ONLY' });
    headers = { Authorization: 'Bearer ' + env('SUPABASE_SERVICE_ROLE_KEY') };
  } else {
    const pk = env('SUPABASE_PUBLISHABLE_KEY');
    headers = { apikey: pk, Authorization: 'Bearer ' + pk, 'x-syncview-key': env('SYNCVIEW_STAFF_KEY'),
      'x-syncview-actor': env('SYNCVIEW_ACTOR') };
  }
  const r = await fetch(base + '/functions/v1/production-write', { method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json || json.ok !== true) throw Error('write refused HTTP ' + r.status + ' ' + String(json && json.error || ''));
  return json;
}

async function main(argv) {
  const a = parseArgs(argv);
  if (a.rollback) {
    if (process.env.B2_BRIEF_REWRITE_CONFIRM !== CONFIRM) throw Error('set B2_BRIEF_REWRITE_CONFIRM to roll back');
    const snap = JSON.parse(fs.readFileSync(a.rollback, 'utf8'));
    const out = { restored: 0, skipped_changed_since: 0, failed: 0 };
    for (const e of snap.entries) {
      const row = await readRow(e.id, e.client_slug);
      if (!row || sha256(row.brief || '') !== e.new_sha256) { out.skipped_changed_since++; continue; }
      if (sha256(e.old_brief) !== e.old_sha256) { out.failed++; continue; }
      try { await gatewayWrite(row, e.old_brief); out.restored++; } catch { out.failed++; }
    }
    console.log(JSON.stringify({ mode: 'rollback', ...out }));
    return;
  }
  const data = a.input ? JSON.parse(fs.readFileSync(a.input, 'utf8')) : await loadLive(a.statuses, a.apply ? a.clients : []);
  const statusOk = new Set(a.statuses);
  let rows = data.deliverables.filter(d => statusOk.has(String(d.status || '').toLowerCase()));
  if (a.clients.length) rows = rows.filter(d => a.clients.includes(d.client_slug));
  const counts = summarize(rows, data.occurrences);
  if (!a.apply) { console.log(JSON.stringify({ mode: 'dry-run', ...counts })); return; }
  if (a.input) throw Error('--apply reads live rows; --input is dry-run only');
  if (process.env.B2_BRIEF_REWRITE_CONFIRM !== CONFIRM) throw Error('set B2_BRIEF_REWRITE_CONFIRM to apply');
  const plans = rows.map(row => ({ row, plan: planRewrite(row, data.occurrences) })).filter(x => x.plan.status === 'rewrite');
  if (plans.length) {
    const probe = await probeCapability(plans[0].row);
    if (!probe.ok) throw Error('ABORTED before any write: deployed production-write does not prove support for '
      + REQUIRED_REFERENCE_FORM + ' (' + probe.reason + '). Deploy production-write first.');
  }
  // Snapshot BEFORE any write; written with owner-only permissions. It holds brief text: keep it out of the repo.
  const snapshot = { format: 'b2-brief-link-rewrite-snapshot-v1', taken_at: new Date().toISOString(),
    entries: plans.map(({ row, plan }) => ({ id: row.id, client_slug: row.client_slug, updated_at: row.updated_at,
      old_sha256: sha256(row.brief), old_brief: row.brief, new_sha256: sha256(plan.brief) })) };
  fs.writeFileSync(a.snapshot, JSON.stringify(snapshot, null, 2), { mode: 0o600, flag: 'wx' });
  const out = { written: 0, verified: 0, failed: 0 };
  for (const { row, plan } of plans) {
    try {
      await gatewayWrite(row, plan.brief); out.written++;
      const back = await readRow(row.id, row.client_slug);
      if (back && back.brief === plan.brief && !briefMediaOccurrences(back.brief).length) out.verified++;
      else out.failed++;
    } catch { out.failed++; }
  }
  console.log(JSON.stringify({ mode: 'apply', ...counts, ...out }));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch(e => { console.error(String(e && e.message || e)); process.exitCode = 1; });
}
