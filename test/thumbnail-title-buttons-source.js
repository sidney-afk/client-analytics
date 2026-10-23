'use strict';
/*
 * The Production thumbnail title buttons (session Titlecard, 2026-10-23, OPEN_REPAIRS 481): the pure rules in
 * supabase/functions/thumbnail-titles/manual.mjs, and the wiring of the run, the migration and the page.
 * Fictional plans only.
 *
 *   - the batch rule (owner decision 4): the latest plan tab dated on or before the day the batch was made;
 *     a newer tab is the plan still being written; checked against the batch's video numbers; ask when two fit;
 *   - matching numbers in a plan's main list;
 *   - what a run may write without asking (owner decision 3): empty or the robot's own "Needs info" line only;
 *   - the texts a person's choice writes, and Undo's compare and set;
 *   - the service-account Doc reader's text, token counts, cost;
 *   - static: admins and SMMs only, one run per post, compare and set, all four roles revoked, the switch.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };

(async () => {
  const M = await import(path.join(root, 'supabase/functions/thumbnail-titles/manual.mjs'));
  const L = await import(path.join(root, 'supabase/functions/thumbnail-titles/logic.mjs'));

  const plan = (n, extra = '') => 'Filming plan\n' + Array.from({ length: n }, (_, i) => `${i + 1}. A video about topic ${i + 1}, with what happens in it and the words she will say on camera.`).join('\n') + '\n' + extra + 'x'.repeat(1600);
  const tabs = [
    { id: 't.aug', name: 'August', text: plan(6) },
    { id: 't.sep', name: 'September', text: plan(6) },
    { id: 't.oct', name: 'October', text: plan(5) },
    { id: 't.nov', name: 'November', text: plan(8) },
  ];
  const oct20 = '2026-10-20T10:00:00Z';

  // ---- the batch rule ----
  let p = M.pickBatchTab(tabs, oct20, [1, 2, 3]);
  eq([p.tab && p.tab.name, p.via], ['October', 'latest'], 'the latest tab on or before the batch');
  ok(M.pickBatchTab(tabs, oct20, [1]).tab.name !== 'November', 'a tab dated after the batch is the plan still being written, never picked');
  p = M.pickBatchTab(tabs, oct20, [6]);
  eq([p.tab && p.tab.name, p.via], ['September', 'previous'], 'the latest tab does not hold video 6: the one before it');
  p = M.pickBatchTab(tabs, oct20, [7]);
  eq([p.tab, p.reason], [null, 'no_fit'], 'neither of the two latest holds video 7: ask, never guess');
  ok(p.ask.length === 4 && p.ask[0].name === 'November', 'the person is offered every tab with videos, newest first');
  p = M.pickBatchTab(tabs, oct20, [], undefined, 't.aug');
  eq([p.tab.name, p.via], ['August', 'picked'], 'a tab the person picked wins');
  p = M.pickBatchTab([{ id: 'a', name: 'October', text: plan(4) }, { id: 'b', name: 'October 2026', text: plan(4) }], oct20, [1]);
  eq([p.tab, p.reason, p.ask.length], [null, 'two_fit', 2], 'two tabs for the same month: ask with exactly those two');
  p = M.pickBatchTab([{ id: 'a', name: 'Week of Oct 5', text: plan(3) }, { id: 'b', name: 'Week of Oct 12', text: plan(3) }, { id: 'c', name: 'Week of Oct 26', text: plan(3) }], oct20, [2]);
  eq(p.tab && p.tab.id, 'b', 'week tabs: the latest week starting on or before the batch');
  p = M.pickBatchTab([{ id: 'a', name: '', text: plan(4) }, { id: 'b', name: '', text: plan(4) }], oct20, [1]);
  eq(p.tab && p.tab.id, 'b', 'no dated tab: the Doc order, last tab first');
  p = M.pickBatchTab([{ id: 'a', name: 'Plan', text: plan(3) }], oct20, [2]);
  eq([p.tab && p.tab.id, p.via], ['a', 'only'], 'a single tab is the plan');
  eq(M.pickBatchTab([{ id: 'a', name: 'October', text: 'Filming Plan\nTBD' }], oct20, [1]).reason, 'plan_empty', 'a template tab is not a batch');
  p = M.pickBatchTab([{ id: 'd', name: 'December', text: plan(4) }, { id: 'j', name: 'January', text: plan(4) }], '2027-01-08T00:00:00Z', [1]);
  eq(p.tab && p.tab.id, 'j', 'across the new year: January is this month, December is last month');
  p = M.pickBatchTab([{ id: 'd', name: 'December', text: plan(4) }, { id: 'j', name: 'January', text: plan(4) }], '2026-12-15T00:00:00Z', [1]);
  eq(p.tab && p.tab.id, 'd', 'in December, a January tab is next month (being written)');
  eq(M.tabDate({ name: 'Week of Nov 2' }, oct20).date.toISOString().slice(0, 10), '2026-11-02', 'a week tab name with no year reads as the nearest year');

  // ---- matching numbers ----
  eq(M.planVideoNumbers('1. a\n2. b\nVideo 3: c\n#4 - d\nHooks\n1. x\n2. y'), [1, 2, 3, 4], 'the main list only; a list that restarts at 1 ends it');
  ok(M.tabFits({ text: plan(5) }, [5]) && !M.tabFits({ text: plan(5) }, [6]), 'a tab fits when it reaches the highest number the batch needs');
  ok(M.tabFits({ text: 'no numbers here at all' }, [9]), 'a list that cannot be read as numbers is not refused (the model still leaves out what it cannot match)');

  // ---- what a run may write without asking ----
  eq(M.briefKind(''), 'empty', 'empty');
  eq(M.briefKind('   \n'), 'empty', 'blank is empty');
  for (const code of Object.keys(L.NEEDS_INFO_TEXT)) {
    const line = L.needsInfoLine(code, { month: 'October 2026', post: 'Video 3 — Morning routine', video: 4, plan: 'August' });
    eq(M.briefKind(line), 'needs_info', 'the robot\'s own line is recognised: ' + code);
  }
  eq(M.briefKind(L.needsInfoLine('plan_empty') + ' Also use the blue one.'), 'human', 'a robot line a person added to is a person\'s text');
  eq(M.briefKind('Needs info: I will write this myself'), 'human', 'a person starting with the same words is a person\'s text');
  eq(M.briefKind('Thumbnail title (generated by AI): Morning routine that works'), 'ai', 'an AI title');
  eq(M.briefKind('Thumbnail title (generated by AI, from the August plan): Pantry swaps'), 'ai', 'an AI title from a named plan');
  eq(M.briefKind('Thumbnail title (generated by AI): Pantry swaps\nMake it red'), 'human', 'an AI title a person added to is a person\'s text');
  ok(M.decideWrite('').auto && M.decideWrite(L.needsInfoLine('no_plan')).auto, 'empty and the robot line are written at once');
  ok(!M.decideWrite('Thumbnail title (generated by AI): Old').auto && !M.decideWrite('Big text: jars').auto, 'an AI title or a person\'s text waits for a person');

  // ---- the texts a choice writes ----
  const line = M.titleLineFor('Three pantry swaps', 'October');
  eq(line, 'Thumbnail title (generated by AI, from the October plan): Three pantry swaps', 'the label names the plan tab');
  eq(M.briefKind(line), 'ai', 'a written title reads back as an AI title, so a later run asks before replacing it');
  eq(M.textFor('replace', line, 'Big text: jars'), line + '\n\nPrevious description:\nBig text: jars', 'Replace keeps the person\'s text under the title');
  eq(M.textFor('above', line, 'Big text: jars'), line + '\n\nBig text: jars', 'Add title above mine');
  eq(M.textFor('use_new', line, 'Thumbnail title (generated by AI): Old'), line, 'Use new replaces an earlier AI title');
  assert.throws(() => M.textFor('delete', line, 'x')); checks++;
  eq(M.titleLineFor('Hi', 'Oct (week 2)\n'), 'Thumbnail title (generated by AI, from the Oct week 2 plan): Hi', 'a tab name never breaks the label');
  eq(M.skipMessage('no_match', { tab: 'October', video: 4, absent: true }), 'No video 4 in the October plan', 'row message names the video and the tab');
  eq(M.skipMessage('no_match', { tab: 'October', video: 2 }), 'Video 2 not matched in the October plan', 'a video the tab lists but the model could not match says so');

  // ---- the service-account reader, tokens, cost, actor ----
  const doc = { tabs: [
    { tabProperties: { tabId: 't.1', title: 'October' }, documentTab: { body: { content: [
      { paragraph: { elements: [{ textRun: { content: '1. Morning routine\n' } }] } },
      { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: '2. Pantry swaps\n' } }] } }] }, { content: [{ paragraph: { elements: [{ textRun: { content: 'Hook\n' } }] } }] }] }] } },
    ] } }, childTabs: [{ tabProperties: { tabId: 't.2', title: 'Hooks' }, documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Hook ideas\n' } }] } }] } } }] },
    { tabProperties: { tabId: 't.3', title: 'Empty' }, documentTab: { body: { content: [] } } },
  ] };
  const t = M.docTabsText(doc);
  eq(t.map(x => [x.id, x.name]), [['t.1', 'October'], ['t.2', 'Hooks']], 'tabs and child tabs, empty ones left out');
  ok(t[0].text.includes('1. Morning routine') && t[0].text.includes('2. Pantry swaps | Hook'), 'paragraphs and table cells become text');
  eq(M.docIdFromUrl('https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit?tab=t.0'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'Doc id from a link');
  eq(M.docIdFromUrl('https://example.com/x'), '', 'no id from another link');
  let u = M.addUsage({ input: 0, output: 0 }, { input_tokens: 1000, cache_read_input_tokens: 200, output_tokens: 300 });
  u = M.addUsage(u, null);
  eq(u, { input: 1200, output: 300 }, 'token counts add up, a missing usage block adds nothing');
  eq(M.costCents('claude-sonnet-5-5', 10000, 1000), 3, '10k in and 1k out on Sonnet 5.5 is 3 cents');
  eq(M.actorName('Sam <b>Other</b>', 'smm'), 'Sam bOtherb', 'the display name keeps letters only');
  eq(M.actorName('', 'smm'), 'staff:smm', 'no name: the role');
  ok(M.RUN_KEY_RE.test('post:abc-123_x.y') && !M.RUN_KEY_RE.test('post:a b') && !M.RUN_KEY_RE.test(''), 'run keys are plain');

  // ---- static wiring ----
  const runs = read('supabase/functions/thumbnail-titles/runs.ts');
  const fn = read('supabase/functions/thumbnail-titles/index.ts');
  const sql = read('migrations/2026-10-23-thumbnail-title-buttons.sql');
  ok(/\["admin", "smm"\]\.includes\(principal\.role\)/.test(fn) && /smm_or_admin_only/.test(fn), 'admins and SMMs only (owner decision 2)');
  ok(/insertError\.code === "23505"[\s\S]{0,700}following: true/.test(runs), 'a second press follows the run already going');
  ok(/thumbnail_title_runs_one_active[\s\S]{0,120}where state in \('queued', 'running', 'ask'\)/.test(sql), 'one active run per post, enforced by the database');
  ok(/coalesce\(d\.brief, ''\) is distinct from coalesce\(p_expected, ''\)[\s\S]{0,40}return 'changed'/.test(sql) && /for update;/.test(sql), 'descriptions are written by compare and set, under a row lock');
  ok(/f\.key = 'prod_authority'[\s\S]{0,200}<> 'syncview' then\s+return 'authority'/.test(sql), 'a team Production may not write is refused in the database, fail-closed (AGENTS.md authority rule)');
  ok(/p_action = 'write' then[\s\S]{0,200}for update;[\s\S]{0,120}return 'stopped'/.test(sql), 'an automatic write is fenced on its run still running (a Cancel wins)');
  ok(!/attempts < 3/.test(sql) && /Number\(r\.attempts \|\| 0\) >= 3/.test(runs), 'a run killed on its third try is ended, never left holding its post');
  ok(/briefKind\(now\) === "human" \? "human" : "ai"/.test(runs), 'after a conflict the choices follow what is there now');
  ok(/_prodCanWrite\(k, 'description'\)/.test(read('src/index/255-production-thumbnail-titles.js.part')), 'the buttons follow the description write gate');
  ok(/'description_change'[\s\S]{0,200}'ui'[\s\S]{0,200}'thumbnail_titles_manual'/.test(sql), 'every write is in the issue\'s history under the person who pressed');
  for (const obj of ['table public.thumbnail_title_runs', 'table public.thumbnail_title_run_items', 'function public.thumbnail_title_manual_apply(text, text, text, text, text, text, text)', 'function public.thumbnail_titles_tick_needed()']) {
    ok(sql.includes(`revoke all on ${obj} from public, anon, authenticated, service_role`), 'revoked from all four roles: ' + obj);
  }
  ok(sql.startsWith('-- ef-auto-deploy: functions-cope-without-this\n-- ef-auto-deploy-applied-when: select to_regclass(\'public.thumbnail_title_runs\') is not null'), 'line 1 says the function copes without it; line 2 says how to tell it is applied');
  ok(/missingTable\(/.test(runs) && /"not_ready"/.test(runs), 'before the migration the buttons answer "not ready"');
  ok(/decideWrite\(before\)/.test(runs) && /\.from\("deliverables"\)\.select\("brief,status,kind"\)/.test(runs), 'the description is read again at the moment of writing');
  ok(/EdgeRuntime\.waitUntil\(work\)/.test(fn) && /resumeStaleRuns\(db, runDeps\(\)\)/.test(fn), 'the run works in the background, and the timer finishes a run whose worker stopped');
  ok(/stillMine\(db, runId, tabKey\)/.test(runs), 'a cancel or "Use another tab" stops the old worker before it writes');
  ok(/input_tokens: usage\.input, output_tokens: usage\.output/.test(runs), 'real token counts are stored per run (owner decision 7)');
  ok(!/console\.(?:log|warn)\([^)]*\$\{[^}]*(?:title|brief|text|name)[^}]*\}/.test(runs), 'logs carry counts and codes, never a title or plan text');
  const plan2 = read('supabase/functions/thumbnail-titles/plan.ts');
  ok(/planTabs\(docId\)/.test(plan2) && /documents\.readonly/.test(plan2) && /GOOGLE_SERVICE_ACCOUNT_JSON/.test(plan2), 'private plans: the link reader first, then the service account (owner decision 6)');
  ok(/<\(\?:!doctype\|html\)/.test(plan2), 'a sign-in page is never taken for a plan');

  const page = read('src/index/255-production-thumbnail-titles.js.part');
  const sw = read('src/index/188-review-stage-switch.js.part');
  ok(/'thumbnail_title_buttons_staff'\]/.test(sw) && /function svThumbTitleButtonsOn\(\)[\s\S]{0,200}_rsListed\(_rsFlags\.ttb\)/.test(sw), 'the switch lists staff by id or full name; missing means off');
  ok(/svThumbTitleButtonsOn\(\)/.test(page) && /_isClientLink/.test(page), 'the page draws nothing unless the switch lists the person, and never on a client link');
  ok(/svLayerOpen\(\{ key: 'prod-tt-review'/.test(page) && /svLayerRelease\('prod-tt-review'/.test(page), 'the review sheet joins the shared pop-up layers (Escape, outside click, focus back)');
  const keepAt = page.indexOf("_jsAttrArg('keep') + ')\">Keep mine</button>'");
  ok(keepAt > 0 && keepAt < page.indexOf("_jsAttrArg('replace')"), 'Keep mine comes before Replace');
  ok(/_prodTtDescButtonHTML\(issue\)\s*\n?\s*\+ '<button class="prod-description-action"/.test(read('src/index/240-production-description.js.part')), '"Write title" sits right before Edit');
  ok(/' Sub-issues <span class="prod-group-count">' \+ kids\.length \+ '<\/span><\/span>' \+ ttButton/.test(read('src/index/260-production-refresh-boot.js.part')), 'the batch button sits on the right of the Sub-issues header');
  ok(!/production-write/.test(page.replace(/\/\*[\s\S]*?\*\//g, '')), 'the page never calls production-write for this (no Section 4 change)');

  console.log(`thumbnail-title-buttons-source: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
