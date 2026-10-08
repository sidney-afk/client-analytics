'use strict';
// scripts/client-resource-match.js (Stage 3.1): the read-only matching pass, on fictional data.
// It proposes and never saves; it refuses to write its detail inside a git checkout; it prints
// counts only; the brain is read first; a missing HubSpot flag is "unknown", never "unpaid".
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const m = require(path.join(ROOT, 'scripts', 'client-resource-match.js'));
let passed = 0; let failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log('  ok  ' + msg); } else { failed++; console.error('FAIL  ' + msg); } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-'));
const brainDir = path.join(tmp, 'brain');
fs.mkdirSync(path.join(brainDir, 'clients', 'qx-alphatest'), { recursive: true });
fs.writeFileSync(path.join(brainDir, 'clients', 'qx-alphatest', 'identity.md'),
  'Plan: https://docs.google.com/document/d/DOCfixture000000000000001/edit\nFolder: https://drive.google.com/drive/folders/FOLDERfixture01\nCreative: C0FIXTURE01\n');
fs.mkdirSync(path.join(brainDir, 'clients', 'qx-bravotest'), { recursive: true });
fs.writeFileSync(path.join(brainDir, 'clients', 'qx-bravotest', 'brief.md'), 'nothing linked');

const roster = [
  { slug: 'qxalphatest', display_name: 'Qx Alphatest', kind: 'client', email: 'qxa@example.invalid', slack_channel_id: null, creative_channel_id: 'C0FIXTURE01', filming_plan: 'https://docs.google.com/document/d/DOCfixture000000000000001/edit' },
  { slug: 'qxbravotest', display_name: 'Qx Bravotest', kind: 'client', email: null, slack_channel_id: 'C0OLDID0001', creative_channel_id: null, filming_plan: null },
  { slug: 'qxcharlietest', display_name: 'Dr. Qx Charlietest', kind: 'client', email: null, slack_channel_id: null, creative_channel_id: null, filming_plan: null },
];
const hubspot = {
  contacts: [
    { id: '11', email: 'QXA@example.invalid', firstname: 'Someone', lastname: 'Else', contract_signed: 'true', first_invoice_paid: null },
    { id: '22', email: 'qxb@example.invalid', firstname: 'Qx', lastname: 'Bravotest', contract_signed: null, first_invoice_paid: 'false' },
    { id: '33', email: 'c1@example.invalid', firstname: 'Qx', lastname: 'Charlietest' },
    { id: '34', email: 'c2@example.invalid', firstname: 'Qx', lastname: 'Charlietest' },
  ],
  deals: [{ id: 'D1', dealname: 'x', dealstage: 'closedwon', contact_ids: ['11'] }, { id: 'D2', contact_ids: ['22'] }, { id: 'D3', contact_ids: ['22'] }],
};
const drive = {
  client_folders: [{ id: 'F-qxb', name: 'qx-bravotest' }, { id: 'F-qxc1', name: 'qx-charlietest' }, { id: 'F-qxc2', name: 'Qx Charlietest (old)' }],
  filming_plan_folders: [{ id: 'P-avery', name: 'Qx Alphatest' }],
};
const slack = { channels: [{ id: 'C0FIXTURE01', name: 'qx-alphatest-creative' }, { id: 'C0NEWID0002', name: 'qx-bravotest-synchro', is_private: true }, { id: 'C0QXC000003', name: 'qx-charlietest-creative' }] };

ok(m.norm('Dr. Qx Charlietest') === 'qxcharlietest' && m.norm('Qx and Qy') === 'qx&qy' && m.norm('Zoë Qxnaïve') === 'zoeqxnaive', 'names are normalised the way every client slug is');
const src = { brain: m.readBrain(brainDir), hubspot, drive, slack };
const rows = roster.flatMap((c) => m.matchClient(c, src));
const get = (slug, res) => rows.filter((r) => r.client_slug === slug && r.resource === res);
ok(get('qxalphatest', 'brain_folder')[0].status === 'proposal' && get('qxalphatest', 'brain_folder')[0].value === 'clients/qx-alphatest', 'brain: the client folder is found by name');
ok(get('qxalphatest', 'filming_plan_doc')[0].status === 'confirms_existing', 'brain: a Doc in the brain that is the linked filming plan confirms it');
ok(get('qxalphatest', 'drive_client_folder').length === 1 && get('qxalphatest', 'drive_client_folder')[0].source === 'brain' && get('qxalphatest', 'drive_client_folder')[0].value === 'FOLDERfixture01', 'brain first: its Drive folder link wins, Drive is not asked again');
ok(get('qxalphatest', 'hubspot_contact')[0].value === '11' && get('qxalphatest', 'hubspot_contact')[0].confidence === 'high', 'hubspot: the contact is matched by the profile email, any case');
ok(get('qxalphatest', 'hubspot_deal')[0].value === 'D1' && get('qxalphatest', 'hubspot_deal')[0].status === 'proposal', 'hubspot: the one deal on that contact is proposed');
ok(get('qxalphatest', 'contract_state')[0].value === 'signed' && get('qxalphatest', 'payment_state')[0].value === 'unknown', 'hubspot: a set flag is signed; a missing flag is unknown, never unpaid');
ok(get('qxbravotest', 'payment_state')[0].value === 'unknown', 'hubspot: a false flag is still unknown (hand imports carry no flags)');
ok(get('qxbravotest', 'hubspot_contact')[0].confidence === 'medium' && get('qxbravotest', 'hubspot_deal')[0].status === 'ambiguous', 'hubspot: by name is medium; two deals on one contact are ambiguous for a person');
ok(get('qxcharlietest', 'hubspot_contact')[0].status === 'ambiguous', 'hubspot: two contacts with the same name are ambiguous');
ok(get('qxcharlietest', 'drive_client_folder')[0].status === 'proposal' && get('qxcharlietest', 'drive_client_folder')[0].value === 'F-qxc1', 'drive: an exact folder name beats a loose one');
ok(get('qxbravotest', 'drive_client_folder')[0].value === 'F-qxb', 'drive: the client folder by name');
ok(get('qxalphatest', 'creative_channel')[0].status === 'confirms_existing', 'slack: a channel that matches the saved id confirms it');
ok(get('qxbravotest', 'client_channel')[0].status === 'conflict' && get('qxbravotest', 'client_channel')[0].existing === 'C0OLDID0001', 'slack: a different id from the saved one is a conflict, never an overwrite');
ok(get('qxcharlietest', 'creative_channel')[0].status === 'proposal' && get('qxcharlietest', 'creative_channel')[0].confidence === 'high', 'slack: an unsaved creative channel found by name is proposed');
const partial = m.matchClient(roster[0], { brain: null, hubspot: null, drive: null, slack: null });
ok(partial.every((r) => r.status === 'not_read'), 'a source left out is "not read", never "missing"');
const s = m.summarise(rows);
ok(s.by.hubspot_contact.ambiguous === 1 && s.sources.brain >= 1 && Object.keys(s.by).length === m.RESOURCES.length, 'the summary is counts per resource and status');

// CLI: refuses to write inside a git checkout; prints counts only
const files = { roster: path.join(tmp, 'roster.json'), hubspot: path.join(tmp, 'hubspot.json'), drive: path.join(tmp, 'drive.json'), slack: path.join(tmp, 'slack.json') };
fs.writeFileSync(files.roster, JSON.stringify(roster)); fs.writeFileSync(files.hubspot, JSON.stringify(hubspot));
fs.writeFileSync(files.drive, JSON.stringify(drive)); fs.writeFileSync(files.slack, JSON.stringify(slack));
const run = (out) => spawnSync('node', [path.join(ROOT, 'scripts', 'client-resource-match.js'), '--roster=' + files.roster, '--brain=' + brainDir, '--hubspot=' + files.hubspot, '--drive=' + files.drive, '--slack=' + files.slack, '--out=' + out], { encoding: 'utf8' });
const refused = run(path.join(ROOT, 'proposals-should-not-exist.json'));
ok(refused.status === 2 && !fs.existsSync(path.join(ROOT, 'proposals-should-not-exist.json')), 'the detail file is refused inside the repository');
const out = path.join(tmp, 'proposals.json');
const r = run(out);
ok(r.status === 0 && fs.existsSync(out) && JSON.parse(fs.readFileSync(out, 'utf8')).dry_run === true, 'the detail file is written outside the repository, marked dry run');
ok(!/Qxa|Qxb|Qxc|qxalphatest|C0FIXTURE01|F-qxb|example\.invalid/i.test(r.stdout) && /DRY RUN/.test(r.stdout), 'stdout is counts only: no name, slug, id or email');
const src2 = fs.readFileSync(path.join(ROOT, 'scripts', 'client-resource-match.js'), 'utf8');
ok(!/\bfetch\(|https?\.request|require\('https?'\)|supabase|\.rpc\(/.test(src2.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')), 'the script makes no network call and talks to no database');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('\nclient-resource-match: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
