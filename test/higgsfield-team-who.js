'use strict';
/*
 * The Higgsfield connector's shared team link, its name and its icon.
 *
 * The team link is the one hf_team_members row named "Team". On it,
 * brain_change and create take an optional "who" (a first name) and record
 * "<who> (team)"; without it, "Team". Personal links ignore "who" and keep
 * their own name. The connector reports itself as "synchro" with a Synchro
 * icon. The connector runs under Deno, so the logic lives in who.mjs (run
 * here for real) and index.ts is checked for the wiring.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

(async () => {
  const who = await import(path.join(dir, 'who.mjs'));

  // Team link: "who" makes "<who> (team)"; missing or empty stays "Team".
  assert.strictEqual(who.authorFor('Team', 'Maria'), 'Maria (team)');
  assert.strictEqual(who.authorFor('Team', '  Ana  Lucía '), 'Ana Lucía (team)');
  assert.strictEqual(who.authorFor('Team', undefined), 'Team');
  assert.strictEqual(who.authorFor('Team', ''), 'Team');
  assert.strictEqual(who.authorFor('Team', '   '), 'Team');
  assert.strictEqual(who.authorFor('Team', 42), 'Team');
  // Nothing but a first name gets through (no line breaks, symbols or digits).
  assert.strictEqual(who.authorFor('Team', 'Eve\nSidney (owner)'), 'EveSidney owner (team)');
  assert.strictEqual(who.authorFor('Team', '<b>9</b>'), 'bb (team)');
  assert.strictEqual(who.authorFor('Team', '1234'), 'Team');
  assert.ok(who.authorFor('Team', 'x'.repeat(500)).length <= 40 + ' (team)'.length);

  // Personal links are unchanged: they ignore "who" entirely.
  assert.strictEqual(who.authorFor('Pat', 'Maria'), 'Pat');
  assert.strictEqual(who.authorFor('Pat', undefined), 'Pat');
  assert.strictEqual(who.authorFor('team', 'Maria'), 'team', 'the match is the exact member name "Team"');
  assert.strictEqual(who.authorFor('Maria (team)', 'Sam'), 'Maria (team)');
  assert.strictEqual(who.isTeamLink('Team'), true);
  assert.strictEqual(who.isTeamLink('Pat'), false);

  // The name and the icon in the initialize reply.
  assert.strictEqual(who.SERVER_INFO.name, 'synchro');
  // Icons belong to protocol 2025-11-25, so the server must be able to speak it.
  const protocols = JSON.parse(read('index.ts').match(/const PROTOCOLS = (\[[^\]]*\])/)[1]);
  assert.ok(protocols.includes('2025-11-25'), 'the server lists protocol 2025-11-25');
  assert.strictEqual(protocols[0], '2025-11-25', 'the newest version is the fallback for unknown asks');
  assert.ok(protocols.includes('2025-06-18') && protocols.includes('2024-11-05'), 'older clients still work');
  assert.ok(Array.isArray(who.SERVER_INFO.icons) && who.SERVER_INFO.icons.length === 1);
  const icon = who.SERVER_INFO.icons[0];
  assert.ok(/^https:\/\/synchrosocial\.com\/[\w./-]+\.(png|svg)$/.test(icon.src), 'a public https PNG or SVG on the agency site');
  assert.ok(/^image\/(png|svg\+xml)$/.test(icon.mimeType));

  const idx = read('index.ts');
  // initialize hands out exactly that serverInfo; the old name is gone.
  assert.ok(/result: \{[\s\S]*?serverInfo: SERVER_INFO,/.test(idx), 'the initialize reply carries SERVER_INFO (name and icons)');
  assert.ok(!/synchro-higgsfield/.test(idx), 'the old connector name is gone from index.ts');
  // The viewer's ids are deliberately untouched (Claude caches them).
  assert.ok(/ui:\/\/synchro-higgsfield\/preview\.html/.test(read('viewer.ts')), 'VIEWER_URI is unchanged');

  // "who" is an optional input of exactly brain_change and create.
  const tools = idx.slice(idx.indexOf('const TOOLS = ['), idx.indexOf('// ---- Input validation'));
  const block = (name) => tools.slice(tools.indexOf(`name: "${name}"`), tools.indexOf('\n  },', tools.indexOf(`name: "${name}"`)));
  for (const t of ['create', 'brain_change', 'run_recipe']) {
    assert.ok(/who: WHO_ARG/.test(block(t)), t + ' accepts "who"');
    assert.ok(!/required: \[[^\]]*"who"/.test(block(t)), '"who" is optional on ' + t);
  }
  assert.strictEqual((tools.match(/who: WHO_ARG/g) || []).length, 3, 'no other tool takes "who"');

  // The recorded author is the one authorFor gives, for both tools.
  assert.ok(/const author = authorFor\(member, args\.who\);/.test(idx));
  assert.ok(/submitJob\(author, id, inputs, est\.usd, cap\)/.test(idx), 'create records the author');
  assert.ok(/submitJob\(author, model, recipe\.build\(/.test(idx), 'run_recipe records the author');
  assert.ok(!/submitJob\(member,/.test(idx), 'no job is recorded under the bare link name');
  assert.ok(/name === "brain_change"\) return await brainChange\(.*, author\);/.test(idx), 'brain_change records the author');

  // start_here: the ask-for-a-name note appears on the team link only.
  const start = idx.slice(idx.indexOf('if (name === "start_here")'), idx.indexOf('if (name === "find_models")'));
  assert.ok(/isTeamLink\(member\) \? `\\n\\n\$\{TEAM_START_NOTE\}` : ""/.test(start), 'only the team link gets the note');
  assert.ok(/first name once/.test(who.TEAM_START_NOTE) && /"who"/.test(who.TEAM_START_NOTE) && /brain_change, create and run_recipe/.test(who.TEAM_START_NOTE));
  assert.ok(!/first name|"who"|team link/.test(start.replace(/isTeamLink\(member\)[^\n]*TEAM_START_NOTE[^\n]*/, '')), 'nothing about it elsewhere in start_here');
  // The tool texts every link sees say nothing about the team link.
  assert.ok(!/team link/i.test(tools), 'tool descriptions do not mention the team link');

  console.log('higgsfield-team-who: "who" on the team link vs personal links, the "synchro" name and its icon ✅');
})().catch((e) => { console.error(e); process.exit(1); });
