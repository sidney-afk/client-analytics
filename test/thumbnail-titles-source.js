'use strict';
// thumbnail-titles: the title logic under Node (no network, no database, no model call),
// plus static wiring checks on the two Edge Functions, the migration and the Calendar editor.
// The rules under test: a title is written only from the filming plan, only into an empty
// description, labelled as AI; where no honest title exists the line says "Needs info: ...";
// Samples are never touched; the switch defaults off; the prompt table is closed to the browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

(async () => {
  const L = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/thumbnail-titles/logic.mjs')).href);

  // The default prompt is the n8n node's instruction, word for word, plus the Brain style.
  ok(L.N8N_TITLE_PROMPT.includes('You write short, punchy reel titles.'), 'n8n opening line kept');
  ok(L.N8N_TITLE_PROMPT.includes('write a title (2-5 words)'), 'n8n length rule kept');
  ok(L.N8N_TITLE_PROMPT.includes('NO descriptions, NO filler words, NO clinical language'), 'n8n tone rule kept');
  eq(L.defaultPromptFor(''), L.N8N_TITLE_PROMPT, 'no style: plain n8n prompt');
  const withStyle = L.defaultPromptFor('## Hooks (voice)\nShort and warm.');
  ok(withStyle.startsWith(L.N8N_TITLE_PROMPT) && withStyle.includes(L.STYLE_HEADER) && withStyle.endsWith('Short and warm.'), 'style appended');
  ok(L.defaultPromptFor('x'.repeat(9000)).length <= L.N8N_TITLE_PROMPT.length + L.STYLE_HEADER.length + L.STYLE_MAX_CHARS + 4, 'style capped');
  ok(L.STYLE_EXCLUDE.test('Communication') && L.STYLE_EXCLUDE.test('How she talks to us') && !L.STYLE_EXCLUDE.test('Banned-Openings'), 'agency-communication facts left out');

  // Saved prompt wins, then the seeded default, then the plain instruction.
  eq(L.effectivePrompt({ prompt: 'Mine', default_prompt: 'Seeded' }), 'Mine', 'saved prompt wins');
  eq(L.effectivePrompt({ prompt: '  ', default_prompt: 'Seeded' }), 'Seeded', 'empty saved = default');
  eq(L.effectivePrompt(null), L.N8N_TITLE_PROMPT, 'no row = n8n instruction');

  // Video number: from the card name, else a bare "Thumbnail N" in a multi-post batch only.
  eq(L.numberFromCardName('Video 9'), 9, 'Video 9');
  eq(L.numberFromCardName('Video 3— ADS'), 3, 'Video 3 with suffix');
  eq(L.numberFromCardName('VIDEO12 - hook'), 12, 'no space');
  eq(L.numberFromCardName('Carousel 6'), null, 'carousel is not a video number');
  eq(L.numberFromCardName('My launch reel'), null, 'no number');
  eq(L.numberFromItemTitle('Thumbnail 4', 10), 4, 'submit batch number');
  eq(L.numberFromItemTitle('Thumbnail 1', 1), null, 'single-post batch says nothing');
  eq(L.numberFromItemTitle('Thumbnail 4 — Launch', 10), null, 'named item matches by name');
  eq(L.postNameFor('', 'Thumbnail 4 — Launch hook'), 'Launch hook', 'name from the item title');
  eq(L.postNameFor('Video 2', 'Thumbnail 2'), 'Video 2', 'card name preferred');

  // Tab choice: the creation month's tab, by name first; never a guess.
  const tabs = [
    { id: 't.a', name: 'September 2026', text: 'September plan text' },
    { id: 't.b', name: 'October 2026', text: 'October plan text' },
  ];
  eq(L.pickTab(tabs, '2026-10-09T10:00:00Z', () => '').tab.id, 't.b', 'October tab by name');
  eq(L.pickTab(tabs, '2026-11-02T10:00:00Z', () => '').reason, 'no_month_tab', 'no November tab: reported');
  eq(L.pickTab([{ id: '', name: '', text: 'only tab' }], '2026-11-02T10:00:00Z', () => '').tab.text, 'only tab', 'single tab used');
  eq(L.pickTab([], '2026-10-09', () => '').reason, 'plan_empty', 'no text: plan empty');
  eq(L.pickTab([{ id: 'x', name: '', text: 'a' }, { id: 'y', name: '', text: 'October October' }], '2026-10-09', (t) => (/October/.test(t) ? 'October' : '')).tab.id, 'y', 'month from the text');
  eq(L.pickTab([{ id: 'x', name: 'October 2025', text: 'a' }, { id: 'y', name: 'Notes', text: 'b' }], '2026-10-09', () => '').reason, 'no_month_tab', 'last year\'s October is not this October');

  // Grounding: a distilled title passes, the 2026-08-17 style invention fails.
  const plan = L.normalizedText('Video 1: Why your morning routine is failing you. Hook: stop chasing productivity, start chasing calm. Video 2: The one question every new parent forgets to ask.');
  ok(L.grounded('Stop Chasing Productivity', plan), 'quoted phrase is grounded');
  ok(L.grounded('Your Routine Is Failing', plan), 'distilled phrase is grounded');
  ok(!L.grounded('Deep Navy Gold Gradient', plan), 'invented art direction fails');
  ok(!L.grounded('The Best Of It', plan), 'no significant words fails');
  ok(L.titleShapeOk('Chase Calm Instead'), 'short title ok');
  ok(!L.titleShapeOk('one two three four five six seven eight nine'), 'too many words');
  ok(!L.titleShapeOk('Line one\nLine two'), 'line break refused');

  // Parsing the model's answer: only the keys we sent, first answer wins, junk ignored.
  const content = [{ type: 'text', text: '```json\n[{"key":"p1","title":"\\"Stop Chasing Productivity\\""},{"key":"p1","title":"Second"},{"key":"zz","title":"Nope"},{"key":"p2"}]\n```' }];
  const parsed = L.parseTitles(content, ['p1', 'p2']);
  ok(parsed.ok, 'parsed');
  eq([...parsed.titles.entries()], [['p1', 'Stop Chasing Productivity']], 'only p1, quotes stripped');
  ok(!L.parseTitles([{ type: 'text', text: 'Sorry, I cannot.' }], ['p1']).ok, 'no JSON = provider failure');
  ok(L.parseTitles([{ type: 'text', text: 'Here: [{"key":"p1","title":"Calm"}] done' }], ['p1']).titles.get('p1') === 'Calm', 'array inside prose');

  // The line written.
  const post = { key: 'p1', postName: 'Video 7' };
  const good = L.resolveLine(post, 'Stop Chasing Productivity', plan);
  eq([good.state, good.outcome], ['written', 'title'], 'title written');
  eq(good.text, 'Thumbnail title (generated by AI): Stop Chasing Productivity', 'AI label, same as the Submit tab');
  const unmatched = L.resolveLine(post, '', plan);
  eq(unmatched.state, 'needs_info', 'unmatched is needs info');
  ok(unmatched.text.startsWith('Needs info: this post could not be matched') && unmatched.text.includes('(post "Video 7")'), 'clear one line');
  ok(!/[\r\n]/.test(unmatched.text), 'one line');
  eq(L.resolveLine(post, 'Deep Navy Gold Gradient', plan).outcome, 'not_grounded', 'invention never written as a title');
  for (const code of Object.keys(L.NEEDS_INFO_TEXT)) {
    const line = L.needsInfoLine(code, { month: 'October 2026', post: 'x' });
    ok(line.startsWith('Needs info: ') && !/[\r\n{}]/.test(line) && line.length < 220, 'needs-info line shape: ' + code);
  }
  eq(L.needsInfoLine('no_month_tab', { month: 'October 2026' }), 'Needs info: the client\'s filming plan has no tab for October 2026, so no thumbnail title was written. Add the title here by hand.', 'month named');

  // Switch.
  ok(!L.clientOn({ clients: [] }, 'a'), 'empty list = off');
  ok(L.clientOn({ clients: ['a'] }, 'a') && !L.clientOn({ clients: ['a'] }, 'b'), 'per client');
  ok(L.clientOn({ clients: ['*'] }, 'b'), 'star = all');
  ok(!L.clientOn(null, 'a'), 'missing flag = off');

  // The model request carries the prompt, the posts and the plan; the system prompt forbids invention.
  const msg = L.userMessage('PROMPT', [{ key: 'p1', videoNumber: 3, postName: 'Video 3' }, { key: 'p2', videoNumber: null, postName: 'Launch' }], 'PLAN');
  ok(msg.startsWith('PROMPT') && msg.includes('{"key":"p1","videoNumber":3,"postName":"Video 3"}') && msg.includes('{"key":"p2","postName":"Launch"}') && msg.endsWith('Filming plan:\nPLAN'), 'user message shape');
  ok(/Count|counted sequentially from the top of the plan/.test(L.SYSTEM_PROMPT) && /Never invent/.test(L.SYSTEM_PROMPT), 'system prompt keeps the n8n counting rule and forbids invention');

  // ---- static wiring ----
  const fn = read('supabase/functions/thumbnail-titles/index.ts');
  ok(fn.includes('from "../higgsfield-mcp/clientinfo.ts"') && /planTabs\(docId\)/.test(fn), 'reuses the connector\'s filming-plan reader');
  ok(!/docs\.google\.com/.test(fn), 'no second copy of the Doc reader');
  ok(/x-thumbnail-titles-key/.test(fn) && /thumbnail_titles_key_ok/.test(fn) && fn.indexOf('thumbnail_titles_key_ok') < fn.indexOf('req.json()'), 'timer key checked before anything else');
  ok(/security definer[\s\S]{0,200}vault\.decrypted_secrets where name = 'thumbnail_titles_key'/.test(read('migrations/2026-10-09-thumbnail-titles.sql')), 'key compared in the database');
  ok(/THUMBNAIL_TITLES_API_KEY/.test(fn) && !/sk-ant-/.test(fn), 'AI key from a secret only');
  ok(/skipped: "off"/.test(fn), 'off is a no-op');
  ok(/p_count: false/.test(fn) && /waiting_for_api_key/.test(fn), 'no AI key: titles wait without using up a try');
  ok(/thumbnail_title_apply/.test(fn) && !/\.from\("deliverables"\)[\s\S]{0,80}\.update\(/.test(fn), 'descriptions written only through the apply function');
  const seed = read('supabase/functions/thumbnail-titles/seed.ts');
  ok(/titleStyleFacts/.test(seed) && /STYLE_EXCLUDE/.test(seed) && /\.update\(\{ default_prompt: defaultPrompt, default_source: source, default_refreshed_at: now \}\)/.test(seed) && !/[^_]prompt:\s*defaultPrompt/.test(seed), 'seed never overwrites a saved prompt');
  const prompts = read('supabase/functions/thumbnail-title-prompts/index.ts');
  ok(/actor\.kind !== "staff"/.test(prompts) && /staff_only/.test(prompts), 'prompt function is staff only');
  ok(/settings_events/.test(prompts), 'prompt saves are recorded like caption prompt saves');
  const clientinfo = read('supabase/functions/higgsfield-mcp/clientinfo.ts');
  ok(/export async function planTabs/.test(clientinfo) && /export async function titleStyleFacts/.test(clientinfo), 'shared helpers exported');

  const sql = read('migrations/2026-10-09-thumbnail-titles.sql');
  ok(/'\{"clients":\[\]\}'::jsonb/.test(sql), 'switch seeded OFF');
  ok(/d\.origin = 'calendar'/.test(sql) && !/origin = 'samples'/.test(sql), 'Submit tab and Calendar only, never Samples');
  ok(/coalesce\(btrim\(d\.brief\), ''\) <> ''[\s\S]{0,60}skipped_human/.test(sql), 'a description someone wrote is never overwritten');
  ok(/for update;/.test(sql), 'write under a row lock');
  ok(/A refused write never overwrites the record[\s\S]{0,120}state in \('pending', 'running'\)/.test(sql), 'a refused second write keeps the first result on record');
  ok(/the Synchro Brain has no written title style for this client yet/.test(read('src/index/180-calendar-native-post-media.js.part')), 'the banner only claims a Brain style when there is one');
  ok(/revoke all on table public\.thumbnail_title_prompts from public, anon, authenticated, service_role/.test(sql), 'prompt table revoked from all four roles');
  ok(!/grant select on table public\.thumbnail_title_prompts to anon/.test(sql), 'prompt table not browser readable');
  ok(/p_apply boolean default false/.test(sql) && /'dry_run'/.test(sql), 'backfill defaults to a dry run');
  ok(!/create trigger[\s\S]{0,80}on public\.deliverables/i.test(sql), 'no trigger added to deliverables');
  ok(/where public\.thumbnail_titles_tick_needed\(\)/.test(sql), 'timer calls the function only when needed');

  const ui = read('src/index/180-calendar-native-post-media.js.part');
  ok(/function _calOpenThumbTitlePromptModal/.test(ui) && /THUMBNAIL_TITLE_PROMPTS_EF_URL/.test(ui), 'editor present');
  ok(/if \(!client \|\| _isClientLink\) return;/.test(ui), 'never opens on a client link');
  const kebab = read('src/index/160-calendar-organize-ui.js.part');
  const cap = kebab.indexOf('Caption prompt</button>');
  const thumb = kebab.indexOf('Thumbnail title prompt</button>');
  ok(cap > 0 && thumb > cap && thumb - cap < 600, 'menu item right under Caption prompt');
  ok(/calState\.client && !_isClientLink/.test(kebab.slice(0, cap)), 'menu is staff only');
  ok(!/[ï»¿]/.test(fn.slice(0, 3)) && fn.charCodeAt(0) !== 0xFEFF, 'no byte-order mark');

  console.log(`thumbnail-titles-source: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
