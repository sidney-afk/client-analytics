#!/usr/bin/env node
// The Synchro connector's studio_profile and studio_profile_save: a client's
// video look as one JSON in the Synchro Brain (clients/<folder>/video-profile.json),
// saved through the same shared change path brain_change uses. Offline: GitHub
// is faked, and only the test client sidneylaruel appears.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

(async () => {
  const p = await import(path.join(dir, 'profile.mjs'));
  const { recordChange, MAX_CHANGE_CHARS } = await import(path.join(root, 'supabase', 'functions', 'brain', 'change.mjs'));
  const who = await import(path.join(dir, 'who.mjs'));

  const full = {
    colours: { accent: '#d4a373', bg: '#111111', paper: '#faf7f2', grey: '#8a8a8a' },
    fonts: { main: 'Cardo', accent: 'Nord', subtitles: 'Cardo' },
    subtitles: { style: 'white, no box, word by word', position: 'between face and mic' },
    hook_style: 'black text in a white box above the head',
    music: 'soft instrumental, never over the voice',
    avoid: ['stock music', 'heavy zooms'],
    preferred_style: 'calm and clean',
    handle: '@sidneylaruel',
    platform: ['instagram', 'tiktok'],
    cta_style: 'spoken, last 3 seconds',
    camera: 'one camera, chest up',
    notes: 'test client fixture',
    lut: 'warm-01', // an unknown field: kept
  };

  // Shape checks: a full profile passes; wrong types, money and secrets are refused.
  assert.deepStrictEqual(p.profileProblems(full), []);
  assert.deepStrictEqual(p.profileProblems({ notes: 'only this' }), [], 'a partial profile is fine');
  assert.ok(p.profileProblems('x')[0].startsWith('The profile must be a JSON object'));
  assert.ok(p.profileProblems([]).length);
  assert.ok(p.profileProblems({ colours: '#fff' }).some((x) => x.startsWith('colours must be an object')));
  assert.ok(p.profileProblems({ fonts: { main: { nested: 1 } } }).some((x) => x.includes('fonts.main must be text')));
  assert.ok(p.profileProblems({ music: 3 }).some((x) => x.startsWith('music must be text')));
  assert.ok(p.profileProblems({ avoid: [1] }).some((x) => x.startsWith('avoid must be a list of text')));
  assert.ok(p.profileProblems({ notes: 'retainer is $500' }).some((x) => x.includes('mentions money')));
  assert.ok(p.profileProblems({ notes: 'api key: abc' }).some((x) => x.includes('password or key')));
  assert.ok(p.profileProblems({ notes: 'x'.repeat(601) }).some((x) => x.includes('longer than 600')));
  assert.ok(p.profileProblems({ 'bad/key': 'x' }).some((x) => x.includes('not a usable field name')));
  assert.ok(p.profileProblems({ a: { b: { c: { d: { e: 'deep' } } } } }).some((x) => x.includes('nested too deep')));
  assert.deepStrictEqual(p.profileProblems({ music: null }), [], 'null is how a field is removed');
  // The refusal is read as a failure by the activity log.
  assert.strictEqual(who.outcomeOf('studio_profile_save', 'Fix these before saving:\n- x').ok, false);

  // Merge: objects key by key, lists and text replace, null removes, unknown fields kept,
  // and the connector's own stamps cannot be set by the caller.
  const merged = p.mergeProfile(full, { colours: { accent: '#ff0000' }, avoid: 'jump cuts', music: null, extra: { a: 1 }, updated_by: 'forged' });
  assert.deepStrictEqual(merged.colours, { accent: '#ff0000', bg: '#111111', paper: '#faf7f2', grey: '#8a8a8a' });
  assert.deepStrictEqual(merged.avoid, ['jump cuts']);
  assert.ok(!('music' in merged));
  assert.strictEqual(merged.lut, 'warm-01');
  assert.deepStrictEqual(merged.extra, { a: 1 });
  assert.ok(!('updated_by' in merged));
  assert.deepStrictEqual(p.mergeProfile(undefined, { notes: 'n' }), { notes: 'n' });

  // Stamp: schema first, known fields in order, unknown after, then who and when.
  const stamped = p.stampProfile(merged, 'sidneylaruel', '2026-10-16T12:00:00.000Z');
  const keys = Object.keys(stamped);
  assert.strictEqual(keys[0], 'schema');
  assert.strictEqual(stamped.schema, 1);
  assert.deepStrictEqual(keys.slice(-2), ['updated_by', 'updated_at']);
  assert.ok(keys.indexOf('colours') < keys.indexOf('lut'));
  assert.strictEqual(stamped.updated_by, 'sidneylaruel');
  assert.ok(p.profileJson(stamped).endsWith('}\n'));

  // The filed change: the marker, the exact target file, the whole JSON, nothing about the Look.
  const text = p.profileChangeText('sidneylaruel', stamped);
  assert.ok(text.startsWith('VIDEO PROFILE\n'));
  assert.ok(text.includes('clients/sidneylaruel/video-profile.json'));
  assert.ok(text.includes('do not change any .md file, the brief or the Look facts'));
  const body = /```json\n([\s\S]*?)\n```/.exec(text)[1];
  assert.deepStrictEqual(JSON.parse(body), stamped, 'the JSON in the change is exactly the profile');
  assert.strictEqual(p.profileFactId('sidneylaruel'), 'client.sidneylaruel.video-profile');

  // Filed through the SAME shared module as brain_change, so it lands in
  // inputs/syncview-changes/ with who sent it, and the brain workflow processes it.
  const calls = [];
  const gh = async (route, init) => { calls.push({ route, init }); return { ok: true, status: 201 }; };
  const out = await recordChange({
    slug: 'sidneylaruel', text, factId: p.profileFactId('sidneylaruel'), heading: 'Video profile',
    from: 'sidneylaruel via Claude connector', role: 'Claude connector', folders: ['sidneylaruel'], gh, branch: 'main',
  });
  assert.strictEqual(out.ok, true);
  assert.ok(/^inputs\/syncview-changes\/\d{4}-\d{2}-\d{2}-sidneylaruel-[0-9a-f]{8}\.md$/.test(out.path));
  const md = Buffer.from(JSON.parse(calls[0].init.body).content, 'base64').toString('utf8');
  for (const line of ['- fact id: client.sidneylaruel.video-profile', '- fact heading: Video profile',
    '- sent by (as typed): sidneylaruel via Claude connector', '## What they sent, word for word', 'VIDEO PROFILE']) {
    assert.ok(md.includes(line), `change file has: ${line}`);
  }
  // The largest profile the connector allows still fits the brain's change limit.
  const biggest = { notes: 'x'.repeat(p.PROFILE_MAX_CHARS - 20) };
  assert.ok(p.profileJson(biggest).length <= p.PROFILE_MAX_CHARS);
  assert.ok(p.profileChangeText('a-forty-character-client-folder-name-xx', biggest).length <= MAX_CHANGE_CHARS);

  // Replies.
  const shown = p.profileReply('Test Client', p.profileJson(stamped));
  assert.ok(shown.startsWith('Test Client, video profile from the Synchro Brain') && shown.includes('"accent": "#ff0000"'));
  const broken = p.profileReply('Test Client', '{oops');
  assert.ok(broken.startsWith('Could not read'));
  const draft = p.draftReply('Test Client', ['Subtitles: white, no box.'], [{ heading: 'Subtitle spec', spec: 'font=Cardo; main=#ffffff' }]);
  assert.ok(draft.startsWith('Test Client has no video profile yet.'));
  assert.ok(draft.includes("From the brief's Look section:\n- Subtitles: white, no box."));
  assert.ok(draft.includes('- Subtitle spec: font=Cardo; main=#ffffff'));
  assert.ok(draft.includes('- colours:') && draft.includes('studio_profile_save only after they agree'));
  assert.strictEqual(who.outcomeOf('studio_profile', draft).ok, true, 'no profile yet is an answer, not a failure');
  assert.ok(p.draftReply('Test Client', [], []).includes('no Look notes'));

  // Wiring in the connector.
  const idx = read('index.ts');
  const ci = read('studioprofile.ts');
  assert.ok(/name: "studio_profile",/.test(idx) && /name: "studio_profile_save",/.test(idx));
  assert.ok(/if \(name === "studio_profile"\) return await studioProfile\(db\(\), String\(args\.client \|\| ""\)\);/.test(idx));
  assert.ok(/if \(name === "studio_profile_save"\) return await studioProfileSave\(db\(\), String\(args\.client \|\| ""\), args\.profile, args\.replace === true, author\);/.test(idx),
    'the save is signed with the same author brain_change uses');
  // Reads the one profile file; saves only through recordChange; never writes a client file directly.
  assert.ok(/contents\/clients\/\$\{folder\}\/\$\{PROFILE_FILE\}\?ref=/.test(ci));
  const saveFn = ci.slice(ci.indexOf('export async function studioProfileSave'));
  assert.ok(/await recordChange\(\{/.test(saveFn), 'saved through the shared change path');
  assert.ok(!/method: "PUT"/.test(ci), 'studioprofile.ts never PUTs a brain file itself');
  assert.ok(/text: profileChangeText\(where\.folder, stamped\)/.test(saveFn));
  assert.ok(/if \(!where\.folder\) return `Could not save:/.test(saveFn), 'no unmatched profile files');
  // The draft reads brief.md and editing.md only (never money.md).
  const viewFn = ci.slice(ci.indexOf('export async function studioProfile('), ci.indexOf('export async function studioProfileSave'));
  assert.ok(/read\("brief"\), read\("editing"\)/.test(viewFn));
  assert.ok(!/money/.test(viewFn));
  // Existing tools are still offered.
  for (const t of ['client_brain', 'brain_change', 'recipes', 'guide', 'create', 'studio_latest', 'team_usage']) assert.ok(idx.includes(`name: "${t}"`), `${t} is still offered`);

  console.log('higgsfield-studio-profile: permissive schema, merge, money and key refusal, filed through the brain change path, draft from the Look ✅');
})().catch((e) => { console.error(e); process.exit(1); });
