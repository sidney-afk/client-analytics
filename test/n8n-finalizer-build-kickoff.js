'use strict';
/*
 * OPEN_REPAIRS 696: the Slack finalizer's "Build Kickoff" step (scripts/n8n-finalizer-build-kickoff.js), run
 * here against fictional step outputs exactly as n8n runs a Code step: the same code string, with $() and
 * $json supplied. Everything below is invented: names, ids, links and logins.
 * RENDER=1 prints the rendered kickoff.
 */
const vm = require('node:vm');
const { BUILD_KICKOFF_JS } = require('../scripts/n8n-finalizer-build-kickoff.js');

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.error('FAIL  ' + m); } };

function run(steps) {
  const $ = name => ({ all: () => (steps[name] || []).map(json => ({ json })), first: () => ({ json: (steps[name] || [])[0] || {} }) });
  const ctx = { $, $json: (steps['Read Sales Intake'] || [])[0] || {} };
  vm.createContext(ctx);
  const out = vm.runInContext('(function(){' + BUILD_KICKOFF_JS + '\n})()', ctx);
  return out[0].json;
}

const SNAPSHOT_KICKOFF = '*New client — Fixture Person*\n\nStandard funnel\n\n*Team*\n\n*CCS* — [ assign ]\n\n*GD* — [ assign ]\n\n*Resources*\n\n'
  + '*Onboarding form* — https://example.invalid\n\n*Account access*\n\n*Instagram* — fixture_ig / fixture-pass-1\n\n*TikTok* — fixture_tt / fixture-pass-2\n\n'
  + '*Full form answers* — in the next message\n\n*Action items*\n\n[ Kasper — fill in ]';
const SNAPSHOT_BRIEF = '*Onboarding form — Fixture Person*\n\nStandard funnel\n\n*Basic info*\n\n*Name* — Fixture Person\n\n'
  + '*Brand & audience*\n\n*Brand guidelines* — https://example.invalid/fixture-deck\n\n*Ideal customer* — Busy fixture founders\n\n'
  + '*Pain points*\n\nNo time to post\n\nNo clear message\n\n*Desired outcomes* — More booked calls\n\n'
  + '*Style*\n\n*Creators for inspiration*\n\n@fixture.one  (calm)\n\n@fixture.two\n\n*Subtitles* — Bold - with highlights\n\n'
  + '*Goals*\n\n*What makes this a win* — Ten leads a month';
const full = {
  'Pick One Pending Job': [{ client_name: 'Fixture Person', email: 'fixture@example.invalid', viewer_slug: 'fixtureperson', funnel: 'standard', folder_id: 'FIXTUREFOLDER', kickoff: SNAPSHOT_KICKOFF, form_brief: SNAPSHOT_BRIEF }],
  'Verify Clients Info Readback': [{ state: 'client_info_verified', creative_channel_id: 'CFIXTURE1', private_channel_id: 'CFIXTURE2' }],
  'Check Readiness and Slack Decision': [{ private_required_members: ['UFIXTURELEAD', 'UFIXTURESMM'] }],
  'Read Clients Info': [{ client_name: 'Fixture Person', content_description: 'A fixture coach who helps founders speak on camera.', keywords: 'founder video', specific_keywords: 'camera confidence' }],
  'Read SMM Assignment': [{ client_name: 'Fixture Person', social_media_manager: 'Fixture SMM', slack_profile_url: 'UFIXTURESMM' }],
  'Read Filming Plan': [{ client_slug: 'fixtureperson', doc_url: 'https://docs.example.invalid/fixture-plan', doc_id: 'x' }],
  'Read Sales Intake': [
    { client_email: 'FIXTURE@example.invalid', created_at: '2026-11-01T00:00:00Z', status: 'signed', deliverables: '12 short videos a month, one filming day, ManyChat setup' },
    { client_email: 'fixture@example.invalid', created_at: '2026-10-01T00:00:00Z', status: 'cancelled', deliverables: 'old cancelled deal' },
  ],
};

const a = run(full);
const t = a.kickoff_text;
if (process.env.RENDER) console.log('\n' + t + '\n');
ok(a.creative_channel_id === 'CFIXTURE1' && a.state === 'client_info_verified', 'passes the channel id and state through for the post step');
ok(t.startsWith('*New client — Fixture Person* · Standard funnel'), 'heading: name and funnel');
ok(t.includes('SMM <@UFIXTURESMM> · Lead <@UFIXTURELEAD> · CCS [ assign ] · GD [ assign ] · Videographer [ assign ]'), 'team: SMM and lead tagged from the steps before; filming in scope adds the videographer');
ok(t.includes('Onboarding form — https://syncview.synchrosocial.com/?onboarding_view=fixtureperson'), 'resources: onboarding form link from the viewer slug');
ok(t.includes('Drive folder — https://drive.google.com/drive/folders/FIXTUREFOLDER') && t.includes('Filming plan — https://docs.example.invalid/fixture-plan'), 'resources: Drive folder and filming plan');
ok(t.includes('Brand deck — https://example.invalid/fixture-deck') && t.includes('Onboarding call — [ add link ]'), 'resources: brand deck from the form; the call stays a placeholder');
ok(t.includes('*Account access*\n*Instagram* — fixture_ig / fixture-pass-1\n\n*TikTok* — fixture_tt / fixture-pass-2\n'), 'logins: the snapshot block, word for word (owner rule: logins stay in Slack)');
ok(t.includes('*The brand*\nA fixture coach who helps founders speak on camera.\nKeywords: founder video, camera confidence'), 'the brand: profile description and keyword research');
ok(t.includes('*Audience*\nBusy fixture founders\nPain points: No time to post\nNo clear message'), 'audience: ideal customer and pain points (a multi-paragraph answer kept whole)');
ok(t.includes('*Goals*\nMore booked calls\nA win: Ten leads a month'), 'goals');
ok(t.includes('Inspiration: @fixture.one  (calm) · @fixture.two') && t.includes('Subtitles: Bold - with highlights'), 'style: inspiration handles and form style answers');
ok(t.includes('*Scope*\n12 short videos a month, one filming day, ManyChat setup'), 'scope: the newest live sales intake, never the cancelled one');
ok(t.includes('• <@UFIXTURELEAD> book the kickoff call with <@UFIXTURESMM>') && t.includes('• <@UFIXTURESMM> connect Post for Me, and do the ManyChat plan') && t.includes('• <@UFIXTURELEAD> book the videographer'), 'action items: tagged, ManyChat and the videographer only because the scope has them');
ok(t.includes('*Timeline*\n[ Kasper — strategy · first samples · first post ]') && t.endsWith('Full form answers in the next message.'), 'timeline stays Kasper\'s placeholder; the form answers follow');
ok(!t.includes('**'), 'Slack bold: single asterisks only');

const bare = run({
  'Pick One Pending Job': [{ client_name: 'Fixture Person', email: 'fixture@example.invalid', viewer_slug: '', funnel: '', folder_id: '', kickoff: '', form_brief: '' }],
  'Verify Clients Info Readback': [{ state: 'client_info_verified', creative_channel_id: 'CFIXTURE1' }],
});
const b = bare.kickoff_text;
if (process.env.RENDER) console.log('\n' + b + '\n');
for (const ph of ['[ SMM ]', '[ Kasper ]', '[ funnel ]', '[ onboarding form link ]', '[ Drive folder ]', '[ filming plan link ]', '[ brand summary from the research ]', '[ audience ]', '[ goals ]', '[ style ]', '[ deliverables from the sales intake ]', 'Videographer [ if the scope includes filming ]', '[ and the ManyChat plan, if it is in scope ]']) {
  ok(b.includes(ph), 'missing piece becomes a placeholder, never a guess: ' + ph);
}
ok(b.includes('Brand deck — none sent') && b.includes('_No account access in the form yet: chase it before the first post._'), 'no deck says "none sent"; no logins says so plainly');

const noFilm = run({ ...full, 'Read Sales Intake': [{ client_email: 'fixture@example.invalid', created_at: '2026-11-01', status: 'signed', deliverables: '12 short videos a month' }] }).kickoff_text;
ok(!/Videographer|videographer|ManyChat/.test(noFilm), 'a scope without filming or ManyChat names neither');

const same = run({ ...full, 'Check Readiness and Slack Decision': [{ private_required_members: ['UFIXTURESMM'] }] }).kickoff_text;
ok(same.includes('SMM <@UFIXTURESMM> · Lead <@UFIXTURESMM>'), 'when the lead is also the SMM (one id in the set), both are tagged, never a placeholder');
const noReady = run({ ...full, 'Check Readiness and Slack Decision': [{}] }).kickoff_text;
ok(noReady.includes('Lead [ Kasper ]'), 'no readiness id: the lead is a placeholder, never the SMM');

console.log('\nn8n-finalizer-build-kickoff: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
