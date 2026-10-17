'use strict';
// client_brain's reply shape (brainview.mjs): the whole brain in full by
// default when it fits, else the brief plus each fact's first paragraph; one
// fact in full on request; named left-outs instead of a bare "[cut here]";
// history.md never read.
// Fictional client and text only; nothing touches the network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
  const view = await import(path.join(ROOT, 'supabase/functions/higgsfield-mcp/brainview.mjs'));
  const { parseBrainFacts } = await import(path.join(ROOT, 'supabase/functions/brain/parse.mjs'));
  const { brainView, BRAIN_MAX_CHARS, firstParagraph } = view;

  const fact = (file, slug, heading, body, status = 'written') =>
    `## ${heading}\n<!-- brain\nid:      client.fixture.${file}.${slug}\nowner:   test\nstatus:  ${status}\nsource:  test\nupdated: 2026-10-17\n-->\n\n${body}\n`;
  const voice = '# Fixture: voice\n\n' +
    fact('voice', 'caption-style', 'Caption style', 'Short lines, no emojis.\n\nEarlier notes: in March 2026 longer captions were tried and dropped.') +
    fact('voice', 'tone', 'Tone', 'Warm and plain.') +
    fact('voice', 'empty', 'Not yet', '', 'not-written');
  const editing = '# Fixture: editing\n\n' +
    fact('editing', 'subtitle-spec', 'Subtitles', 'Two words at a time:\n\n- white\n- bold\n\nOlder: yellow subtitles until 2026-05.') +
    fact('editing', 'music', 'Music', 'Soft piano only.') +
    fact('editing', 'music-dated', 'Music (call, 2026-10-13)', 'No drums on hooks.');
  const relationship = '# Fixture: relationship\n\n' +
    fact('relationship', 'history', 'History', 'Signed in 2025 after a referral.');
  const brief = '# Brief\n\n## Look\n- Calm, natural light. <!-- fact: client.fixture.editing.subtitle-spec -->\n\n## Voice\n- Plain words.\n';
  const facts = [...parseBrainFacts(voice, 'voice'), ...parseBrainFacts(editing, 'editing'), ...parseBrainFacts(relationship, 'relationship')].filter((f) => f.status === 'written' && f.body);

  // 1a. Default, under the budget: the whole brain, every fact in full, nothing marked "more" or left out.
  const out = brainView({ name: 'Fixture Client', brief, facts });
  assert.ok(out.length <= BRAIN_MAX_CHARS, 'the fixture fits the budget');
  assert.ok(out.startsWith('Fixture Client, from the Synchro Brain: the brief and every written fact, in full.'), 'opens with the client name and says it is the whole brain');
  assert.ok(out.includes('## Look\n- Calm, natural light.'), 'the brief, Look section included, is sent in full');
  assert.ok(!out.includes('<!--'), 'no comment markup leaks');
  assert.ok(out.includes('### Caption style (voice; fact id: client.fixture.voice.caption-style)\nShort lines, no emojis.\n\nEarlier notes: in March 2026 longer captions were tried and dropped.'), 'Caption style is whole');
  assert.ok(out.includes('Older: yellow subtitles until 2026-05.'), 'Subtitles is whole, later paragraphs included');
  for (const f of facts) assert.ok(out.includes(`fact id: ${f.id})\n${f.body}`), `${f.id} is sent in full`);
  assert.ok(!out.includes('; more)'), 'nothing is marked "more" when the whole brain is sent');
  assert.ok(!out.includes('Not yet'), 'not-written facts are not sent');
  assert.ok(!out.includes('[cut here]') && !out.includes('Left out for length'), 'nothing left out when it fits');

  // 1b. Default, over the budget: the brief in full plus each fact's first paragraph, "more" on longer facts.
  const filler = [];
  for (let i = 0; i < 30; i++) filler.push({ file: 'audience', heading: `Filler ${i}`, id: `client.fixture.audience.filler-${i}`, body: `Filler ${i} opener.\n\n` + 'detail '.repeat(400).trim(), sure: '' });
  const over = brainView({ name: 'Fixture Client', brief, facts: [...facts, ...filler] });
  assert.ok(over.length <= BRAIN_MAX_CHARS, `the first-paragraph shape stays within the budget (${over.length})`);
  assert.ok(over.startsWith('Fixture Client, from the Synchro Brain. The whole brain is too long for one answer'), 'says why it is shortened');
  assert.ok(over.includes('## Look\n- Calm, natural light.'), 'the brief is still in full');
  assert.ok(over.includes('### Caption style (voice; fact id: client.fixture.voice.caption-style; more)\nShort lines, no emojis.'), 'Caption style shows its first paragraph and is marked more');
  assert.ok(!over.includes('longer captions were tried'), 'the rest of a fact stays out');
  assert.ok(over.includes('### Tone (voice; fact id: client.fixture.voice.tone)\nWarm and plain.'), 'a one-paragraph fact is whole, no "more"');
  assert.ok(over.includes('Two words at a time:\n\n- white\n- bold') && !over.includes('yellow subtitles'), 'a paragraph ending in ":" brings its list along');
  assert.ok(over.includes('fact id: client.fixture.audience.filler-29; more)\nFiller 29 opener.') && !over.includes('detail detail'), 'every filler shows only its opener');
  assert.ok(/call client_brain again with topic/.test(over), 'the shortened shape says how to ask for more');

  // 2. One fact in full, by id, id ending, heading or file name.
  const full = brainView({ name: 'Fixture Client', brief, facts, topic: 'client.fixture.voice.caption-style' });
  assert.ok(full.includes('Short lines, no emojis.\n\nEarlier notes: in March 2026 longer captions were tried and dropped.'), 'by id: the whole fact');
  assert.ok(!full.includes('Warm and plain.'), 'by id: only that fact');
  assert.ok(brainView({ name: 'F', brief, facts, topic: 'editing.subtitle-spec' }).includes('yellow subtitles until 2026-05'), 'by id ending, e.g. editing.subtitle-spec');
  assert.ok(brainView({ name: 'F', brief, facts, topic: 'Caption style' }).includes('Earlier notes: in March 2026'), 'by heading: Caption style');
  const music = brainView({ name: 'F', brief, facts, topic: 'music' });
  assert.ok(music.includes('Soft piano only.') && music.includes('No drums on hooks.') && !music.includes('Warm and plain.'), 'heading words gather every matching fact');
  const look = brainView({ name: 'F', brief, facts, topic: 'Look' });
  assert.ok(look.includes('## Look\n- Calm, natural light.'), "the brief's Look section is reachable by name");
  const file = brainView({ name: 'F', brief, facts, topic: 'editing.md' });
  assert.ok(file.includes('yellow subtitles') && file.includes('No drums on hooks.') && !file.includes('Warm and plain.'), 'a file name gives that file in full');
  // Topic "History" is the relationship History fact (history.md itself is never read).
  const hist = brainView({ name: 'F', brief, facts, topic: 'History' });
  assert.ok(hist.includes('### History (relationship; fact id: client.fixture.relationship.history)\nSigned in 2025 after a referral.'), 'topic "History" returns the relationship History fact');
  // Heading words match the heading and the fact's own name, never the client part of the id.
  assert.ok(/no fact matches "fixture"/.test(brainView({ name: 'F', brief, facts, topic: 'fixture' })), 'the client folder name matches no fact');
  const sub = brainView({ name: 'F', brief, facts, topic: 'subtitle spec' });
  assert.ok(sub.includes('Two words at a time') && !sub.includes('Warm and plain.'), "a fact's own name in its id still matches");
  const musicFolder = facts.map((f) => ({ ...f, id: f.id.replace('client.fixture.', 'client.music.') }));
  const mf = brainView({ name: 'F', brief, facts: musicFolder, topic: 'music' });
  assert.ok(mf.includes('Soft piano only.') && mf.includes('No drums on hooks.') && !mf.includes('Warm and plain.') && !mf.includes('Short lines'), 'a folder named like a topic does not pull in every fact');
  const miss = brainView({ name: 'F', brief, facts, topic: 'zebra' });
  assert.ok(/no fact matches "zebra"/.test(miss) && miss.includes('client.fixture.voice.tone'), 'a miss lists the facts to choose from');

  // 3. Too long: whole facts are left out, each named by file and id, with how to ask; never "[cut here]".
  const big = [];
  for (let i = 0; i < 80; i++) big.push({ file: i < 40 ? 'editing' : 'audience', heading: `Topic ${i}`, id: `client.fixture.x.t${i}`, body: 'word '.repeat(300).trim() + '\n\nmore', sure: '' });
  const long = brainView({ name: 'F', brief, facts: big });
  assert.ok(long.length <= BRAIN_MAX_CHARS, `stays within the budget (${long.length})`);
  assert.ok(!long.includes('[cut here]'), 'no bare cut marker');
  const tail = long.split('# Left out for length')[1];
  assert.ok(tail, 'names what was left out');
  assert.ok(/topic set to its fact id/.test(tail), 'says how to ask for a left-out fact');
  assert.ok(/audience\.md \(\d+\): [^\n]*client\.fixture\.x\.t79/.test(tail), 'names the file, count and fact ids');
  assert.ok(long.includes('fact id: client.fixture.x.t0; more)\n' + 'word '.repeat(300).trim()) && !long.includes('word\n\nmore'), 'sent facts show their first paragraph only');
  for (const f of big) assert.ok(long.includes(`fact id: ${f.id}`) || tail.includes(f.id), `${f.id} is either sent or named`);
  // Even a thousand left-out facts keep the reply within budget: the list falls back to per-file counts.
  const many = [];
  for (let i = 0; i < 1000; i++) many.push({ file: 'editing', heading: `Topic ${i}`, id: `client.fixture.editing.a-rather-long-fact-id-number-${i}`, body: 'word '.repeat(300).trim(), sure: '' });
  for (const topic of ['', 'topic']) {
    const o = brainView({ name: 'F', brief, facts: many, topic });
    assert.ok(o.length <= BRAIN_MAX_CHARS, `a thousand facts (topic "${topic}") stay within budget (${o.length})`);
    assert.ok(/editing\.md: \d+ facts \(too many to list; ask with the file name/.test(o), 'an over-long left-out list becomes per-file counts');
  }
  const huge = brainView({ name: 'F', brief, facts: [{ file: 'voice', heading: 'Huge', id: 'client.fixture.voice.huge', body: 'x '.repeat(40000) }], topic: 'huge' });
  assert.ok(huge.length <= BRAIN_MAX_CHARS && /the rest of client\.fixture\.voice\.huge was not sent/.test(huge), 'a single fact too long for one answer says so by id');
  assert.strictEqual(firstParagraph('a'.repeat(5000)).more, true, 'a giant first paragraph is shortened and marked');

  // 3b. focus.md: in the head, before the brief, always whole (even when the rest is shortened), and searchable by topic.
  const focusMd = '# Fixture: focus\n\n' + fact('focus', 'current', 'Current focus', 'Sleep series this month.\n\nDetail: three videos, then a recap.');
  const focus = parseBrainFacts(focusMd, 'focus').filter((f) => f.status === 'written' && f.body);
  const fOut = brainView({ name: 'F', brief, focus, facts });
  assert.ok(fOut.indexOf('# Current focus') > 0 && fOut.indexOf('# Current focus') < fOut.indexOf('# Brief'), 'focus comes before the brief');
  assert.ok(fOut.includes('Sleep series this month.\n\nDetail: three videos, then a recap.'), 'focus is whole when the brain fits');
  const fOver = brainView({ name: 'F', brief, focus, facts: [...facts, ...filler] });
  assert.ok(fOver.length <= BRAIN_MAX_CHARS && /too long for one answer/.test(fOver), 'with the brain over budget the shortened shape is used');
  assert.ok(fOver.indexOf('# Current focus') < fOver.indexOf('# Brief') && fOver.includes('Detail: three videos, then a recap.') && !fOver.includes('; more)\nSleep'), 'focus stays whole and first, never shortened');
  const fLong = brainView({ name: 'F', brief, focus, facts: big });
  assert.ok(fLong.includes('Detail: three videos, then a recap.') && !fLong.split('# Left out for length')[1].includes('focus.current'), 'focus is never left out, even when facts are');
  assert.ok(!brainView({ name: 'F', brief, facts }).includes('# Current focus'), 'no focus.md, no focus section');
  assert.ok(brainView({ name: 'F', brief, focus, facts, topic: 'focus' }).includes('Detail: three videos') && brainView({ name: 'F', brief, focus, facts, topic: 'focus' }).includes('every written fact in focus.md'), 'topic "focus" gives focus.md in full');
  assert.ok(brainView({ name: 'F', brief, focus, facts, topic: 'client.fixture.focus.current' }).includes('Detail: three videos'), 'a focus fact by id');
  assert.ok(/no written brief or facts/.test(brainView({ name: 'F', brief: '', facts: [] })) && !/no written brief or facts/.test(brainView({ name: 'F', brief: '', focus, facts: [] })), 'focus alone counts as a written brain');

  // 4. history.md is never read: the read list is fixed.
  const info = read('supabase/functions/higgsfield-mcp/clientinfo.ts');
  const code = (s) => s.replace(/\/\/.*$/gm, '');
  const brainPart = code(info.slice(info.indexOf('export async function clientBrain'), info.indexOf('export async function brainChange')));
  assert.ok(/Promise\.all\(\[read\("brief"\), read\("audience"\), read\("focus"\), \.\.\.BRAIN_FILES\.map\(read\)\]\)/.test(brainPart), 'client_brain reads brief, audience, focus and the fixed list only');
  assert.ok(/brainView\(\{ name: p\.client_name, brief, focus: focusFacts, facts, topic \}\)/.test(brainPart), 'focus facts are passed to brainView on their own');
  assert.ok(!/history/i.test(code(info)), 'clientinfo.ts code never names history.md');
  assert.ok(!/history/i.test(code(read('supabase/functions/higgsfield-mcp/brainview.mjs'))), 'brainview.mjs never reads history');
  assert.ok(!/contents\/clients\/\$\{where\.folder\}\/\$\{file\}/.test(brainPart.replace(/read = async \(file: string\) => \{[\s\S]*?\};/, '')), 'no other file read in client_brain');

  // The tool tells Claude how to ask for more, and passes the topic through.
  const idx = read('supabase/functions/higgsfield-mcp/index.ts');
  const def = idx.slice(idx.indexOf('name: "client_brain"'), idx.indexOf('name: "brain_change"'));
  assert.ok(/When you need more on a topic/.test(def) && /topic: \{ type: "string"/.test(def), 'description and schema offer topic');
  assert.ok(/clientBrain\(db\(\), String\(args\.client \|\| ""\), String\(args\.topic \|\| ""\)(, askerFor\(member, args\.who\))?\)/.test(idx), 'topic is passed to clientBrain');

  console.log('higgsfield-client-brain: whole brain when it fits, else first paragraphs, one fact in full, named left-outs, history.md never read ✅');
})().catch((e) => { console.error(e); process.exit(1); });
