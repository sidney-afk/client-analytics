'use strict';
// Leads CRM step 1 (docs/features/CRM_LEADS.md): the pure rules shared by the
// crm-leads Edge Function and the import script, the import planner, and the
// source wiring of the migration, the function and the page. Offline.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }

(async () => {
  const c = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/crm-leads-core.mjs')).href);
  const { planImport, parseCsv } = require('../scripts/crm-import.js');

  // ── access ──
  ok(c.leadsAllowed('admin', ''), 'admin may use Leads');
  ok(c.leadsAllowed('ADMIN ', 'anyone'), 'role match is case and space tolerant');
  ok(!c.leadsAllowed('smm', 'someone'), 'smm may not, with no per-person grant');
  ok(!c.leadsAllowed('creative', ''), 'creative may not');
  ok(!c.leadsAllowed('', 'someone'), 'no role, no access');
  ok(Array.isArray(c.LEADS_MEMBER_GRANTS) && c.LEADS_MEMBER_GRANTS.length === 0, 'no per-person grants ship');
  c.LEADS_MEMBER_GRANTS.push({ role: 'smm', actor: 'Example Person' });
  ok(c.leadsAllowed('smm', 'example person'), 'a one-line grant admits that member in that role');
  ok(!c.leadsAllowed('creative', 'Example Person'), 'the grant is tied to its role');
  ok(!c.leadsAllowed('smm', 'Other Person'), 'and to its member');
  c.LEADS_MEMBER_GRANTS.length = 0;

  // ── normalisers (mirror the SQL) ──
  ok(c.normalizeEmail('  A@Example.INVALID ') === 'a@example.invalid', 'email trimmed and lowered');
  ok(c.normalizeEmail('  ') === null, 'blank email is null');
  ok(c.normalizePhone('+1 (555) 010-0000') === '15550100000', 'phone keeps digits');
  ok(c.normalizePhone('12-34') === null, 'short phone is null');
  ok(c.cleanHandle('@Example.Shop [NEAR-MISS: 1 follower short]') === 'Example.Shop', 'near-miss tag and @ removed');
  ok(c.normalizeHandle('@@Foo [x] ') === 'foo', 'handle normalised');
  ok(c.normalizeHandle('[only a tag]') === null, 'tag-only handle is null');

  // ── filters ──
  const now = Date.parse('2026-10-28T10:00:00Z'); // a Wednesday
  ok(JSON.stringify(c.weekRange(now)) === JSON.stringify({ from: '2026-10-26', to: '2026-11-01' }), 'week runs Monday to Sunday');
  const f = c.parseListFilters({ lead_type: 'dream100', stage: 'nope', niche: ' fitness ', owner: '', source_id: 'not-a-uuid', due_this_week: true, extra: 1 }, now);
  ok(f.lead_type === 'dream100' && f.niche === 'fitness' && !('stage' in f) && !('owner' in f) && !('source_id' in f) && !('extra' in f), 'unknown filter values are dropped, not refused');
  ok(f.due && f.due.from === '2026-10-26', 'due this week becomes a date range');
  ok(Object.keys(c.parseListFilters(null)).length === 0, 'no filters is fine');

  // ── patch validation ──
  ok(c.validatePatch({ stage: 'won' }).ok, 'valid stage');
  ok(c.validatePatch({ stage: 'maybe' }).error === 'bad_stage', 'bad stage refused');
  ok(c.validatePatch({ email: 'x' }).error === 'unknown_field', 'contact details are not editable through update');
  ok(c.validatePatch({ next_step_due: '2026-02-30' }).error === 'bad_next_step_due', 'impossible date refused');
  ok(c.validatePatch({ next_step_due: null }).patch.next_step_due === '', 'due can be cleared');
  ok(c.validatePatch({ lost_reason: 'price' }).ok && c.validatePatch({ lost_reason: 'bored' }).error === 'bad_lost_reason', 'lost reasons are the five');
  ok(JSON.stringify(c.validatePatch({ tags: ['Bench', 'bench', ' hot '] }).patch.tags) === '["bench","hot"]', 'tags deduped and lowered');
  ok(c.validatePatch({ tags: 'bench' }).error === 'bad_tags', 'tags must be a list');
  ok(c.validatePatch([]).error === 'patch_required' && c.validatePatch(null).error === 'patch_required', 'patch must be an object');
  ok(c.validatePatch({ owner: 'x'.repeat(81) }).error === 'bad_owner', 'owner length bounded');
  ok(c.validateNote('  ').error === 'note_required' && c.validateNote('x'.repeat(4001)).error === 'note_too_long' && c.validateNote(' hi ').note === 'hi', 'notes validated');

  // ── events: every change appends a row, no change appends none ──
  const before = { stage: 'to_contact', owner: null, next_step: null, next_step_due: null, lost_reason: null, tags: ['bench'] };
  const p1 = c.effectivePatch(before, { stage: 'contacted', owner: '', next_step: 'DM', next_step_due: '2026-11-02', tags: ['bench'] });
  ok(JSON.stringify(p1) === JSON.stringify({ stage: 'contacted', next_step: 'DM', next_step_due: '2026-11-02' }), 'effective patch keeps only what moved');
  const ev = c.changeEvents(before, p1, 'Said hello');
  ok(ev.map((e) => e.kind).join(',') === 'stage_changed,next_step_set,note', 'stage, next step and note events');
  ok(ev[0].detail.from === 'to_contact' && ev[0].detail.to === 'contacted', 'stage event records from and to');
  ok(ev[1].detail.next_step === 'DM' && ev[1].detail.due === '2026-11-02', 'next step event records both fields');
  ok(c.changeEvents(before, c.effectivePatch(before, { stage: 'to_contact' }), '').length === 0, 'a save that changes nothing writes no event');
  ok(c.changeEvents(before, { lost_reason: 'price', owner: 'A', tags: ['x'] }).map((e) => e.kind).join(',') === 'owner_changed,lost_reason_set,tags_changed', 'owner, lost reason and tag events');

  // ── cards ──
  const card = c.cardOf({ id: 'i', display_name: 'N', email: 'secret@example.invalid', phone: '5550100000', lead_type: 'email', stage: 'contacted', next_step_due: '2026-10-01', state_version: 3 }, '2026-10-26');
  ok(card.overdue === true && !('email' in card) && !('phone' in card), 'cards mark overdue and leave contact details out of the list');
  ok(c.cardOf({ stage: 'won', next_step_due: '2026-10-01' }, '2026-10-26').overdue === false, 'won is never overdue');

  // ── import ──
  const csv = parseCsv('﻿Name,Email,Instagram,Phone,Niche,Bench,Excluded\r\n'
    + 'One,one@example.invalid,@one.example [NEAR-MISS: close],,Fitness,yes,\n'
    + 'Two,,"two.example",555 010 0002,"Food, drink",,\n'
    + 'Three,three@example.invalid,,,,,yes\n'
    + 'Four,,,,,,\n'
    + 'One again,ONE@example.invalid,,555 010 0001,,,\n'
    + 'Five,five@example.invalid,@two.example,,,,\n');
  ok(csv.length === 6 && csv[1].Niche === 'Food, drink', 'CSV parser handles BOM, CRLF and quoted commas');
  const existing = [{ id: 'e1', display_name: '', email: 'five@example.invalid', phone: null, instagram_handle: null, niche: 'Retail', tags: [], state_version: 2 }];
  const plan = planImport(c, existing, csv, { lead_type: 'dream100', tags: [] });
  ok(plan.counts.rows === 6 && plan.counts.excluded === 1 && plan.counts.no_contact === 1, 'excluded and contactless rows skipped');
  ok(plan.counts.created === 2 && plan.counts.duplicate_in_file === 1, 'one person per email/handle within the file');
  ok(plan.counts.updated === 1 && plan.updates.get('e1').display_name === 'Five' && !('niche' in plan.updates.get('e1')), 'an existing person only has blanks filled');
  const one = plan.creates.find((p) => p.email === 'one@example.invalid');
  ok(one.instagram_handle === 'one.example' && one.tags.includes('bench') && one.tags.includes('near-miss') && one.phone === '555 010 0001', 'handle cleaned, bench and near-miss tagged, duplicate row fills the blank phone');
  ok(planImport(c, [], csv, {}).counts.no_lead_type === 4, 'no lead type, no import');
  ok(plan.creates.every((p) => !('stage' in p) && !('owner' in p)), 'import never sets stage or owner');
  const { parseRestBody } = require('../scripts/crm-import.js');
  ok(parseRestBody('') === null && parseRestBody('  \n') === null, 'an empty REST body (204, or 201 with return=minimal) is null, not a parse error');
  ok(Array.isArray(parseRestBody('[{"id":"x"}]')) && parseRestBody('{"a":1}').a === 1, 'a JSON REST body still parses');
  const importSrc = read('scripts/crm-import.js');
  ok(!/console\.log\([^)]*(email|display_name|instagram_handle|phone)\b/.test(importSrc), 'import prints counts, never row values');
  ok(/--apply/.test(importSrc) && /dry run/.test(importSrc), 'import is a dry run unless --apply');

  // ── migration ──
  const migFile = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).find((f) => /_crm_leads\.sql$/.test(f));
  ok(!!migFile, 'migration exists');
  const mig = read('supabase/migrations/' + migFile);
  ok(/^-- ef-auto-deploy-applied-when: select to_regclass\('public\.crm_people'\) is not null/.test(mig), 'applied-when header is the first line');
  for (const t of ['crm_people', 'crm_events', 'crm_sources', 'crm_sequences', 'crm_sequence_steps', 'crm_enrolments']) {
    ok(new RegExp('alter table public\\.' + t + ' enable row level security').test(mig), t + ' has RLS on');
    ok(new RegExp('public\\.' + t + '[\\s\\S]*?from public, anon, authenticated, service_role').test(mig.slice(mig.indexOf('revoke all on table'))), t + ' revoked from all four roles');
  }
  ok(/revoke all on sequence public\.crm_events_id_seq from public, anon, authenticated, service_role/.test(mig), 'events sequence revoked from all four');
  ok(/grant select, insert on table public\.crm_events to service_role;/.test(mig) && !/grant[^;]*update[^;]*crm_events/.test(mig.replace(/^--.*$/gm, '').replace(/grant select, insert, update on table[^;]*;/, '')), 'events are append-only for service_role');
  ok(/before update or delete on public\.crm_events/.test(mig), 'append-only trigger');
  ok(!/to (anon|authenticated)\b/.test(mig.replace(/^--.*$/gm, '')), 'no grant to a browser role');
  ok(/'dream100', 'ad_lead', 'past_call', 'email'/.test(mig) && /'price', 'trust', 'timing', 'budget', 'no_show'/.test(mig), 'enums match');
  ok(c.STAGES.every((s) => mig.includes("'" + s + "'")), 'every stage is allowed by the table');
  ok(/unique index if not exists crm_people_email_norm_uq/.test(mig) && /crm_people_phone_norm_uq/.test(mig) && /crm_people_handle_norm_uq/.test(mig), 'unique normalised email, phone and handle');
  ok(/where id = p_id and state_version = p_expected_version/.test(mig), 'apply function swaps on state_version');

  // ── Edge Function ──
  const ef = read('supabase/functions/crm-leads/index.ts');
  ok(/authorizeStaffKey\(/.test(ef) && /leadsAllowed\(role, actor\)/.test(ef), 'function checks the staff key, then the leads grant');
  ok(ef.indexOf('leadsAllowed(role, actor)') < ef.indexOf('createClient(', ef.indexOf('authorizeStaffKey(key')), 'access is decided before any database client exists');
  ok(ef.indexOf('serverKeyOk(req)') < ef.indexOf('createClient(') && ef.indexOf('createClient(') < ef.indexOf('authorizeStaffKey(key'), 'the server actions decide access before their database client too');
  ok(/auth\.via !== "role"/.test(ef), 'only a role key, never a legacy secret');
  ok(/rpc\("crm_apply_change"/.test(ef) && !/\.from\("crm_people"\)\.update/.test(ef) && !/\.from\("crm_events"\)\.insert/.test(ef), 'every change goes through the one transactional apply');
  ok(/"conflict", current/.test(ef) && /409/.test(ef), 'a lost race answers 409 with the current row');
  ok(/\[functions\.crm-leads\]\s*\nverify_jwt = false/.test(read('supabase/config.toml')), 'config registers the function');
  ok(!/﻿/.test(ef) && !/﻿/.test(read('supabase/functions/_shared/crm-leads-core.mjs')), 'no byte-order mark');

  // ── page wiring ──
  const frag = read('src/index/328-crm-leads.js.part');
  ok(/_writeUiRecordFailure\('leads'/.test(frag), 'refused writes are reported');
  ok(/functions\/v1\/crm-leads/.test(frag) && /_syncviewEfHeaders\(/.test(frag), 'page calls crm-leads with the staff headers');
  ok(!/\/rest\/v1\//.test(frag), 'page never reads the tables directly');
  ok(/svLayerOpen\(\{ key: 'crm-person'/.test(frag), 'person panel joins the layer list');
  ok(/CRM_LEADS_MEMBER_GRANTS = \[\]/.test(frag), 'browser grant list ships empty');
  ok(["'today'", "'sequences'", "'systems'"].every((k) => frag.includes('[' + k)) && !/CRM_COMING|crm-soon/.test(frag), 'Today, Sequences and Systems are real tabs now, with no "soon" left');
  ok(/_crmCall\('today'/.test(frag) && /_crmCall\('sequences'/.test(frag) && /_crmCall\('systems'/.test(frag), 'each tab reads its own action');
  ok(!/_crmCall\('due'|_crmCall\('log_send'/.test(frag), 'the page never calls the sender-only actions');
  ok(/svLayerOpen\(\{ key: 'crm-step-edit'/.test(frag), 'the step editor joins the layer list');
  // identity change (review finding): purge and re-render are wired into 100
  const staff = read('src/index/100-onboarding-staff-controls.js.part');
  const purge = staff.slice(staff.indexOf('function _syncviewStaffPurgeSensitiveState'));
  ok(/window\._crmPurgeSensitiveState\(\)/.test(purge.slice(0, 4000)), 'the staff purge clears Leads');
  const chrome = staff.slice(staff.indexOf('function _syncviewStaffRefreshChrome'));
  ok(/window\._crmOnIdentity\(\)/.test(chrome.slice(0, 3000)), 'the staff chrome refresh re-renders Leads');
  ok(/_crmState\.gen\+\+/.test(frag) && /gen !== _crmState\.gen/.test(frag), 'reads still in flight at an identity change are ignored');
  ok(/if \(_crmState\.openId === p\.id && _crmState\.person && _crmState\.person\.id === p\.id\)/.test(frag), 'a note answer only touches the panel if it still shows that person');
  ok(/_crmPaintFilters\(\);\s+\/\/ the niche, owner and batch choices/.test(frag), 'filter choices repaint after the list loads');
  ok(!/\bconfirm\(|\balert\(/.test(frag), 'no native dialogs');
  ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(frag.slice(frag.indexOf('_crmInjectStyles'))), 'styles use theme tokens only');
  ok(/'leads': 'leads'/.test(read('src/index/003-sv-route.html.part')), 'clean route /leads');
  ok(fs.existsSync(path.join(ROOT, 'leads.html')), 'route stub exists');
  ok(/page === 'leads'[\s\S]{0,400}_crmMountPage/.test(read('src/index/092-core-submit-form-navigation.js.part')), 'navTo mounts the page');
  ok(/if\(hash==='leads'\)\{navTo\('leads',false\);return;\}/.test(read('src/index/260-production-refresh-boot.js.part')), 'boot opens /leads');
  ok(/if \(capability === 'leads'\) return role === 'admin';/.test(read('src/index/100-onboarding-staff-controls.js.part')), 'leads capability is admin');
  const k = read('src/index/321-kasper-dashboard-replies.js.part');
  ok(/tab === 'leads'[\s\S]{0,200}navTo\('leads'\)/.test(k), 'Kasper More item opens the page');

  // ── ingest (n8n, server key) ──
  {
    const base = { event: 'booked', idempotency_key: 'k1', call_at: '2026-11-02T15:00:00Z',
      person: { name: 'Test Lead', email: 'Lead@Example.INVALID', phone: '', instagram: '', timezone: 'America/Chicago' },
      source: { name: 'example-ad', kind: 'ad' }, actor: 'n8n:Booking Handler',
      detail: { utm_campaign: 'c1', body: 'Hi there', api_key: 'x', access_token: 'y', nested: { a: 1 } } };
    const v = c.validateIngest(base);
    ok(v.ok && v.kind === 'booked' && v.channel === 'call', 'booked maps to the booked kind');
    ok(v.detail.utm_campaign === 'c1' && !('body' in v.detail) && !('api_key' in v.detail) && !('access_token' in v.detail) && !('nested' in v.detail), 'detail drops bodies, secrets and nesting');
    ok(!v.isTest, 'a normal lead is not a test');
    ok(c.validateIngest(Object.assign({}, base, { event: 'nope' })).error === 'bad_event', 'unknown event refused');
    ok(c.validateIngest(Object.assign({}, base, { idempotency_key: '' })).error === 'bad_idempotency_key', 'key required');
    ok(c.validateIngest(Object.assign({}, base, { person: { name: 'x' } })).error === 'no_contact', 'a contact is required');
    ok(c.validateIngest(Object.assign({}, base, { call_at: '' })).error === 'call_at_required', 'booked needs call_at');
    ok(c.validateIngest(Object.assign({}, base, { event: 'rescheduled', call_at: 'soon' })).error === 'bad_call_at', 'bad call_at refused');
    ok(c.validateIngest(Object.assign({}, base, { channel: 'fax' })).error === 'bad_channel', 'bad channel refused');
    ok(c.validateIngest(Object.assign({}, base, { source: { name: 's', kind: 'weird' } })).source.kind === 'other', 'unknown source kind becomes other');
    ok(c.validateIngest(Object.assign({}, base, { person: { email: 'sidney.laruel+t1@gmail.com' } })).isTest, 'plus-address test email is tagged test');
    ok(c.validateIngest(Object.assign({}, base, { detail: { utm_source: 'TEST' } })).isTest, 'utm_source test is tagged test');
    for (const ev of Object.keys(c.INGEST_EVENTS)) ok(['imported', 'booked', 'call', 'message_sent', 'reply'].includes(c.INGEST_EVENTS[ev].kind), ev + ' maps to an allowed kind');

    let plan = c.ingestPlan({ stage: 'contacted', tags: [], call_at: null, timezone: null }, v);
    ok(plan.patch.stage === 'call1_booked' && plan.patch.call_at === '2026-11-02T15:00:00.000Z' && plan.patch.timezone === 'America/Chicago', 'booked moves forward and sets call_at and timezone');
    ok(plan.events[0].kind === 'booked' && plan.events[0].detail.idempotency_key === 'k1' && plan.events[0].detail.event === 'booked', 'the ingest row carries the key and event');
    ok(plan.events.some((e) => e.kind === 'stage_changed') && plan.events.some((e) => e.kind === 'call_at_set'), 'stage and call time changes are on the timeline');
    plan = c.ingestPlan({ stage: 'call1_done', tags: [] }, v);
    ok(!('stage' in plan.patch), 'booked never moves a later stage back');
    plan = c.ingestPlan({ stage: 'no_show', tags: [] }, v);
    ok(plan.patch.stage === 'call1_booked', 'a no-show who rebooks is booked again');
    plan = c.ingestPlan({ stage: 'call1_booked', call_at: '2026-11-02T15:00:00.000Z', tags: [] }, Object.assign({}, v, { event: 'cancelled', kind: 'call' }));
    ok(plan.patch.call_at === '' && !('stage' in plan.patch) && plan.events[0].detail.call_at === '2026-11-02T15:00:00.000Z', 'cancelled clears call_at, keeps stage, records the old slot');
    plan = c.ingestPlan({ stage: 'call1_booked', call_at: '2026-11-02T15:00:00.000Z', tags: [] }, Object.assign({}, v, { event: 'rescheduled', kind: 'call', callAt: '2026-11-03T15:00:00.000Z' }));
    ok(plan.patch.call_at === '2026-11-03T15:00:00.000Z' && !('stage' in plan.patch), 'rescheduled moves call_at only');
    const reply = c.validateIngest(Object.assign({}, base, { event: 'sms_reply', call_at: null }));
    plan = c.ingestPlan({ stage: 'to_contact', tags: [] }, reply);
    ok(plan.patch.stage === 'replied' && plan.stopEnrolments && plan.events[0].kind === 'reply', 'sms_reply moves to replied and stops sequences');
    plan = c.ingestPlan({ stage: 'call2_done', tags: [] }, reply);
    ok(!('stage' in plan.patch) && plan.stopEnrolments, 'a later-stage reply keeps stage but still stops sequences');
    const sent = c.validateIngest(Object.assign({}, base, { event: 'email_sent', call_at: null, person: { email: 'sidney.laruel+x@gmail.com' } }));
    plan = c.ingestPlan({ stage: 'contacted', tags: ['a'] }, sent);
    ok(plan.events[0].kind === 'message_sent' && plan.events[0].channel === 'email' && plan.patch.tags.join() === 'a,test' && plan.events[0].detail.test === true, 'a send is logged and a test lead tagged test');
    ok(!plan.stopEnrolments && !('stage' in plan.patch), 'a send changes no stage');
  }
  const fnSrc = read('supabase/functions/crm-leads/index.ts');
  ok(/SERVER_ACTIONS = \["due", "log_send", "ingest"\]/.test(fnSrc), 'ingest takes only the server key');
  ok(/detail->>idempotency_key/.test(fnSrc), 'ingest dedupes on the idempotency key');
  ok(!/console\.(log|error|warn)\([^)]*v\.person/.test(fnSrc), 'ingest never logs contact details');
  console.log('crm-leads: ' + passed + ' checks passed');
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
