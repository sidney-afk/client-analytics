'use strict';
// client_brain's reply shape (brainview.mjs): the brief plus each fact's
// current answer by default, one fact in full on request, named left-outs
// instead of a bare "[cut here]", and history.md never read.
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
  const brief = '# Brief\n\n## Look\n- Calm, natural light. <!-- fact: client.fixture.editing.subtitle-spec -->\n\n## Voice\n- Plain words.\n';
  const facts = [...parseBrainFacts(voice, 'voice'), ...parseBrainFacts(editing, 'editing')].filter((f) => f.status === 'written' && f.body);

  // 1. Default shape: whole brief, then each fact's first paragraph with its id; "more" marks a longer fact.
  const out = brainView({ name: 'Fixture Client', brief, facts });
  assert.ok(out.startsWith('Fixture Client, from the Synchro Brain.'), 'opens with the client name');
  assert.ok(out.includes('## Look\n- Calm, natural light.'), 'the brief, Look section included, is sent in full');
  assert.ok(!out.includes('<!--'), 'no comment markup leaks');
  assert.ok(out.includes('### Caption style (voice; fact id: client.fixture.voice.caption-style; more)\nShort lines, no emojis.'), 'Caption style shows its current answer and is marked more');
  assert.ok(!out.includes('longer captions were tried'), 'the rest of a fact stays out of the overview');
  assert.ok(out.includes('### Tone (voice; fact id: client.fixture.voice.tone)\nWarm and plain.'), 'a one-paragraph fact is whole, no "more"');
  assert.ok(out.includes('Two words at a time:\n\n- white\n- bold') && !out.includes('yellow subtitles'), 'a paragraph ending in ":" brings its list along');
  assert.ok(!out.includes('Not yet'), 'not-written facts are not sent');
  assert.ok(/call client_brain again with topic/.test(out), 'the overview says how to ask for more');
  assert.ok(!out.includes('[cut here]') && !out.includes('Left out for length'), 'nothing left out when it fits');

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
  for (const f of big) assert.ok(long.includes(`fact id: ${f.id}`) || tail.includes(f.id), `${f.id} is either sent or named`);
  const huge = brainView({ name: 'F', brief, facts: [{ file: 'voice', heading: 'Huge', id: 'client.fixture.voice.huge', body: 'x '.repeat(40000) }], topic: 'huge' });
  assert.ok(huge.length <= BRAIN_MAX_CHARS && /the rest of client\.fixture\.voice\.huge was not sent/.test(huge), 'a single fact too long for one answer says so by id');
  assert.strictEqual(firstParagraph('a'.repeat(5000)).more, true, 'a giant first paragraph is shortened and marked');

  // 4. history.md is never read: the read list is fixed, and asking for it says it is not served.
  const info = read('supabase/functions/higgsfield-mcp/clientinfo.ts');
  const code = (s) => s.replace(/\/\/.*$/gm, '');
  const brainPart = code(info.slice(info.indexOf('export async function clientBrain'), info.indexOf('export async function brainChange')));
  assert.ok(/Promise\.all\(\[read\("brief"\), read\("audience"\), \.\.\.BRAIN_FILES\.map\(read\)\]\)/.test(brainPart), 'client_brain reads brief, audience and the fixed list only');
  assert.ok(!/history/i.test(code(info)), 'clientinfo.ts code never names history.md');
  assert.ok(!/history/i.test(code(read('supabase/functions/higgsfield-mcp/brainview.mjs')).replace(/want === "history"[^\n]*/, '')), 'brainview.mjs never reads history');
  assert.ok(/not served by client_brain/.test(brainView({ name: 'F', brief, facts, topic: 'history.md' })), 'asking for history says it is not served');
  assert.ok(!/contents\/clients\/\$\{where\.folder\}\/\$\{file\}/.test(brainPart.replace(/read = async \(file: string\) => \{[\s\S]*?\};/, '')), 'no other file read in client_brain');

  // The tool tells Claude how to ask for more, and passes the topic through.
  const idx = read('supabase/functions/higgsfield-mcp/index.ts');
  const def = idx.slice(idx.indexOf('name: "client_brain"'), idx.indexOf('name: "brain_change"'));
  assert.ok(/When you need more on a topic/.test(def) && /topic: \{ type: "string"/.test(def), 'description and schema offer topic');
  assert.ok(/clientBrain\(db\(\), String\(args\.client \|\| ""\), String\(args\.topic \|\| ""\)\)/.test(idx), 'topic is passed to clientBrain');

  console.log('higgsfield-client-brain: overview by current answers, one fact in full, named left-outs, history.md never read ✅');
})().catch((e) => { console.error(e); process.exit(1); });
