#!/usr/bin/env node
// The Synchro connector's "studio_latest" tool: the newest Synchro video studio
// zip from the private "studio" bucket, as { version, download_url, notes },
// with every call logged in hf_studio_downloads. Offline: the bucket and the
// log are mocked.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

// A mock bucket: name -> text. sign() returns a fake signed link.
function store(files, opts = {}) {
  const logged = [];
  const signed = [];
  return {
    logged, signed,
    exists: async (name) => { if (opts.listFails) throw new Error('bucket down'); return Object.prototype.hasOwnProperty.call(files, name); },
    readText: async (name) => { if (!(name in files)) throw new Error('Object not found'); return files[name]; },
    sign: async (name, seconds) => {
      if (!(name in files)) throw new Error('Object not found');
      signed.push({ name, seconds });
      return `https://example.supabase.co/storage/v1/object/sign/studio/${name}?token=t`;
    },
    log: (row) => { if (opts.logThrows) throw new Error('log down'); logged.push(row); },
  };
}

(async () => {
  const s = await import(path.join(dir, 'studio.mjs'));
  const who = await import(path.join(dir, 'who.mjs'));

  // latest.json shapes.
  assert.deepStrictEqual(s.parseLatest('{"version":"1.2.0","file":"synchro-video-studio-1.2.0.zip","notes":" New presets "}'),
    { version: '1.2.0', file: 'synchro-video-studio-1.2.0.zip', notes: 'New presets' });
  assert.strictEqual(s.parseLatest('{"version":"1.2.0"}').file, 'synchro-video-studio-1.2.0.zip', 'file defaults from the version');
  assert.ok(s.parseLatest('not json').error);
  assert.ok(s.parseLatest('[]').error);
  assert.ok(s.parseLatest('{"version":"../x"}').error, 'a version cannot climb out of the bucket');
  assert.ok(s.parseLatest('{"version":"1.0","file":"other.zip"}').error, 'the file must be a studio zip');
  assert.ok(s.parseLatest('{"version":"1.0","file":"../synchro-video-studio-1.0.zip"}').error);
  assert.ok(s.parseLatest('{"version":"1.0","file":"old/synchro-video-studio-1.0.zip"}').error, 'top of the bucket only');
  assert.ok(s.parseLatest('{"version":"1.0","file":"synchro-video-studio-..zip"}').error, 'no ".." in the name');
  assert.ok(s.parseLatest('{"version":"1.0","file":"synchro-video-studio-1.0.zip.exe"}').error);
  // Exactly the latest.json uploaded to the live bucket on 2026-10-16: the file
  // name carries a "v" the version does not, and is used as given.
  const real = '{"version": "0.1", "file": "synchro-video-studio-v0.1.zip", "notes": "First release"}';
  assert.deepStrictEqual(s.parseLatest(real), { version: '0.1', file: 'synchro-video-studio-v0.1.zip', notes: 'First release' });

  // Happy path: the three fields, a 10-minute signed link, one log row with the version.
  const ok = store({ 'latest.json': '{"version":"1.2.0","file":"synchro-video-studio-1.2.0.zip","notes":"New presets"}', 'synchro-video-studio-1.2.0.zip': 'zip' });
  const out = await s.studioLatest(ok, { member: 'sidneylaruel', who: '' });
  const j = JSON.parse(out);
  assert.strictEqual(j.version, '1.2.0');
  assert.strictEqual(j.notes, 'New presets');
  assert.ok(/^https:\/\/.+synchro-video-studio-1\.2\.0\.zip/.test(j.download_url));
  assert.deepStrictEqual(ok.signed, [{ name: 'synchro-video-studio-1.2.0.zip', seconds: 600 }]);
  assert.deepStrictEqual(ok.logged, [{ member_name: 'sidneylaruel', who: null, version: '1.2.0', file: 'synchro-video-studio-1.2.0.zip' }]);
  assert.strictEqual(who.outcomeOf('studio_latest', out).ok, true);

  // The real upload end to end: the link is for the "v" file.
  const live = store({ 'latest.json': real, 'synchro-video-studio-v0.1.zip': 'zip' });
  const liveOut = JSON.parse(await s.studioLatest(live, { member: 'sidneylaruel', who: '' }));
  assert.deepStrictEqual([liveOut.version, liveOut.notes], ['0.1', 'First release']);
  assert.deepStrictEqual(live.signed, [{ name: 'synchro-video-studio-v0.1.zip', seconds: 600 }]);
  assert.strictEqual(live.logged[0].file, 'synchro-video-studio-v0.1.zip');

  // Team link: the first name is logged.
  const team = store({ 'latest.json': '{"version":"1.2.0"}', 'synchro-video-studio-1.2.0.zip': 'zip' });
  await s.studioLatest(team, { member: 'Team', who: 'Sam' });
  assert.strictEqual(team.logged[0].who, 'Sam');

  // Nothing uploaded yet: a clear answer, not a failure, and the call is still logged.
  const none = store({});
  const empty = await s.studioLatest(none, { member: 'sidneylaruel', who: '' });
  assert.strictEqual(empty, s.NO_VERSION);
  assert.ok(empty.startsWith('No studio version uploaded yet'));
  assert.strictEqual(who.outcomeOf('studio_latest', empty).ok, true);
  assert.deepStrictEqual(none.logged, [{ member_name: 'sidneylaruel', who: null, version: null, file: null }]);

  // Failures say so in words the activity log reads as failures, and give out no link.
  const cases = [
    store({}, { listFails: true }),
    store({ 'latest.json': '{oops' }),
    store({ 'latest.json': '{"version":"2.0.0"}' }), // zip missing from the bucket
  ];
  for (const c of cases) {
    const t = await s.studioLatest(c, { member: 'sidneylaruel', who: '' });
    assert.ok(t.startsWith('Could not'), t);
    assert.strictEqual(who.outcomeOf('studio_latest', t).ok, false);
    assert.ok(!/https:\/\//.test(t));
    assert.strictEqual(c.logged.length, 1);
    assert.strictEqual(c.logged[0].version, null, 'a failed call logs no version');
  }

  // A log that throws never breaks the answer.
  const noisy = store({ 'latest.json': '{"version":"1.2.0"}', 'synchro-video-studio-1.2.0.zip': 'zip' }, { logThrows: true });
  assert.strictEqual(JSON.parse(await s.studioLatest(noisy, { member: 'sidneylaruel', who: '' })).version, '1.2.0');

  // Wiring: offered, answered from the private bucket with a signed link, read only.
  const idx = read('index.ts');
  assert.ok(/import \{ STUDIO_BUCKET, studioLatest \} from "\.\/studio\.mjs";/.test(idx));
  assert.ok(/name: "studio_latest",/.test(idx), 'the tool is offered');
  assert.ok(/if \(name === "studio_latest"\) \{\n\s*return await studioLatest\(studioStore\(\), \{ member, who: isTeamLink\(member\) \? cleanWho\(args\.who\) : "" \}\);/.test(idx));
  assert.ok(/createSignedUrl\(name, seconds/.test(idx), 'a signed link, never a public one');
  assert.ok(!/getPublicUrl/.test(idx.slice(idx.indexOf('function studioStore'))), 'no public link for the studio');
  assert.ok(!/storage\.from\(STUDIO_BUCKET\)[^\n]*\.(upload|remove|move|copy|update)\(/.test(idx), 'the connector never writes the bucket');
  assert.ok(/from\("hf_studio_downloads"\)\.insert\(/.test(idx), 'logs each call');
  assert.strictEqual(s.STUDIO_BUCKET, 'studio');
  // Every tool name that existed before is still offered.
  for (const t of ['start_here', 'find_models', 'model_details', 'price_check', 'create', 'check_job', 'wait_for_job', 'check_jobs', 'recipes', 'recipe_plan', 'run_recipe', 'thumbnail_workflow', 'clients', 'client_filming_plan', 'client_style', 'client_brain', 'brain_change', 'import_file', 'get_upload_link', 'guide', 'team_usage', 'studio_latest', 'studio_profile', 'studio_profile_save', 'pipeline_pass', 'toolkit_latest', 'client_record', 'feedback_note', 'feedback_notes']) {
    assert.ok(idx.includes(`name: "${t}"`), `${t} is still offered`);
  }

  // The migration: names all four roles, the function gets exactly SELECT and INSERT, no browser grant.
  const mig = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261016180000_hf_studio_downloads.sql'), 'utf8');
  assert.ok(/revoke all on table public\.hf_studio_downloads from public, anon, authenticated, service_role;/.test(mig));
  assert.ok(/grant select, insert on table public\.hf_studio_downloads to service_role;/.test(mig));
  assert.ok(!/grant [^;]*to [^;]*(anon|authenticated|public)\b/i.test(mig), 'no browser grant');
  assert.ok(/enable row level security/.test(mig));
  assert.ok(/^-- ef-auto-deploy-applied-when: select to_regclass\('public\.hf_studio_downloads'\) is not null$/m.test(mig.split('\n').slice(0, 40).join('\n')),
    'the on-merge lane can tell when it is applied');

  console.log('higgsfield-studio-latest: version, signed link, notes, missing-version answer, failures, log, read-only wiring ✅');
})().catch((e) => { console.error(e); process.exit(1); });
