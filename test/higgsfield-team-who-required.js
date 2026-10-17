'use strict';
/*
 * On the shared team link, the two tools that save to a client's brain
 * (brain_change and studio_profile_save) refuse when "who" (the person's first
 * name) is missing, so no save is signed only "Team". Nothing is written on a
 * refusal. Personal links and every other tool are unchanged.
 *
 * Also: the guide topic "broll" finds the "b-roll" guide (a call for "broll"
 * failed on 2026-10-16), as do "b roll" and "B-Roll".
 *
 * The connector runs under Deno, so the logic lives in who.mjs and guides.mjs
 * (run here for real) and index.ts is checked for the wiring.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

(async () => {
  const who = await import(path.join(dir, 'who.mjs'));
  assert.strictEqual(typeof who.whoRefusal, 'function', 'who.mjs exports whoRefusal');

  // Team link, a save tool, no usable name: refused with the plain ask.
  for (const tool of ['brain_change', 'studio_profile_save']) {
    for (const missing of [undefined, null, '', '   ', 42, '1234', '<>']) {
      const r = who.whoRefusal('Team', tool, missing);
      assert.ok(r.startsWith('Tell me your first name first, so the team knows who saved this. Then I\'ll save it.'), `${tool} without who (${JSON.stringify(missing)}) is refused`);
      assert.ok(/Nothing was saved/.test(r));
      assert.strictEqual(who.outcomeOf(tool, r).ok, false, 'the activity log records the refusal as a failure');
    }
    // With a name: allowed, and signed "<name> (team)".
    assert.strictEqual(who.whoRefusal('Team', tool, 'Maria'), '');
    assert.strictEqual(who.authorFor('Team', 'Maria'), 'Maria (team)');
    // Personal links never need "who".
    assert.strictEqual(who.whoRefusal('Pat', tool, undefined), '');
    assert.strictEqual(who.whoRefusal('Pat', tool, ''), '');
    assert.strictEqual(who.whoRefusal('team', tool, undefined), '', 'only the exact member name "Team" is the team link');
  }
  // Every other tool on the team link keeps working without "who".
  for (const tool of ['client_brain', 'guide', 'start_here', 'create', 'price_check', 'feedback_note', 'studio_profile']) {
    assert.strictEqual(who.whoRefusal('Team', tool, undefined), '', `${tool} works without who`);
  }
  assert.ok(/brain_change and studio_profile_save refuse to save without it/.test(who.TEAM_START_NOTE), 'start_here on the team link says so');

  // Wiring in index.ts: the check runs before ANY tool handler, so a refused
  // call never reaches brainChange or studioProfileSave (nothing is written).
  const idx = read('index.ts');
  assert.ok(/import \{[^}]*\bwhoRefusal\b[^}]*\} from "\.\/who\.mjs";/.test(idx), 'index.ts imports whoRefusal');
  const check = idx.indexOf('const refusal = whoRefusal(member, name, args.who);\n  if (refusal) return refusal;');
  assert.ok(check > 0, 'the refusal is returned before the handler runs');
  const firstHandler = idx.indexOf('if (name === "start_here")');
  const brainSave = idx.indexOf('if (name === "brain_change") return await brainChange(');
  const profileSave = idx.indexOf('if (name === "studio_profile_save") return await studioProfileSave(');
  assert.ok(firstHandler > 0 && brainSave > 0 && profileSave > 0);
  assert.ok(check < firstHandler && check < brainSave && check < profileSave, 'the check sits before every handler, so nothing is read or written on a refusal');
  assert.strictEqual(idx.split('brainChange(db()').length - 1, 1, 'brain_change saves through exactly one call');
  assert.strictEqual(idx.split('studioProfileSave(db()').length - 1, 1, 'studio_profile_save saves through exactly one call');

  // The two tools tell Claude to pass "who", on the team link's tool list only.
  const tools = [
    { name: 'brain_change', description: 'Save to the brain.' },
    { name: 'studio_profile_save', description: 'Save a profile.' },
    { name: 'client_brain', description: 'Read the brain.' },
  ];
  const team = who.teamTools(tools, 'Team');
  assert.ok(team[0].description.startsWith('Save to the brain. This is the shared team link: always pass "who"'));
  assert.ok(team[1].description.startsWith('Save a profile. This is the shared team link: always pass "who"'));
  assert.strictEqual(team[2], tools[2], 'other tools are untouched');
  assert.strictEqual(tools[0].description, 'Save to the brain.', 'the shared list itself is never changed');
  assert.strictEqual(who.teamTools(tools, 'Pat'), tools, 'personal links get the descriptions unchanged');
  assert.ok(/if \(method === "tools\/list"\) return reply\(\{ jsonrpc: "2\.0", id, result: \{ tools: teamTools\(TOOLS, member\) \} \}\);/.test(idx), 'tools/list serves the per-link list');

  // Guide topics: "broll", "b roll", "B-Roll" and the existing "b-roll" all
  // reach the b-roll guide.
  const g = await import(path.join(dir, 'guides.mjs'));
  const rows = [
    { topic: 'b-roll', body: '# B-roll\nPhoto first, then video.', created_at: '2026-10-15T20:00:00Z' },
    { topic: 'video-studio', body: '# Video studio', created_at: '2026-10-16T20:00:00Z' },
    { topic: 'brain', body: '# Client brain', created_at: '2026-10-15T20:00:00Z' },
  ];
  for (const ask of ['b-roll', 'broll', 'BROLL', 'b roll', '  B   Roll ', 'B-Roll', 'b_roll', 'b - roll']) {
    const r = g.guideReply(rows, ask);
    assert.ok(r.startsWith('# B-roll\nPhoto first, then video.'), `"${ask}" finds the b-roll guide, got: ${r.slice(0, 60)}`);
  }
  assert.ok(g.guideReply(rows, 'videostudio').startsWith('# Video studio'), 'the same rule works for any dashed topic');
  assert.ok(g.guideReply(rows, 'nope').startsWith('No guide called "nope"'), 'an unknown topic is still unknown');
  // An ambiguous squashed match picks nothing rather than guessing.
  const twins = [...rows, { topic: 'br-oll', body: 'other', created_at: '2026-10-15T20:00:00Z' }];
  assert.ok(g.guideReply(twins, 'broll').startsWith('No guide called'), 'two squashed matches: no guess');
  assert.ok(g.guideReply(twins, 'b-roll').startsWith('# B-roll'), 'the exact topic still wins');

  console.log('higgsfield-team-who-required: team-link saves need a name, other tools and personal links unchanged, "broll" finds b-roll ✅');
})().catch((e) => { console.error(e); process.exit(1); });
