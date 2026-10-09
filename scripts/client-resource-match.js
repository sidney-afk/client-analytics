#!/usr/bin/env node
'use strict';
/*
 * client-resource-match.js -- Stage 3.1 of docs/plans/2026-10-01-onboarding-checklist-and-profile.md:
 * the READ-ONLY matching pass that lines current clients up with the resources their checklist
 * needs. It proposes; it never saves. (Owner decision 2026-10-01: find, propose, wait, then save.)
 *
 * WHAT IT READS. Local files only; this script makes no network call and writes to no system:
 *   --roster=<json>   active clients: [{slug, display_name, kind, email, slack_channel_id,
 *                     creative_channel_id, filming_plan}] (a read-only SELECT, see the runbook)
 *   --brain=<dir>     a checkout of synchro-brain (its clients/<folder>/ files), read FIRST
 *   --hubspot=<json>  {contacts:[{id,email,firstname,lastname,contract_signed,first_invoice_paid}],
 *                      deals:[{id,dealname,dealstage,contact_ids:[]}]}
 *   --drive=<json>    {client_folders:[{id,name}], filming_plan_folders:[{id,name}]}
 *   --slack=<json>    {channels:[{id,name,is_private}]}
 * The source order is fixed by the owner: the brain first, then HubSpot, Drive and Slack to fill
 * what the brain does not say. Any source file may be left out; its resources are then "not read".
 *
 * WHAT IT WRITES. --out=<file>: every proposal with its value and evidence, for the owner's review
 * (3.2) and the later approvals screen (3.3). It holds client names and ids, so it REFUSES any path
 * inside a git checkout (this repository is public). stdout: COUNTS ONLY, never a name or id.
 *
 * Usage: node scripts/client-resource-match.js --roster=... [--brain=...] [--hubspot=...]
 *          [--drive=...] [--slack=...] --out=/private/path/proposals.json [--only=<slug>] [--json]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Same shape as every table's client slug (supabase/functions/_shared/sheets-mirror.mjs clientSlug).
function norm(name) {
  let t = String(name == null ? '' : name).trim().toLowerCase();
  try { t = t.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* keep */ }
  t = t.replace(/^dr\.?\s+/, '').replace(/\s+(?:and|&)\s+/g, '&');
  return t.replace(/[^a-z0-9&]+/g, '');
}
const tokens = (name) => String(name || '').toLowerCase().replace(/^dr\.?\s+/, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1);

// The resources a proposal can name (client_resources keys, plus the sales and channel facts).
const RESOURCES = Object.freeze([
  'brain_folder', 'drive_client_folder', 'drive_filming_plan_folder', 'filming_plan_doc',
  'hubspot_contact', 'hubspot_deal', 'contract_state', 'payment_state', 'creative_channel', 'client_channel',
]);
const STATUSES = Object.freeze(['proposal', 'confirms_existing', 'conflict', 'ambiguous', 'none', 'not_read']);

// Name match against a list of {id,name}: exact slug match is high, every name word present is
// medium; more than one candidate at the best level is ambiguous.
function matchByName(client, items, strip) {
  const want = norm(client.display_name);
  const words = tokens(client.display_name);
  const clean = (n) => (strip ? String(n).replace(strip, '') : String(n));
  const exact = items.filter((it) => norm(clean(it.name)) === want || norm(clean(it.name)) === client.slug);
  if (exact.length) return { level: 'high', hits: exact };
  if (words.length < 2) return { level: null, hits: [] };
  const loose = items.filter((it) => { const t = tokens(clean(it.name)); return words.every((w) => t.includes(w)); });
  return loose.length ? { level: 'medium', hits: loose } : { level: null, hits: [] };
}
function fromMatch(m, resource, source, evidence) {
  if (!m.hits.length) return { resource, source, status: 'none', confidence: null, value: null, evidence };
  if (m.hits.length > 1) return { resource, source, status: 'ambiguous', confidence: m.level, value: m.hits.map((h) => h.id), evidence: evidence + ' (' + m.hits.length + ' candidates)' };
  return { resource, source, status: 'proposal', confidence: m.level, value: m.hits[0].id, evidence };
}
// A found value next to what SyncView already holds.
function against(existing, found) {
  if (found.status !== 'proposal' || !existing) return found;
  return Object.assign({}, found, { status: found.value === existing ? 'confirms_existing' : 'conflict', existing });
}

// ---- 1. synchro-brain: the client's folder, and any Drive, Doc, Slack or HubSpot reference in it.
function readBrain(dir) {
  const root = path.join(dir, 'clients');
  if (!fs.existsSync(root)) return null;
  const out = [];
  for (const folder of fs.readdirSync(root)) {
    const full = path.join(root, folder);
    if (!fs.statSync(full).isDirectory()) continue;
    let text = '';
    for (const f of fs.readdirSync(full)) {
      const p = path.join(full, f);
      if (fs.statSync(p).isFile() && /\.(md|txt|json|ya?ml)$/i.test(f)) text += '\n' + fs.readFileSync(p, 'utf8');
    }
    out.push({
      id: 'clients/' + folder, name: folder.replace(/-/g, ' '),
      driveFolders: [...new Set([...text.matchAll(/drive\.google\.com\/drive\/(?:u\/\d\/)?folders\/([A-Za-z0-9_-]{10,})/g)].map((x) => x[1]))],
      docs: [...new Set([...text.matchAll(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{20,})/g)].map((x) => x[1]))],
      slack: [...new Set([...text.matchAll(/\b(C0[A-Z0-9]{8,10})\b/g)].map((x) => x[1]))],
      hubspotContacts: [...new Set([...text.matchAll(/app\.hubspot\.com\/contacts\/\d+\/(?:record\/0-1|contact)\/(\d+)/g)].map((x) => x[1]))],
    });
  }
  return out;
}
const docId = (url) => { const m = /\/document\/d\/([A-Za-z0-9_-]{20,})/.exec(String(url || '')); return m ? m[1] : null; };

function matchClient(client, src) {
  const rows = [];
  const add = (r) => rows.push(Object.assign({ client_slug: client.slug }, r));

  // 1. Brain first.
  let brain = null;
  if (!src.brain) add({ resource: 'brain_folder', source: 'brain', status: 'not_read' });
  else {
    const m = matchByName(client, src.brain);
    add(fromMatch(m, 'brain_folder', 'brain', 'brain folder name'));
    if (m.hits.length === 1) brain = m.hits[0];
  }
  const fp = docId(client.filming_plan);
  if (brain && brain.docs.length) {
    add(fp && brain.docs.includes(fp)
      ? { resource: 'filming_plan_doc', source: 'brain', status: 'confirms_existing', confidence: 'high', value: fp, existing: fp, evidence: 'the brain names the linked filming plan' }
      : { resource: 'filming_plan_doc', source: 'brain', status: fp ? 'conflict' : 'proposal', confidence: 'low', value: brain.docs, existing: fp, evidence: 'Docs named in the brain (' + brain.docs.length + ')' });
  }
  if (brain && brain.driveFolders.length) {
    add({ resource: 'drive_client_folder', source: 'brain', status: brain.driveFolders.length === 1 ? 'proposal' : 'ambiguous', confidence: 'medium', value: brain.driveFolders.length === 1 ? brain.driveFolders[0] : brain.driveFolders, evidence: 'Drive folder link in the brain' });
  }
  if (brain && brain.hubspotContacts.length === 1) add({ resource: 'hubspot_contact', source: 'brain', status: 'proposal', confidence: 'high', value: brain.hubspotContacts[0], evidence: 'HubSpot contact link in the brain' });
  const brainSlack = brain ? brain.slack : [];

  // 2. HubSpot: the contact by the profile's email, then by name; the deal through that contact.
  if (!src.hubspot) ['hubspot_contact', 'hubspot_deal', 'contract_state', 'payment_state'].forEach((r) => add({ resource: r, source: 'hubspot', status: 'not_read' }));
  else {
    const contacts = src.hubspot.contacts || [];
    const email = String(client.email || '').trim().toLowerCase();
    let cm = { level: null, hits: [] };
    if (email) { const hits = contacts.filter((c) => String(c.email || '').trim().toLowerCase() === email); if (hits.length) cm = { level: 'high', hits }; }
    if (!cm.hits.length) {
      // A name is weaker evidence than the email on the profile: one level lower.
      cm = matchByName(client, contacts.map((c) => Object.assign({ name: [c.firstname, c.lastname].filter(Boolean).join(' ') }, c)));
      if (cm.level) cm.level = cm.level === 'high' ? 'medium' : 'low';
    }
    const contactRow = fromMatch(cm, 'hubspot_contact', 'hubspot', cm.level === 'high' && email ? 'contact by the profile email' : 'contact by name');
    if (!rows.some((r) => r.resource === 'hubspot_contact' && r.status === 'proposal')) add(contactRow);
    const contact = cm.hits.length === 1 ? cm.hits[0] : null;
    if (!contact) ['hubspot_deal', 'contract_state', 'payment_state'].forEach((r) => add({ resource: r, source: 'hubspot', status: 'none', evidence: 'no single contact' }));
    else {
      const deals = (src.hubspot.deals || []).filter((d) => (d.contact_ids || []).map(String).includes(String(contact.id)));
      add(deals.length === 1 ? { resource: 'hubspot_deal', source: 'hubspot', status: 'proposal', confidence: cm.level, value: deals[0].id, stage: deals[0].dealstage || null, evidence: 'the one deal on that contact' }
        : deals.length ? { resource: 'hubspot_deal', source: 'hubspot', status: 'ambiguous', confidence: cm.level, value: deals.map((d) => d.id), evidence: deals.length + ' deals on that contact' }
          : { resource: 'hubspot_deal', source: 'hubspot', status: 'none', evidence: 'no deal on that contact' });
      // Owner decision: no flag means "unknown", never "unsigned" or "unpaid" (26 deals were hand imported).
      const flag = (v) => String(v).toLowerCase() === 'true';
      add({ resource: 'contract_state', source: 'hubspot', status: 'proposal', confidence: 'high', value: flag(contact.contract_signed) ? 'signed' : 'unknown', evidence: 'contact contract flag' });
      add({ resource: 'payment_state', source: 'hubspot', status: 'proposal', confidence: 'high', value: flag(contact.first_invoice_paid) ? 'paid' : 'unknown', evidence: 'contact payment flag' });
    }
  }

  // 3. Drive: the client folder and the filming plan folder, by name.
  if (!src.drive) ['drive_client_folder', 'drive_filming_plan_folder'].forEach((r) => add({ resource: r, source: 'drive', status: 'not_read' }));
  else {
    if (!rows.some((r) => r.resource === 'drive_client_folder')) add(fromMatch(matchByName(client, src.drive.client_folders || []), 'drive_client_folder', 'drive', 'client folder by name'));
    add(fromMatch(matchByName(client, src.drive.filming_plan_folders || []), 'drive_filming_plan_folder', 'drive', 'filming plan folder by name'));
  }

  // 4. Slack: the creative and the client channel, by name, against the ids already saved.
  if (!src.slack) ['creative_channel', 'client_channel'].forEach((r) => add({ resource: r, source: 'slack', status: 'not_read' }));
  else {
    const ch = src.slack.channels || [];
    const creative = against(client.creative_channel_id, fromMatch(matchByName(client, ch.filter((c) => /-creative$/.test(c.name)), /-creative$/), 'creative_channel', 'slack', 'channel named <client>-creative'));
    const own = against(client.slack_channel_id, fromMatch(matchByName(client, ch.filter((c) => !/-creative$/.test(c.name)), /-synchro$/), 'client_channel', 'slack', 'channel named <client> or <client>-synchro'));
    for (const r of [creative, own]) {
      // Nothing found by name, but the brain or the profile names the id: say so, never guess.
      if (r.status === 'none') {
        const have = r.resource === 'creative_channel' ? client.creative_channel_id : client.slack_channel_id;
        if (have && brainSlack.includes(have)) Object.assign(r, { source: 'brain', status: 'confirms_existing', confidence: 'medium', value: have, existing: have, evidence: 'the brain names the saved channel id' });
        else if (have) Object.assign(r, { status: 'confirms_existing', confidence: 'low', value: have, existing: have, evidence: 'saved id; channel not visible to the reader (private or shared)' });
      }
      add(r);
    }
  }
  return rows;
}

function summarise(all) {
  const by = {};
  for (const k of RESOURCES) by[k] = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const sources = {};
  const confidence = { high: 0, medium: 0, low: 0 };
  for (const r of all) {
    if (by[r.resource]) by[r.resource][r.status]++;
    if (r.status === 'proposal') { sources[r.source] = (sources[r.source] || 0) + 1; if (r.confidence) confidence[r.confidence]++; }
  }
  return { by, sources, confidence };
}

function insideGit(p) {
  let dir = path.dirname(path.resolve(p));
  while (!fs.existsSync(dir)) dir = path.dirname(dir);
  try { execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { stdio: 'pipe' }); return true; } catch (e) { return false; }
}

function main(argv) {
  const args = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
  if (!args.roster || !args.out) { console.error('usage: --roster=<json> --out=<private file> [--brain=<dir>] [--hubspot=<json>] [--drive=<json>] [--slack=<json>] [--only=<slug>]'); return 2; }
  if (insideGit(args.out)) { console.error('client-resource-match: refusing --out inside a git checkout (the proposals hold client names and ids).'); return 2; }
  const readJson = (p) => (p ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
  let roster = readJson(args.roster).filter((c) => c && c.slug);
  if (args.only) roster = roster.filter((c) => c.slug === args.only);
  const src = { brain: args.brain ? readBrain(args.brain) : null, hubspot: readJson(args.hubspot), drive: readJson(args.drive), slack: readJson(args.slack) };
  const all = roster.flatMap((c) => matchClient(c, src));
  fs.writeFileSync(args.out, JSON.stringify({ generated_at: new Date().toISOString(), dry_run: true, clients: roster.length, proposals: all }, null, 2));
  const s = summarise(all);
  if (args.json) { console.log(JSON.stringify({ clients: roster.length, ...s })); return 0; }
  console.log(`client-resource-match: DRY RUN, nothing saved. ${roster.length} client(s); sources read: ${['brain', 'hubspot', 'drive', 'slack'].filter((k) => src[k]).join(', ') || 'none'}.`);
  console.log('resource'.padEnd(26) + STATUSES.map((x) => x.padStart(18)).join(''));
  for (const k of RESOURCES) console.log(k.padEnd(26) + STATUSES.map((x) => String(s.by[k][x]).padStart(18)).join(''));
  console.log('proposals by source: ' + JSON.stringify(s.sources) + '; by confidence: ' + JSON.stringify(s.confidence));
  console.log('Counts only. The detail (names, ids, evidence) is in the private --out file.');
  return 0;
}

module.exports = { norm, matchByName, matchClient, summarise, readBrain, RESOURCES, STATUSES, insideGit };
if (require.main === module) process.exit(main(process.argv.slice(2)));
