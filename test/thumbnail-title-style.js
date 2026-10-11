'use strict';
// thumbnail-title-style: the default thumbnail title prompt is the n8n instruction word for word,
// then a short style section built by plain code from the client's written Brain facts.
// Rules under test: source notes (dates, segments, files, "source status" lines) are gone; the same
// facts always give the same prompt; and every boundary or "never say" rule survives, uncapped.
// All text here is invented. No client, staff name or slug belongs in this file.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// A boundary sentence counts as kept when its words, outside quotations and brackets, all appear in order in the prompt.
const flat = (t) => String(t).toLowerCase().replace(/[*_`]/g, '').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9"“” ]/g, ' ').replace(/\s+/g, ' ').trim();
const missing = (boundaries, prompt) => boundaries.filter((b) => !flat(prompt).includes(flat(b)));

(async () => {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/thumbnail-titles/logic.mjs')).href);

  const BOUNDARIES = [
    'Never use the word "quietly" in a title.',
    'Do not mention her children by name.',
    'She refuses to be called a "guru".',
    'Avoid medical claims of any kind.',
    'He does not want his hometown named.',
    'No swearing anywhere.',
    'Do not rank believers or say who is saved.',
    'The word "hack" is banned on this account.',
    'She rejected the label "influencer" and asked for "teacher".',
    'Keep client revenue figures private.',
    'Never name the former employer.',
    'He prefers "coach" to "guru".',
  ];

  const FACTS = [
    {
      file: 'voice', heading: 'Content style assessment',
      body: [
        'The undated Clients Info assessment, captured 2026-09-12, says (verbatim excerpt):',
        '',
        '> Her tone is warm, grounded and direct.',
        '',
        'These are source-authored observations, not owner-approved voice instructions. They do not supersede direct client preferences.',
      ].join('\n'),
    },
    {
      file: 'voice', heading: 'Caption style',
      body: [
        '- **Tone.** Warm and plainspoken, a teacher talking to a friend (native Pat, segments 12-14; 00:26:13 to 00:27:01).',
        '- **Words she uses.** "slow down", "tiny steps", "gentle", "your body knows" (Slack, 2026-02-17).',
        '- **Words and patterns she avoids.** ' + BOUNDARIES[0] + ' ' + BOUNDARIES[1] + ' (2026-06-25).',
        '- **Hashtags.** Four or five tags.',
      ].join('\n'),
    },
    { file: 'voice', heading: 'Boundaries', body: BOUNDARIES.slice(2).map((b) => `- ${b} (call 2026-01-16, segment 33)`).join('\n') },
    { file: 'voice', heading: 'On camera', body: ['**Pace.** Calm, about 130 words a minute.', '**Eye line and address.** Mostly into the lens, one to one.', '**Against the caption voice.** She asked us to avoid "cheesy" openers.'].join('\n') },
    { file: 'voice', heading: 'Caption prompt source status', body: 'CaptionPrompts row 16 carries updated_at 2026-06-03. The cached sheet text is retained verbatim.' },
    { file: 'voice', heading: 'Duplicate', body: 'Never use the word "quietly" in a title.\n- **Never use the word "quietly" in a title.** (2026-08-12)' },
  ];

  const prompt = L.defaultPromptFor(FACTS);

  // The five base rules come first, word for word.
  ok(prompt.startsWith(L.N8N_TITLE_PROMPT + '\n\n' + L.STYLE_HEADER), 'base rules first, untouched');
  eq(L.defaultPromptFor([]), L.N8N_TITLE_PROMPT, 'no facts: the plain base rules');
  eq(L.defaultPromptFor([{ file: 'voice', heading: 'X', body: 'Pace and nothing else of use.' }]).startsWith(L.N8N_TITLE_PROMPT), true, 'still starts with the base rules');

  // Deterministic: same facts, same prompt, byte for byte.
  eq(L.defaultPromptFor(FACTS), prompt, 'same facts give the same prompt');
  eq(L.defaultPromptFor(JSON.parse(JSON.stringify(FACTS))), prompt, 'a copy gives the same prompt');

  // Source notes gone.
  for (const bad of ['2026', 'segment', 'Slack', 'source status', 'CaptionPrompts', 'verbatim', 'Clients Info', 'supersede', '00:26', 'native Pat']) {
    ok(!prompt.includes(bad), `source note "${bad}" removed`);
  }
  ok(!/\(\s*[,;]?\s*\)/.test(prompt), 'no empty brackets left behind');

  // What helps a title stays.
  ok(prompt.includes('Her tone is warm, grounded and direct.'), 'tone sentence kept');
  ok(/Warm and plainspoken/.test(prompt), 'labelled tone kept');
  for (const w of ['slow down', 'tiny steps', 'gentle', 'your body knows']) ok(prompt.includes(`"${w}"`) || prompt.includes(`“${w}”`), `phrase "${w}" listed`);
  ok(!/130 words a minute/.test(prompt) && !/lens/.test(prompt), 'on-camera delivery read off video is not a title rule');

  // Every boundary survives, and the check itself can fail.
  eq(missing(BOUNDARIES, prompt), [], 'no boundary lost');
  const cut = prompt.split('\n').filter((l) => !l.includes('hometown')).join('\n');
  eq(missing(BOUNDARIES, cut), [BOUNDARIES[4]], 'the check catches a lost boundary line');
  ok(/Avoid cheesy|avoid "cheesy"/i.test(prompt), 'a rule found inside an on-camera line is kept');

  // Duplicates collapse to one line.
  eq(prompt.split('\n').filter((l) => l.includes('quietly')).length, 1, 'duplicate rule said once');

  // Boundaries are never capped, however many there are.
  const many = Array.from({ length: 60 }, (_, i) => `Never mention topic number ${i} in any title.`);
  const big = L.defaultPromptFor([{ file: 'voice', heading: 'Many', body: many.map((m) => `- ${m}`).join('\n') }]);
  eq(missing(many, big), [], 'sixty rules, none dropped');

  // A rule survives whichever way it is written.
  const forms = [
    '**Never claim authority.** Said on a call.',
    'Do not say who is saved: not her place.',
    'She did not want her husband named.',
    'Nothing is banned in scripts; captions are different.',
    'Avoid quotation marks around titles unless asked.',
  ];
  const formPrompt = L.defaultPromptFor([{ file: 'editing', heading: 'Title rules', body: forms.join('\n') }]);
  for (const needle of ['Never claim authority.', 'Do not say who is saved', 'did not want her husband named', 'Nothing is banned in scripts', 'Avoid quotation marks']) {
    ok(formPrompt.includes(needle), `kept: ${needle}`);
  }

  // A quoted sample that happens to contain "never" is a sample, not a rule.
  const sample = L.defaultPromptFor([{ file: 'voice', heading: 'On camera', body: '**Vocabulary and signature phrases.** Warm: "it never is easy".' }]);
  ok(!/Avoid:/.test(sample), 'a quoted "never" is not read as a rule');

  // Sentences split on full stops but not inside a quotation or brackets.
  eq(L.splitSentences('One. Two "a. b" c. Three (x. Y) z.'), ['One.', 'Two "a. b" c.', 'Three (x. Y) z.'], 'splitting respects quotes and brackets');

  // Avoid and Boundaries hold only instructions about what to write.
  const mixed = L.defaultPromptFor([
    { file: 'voice', heading: 'Words and openings to avoid', body: [
      '- **Never the word "quietly".** Said on a call: *"Never use the word quietly"*.',
      '- **Capitalise Lord.** She asked for this by name: *"Looks good, but Lord should be capitalized please :)"*.',
    ].join('\n') },
    { file: 'voice', heading: 'Caption voice', body: [
      'Every caption was one line plus five `Check out Pat`, `Don\'t miss out on Pat` posts.',
      'The bridge line is reworded every time even though its job never changes.',
      'Kasper rejected the same caption three times for jumping to the app.',
      'Nobody has said in writing who wrote them, so do not assume it was her.',
      'Do not extrapolate one general list; ask Sam for the rule.',
    ].join('\n') },
    { file: 'editing', heading: 'Subtitles', body: [
      'Subtitles are white text with PURPLE highlights (never yellow), in a bold font.',
      'Keep subtitles in the safe zone; avoid caps-lock titles and write hooks exactly as phrased.',
      'Do not use a bounce animation on subtitles.',
    ].join('\n') },
    { file: 'editing', heading: 'Thumbnails', body: 'The image should be a screen grab of the video, never a generated picture.' },
    { file: 'voice', heading: 'On camera', body: ['**Eye line and address.** Never looks into the lens.', '**Pace.** Slow, never rushed.'].join('\n') },
  ]);
  const avoidAndBoundaries = mixed.slice(mixed.indexOf('Avoid:'));
  ok(avoidAndBoundaries.includes('Never the word "quietly".'), 'a label that is a rule is kept');
  ok(avoidAndBoundaries.includes('Capitalise Lord.'), 'a rule label in a list of things to avoid is kept as the rule');
  ok(!/Looks good|capitalized please/.test(mixed), 'a reviewer comment is not a rule and not a phrase');
  ok(/avoid caps-lock titles/i.test(avoidAndBoundaries) && !/safe zone/.test(mixed), 'a mixed sentence keeps its title rule and loses its subtitle half');
  for (const gone of ['one line plus five', 'reworded every time', 'rejected the same caption', 'Nobody has said', 'extrapolate', 'PURPLE', 'bounce', 'screen grab', 'lens', 'rushed']) {
    ok(!mixed.includes(gone), `not an instruction about what to write: ${gone}`);
  }

  // No repeated line within a section.
  const dup = L.defaultPromptFor([{ file: 'voice', heading: 'Rules', body: ['- Do not rank believers or say who is saved.', '- **Do not rank believers.** She asked.', '- Do not rank believers or say who is saved!'].join('\n') }]);
  eq(dup.split('\n').filter((l) => /rank believers/i.test(l)).length, 1, 'a rule said three ways appears once');

  // Words and phrases are the client's own words.
  const own = L.defaultPromptFor([{ file: 'voice', heading: 'Words', body: '**Words she uses.** "heal", "tiny steps". Capitals for reverence, they said: "Lord should be capitalized please".' }]);
  ok(own.includes('"heal"') && !own.includes('capitalized please'), "only the client's own words are listed as phrases");

  // Shorter than the old text for a realistic fact set, never longer than it plus the base rules by much.
  const oldStyle = FACTS.map((f) => `## ${f.heading} (${f.file})\n${f.body}`).join('\n\n');
  ok(prompt.length < L.N8N_TITLE_PROMPT.length + oldStyle.length, 'shorter than base rules plus the old Brain text');

  console.log(`thumbnail-title-style: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
