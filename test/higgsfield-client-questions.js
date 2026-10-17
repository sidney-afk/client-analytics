'use strict';
/*
 * Open client questions on the Synchro connector (synchro-brain
 * POLICY/questions.md, Sidney 2026-10-17): client_brain ends with at most one
 * open question the caller may answer, never the same one to the same person
 * twice in 7 days, and brain_change with question_id files the answer and
 * marks the question answered.
 *
 * clientinfo.ts runs here for real (Node strips its types) with the client
 * list, GitHub and the hf_activity offer log faked in memory. Fictional
 * client and text only; nothing touches the network.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dir = path.join(ROOT, 'supabase', 'functions', 'higgsfield-mcp');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

const FOLDER = 'fixture-client';
const QUESTIONS = `# Open questions

Asked of Kasper or the team, never Sidney.

## Which hook style now?
<!-- question
id:     q.${FOLDER}.hook-style
ask:    kasper
fact:   client.${FOLDER}.voice.hooks
asked:  2026-10-10
status: open
-->

Two notes disagree on hooks. Which one holds? It changes every script.

## Subtitle colour: white or yellow?
<!-- question
id:     q.${FOLDER}.subtitle-colour
ask:    team
fact:   client.${FOLDER}.editing.subtitles
asked:  2026-10-12
status: open
-->

Delivered videos use yellow, the checklist says white.

## Old music question
<!-- question
id:     q.${FOLDER}.music
ask:    team
fact:   client.${FOLDER}.editing.music
asked:  2026-10-01
status: answered
answered: 2026-10-02, Someone (team), inputs/syncview-changes/x.md
-->

Already settled.

## Newer team question
<!-- question
id:     q.${FOLDER}.b-roll
ask:    team
fact:   client.${FOLDER}.editing.b-roll
asked:  2026-10-15
status: open
-->

Stock b-roll or only their own footage?
`;

(async () => {
  // ---- fakes -------------------------------------------------------------
  const env = { BRAIN_GITHUB_TOKEN: 'test-token', BRAIN_REPO: 'example/brain', BRAIN_BRANCH: 'main' };
  globalThis.Deno = { env: { get: (k) => env[k] } };
  const files = {
    [`clients/${FOLDER}/brief.md`]: '# Brief\n\n## Look\n- Calm.\n',
    [`clients/${FOLDER}/questions.md`]: QUESTIONS,
  };
  let sha = 1;
  const shas = {};
  const puts = [];
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    assert.ok(u.pathname.startsWith('/repos/example/brain/'), 'only the brain repository is called: ' + u.pathname);
    const p = decodeURIComponent(u.pathname.replace('/repos/example/brain/', ''));
    const res = (status, body, raw) => ({ ok: status < 300, status, json: async () => body, text: async () => raw ?? JSON.stringify(body) });
    if (p === 'contents/clients') return res(200, [{ name: FOLDER, type: 'dir' }, { name: 'other-client', type: 'dir' }]);
    const file = p.replace(/^contents\//, '');
    if ((init.method || 'GET') === 'PUT') {
      const body = JSON.parse(init.body);
      puts.push({ file, body });
      if (files[file] !== undefined && body.sha !== shas[file]) return res(409, { message: 'sha mismatch' });
      files[file] = Buffer.from(body.content, 'base64').toString('utf8');
      shas[file] = 'sha' + (sha++);
      return res(201, { content: { path: file } });
    }
    if (files[file] === undefined) return res(404, { message: 'Not Found' }, '');
    shas[file] = shas[file] || 'sha' + (sha++);
    const raw = /raw/.test((init.headers || {}).Accept || '');
    return raw ? res(200, null, files[file]) : res(200, { content: b64(files[file]), sha: shas[file] });
  };
  const db = {
    from: () => ({ select: () => ({ order: async () => ({ data: [{ client_slug: 'fixtureclient', client_name: 'Fixture Client', doc_id: '', plan_months: '' }], error: null }) }) }),
  };
  // The hf_activity offer log, in memory, with a movable clock.
  const log = [];
  let now = Date.parse('2026-10-17T12:00:00Z');
  const asker = (member, who = '', teamLink = false) => ({
    member, who, teamLink,
    offeredSince: async (since) => log.filter((r) => r.tool === 'question_offered' && r.member_name === member && (teamLink ? r.who === q.offerKey(who) : r.who === null) && r.at >= since).map((r) => r.summary),
    recordOffer: async (row) => { log.push({ ...row, at: new Date(now).toISOString() }); },
  });
  const realNow = Date.now;
  Date.now = () => now;

  const q = await import(path.join(dir, 'questions.mjs'));
  const ci = await import(path.join(dir, 'clientinfo.ts'));
  const offeredId = (text) => (text.match(/question id: (q\.[a-z0-9.-]+)\)/) || [])[1] || null;

  // ---- parsing -----------------------------------------------------------
  const parsed = q.parseQuestions(QUESTIONS);
  assert.deepStrictEqual(parsed.map((x) => [x.id, x.ask, x.status]), [
    [`q.${FOLDER}.hook-style`, 'kasper', 'open'],
    [`q.${FOLDER}.subtitle-colour`, 'team', 'open'],
    [`q.${FOLDER}.music`, 'team', 'answered'],
    [`q.${FOLDER}.b-roll`, 'team', 'open'],
  ]);
  assert.strictEqual(parsed[1].body, 'Delivered videos use yellow, the checklist says white.');
  assert.strictEqual(parsed[1].heading, 'Subtitle colour: white or yellow?');

  // ---- who is asked ------------------------------------------------------
  assert.deepStrictEqual(q.questionPerson('Kasper', '', false), { name: 'Kasper', role: 'kasper' });
  assert.deepStrictEqual(q.questionPerson('Sidney', '', false), { name: 'Sidney', role: 'sidney' });
  assert.deepStrictEqual(q.questionPerson('Team', 'kasper', true).role, 'kasper');
  assert.deepStrictEqual(q.questionPerson('Team', '', true), { name: '', role: '' }, 'Team link without a name: nobody');
  assert.deepStrictEqual(q.questionPerson('Team', 'Robin', true), { name: 'Robin', role: 'team' });
  assert.deepStrictEqual(q.questionPerson('Robin', 'Kasper', false).role, 'team', 'a personal link keeps its own name, "who" is ignored');

  // 1. Kasper: his own question first (kasper before team), then team ones.
  const k1 = await ci.clientBrain(db, 'Fixture Client', '', asker('Kasper'));
  assert.ok(k1.startsWith('Fixture Client, from the Synchro Brain'), 'the brain comes first');
  assert.strictEqual(offeredId(k1), `q.${FOLDER}.hook-style`, 'Kasper is offered the kasper question first');
  assert.ok(/At the END of their task, ask this one question in one plain sentence/.test(k1), 'tells Claude when and how to ask');
  assert.ok(k1.includes(`question_id set to "q.${FOLDER}.hook-style"`), 'tells Claude to save the answer with the question id');
  assert.strictEqual((k1.match(/question id: /g) || []).length, 1, 'at most one question per call');
  const k2 = await ci.clientBrain(db, 'Fixture Client', '', asker('Kasper'));
  assert.strictEqual(offeredId(k2), `q.${FOLDER}.subtitle-colour`, 'then the oldest team question');
  const k3 = await ci.clientBrain(db, 'Fixture Client', '', asker('Kasper'));
  assert.strictEqual(offeredId(k3), `q.${FOLDER}.b-roll`, 'then the next team question');
  const k4 = await ci.clientBrain(db, 'Fixture Client', '', asker('Kasper'));
  assert.strictEqual(offeredId(k4), null, 'all offered this week: none, and never the answered one');
  assert.ok(!k4.includes('Old music question'), 'an answered question never shows');

  // 2. A team member: only team questions, oldest asked first.
  const t1 = await ci.clientBrain(db, 'Fixture Client', '', asker('Team', 'Robin', true));
  assert.strictEqual(offeredId(t1), `q.${FOLDER}.subtitle-colour`, 'a team member gets the oldest open team question');
  const t2 = await ci.clientBrain(db, 'Fixture Client', '', asker('Team', 'Robin', true));
  assert.strictEqual(offeredId(t2), `q.${FOLDER}.b-roll`, 'not the same one again: the next team question');
  const t3 = await ci.clientBrain(db, 'Fixture Client', '', asker('Team', 'Robin', true));
  assert.strictEqual(offeredId(t3), null, 'never the kasper question, never twice in the week');
  // Someone else is still offered the question Robin was offered.
  const o1 = await ci.clientBrain(db, 'Fixture Client', '', asker('Team', 'Alex', true));
  assert.strictEqual(offeredId(o1), `q.${FOLDER}.subtitle-colour`, 'another person is offered the same question');
  const p1 = await ci.clientBrain(db, 'Fixture Client', '', asker('Robin'));
  assert.strictEqual(offeredId(p1), `q.${FOLDER}.subtitle-colour`, 'Robin on a personal link is a different log key from Robin on the Team link');

  // Typed differently, still the same person: "robin" and "Robin Smith" share Robin's week.
  for (const variant of ['robin', 'ROBIN', 'Robin Smith']) {
    const v = await ci.clientBrain(db, 'Fixture Client', '', asker('Team', variant, true));
    assert.strictEqual(offeredId(v), null, `"${variant}" shares Robin's weekly limit`);
  }
  assert.ok(log.filter((r) => r.who !== null).every((r) => r.who === r.who.toLowerCase() && !/\s/.test(r.who)), 'Team-link offers are logged under the lowercased first name');

  // 3. After 7 days the same person may be offered it again.
  now += 7 * 86400_000 + 1000;
  const t4 = await ci.clientBrain(db, 'Fixture Client', '', asker('Team', 'Robin', true));
  assert.strictEqual(offeredId(t4), `q.${FOLDER}.subtitle-colour`, 'offered again once the week is over');
  now -= 7 * 86400_000 + 1000;

  // 4. Sidney and an unnamed caller: none, and nothing logged for them.
  const before = log.length;
  for (const a of [asker('Sidney'), asker('Sidney Someone'), asker('Team', '', true), asker('Team', 'Sidney', true)]) {
    const out = await ci.clientBrain(db, 'Fixture Client', '', a);
    assert.strictEqual(offeredId(out), null, `${a.member}/${a.who || '-'} is never asked`);
    assert.ok(!out.includes('open question'), 'no question text at all');
  }
  const none = await ci.clientBrain(db, 'Fixture Client', '');
  assert.strictEqual(offeredId(none), null, 'no asker: none');
  assert.strictEqual(log.length, before, 'nothing logged for Sidney or an unnamed caller');

  // 5. A topic call never carries a question.
  const topic = await ci.clientBrain(db, 'Fixture Client', 'brief', asker('Team', 'Sam', true));
  assert.strictEqual(offeredId(topic), null, 'a topic follow-up carries no question');

  // 6. An unreadable offer log offers nothing (the limit cannot be checked).
  const broken = { ...asker('Team', 'Sam', true), offeredSince: async () => { throw new Error('log down'); } };
  const b1 = await ci.clientBrain(db, 'Fixture Client', '', broken);
  assert.ok(b1.startsWith('Fixture Client, from the Synchro Brain') && offeredId(b1) === null, 'log down: the brain, no question');

  // 7. brain_change with a valid question id: filed like any change, then marked answered.
  puts.length = 0;
  const saved = await ci.brainChange(db, 'Fixture Client', 'White, always. The yellow was a mistake.', '', 'Robin (team)', `q.${FOLDER}.subtitle-colour`);
  assert.ok(saved.startsWith(`Sent, and question q.${FOLDER}.subtitle-colour is marked answered.`), saved);
  assert.strictEqual(puts.length, 2, 'two writes: the claim on questions.md first, then the change file');
  assert.strictEqual(puts[0].file, `clients/${FOLDER}/questions.md`, 'the question is claimed before the answer is filed');
  assert.ok(puts[0].body.sha, 'the claim is conditional on the file not having changed');
  const change = puts[1];
  assert.ok(/^inputs\/syncview-changes\/\d{4}-\d{2}-\d{2}-fixture-client-[0-9a-f]{8}\.md$/.test(change.file), 'the answer is filed under inputs/ like any change');
  const md = Buffer.from(change.body.content, 'base64').toString('utf8');
  assert.ok(md.includes('White, always. The yellow was a mistake.'), 'their words, word for word');
  assert.ok(md.includes(`- fact id: client.${FOLDER}.editing.subtitles`), 'the fact the question settles');
  assert.ok(md.includes(`- answers question: q.${FOLDER}.subtitle-colour (Subtitle colour: white or yellow?)`), 'the change file names the question');
  assert.ok(md.includes('- sent by (as typed): Robin (team) via Claude connector'));
  const after = files[`clients/${FOLDER}/questions.md`];
  const block = after.split('## Subtitle colour: white or yellow?')[1].split('-->')[0];
  assert.ok(block.includes('status: answered'), 'status set to answered');
  assert.ok(block.includes(`answered: 2026-10-17, Robin (team), ${change.file}`), 'answered: date, who, the inputs file');
  assert.ok(after.split('## Newer team question')[1].includes('status: open'), 'other questions untouched');
  assert.strictEqual(after.replace(/status: answered\nanswered: [^\n]+\n(?=-->\n\nDelivered)/, 'status: open\n'), QUESTIONS, 'nothing else in the file changed');
  // Once answered it is never offered again.
  const t5 = await ci.clientBrain(db, 'Fixture Client', '', asker('Team', 'Jo', true));
  assert.strictEqual(offeredId(t5), `q.${FOLDER}.b-roll`, 'the answered question is gone from the offers');

  // 7b. Two people answer at once: the one whose claim lands second files nothing.
  {
    const realFetch = globalThis.fetch;
    const qFile = `clients/${FOLDER}/questions.md`;
    let raced = false;
    puts.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      // Just before this caller's claim, someone else's claim on the same question lands.
      if ((init.method || 'GET') === 'PUT' && String(url).includes('questions.md') && !raced) {
        raced = true;
        files[qFile] = q.markAnswered(files[qFile], `q.${FOLDER}.b-roll`, '2026-10-17, Kasper, inputs/syncview-changes/other.md');
        shas[qFile] = 'sha-other';
      }
      return realFetch(url, init);
    };
    const lost = await ci.brainChange(db, 'Fixture Client', 'Only their own footage.', '', 'Jo (team)', `q.${FOLDER}.b-roll`);
    globalThis.fetch = realFetch;
    assert.ok(/^Could not use question "q\.fixture-client\.b-roll": someone else answered it a moment ago\. Nothing was saved\./.test(lost), lost);
    assert.ok(!puts.some((x) => x.file.startsWith('inputs/')), 'the losing answer is never filed');
    assert.ok(files[qFile].includes('answered: 2026-10-17, Kasper, inputs/syncview-changes/other.md'), "the winner's answered line stays");
  }

  // 7c. Filing fails after the claim: the claim is undone, the question is open again.
  {
    const realFetch = globalThis.fetch;
    const qFile = `clients/${FOLDER}/questions.md`;
    const kept = files[qFile];
    files[qFile] = QUESTIONS; shas[qFile] = 'sha-reset';
    globalThis.fetch = async (url, init = {}) => {
      if ((init.method || 'GET') === 'PUT' && String(url).includes('/contents/inputs/')) return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
      return realFetch(url, init);
    };
    const failed = await ci.brainChange(db, 'Fixture Client', 'Only their own footage.', '', 'Jo (team)', `q.${FOLDER}.b-roll`);
    globalThis.fetch = realFetch;
    assert.ok(/^Could not save the answer \(brain_write_500\)\. Nothing was saved and the question is open again/.test(failed), failed);
    assert.strictEqual(files[qFile], QUESTIONS, 'questions.md is back exactly as it was');
    files[qFile] = kept; shas[qFile] = 'sha-kept';
  }

  // 8. Bad ids are refused in plain words, and nothing is written.
  puts.length = 0;
  const bad = [
    [`q.${FOLDER}.nope`, /^Could not find a question with the id "q\.fixture-client\.nope" for Fixture Client\. Nothing was saved\./],
    [`q.${FOLDER}.subtitle-colour`, /^Could not use question "q\.fixture-client\.subtitle-colour": it is not open any more \(it is answered\)\. Nothing was saved\./],
    [`q.${FOLDER}.music`, /it is not open any more/],
  ];
  for (const [id, re] of bad) {
    const out = await ci.brainChange(db, 'Fixture Client', 'Some answer.', '', 'Robin (team)', id);
    assert.ok(re.test(out), `${id}: ${out}`);
  }
  assert.strictEqual(puts.length, 0, 'a refused question id writes nothing');
  // Without question_id, brain_change is unchanged.
  const plain = await ci.brainChange(db, 'Fixture Client', 'Prefers calm openings.', '', 'Robin (team)');
  assert.strictEqual(plain, 'Sent. It will be filed in Fixture Client\'s brain within a few minutes.');
  assert.ok(!Buffer.from(puts[0].body.content, 'base64').toString('utf8').includes('answers question'), 'a plain change names no question');

  // markAnswered on its own: only that block, only when open.
  assert.strictEqual(q.markAnswered(QUESTIONS, `q.${FOLDER}.music`, 'x'), null, 'an answered question is not re-marked');
  assert.strictEqual(q.markAnswered(QUESTIONS, `q.${FOLDER}.missing`, 'x'), null);
  assert.strictEqual(q.checkQuestionId(QUESTIONS.replace(/q\.fixture-client\.b-roll/, 'q.other-client.b-roll'), 'q.other-client.b-roll', FOLDER, 'Fixture Client').ok, false, 'a question of another client is refused');

  // ---- wiring (index.ts runs under Deno; checked as text) ----------------
  const index = read('index.ts');
  assert.ok(index.includes('clientBrain(db(), String(args.client || ""), String(args.topic || ""), askerFor(member, args.who))'), 'client_brain passes the caller');
  assert.ok(index.includes('String(args.fact_id || ""), author, String(args.question_id || ""))'), 'brain_change passes question_id');
  assert.ok(/question_id: \{ type: "string"/.test(index), 'brain_change declares question_id');
  assert.ok(/eq\("tool", QUESTION_TOOL\)/.test(index) && /teamLink \? q\.eq\("who", offerKey\(name\)\) : q\.is\("who", null\)/.test(index), 'the 7-day filter reads hf_activity by person');
  assert.ok(/ask that one question in one plain sentence at the end/.test(index), 'client_brain description explains the flow');
  assert.strictEqual(q.QUESTION_TOOL, 'question_offered');

  Date.now = realNow;
  console.log('higgsfield-client-questions: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
