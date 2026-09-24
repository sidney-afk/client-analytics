'use strict';
// Unit test for the brain Edge Function's pure parser (supabase/functions/brain/parse.mjs).
// Synthetic fixture only: the brain itself is private and never enters this repo.
const assert = require('assert');
const path = require('path');
const fs = require('fs');

(async () => {
  const { findClientFolder, parseBrainFacts, parseSpec, parseBrief } = await import(path.join(__dirname, '../supabase/functions/brain/parse.mjs'));

  assert.strictEqual(findClientFolder(['alpha-beta', 'gamma'], 'alphabeta'), 'alpha-beta');
  assert.strictEqual(findClientFolder(['alpha-beta'], 'Alpha Beta'), 'alpha-beta');
  assert.strictEqual(findClientFolder(['alpha-beta'], 'nope'), null);
  assert.strictEqual(findClientFolder(['alpha-beta'], ''), null);

  const md = [
    '# Fixture: editing', '',
    '## Subtitle spec', '<!-- brain', 'id:      client.fixture.editing.subtitle-spec', 'owner:   kasper',
    'status:  written', 'source:  inputs/x.md', 'updated: 2026-09-24', 'spec:    font=Serif; main=#ffffff; highlight=none', '-->', '',
    'Subtitle settings in words.', '',
    '## Music', '<!-- brain', 'id:      client.fixture.editing.music', 'owner:   kasper', 'status:  not-written', '-->', '',
    '## Notes', '<!-- brain', 'id:      client.fixture.editing.notes', 'status:  written', '-->', '',
    'Line one.', '', '## A heading with no block', 'still part of Notes.', '',
  ].join('\n');
  const facts = parseBrainFacts(md, 'editing');
  assert.strictEqual(facts.length, 3, 'three facts');
  assert.deepStrictEqual(
    { h: facts[0].heading, id: facts[0].id, st: facts[0].status, spec: facts[0].spec, body: facts[0].body, file: facts[0].file },
    { h: 'Subtitle spec', id: 'client.fixture.editing.subtitle-spec', st: 'written', spec: 'font=Serif; main=#ffffff; highlight=none', body: 'Subtitle settings in words.', file: 'editing' });
  assert.strictEqual(facts[1].status, 'not-written');
  assert.strictEqual(facts[1].body, '');
  assert.ok(facts[2].body.includes('## A heading with no block') && facts[2].body.includes('still part of Notes.'), 'unblocked heading kept as prose');
  assert.deepStrictEqual(parseSpec('font=Serif; main=#fff'), [{ key: 'font', value: 'Serif' }, { key: 'main', value: '#fff' }]);

  const brief = parseBrief(['<!-- brief', 'generated: 2026-09-24', '-->', '', '## Look', '- **Subtitles:** Serif, white. <!-- fact: a.b.c, a.b.d -->', '', '## Empty', '', '## Avoid', '- No stock music. <!-- fact: a.b.e -->'].join('\n'));
  assert.deepStrictEqual(brief, [
    { heading: 'Look', bullets: [{ text: '**Subtitles:** Serif, white.', facts: ['a.b.c', 'a.b.d'] }] },
    { heading: 'Avoid', bullets: [{ text: 'No stock music.', facts: ['a.b.e'] }] },
  ], 'brief parses into sections, drops empty ones, keeps fact ids');

  const src = fs.readFileSync(path.join(__dirname, '../supabase/functions/brain/index.ts'), 'utf8');
  assert.ok(/contents\/clients\/\$\{folder\}\/\$\{file\}\.md/.test(src), 'reads only clients/<folder>/<file>.md');
  assert.ok(!/contents\/inputs\/[^s]/.test(src) && !/contents\/(company|POLICY)/.test(src), 'never reads inputs, company or POLICY');
  assert.ok(src.includes('inputs/syncview-changes/'), 'changes land under inputs/syncview-changes/');
  assert.ok(src.includes('"staff_only"'), 'client tokens are refused');
  assert.ok(src.includes('authorizeBrowserWrite('), 'staff key required');
  console.log('brain-parse checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
