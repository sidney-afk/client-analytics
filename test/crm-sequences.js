'use strict';
// Leads CRM step 2 (docs/features/CRM_LEADS.md): the sequence rules the
// crm-leads `due` action applies, step edits, send logging, the seeded
// sequences and the Systems list. Offline; every fixture is made up.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }

(async () => {
  const q = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/crm-sequences-core.mjs')).href);
  const a = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/crm-automations.mjs')).href);

  // ── time zones ──
  ok(q.validTimeZone('America/Chicago') && !q.validTimeZone('Mars/Base') && !q.validTimeZone(''), 'time zones validated');
  ok(q.zoneOf({ timezone: 'Nope/Nope' }) === q.DEFAULT_TZ && q.zoneOf({}) === q.DEFAULT_TZ, 'a missing or bad zone falls back to the default');
  const utc9 = q.zonedToUtc(2026, 7, 15, 9, 'America/New_York');
  ok(new Date(utc9).toISOString() === '2026-07-15T13:00:00.000Z', '09:00 in New York in summer is 13:00 UTC');
  ok(new Date(q.zonedToUtc(2026, 1, 15, 9, 'America/New_York')).toISOString() === '2026-01-15T14:00:00.000Z', 'and 14:00 UTC in winter');
  ok(new Date(q.zonedToUtc(2026, 11, 2, 9, 'America/Los_Angeles')).toISOString() === '2026-11-02T17:00:00.000Z', 'after the autumn clock change too');

  // ── text window: 08:00 to 18:00 in the lead's zone ──
  const ny = 'America/New_York';
  ok(!q.inTextWindow(Date.parse('2026-07-15T11:59:00Z'), ny), '07:59 local is too early');
  ok(q.inTextWindow(Date.parse('2026-07-15T12:00:00Z'), ny), '08:00 local is allowed');
  ok(q.inTextWindow(Date.parse('2026-07-15T21:59:00Z'), ny), '17:59 local is allowed');
  ok(!q.inTextWindow(Date.parse('2026-07-15T22:00:00Z'), ny), '18:00 local is too late');
  ok(q.inTextWindow(Date.parse('2026-07-15T22:00:00Z'), 'America/Los_Angeles'), 'the same instant is fine for a lead on the west coast');

  // ── step timing ──
  const enrolled = Date.parse('2026-07-15T20:10:00Z'); // 16:10 New York
  ok(q.stepDueAt({ day_offset: 0, hour_offset: 0 }, enrolled, ny) === enrolled, 'day 0 hour 0 is due at enrolment');
  ok(q.stepDueAt({ day_offset: 0, hour_offset: 2 }, enrolled, ny) === enrolled + 2 * 3600000, 'hour offset adds hours');
  ok(new Date(q.stepDueAt({ day_offset: 1, send_hour: 9 }, enrolled, ny)).toISOString() === '2026-07-16T13:00:00.000Z', '"next morning" is 09:00 local the next day');
  const lateNight = Date.parse('2026-07-16T03:30:00Z'); // 23:30 on the 15th in New York
  ok(new Date(q.stepDueAt({ day_offset: 1, send_hour: 9 }, lateNight, ny)).toISOString() === '2026-07-16T13:00:00.000Z', 'the local date counts, not the UTC date');

  // ── templates ──
  ok(q.firstName('Dr. Example Person') === 'Example' && q.firstName('Doctor Sample Name') === 'Sample' && q.firstName('') === '', 'first name skips the title');
  const r = q.renderTemplate('Hi {first_name}, about {niche}: {rebook_link}', { display_name: 'Made Up', niche: 'dermatology' });
  ok(r.text === 'Hi Made, about dermatology: {rebook_link}' && JSON.stringify(r.needs) === '["rebook_link"]', 'person placeholders filled, links left for the sender');
  ok(q.renderTemplate('Hi {first_name} in {niche}', {}).text === 'Hi there in your field', 'blank name and niche read naturally');

  // ── step edits ──
  ok(q.validateStepEdit({ template: 'Hi {first_name}' }, 'sms').ok, 'a plain text edit is fine');
  ok(q.validateStepEdit({ template: 'x'.repeat(301) }, 'sms').error === 'text_too_long', 'texts over 300 characters refused');
  ok(q.validateStepEdit({ template: 'x'.repeat(301) }, 'email').ok, 'emails may be longer');
  ok(q.validateStepEdit({ template: 'Hi {firstname}' }, 'sms').error === 'unknown_placeholder', 'a misspelt placeholder is refused');
  ok(q.validateStepEdit({ template: '  ' }, 'sms').error === 'template_required', 'an empty template is refused');
  ok(q.validateStepEdit({ subject: 'Hi' }, 'sms').error === 'subject_on_text', 'texts have no subject');
  ok(q.validateStepEdit({ subject: '' }, 'email').error === 'bad_subject', 'emails need a subject');
  ok(q.validateStepEdit({ subject: 'See {rebook_link}' }, 'email').error === 'unknown_placeholder', 'no links in a subject');
  ok(q.validateStepEdit({ day_offset: 3, hour_offset: 2, send_hour: 9 }, 'email').ok, 'timing edits accepted');
  ok(q.validateStepEdit({ day_offset: -1 }, 'email').error === 'bad_day_offset' && q.validateStepEdit({ hour_offset: 24 }, 'email').error === 'bad_hour_offset', 'timing bounded');
  ok(q.validateStepEdit({ send_hour: 3 }, 'email').error === 'bad_send_hour' && q.validateStepEdit({ send_hour: null }, 'email').fields.send_hour === null, 'send hour bounded or cleared');
  ok(q.validateStepEdit({ approval_state: 'approved' }, 'email').error === 'unknown_field', 'an edit cannot approve itself');
  ok(q.validateStepEdit({}, 'email').error === 'fields_required' && q.validateStepEdit({ template: 'x' }, 'dm').error === 'bad_channel', 'empty edits and odd channels refused');

  // ── evaluateEnrolment ──
  const SEQ = 'seq-1';
  const sequence = { id: SEQ, key: 'no_show', active: true, stay_stages: ['no_show'] };
  const step = (key, pos, extra) => Object.assign({ id: 'id-' + key, sequence_id: SEQ, step_key: key, position: pos, day_offset: 0, hour_offset: 0, send_hour: null, channel: 'sms', audience: 'all', approval_state: 'approved', is_current: true, template: 'Hi {first_name} {rebook_link}', subject: null, version: 1 }, extra || {});
  const steps = [step('a', 1), step('b', 2, { day_offset: 1, send_hour: 9 }), step('c', 3, { day_offset: 2, send_hour: 10, channel: 'email', subject: 'Hello {first_name}', template: 'Body' })];
  const person = { id: 'p', display_name: 'Made Up', stage: 'no_show', phone: '5550100000', email: 'made-up@example.invalid', timezone: ny, lost_reason: null, opted_out_at: null };
  const enrolment = { id: 'e', sequence_id: SEQ, person_id: 'p', status: 'active', paused: false, enrolled_at: '2026-07-15T14:00:00Z', sent_step_keys: [], skipped_step_keys: [] };
  const at = (iso) => Date.parse(iso);
  const ev = (over, now) => q.evaluateEnrolment(Object.assign({ sequence, steps, enrolment, person, events: [], now: at(now || '2026-07-15T14:05:00Z') }, over));

  let x = ev({});
  ok(x.state === 'send' && x.step.step_key === 'a' && x.channel === 'sms' && x.to === '5550100000' && x.body === 'Hi Made {rebook_link}' && x.needs[0] === 'rebook_link', 'the first due step is ready to send, rendered');
  ok(ev({ enrolment: Object.assign({}, enrolment, { sent_step_keys: ['a'] }) }).state === 'wait', 'the next step waits for its day');
  x = ev({ enrolment: Object.assign({}, enrolment, { sent_step_keys: ['a'] }) }, '2026-07-16T13:01:00Z');
  ok(x.state === 'send' && x.step.step_key === 'b', 'and is due the next morning');
  ok(ev({ enrolment: Object.assign({}, enrolment, { skipped_step_keys: ['a'] }) }, '2026-07-16T13:01:00Z').step.step_key === 'b', 'a skipped step is passed over');
  ok(ev({ enrolment: Object.assign({}, enrolment, { sent_step_keys: ['a', 'b', 'c'] }) }).state === 'complete', 'all steps sent: complete');
  ok(ev({ enrolment: Object.assign({}, enrolment, { status: 'stopped' }) }).state === 'inactive', 'a stopped enrolment does nothing');
  // only one step at a time, never a burst
  x = ev({}, '2026-07-20T15:00:00Z');
  ok(x.state === 'send' && x.step.step_key === 'a', 'a backlog sends one step at a time, in order');

  // never if not approved or sequence off; paused holds
  ok(ev({ steps: [step('a', 1, { approval_state: 'draft' })] }).reason === 'not_approved', 'a draft step is never sent');
  ok(ev({ sequence: Object.assign({}, sequence, { active: false }) }).reason === 'sequence_off', 'a sequence that is off sends nothing');
  ok(ev({ sequence: undefined }).state === 'hold', 'a missing sequence sends nothing');
  ok(ev({ enrolment: Object.assign({}, enrolment, { paused: true }) }).reason === 'paused', 'a paused enrolment holds');
  ok(ev({ steps: [step('a', 1, { is_current: false })] }).state === 'complete', 'an old version is never sent');

  // quiet hours for texts only
  ok(ev({ enrolment: Object.assign({}, enrolment, { enrolled_at: '2026-07-15T23:30:00Z' }) }, '2026-07-15T23:35:00Z').reason === 'quiet_hours', 'a text due at 19:35 local waits for morning');
  ok(ev({ enrolment: Object.assign({}, enrolment, { enrolled_at: '2026-07-15T23:30:00Z' }) }, '2026-07-16T12:00:00Z').state === 'send', 'and goes at 08:00 local');
  ok(ev({ person: Object.assign({}, person, { timezone: 'America/Los_Angeles' }), enrolment: Object.assign({}, enrolment, { enrolled_at: '2026-07-15T23:30:00Z' }) }, '2026-07-15T23:35:00Z').state === 'send', 'quiet hours follow the lead\'s own zone');
  x = ev({ steps: [step('c', 1, { channel: 'email', subject: 'Hello {first_name}', template: 'Body' })], enrolment: Object.assign({}, enrolment, { enrolled_at: '2026-07-15T23:30:00Z' }) }, '2026-07-15T23:35:00Z');
  ok(x.state === 'send' && x.channel === 'email' && x.subject === 'Hello Made' && x.to === 'made-up@example.invalid', 'emails may go out of hours');
  ok(ev({ person: Object.assign({}, person, { phone: '' }) }).reason === 'no_phone', 'no phone, no text');
  ok(ev({ steps: [step('c', 1, { channel: 'email', subject: 's', template: 'b' })], person: Object.assign({}, person, { email: null }) }).reason === 'no_email', 'no email, no email');
  ok(ev({ steps: [step('a', 1, { template: '{first_name}' + 'x'.repeat(296) })], person: Object.assign({}, person, { display_name: 'Averyveryverylongname' }) }).reason === 'text_too_long', 'a text that renders past 300 characters holds');

  // stop rules
  const after = (kind, detail) => [{ kind, occurred_at: '2026-07-15T15:00:00Z', detail: detail || {} }];
  ok(ev({ events: after('reply') }).reason === 'replied', 'a reply stops it');
  ok(ev({ events: after('booked') }).reason === 'booked', 'a booking stops it');
  ok(ev({ events: after('opted_out') }).reason === 'opted_out', 'an opt-out event stops it');
  ok(ev({ events: after('opted_out', { opted_out: false }) }).state === 'send', 'opting back in does not');
  ok(ev({ person: Object.assign({}, person, { opted_out_at: '2026-07-15T15:00:00Z' }) }).reason === 'opted_out', 'an opted-out person is stopped');
  ok(ev({ events: [{ kind: 'reply', occurred_at: '2026-07-01T00:00:00Z' }] }).state === 'send', 'a reply from before the enrolment does not count');
  ok(ev({ person: Object.assign({}, person, { stage: 'call1_booked' }) }).reason === 'stage_moved', 'a stage past the trigger stops it');
  ok(ev({ sequence: Object.assign({}, sequence, { stay_stages: [] }) , person: Object.assign({}, person, { stage: 'won' }) }).state === 'send', 'no stay stages: stage does not stop it');
  ok(ev({ person: null }).reason === 'person_missing', 'a deleted person stops it');
  ok(ev({ events: after('reply'), sequence: Object.assign({}, sequence, { active: false }) }).state === 'stop', 'stopping wins over holding');

  // lost_reason variants
  const vSeq = Object.assign({}, sequence, { stay_stages: [] });
  const variants = [step('p', 1, { audience: 'lost_price' }), step('t', 1, { audience: 'lost_trust' }), step('o', 1, { audience: 'lost_other' })];
  const pick = (reason) => ev({ sequence: vSeq, steps: variants, person: Object.assign({}, person, { lost_reason: reason }) }).step.step_key;
  ok(pick('price') === 'p' && pick('trust') === 't' && pick('timing') === 'o' && pick(null) === 'o', 'the email follows the lost reason');
  ok(ev({ sequence: vSeq, steps: variants, person: Object.assign({}, person, { lost_reason: 'price' }), enrolment: Object.assign({}, enrolment, { sent_step_keys: ['p'] }) }).state === 'complete', 'a person gets only their variant');

  // send log
  ok(q.validateSendLog({ result: 'sent', provider_id: 'x1' }).ok && q.validateSendLog({ result: 'maybe' }).error === 'bad_result', 'send results validated');
  ok(q.validateSendLog({ result: 'failed', error: 'x'.repeat(501) }).error === 'bad_error', 'error text bounded');
  ok(q.sendEventKind('sent') === 'message_sent' && q.sendEventKind('failed') === 'send_failed' && q.sendEventKind('skipped') === 'send_skipped', 'each result has its event kind');

  // ── seeded sequences (migration) ──
  const mig = read('supabase/migrations/20261026120000_crm_leads.sql');
  const seqRows = [...mig.matchAll(/insert into public\.crm_sequences \(key, name, description, stay_stages, active\) values \(\$t\$([a-z0-9_]+)\$t\$[\s\S]*?, false\) on conflict/g)].map((m) => m[1]);
  ok(JSON.stringify(seqRows) === '["no_show","call1_no_call2","call2_no_sign","nurture"]', 'the four sequences are seeded, all off');
  const stepRows = [...mig.matchAll(/select id, \$t\$([a-z0-9_]+)\$t\$, (\d+), (\d+), (\d+), (null|\d+), \$t\$(sms|email)\$t\$, \$t\$([a-z_]+)\$t\$, (null|\$t\$[\s\S]*?\$t\$), \$t\$([\s\S]*?)\$t\$ from public\.crm_sequences where key = \$t\$([a-z0-9_]+)\$t\$/g)]
    .map((m) => ({ key: m[1], pos: +m[2], day: +m[3], hour: +m[4], channel: m[6], audience: m[7], subject: m[8], template: m[9], seq: m[10] }));
  ok(stepRows.length === 25, 'twenty-five draft steps seeded (' + stepRows.length + ')');
  ok(!/approval_state[^;]*'approved'[^;]*from public\.crm_sequences/.test(mig), 'no seeded step is approved');
  const by = (k) => stepRows.filter((s) => s.seq === k);
  ok(by('no_show').map((s) => s.channel + s.day).join(',') === 'sms0,sms1,email2,sms4,email7', 'no-show: text now, text next morning, email day 2, text day 4, email day 7');
  ok(/rebook or close your file/i.test(by('no_show')[4].subject) && by('no_show').every((s) => /\{rebook_link\}/.test(s.template)), 'no-show: every touch carries the rebook link, the last asks rebook or close');
  ok(by('call1_no_call2').map((s) => s.channel + s.day).join(',') === 'sms0,email2,sms4,email7,sms10,email14', 'call 1, no call 2: the six touches on the days asked');
  ok(/\{call2_link\}/.test(by('call1_no_call2')[0].template) && /\{case_study_link\}/.test(by('call1_no_call2')[1].template), 'call 2 link on the same-day text, case study on day 2');
  const c2 = by('call2_no_sign');
  ok(new Set(c2.map((s) => s.pos)).size === 6 && Math.max(...c2.map((s) => s.day)) === 14, 'call 2, no sign: six touches over 14 days');
  ok(/\{case_study_link\}/.test(c2.find((s) => s.audience === 'lost_price').template) && /\{testimonials_link\}/.test(c2.find((s) => s.audience === 'lost_trust').template) && c2.some((s) => s.audience === 'lost_other'), 'price gets a case study, trust gets testimonials, others a default');
  ok(/what would need to change/i.test(c2[c2.length - 1].subject), 'the last email asks what would need to change');
  const nu = by('nurture');
  ok(nu.length >= 4 && nu.every((s, i) => s.channel === 'email' && s.day === 7 * (i + 1)), 'nurture: one email a week');
  for (const s of stepRows) {
    if (s.channel === 'sms') ok(s.template.length <= 300, s.key + ': text under 300 characters');
    else ok(/\nKasper$/.test(s.template) && s.subject !== 'null', s.key + ': email has a subject and signs off Kasper');
    ok(/\{first_name\}/.test(s.template), s.key + ': greets by first name');
    ok(q.placeholdersIn(s.template).every((k) => q.PLACEHOLDERS.includes(k)), s.key + ': only known placeholders');
    ok(!/\d+\s*%|\$\s*\d|\b\d{2,}\s*(patients|clients|views|followers|sales|students)/i.test(s.template), s.key + ': claims no results or numbers');
  }
  ok(/'sms', 'email'/.test(mig) && /check \(channel <> 'sms' or length\(template\) <= 300\)/.test(mig), 'the table itself caps texts at 300 characters');
  ok(/approval_state text not null default 'draft'/.test(mig) && /active boolean not null default false/.test(mig), 'steps start as drafts and sequences start off');
  ok(/insert into public\.crm_sequence_steps[\s\S]*?o\.version \+ 1, true, 'draft'/.test(mig), 'an edit makes a new draft version');
  ok(/crm_enrolments_one_active_uq on public\.crm_enrolments \(person_id, sequence_id\) where status = 'active'/.test(mig), 'one active enrolment per person per sequence');
  for (const fn of ['crm_enrol(uuid, uuid, text)', 'crm_enrolment_apply(uuid, jsonb, text, jsonb, boolean)', 'crm_step_new_version(uuid, jsonb, text)']) {
    const esc = fn.replace(/[()]/g, '\\$&');
    ok(new RegExp('revoke all on function[\\s\\S]*?public\\.' + esc + '[\\s\\S]*?from public, anon, authenticated, service_role').test(mig), fn + ' revoked from all four roles');
    ok(new RegExp('grant execute on function[\\s\\S]*?public\\.' + esc + '[\\s\\S]*?to service_role').test(mig), fn + ' granted to service_role');
  }

  // ── function wiring ──
  const ef = read('supabase/functions/crm-leads/index.ts');
  ok(/SERVER_ACTIONS = \["due", "log_send", "ingest"\]/.test(ef) && ef.indexOf('serverKeyOk(req)') < ef.indexOf('authorizeStaffKey(key'), 'due, log_send and ingest take the server key, checked first');
  ok(/sender\.length >= 24/.test(ef) && /timingSafeEqual\(given, sender\)/.test(ef) && /timingSafeEqual\(bearer, service\)/.test(ef), 'server key compared in constant time, short keys refused');
  ok(/const dryRun = body\.dry_run !== false/.test(ef), 'due is a dry run unless asked otherwise');
  ok(!/fetch\(/.test(ef) && !/twilio|sendgrid|smtp|gmail\.googleapis/i.test(ef), 'the function never sends anything');
  ok(/if \(role !== "admin"\) return json\(\{ ok: false, error: "admin_only" \}, 403\)/.test(ef), 'only an admin approves a step');
  ok(/rpc\("crm_step_new_version"/.test(ef) && /rpc\("crm_enrolment_apply"/.test(ef) && /rpc\("crm_enrol"/.test(ef), 'enrolment and step changes go through the transactional functions');
  ok(/key", "no_show"/.test(ef) && /outcome === "showed" \? "call1_done" : "no_show"/.test(ef), 'call outcome moves the stage and enrols a no-show');

  // ── systems list ──
  const ids = a.N8N_AUTOMATIONS.map((r) => r.id);
  for (const id of ['booking_confirmation', 'pre_call_nurture', 'recovery', 'reschedule', 'cancel', 'meta_booked_call', 'contract_email', 'payment_email', 'onboarding_email', 'inbound_text_relay']) ok(ids.includes(id), 'systems lists ' + id);
  for (const r of a.N8N_AUTOMATIONS) {
    ok(['trigger', 'audience', 'channel', 'from', 'timing'].every((k) => typeof r[k] === 'string' && r[k]) && typeof r.logged === 'boolean', r.id + ': trigger, audience, channel, from, timing, logged');
    ok(a.AUTOMATION_CHANNELS.includes(r.channel), r.id + ': known channel');
  }
  const autoSrc = read('supabase/functions/_shared/crm-automations.mjs');
  ok(!/\+?\d[\d\s().-]{8,}\d/.test(autoSrc.replace(/^\/\/.*$/gm, '')) && !/@[a-z0-9-]+\.[a-z]{2,}/i.test(autoSrc), 'no phone numbers or addresses in the systems list');
  const rows = a.sequenceSystemRows([{ id: 's', key: 'k', name: 'N', active: false }], [{ sequence_id: 's', position: 1, day_offset: 0, channel: 'sms', approval_state: 'draft' }, { sequence_id: 's', position: 2, day_offset: 2, channel: 'email', approval_state: 'approved' }], { s: 3 });
  ok(rows.length === 1 && rows[0].channel === 'sms+email' && rows[0].timing === 'day 0, day 2' && rows[0].approved === 1 && /3 now/.test(rows[0].audience) && rows[0].logged === true, 'sequence rows generated from the data');

  console.log('crm-sequences: ' + passed + ' checks passed');
})().catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
