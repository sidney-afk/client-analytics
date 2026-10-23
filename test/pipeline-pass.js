#!/usr/bin/env node
// Filming pipeline passes (item 1, PR 1): the connector's "pipeline_pass" tool
// and the pass check in pipeline-google. Offline: the pure rules in
// pipeline-google/pass.mjs and rules.mjs are run directly, and the wiring in
// the two functions and the migration is read as source. Every file id below
// is invented.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fnDir = path.join(root, 'supabase', 'functions');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

// Invented ids, shaped like Google's (letters, digits, - and _, 10 to 100 long).
const IDS = {
  sheet: 'FAKEsheet0000000000000000001',
  live: 'FAKEliveDoc00000000000000001',
  test: 'FAKEtestDoc00000000000000001',
  folder: 'FAKEfolder000000000000000001',
  testSheet: 'FAKEtestSheet000000000000001',
  stranger: 'FAKEstranger0000000000000001',
  company: 'FAKEcompanyDoc0000000000000001',
};
const CONFIG = {
  slug: 'example-client',
  sheet: { id: IDS.sheet, name: 'Example ideas', drive_folder: IDS.folder, publish_mode: 'new_tab' },
  filming_plan_live_doc: IDS.live,
  filming_plan_test_doc: IDS.test,
  brain: 'clients/example',
};

let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; };
const eq = (a, b, label) => { assert.deepStrictEqual(a, b, label); passed++; };

(async () => {
  const pass = await import(path.join(fnDir, 'pipeline-google', 'pass.mjs'));
  const rules = await import(path.join(fnDir, 'pipeline-google', 'rules.mjs'));
  const who = await import(path.join(fnDir, 'higgsfield-mcp', 'who.mjs'));

  // ---- Tokens, hashing, expiry ------------------------------------------------
  const t1 = pass.newPassToken();
  const t2 = pass.newPassToken();
  ok(pass.PASS_RE.test(t1) && pass.isPassToken(t1), 'a token is fpp_ plus 64 hex characters');
  ok(t1 !== t2, 'two tokens differ');
  ok(!pass.isPassToken('fpp_' + 'g'.repeat(64)) && !pass.isPassToken('') && !pass.isPassToken(null) && !pass.isPassToken(t1 + 'x'), 'malformed tokens are refused');
  const h1 = await pass.passHash(t1);
  eq(h1, crypto.createHash('sha256').update(t1).digest('hex'), 'the stored hash is the SHA-256 of the whole token, lowercase hex');
  ok(/^[0-9a-f]{64}$/.test(h1) && !h1.includes(t1.slice(4)), 'the hash does not contain the token');
  eq(await pass.passHash(t1), h1, 'hashing is stable');
  ok(h1 !== await pass.passHash(t2), 'different tokens hash differently');
  eq(pass.PASS_HOURS, 6, 'a pass lasts 6 hours');
  const now = Date.parse('2026-01-01T12:00:00Z');
  ok(!pass.passExpired({ expires_at: '2026-01-01T17:59:59Z' }, now), 'a pass before its expiry is usable');
  ok(pass.passExpired({ expires_at: '2026-01-01T12:00:00Z' }, now), 'a pass at its expiry is expired');
  ok(pass.passExpired({ expires_at: '2026-01-01T06:00:00Z' }, now), 'a pass after its expiry is expired');
  ok(pass.passExpired({}, now) && pass.passExpired(null, now), 'a row without a readable expiry counts as expired');

  // ---- The publish rule ----------------------------------------------------------
  eq(pass.passTarget(' Client '), 'client', 'target is read case-insensitively');
  eq(pass.passTarget('prod'), null, 'only test and client are targets');
  for (const isPublisher of [true, false]) {
    const team = pass.passDecision({ teamLink: true, target: 'client', isPublisher });
    ok(!team.ok && team.text.startsWith('Refused') && /personal connector link/.test(team.text), `the shared team link never gets a client pass (publisher=${isPublisher})`);
    eq(pass.passDecision({ teamLink: true, target: 'test', isPublisher }), { ok: true, via: 'team', target: 'test' }, 'the team link may have a test pass');
  }
  const notListed = pass.passDecision({ teamLink: false, target: 'client', isPublisher: false });
  ok(!notListed.ok && notListed.text.startsWith('Refused'), 'a personal link not on the publish list gets no client pass');
  eq(pass.passDecision({ teamLink: false, target: 'client', isPublisher: true }), { ok: true, via: 'personal', target: 'client' }, 'a personal link on the publish list gets a client pass');
  eq(pass.passDecision({ teamLink: false, target: 'test', isPublisher: false }), { ok: true, via: 'personal', target: 'test' }, 'anyone with a personal link gets a test pass');
  const noTarget = pass.passDecision({ teamLink: false, target: 'live', isPublisher: true });
  ok(!noTarget.ok && noTarget.text.startsWith('Give '), 'an unknown target asks for test or client');
  // Refusals are logged as failures in hf_activity, a pass as a success.
  for (const r of [team(), notListed, noTarget]) eq(who.outcomeOf('pipeline_pass', r.text).ok, false, 'a refusal is logged as a failure');
  function team() { return pass.passDecision({ teamLink: true, target: 'client', isPublisher: true }); }
  const reply = pass.passReply({ clientName: 'Example Client', target: 'test', token: t1, expiresAt: '2026-01-01T18:00:00.000Z' });
  eq(reply.split(t1).length - 1, 1, 'the reply shows the token exactly once');
  ok(reply.includes('PIPELINE_PASS=' + t1) && /environment variable PIPELINE_PASS for this run only/.test(reply) && /Never save it in a file/.test(reply), 'the reply says how the pipeline uses it: an environment variable, never a file');
  ok(reply.includes('2026-01-01T18:00:00Z') && reply.includes('6 hours'), 'the reply gives the expiry');
  eq(who.outcomeOf('pipeline_pass', reply).ok, true, 'a pass is logged as a success');
  // The activity row is built from the call's arguments; the token is only in the reply.
  const row = who.activityRow({ member: 'Example Member', tool: 'pipeline_pass', args: { client: 'Example Client', target: 'test', summary: 'test pass' }, ok: true });
  ok(!JSON.stringify(row).includes('fpp_'), 'the activity row never carries a token');

  // ---- The file allow-list --------------------------------------------------------
  const files = rules.clientFiles(CONFIG);
  eq(files, { sheet: IDS.sheet, liveDoc: IDS.live, testDoc: IDS.test, folder: IDS.folder }, 'files come from config.json keys sheet, filming_plan_live_doc, filming_plan_test_doc, sheet.drive_folder');
  eq(rules.clientFiles({ sheet: IDS.sheet }), { sheet: IDS.sheet, liveDoc: '', testDoc: '', folder: '' }, 'a bare sheet id works, missing keys stay empty');
  eq(rules.clientFiles({ sheet: { id: 'bad id!' }, filming_plan_live_doc: 3 }).sheet, '', 'a malformed id is ignored');
  eq(rules.clientFiles(null).sheet, '', 'no config, no files');
  const clientAllowed = rules.allowedFiles('client', files, { id: IDS.testSheet });
  const testAllowed = rules.allowedFiles('test', files, IDS.testSheet);
  eq([...clientAllowed.write].sort(), [IDS.live, IDS.sheet].sort(), 'target client writes the ideas Sheet and the live plan Doc');
  eq([...testAllowed.write].sort(), [IDS.testSheet, IDS.test].sort(), 'target test writes the TEST Sheet and the client\'s test Doc');
  for (const [name, allowed] of [['client', clientAllowed], ['test', testAllowed]]) {
    for (const id of [IDS.sheet, IDS.live, IDS.test, IDS.folder]) ok(allowed.read.has(id), `a ${name} pass reads the client's own file ${id}`);
    ok(!allowed.read.has(IDS.stranger), `a ${name} pass cannot read another file`);
  }
  ok(testAllowed.read.has(IDS.testSheet) && !clientAllowed.read.has(IDS.testSheet), 'the TEST Sheet is readable only by a test pass');
  eq([...rules.allowedFiles('test', rules.clientFiles({ sheet: IDS.sheet }), '').write], [], 'no test Doc and no TEST Sheet setting: a test pass writes nothing');

  // Company files (fp_settings company_read_files): readable by every pass, never writable.
  eq(rules.companyReadFiles(JSON.stringify([IDS.company, 'bad id!', 7])), [IDS.company], 'company files: a JSON text list keeps only valid ids');
  eq(rules.companyReadFiles([IDS.company]), [IDS.company], 'company files: an array works');
  eq(rules.companyReadFiles('not json'), [], 'company files: unreadable text means none');
  eq(rules.companyReadFiles(null), [], 'company files: no setting means none');
  for (const t of ['client', 'test']) {
    const a = rules.allowedFiles(t, files, t === 'test' ? IDS.testSheet : '', [IDS.company]);
    ok(a.read.has(IDS.company) && !a.write.has(IDS.company), `a ${t} pass reads the company file and cannot write it`);
    ok(!a.read.has(IDS.stranger), `a ${t} pass still cannot read another file`);
    eq(rules.checkFile('docs.get', { documentId: IDS.company }, a, t), { ok: true, fileId: IDS.company }, `a ${t} pass docs.get on the company file is allowed`);
    ok(!rules.checkFile('docs.batchUpdate', { documentId: IDS.company }, a, t).ok, `a ${t} pass cannot batchUpdate the company file`);
  }
  ok(!rules.allowedFiles('client', files, '').read.has(IDS.company), 'no setting: the company file is not readable');

  const fileCheck = (action, body, allowed, target) => rules.checkFile(action, body, allowed, target);
  for (const action of ['docs.get', 'sheets.get', 'sheets.values.get', 'drive.get']) {
    const key = rules.FILE_KEY[action];
    const id = action.startsWith('docs') ? IDS.live : action === 'drive.get' ? IDS.folder : IDS.sheet;
    eq(fileCheck(action, { [key]: id }, testAllowed, 'test'), { ok: true, fileId: id }, `${action} reads the client's own file with a test pass`);
    const no = fileCheck(action, { [key]: IDS.stranger }, clientAllowed, 'client');
    ok(!no.ok && no.status === 403, `${action} of another file is refused with 403`);
  }
  eq(fileCheck('docs.batchUpdate', { documentId: IDS.live }, clientAllowed, 'client').ok, true, 'a client pass writes the live plan Doc');
  eq(fileCheck('sheets.values.append', { spreadsheetId: IDS.sheet }, clientAllowed, 'client').ok, true, 'a client pass writes the ideas Sheet');
  const testToReal = fileCheck('docs.batchUpdate', { documentId: IDS.live }, testAllowed, 'test');
  ok(!testToReal.ok && testToReal.status === 403 && /target "client"/.test(testToReal.error), 'a test pass cannot write the live plan Doc');
  ok(!fileCheck('sheets.batchUpdate', { spreadsheetId: IDS.sheet }, testAllowed, 'test').ok, 'a test pass cannot write the real ideas Sheet');
  ok(!fileCheck('sheets.values.update', { spreadsheetId: IDS.testSheet }, clientAllowed, 'client').ok, 'a client pass cannot write the TEST Sheet');
  ok(!fileCheck('docs.batchUpdate', { documentId: IDS.test }, clientAllowed, 'client').ok, 'a client pass cannot write the test Doc');
  for (const action of ['drive.copy', 'drive.folder']) {
    const r = fileCheck(action, { fileId: IDS.sheet, parentId: IDS.folder, name: 'x' }, clientAllowed, 'client');
    ok(!r.ok && r.status === 403 && /cannot copy files or make folders/.test(r.error), `${action} is refused with a pass`);
  }
  ok(!fileCheck('drive.delete', { fileId: IDS.sheet }, clientAllowed, 'client').ok, 'an unknown action is refused with a pass');
  eq(fileCheck('docs.get', {}, clientAllowed, 'client').status, 400, 'a missing id is a 400');
  eq(fileCheck('whoami', {}, clientAllowed, 'client').ok, true, 'whoami is allowed');

  // ---- Sheets write rules ------------------------------------------------------------
  const PASS_GID = 777001;
  const OTHER_GID = 123;
  const sheetsOk = (reqs, tabs = [String(PASS_GID)]) => rules.checkSheetsBatch(reqs, tabs);
  const sheetsNo = (reqs, re, label) => {
    const r = sheetsOk(reqs);
    ok(!r.ok && r.status === 403 && re.test(r.error), label + ' -> ' + JSON.stringify(r));
  };
  eq(sheetsOk([{ addSheet: { properties: { title: 'Batch 9 (Jan 1)', index: 0 } } }], []), { ok: true, adds: 1 }, 'adding a tab is allowed (and counted for recording)');
  eq(sheetsOk([{ addSheet: { properties: { sheetId: 4242, title: 'New', index: 0 } } }, { repeatCell: { range: { sheetId: 4242 }, cell: {}, fields: 'userEnteredFormat' } }], []), { ok: true, adds: 1 }, 'a tab added with its own id may be formatted in the same call');
  sheetsNo([{ addSheet: { properties: { title: 'x', hidden: true } } }], /hidden/, 'a hidden tab is refused');
  // The formatting publish.py sends after it writes a batch, on a pass tab.
  const formatting = [
    { repeatCell: { range: { sheetId: PASS_GID, startRowIndex: 0, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 8 }, cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat(wrapStrategy)' } },
    { updateDimensionProperties: { range: { sheetId: PASS_GID, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 120 }, fields: 'pixelSize' } },
    { updateCells: { range: { sheetId: PASS_GID, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 }, rows: [{ values: [{ userEnteredValue: { stringValue: 'x' } }] }], fields: 'userEnteredValue' } },
    { setDataValidation: { range: { sheetId: PASS_GID, startRowIndex: 1, endRowIndex: 5, startColumnIndex: 5, endColumnIndex: 6 }, rule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Accepted' }] } } } },
  ];
  eq(sheetsOk(formatting), { ok: true, adds: 0 }, 'formatting inside a pass tab is allowed');
  sheetsNo([...formatting, { repeatCell: { range: { sheetId: OTHER_GID }, cell: {}, fields: 'userEnteredFormat' } }], /^Request 5 \(repeatCell\) touches a tab that was not created/, 'one request on another tab refuses the whole call and names it');
  sheetsNo([{ repeatCell: { range: { startRowIndex: 0 }, cell: {}, fields: 'x' } }], /does not say which tab|not created/, 'a range without sheetId (the first tab) is refused');
  sheetsNo([{ updateSheetProperties: { properties: { sheetId: PASS_GID, title: 'Renamed' }, fields: 'title' } }], /Renaming a tab is never allowed/, 'renaming a pass tab is refused');
  sheetsNo([{ updateSheetProperties: { properties: { sheetId: OTHER_GID, title: 'Renamed' }, fields: 'title,index' } }], /Renaming/, 'renaming any tab is refused');
  eq(sheetsOk([{ updateSheetProperties: { properties: { sheetId: PASS_GID, index: 0 }, fields: 'index' } }]).ok, true, 'moving a pass tab first is allowed');
  sheetsNo([{ updateSheetProperties: { properties: { sheetId: PASS_GID, index: 3 }, fields: 'index' } }], /first place/, 'moving a pass tab anywhere else is refused');
  sheetsNo([{ updateSheetProperties: { properties: { sheetId: OTHER_GID, index: 0 }, fields: 'index' } }], /not created/, 'moving another tab first is refused');
  sheetsNo([{ updateSheetProperties: { properties: { sheetId: PASS_GID, hidden: true }, fields: 'hidden' } }], /only move its own tab first/, 'hiding a tab is refused');
  eq(sheetsOk([{ updateSheetProperties: { properties: { sheetId: PASS_GID, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } }]).ok, true, 'freezing the header row of a pass tab is allowed');
  sheetsNo([{ deleteSheet: { sheetId: PASS_GID } }], /Deleting a tab is never allowed/, 'deleting even a pass tab is refused');
  sheetsNo([{ duplicateSheet: { sourceSheetId: OTHER_GID } }], /copying a tab/, 'copying a tab is refused');
  sheetsNo([{ findReplace: { find: 'a', replacement: 'b', allSheets: true } }], /every tab/, 'a find and replace over every tab is refused');
  eq(sheetsOk([{ findReplace: { find: 'a', replacement: 'b', sheetId: PASS_GID } }]).ok, true, 'a find and replace inside a pass tab is allowed');
  sheetsNo([{ copyPaste: { source: { sheetId: OTHER_GID }, destination: { sheetId: PASS_GID } } }], /not created/, 'copying from another tab is refused');
  sheetsNo([{ updateSpreadsheetProperties: { properties: { title: 'x' }, fields: 'title' } }], /not allowed with a pipeline pass/, 'a spreadsheet-wide change is refused');
  ok(!sheetsOk([]).ok && sheetsOk([]).status === 400 && !sheetsOk('x').ok, 'an empty or malformed request list is a 400');
  eq(sheetsOk([{ repeatCell: {}, updateCells: {} }]).status, 400, 'a request object with two kinds is a 400');

  // ---- Values ranges -------------------------------------------------------------------
  eq(rules.rangeSheetTitle("'Batch 9 (Jan 1)'!A1:H"), 'Batch 9 (Jan 1)', 'a quoted tab name');
  eq(rules.rangeSheetTitle("'It''s'!A1"), "It's", 'a doubled quote inside a tab name');
  eq(rules.rangeSheetTitle("'Whole tab'"), 'Whole tab', 'a quoted whole-tab range');
  eq(rules.rangeSheetTitle('Ideas!A1'), 'Ideas', 'an unquoted tab name');
  for (const r of ['A1:B2', 'NamedRange', "'unterminated!A1", "'x'A1", '', null]) eq(rules.rangeSheetTitle(r), null, `no tab named in ${JSON.stringify(r)}`);
  const tabs = [{ sheetId: OTHER_GID, title: 'Ideas' }, { sheetId: PASS_GID, title: 'Batch 9 (Jan 1)' }];
  eq(rules.checkValuesRange("'Batch 9 (Jan 1)'!A1", tabs, [String(PASS_GID)]), { ok: true, sheetId: String(PASS_GID) }, 'writing values into a pass tab is allowed');
  eq(rules.checkValuesRange("'batch 9 (jan 1)'!A1", tabs, [String(PASS_GID)]).ok, true, 'a tab name in another case matches when only one tab fits');
  const intoIdeas = rules.checkValuesRange('Ideas!A1', tabs, [String(PASS_GID)]);
  ok(!intoIdeas.ok && intoIdeas.status === 403 && /was not created through a pipeline pass/.test(intoIdeas.error), 'writing values into a tab not created by a pass is refused');
  ok(!rules.checkValuesRange('A1:Z', tabs, [String(PASS_GID)]).ok, 'a range without a tab name is refused');
  eq(rules.checkValuesRange('Missing!A1', tabs, [String(PASS_GID)]).status, 404, 'a tab that does not exist is a 404');

  // ---- Docs write rules ------------------------------------------------------------------
  const PASS_TAB = 't.passtab001';
  const OTHER_TAB = 't.clienttab01';
  const docsOk = (reqs, tabs = [PASS_TAB]) => rules.checkDocsBatch(reqs, tabs);
  const docsNo = (reqs, re, label) => {
    const r = docsOk(reqs);
    ok(!r.ok && r.status === 403 && re.test(r.error), label + ' -> ' + JSON.stringify(r));
  };
  eq(docsOk([{ addDocumentTab: { tabProperties: { title: 'January', index: 0 } } }], []), { ok: true, adds: 1 }, 'adding a Doc tab is allowed');
  docsNo([{ addDocumentTab: { tabProperties: { title: 'x', parentTabId: OTHER_TAB } } }], /inside another tab/, 'adding a tab inside a client tab is refused');
  // The shape filming_plan_write_doc.py sends after it adds a tab: every location carries the tab id.
  const plan = [
    { insertText: { location: { index: 1, tabId: PASS_TAB }, text: 'Title\n' } },
    { updateParagraphStyle: { range: { startIndex: 1, endIndex: 7, tabId: PASS_TAB }, paragraphStyle: { namedStyleType: 'HEADING_1' }, fields: 'namedStyleType' } },
    { updateTextStyle: { range: { startIndex: 1, endIndex: 6, tabId: PASS_TAB }, textStyle: { bold: true }, fields: 'bold' } },
    { replaceAllText: { containsText: { text: '{{BRAND}}', matchCase: true }, replaceText: 'Example', tabsCriteria: { tabIds: [PASS_TAB] } } },
    { insertInlineImage: { location: { index: 8, tabId: PASS_TAB }, uri: 'https://example.invalid/x.png' } },
  ];
  eq(docsOk(plan), { ok: true, adds: 0 }, 'writing and formatting inside a pass tab is allowed');
  docsNo([{ insertText: { location: { index: 1 }, text: 'x' } }], /does not say which tab/, 'a location without tabId (the first tab) is refused');
  docsNo([{ insertText: { location: { index: 1, tabId: OTHER_TAB }, text: 'x' } }], /not created through a pipeline pass/, 'writing into a client tab is refused');
  docsNo([{ replaceAllText: { containsText: { text: 'a' }, replaceText: 'b' } }], /does not say which tab/, 'a replace over the whole Doc is refused');
  docsNo([{ replaceAllText: { containsText: { text: 'a' }, replaceText: 'b', tabsCriteria: { tabIds: [PASS_TAB, OTHER_TAB] } } }], /not created/, 'a replace that reaches a client tab is refused');
  docsNo([{ updateTextStyle: { range: { startIndex: 1, endIndex: 2, tabId: PASS_TAB }, textStyle: {}, fields: 'bold' } }, { deleteContentRange: { range: { startIndex: 1, endIndex: 2, tabId: OTHER_TAB } } }], /^Request 2 \(deleteContentRange\)/, 'one request on a client tab refuses the whole call and names it');
  docsNo([{ insertTableRow: { tableCellLocation: { tableStartLocation: { index: 5 }, rowIndex: 0 }, insertBelow: true } }], /does not say which tab/, 'a table location without tabId is refused');
  eq(docsOk([{ insertTableRow: { tableCellLocation: { tableStartLocation: { index: 5, tabId: PASS_TAB }, rowIndex: 0 }, insertBelow: true } }]).ok, true, 'a table location in a pass tab is allowed');
  docsNo([{ updateDocumentTabProperties: { tabProperties: { tabId: PASS_TAB, title: 'Renamed' }, fields: 'title' } }], /Renaming a tab is never allowed/, 'renaming a pass tab is refused');
  docsNo([{ updateDocumentTabProperties: { tabProperties: { tabId: PASS_TAB, index: 0 }, fields: '*' } }], /Renaming/, 'a catch-all field mask is refused');
  eq(docsOk([{ updateDocumentTabProperties: { tabProperties: { tabId: PASS_TAB, index: 0 }, fields: 'index' } }]).ok, true, 'moving a pass tab first is allowed');
  docsNo([{ updateDocumentTabProperties: { tabProperties: { tabId: OTHER_TAB, index: 0 }, fields: 'index' } }], /not created/, 'moving a client tab first is refused');
  docsNo([{ updateDocumentTabProperties: { tabProperties: { tabId: PASS_TAB, index: 2 }, fields: 'index' } }], /first place/, 'moving a pass tab elsewhere is refused');
  docsNo([{ deleteTab: { tabId: PASS_TAB } }], /Deleting a tab is never allowed/, 'deleting a Doc tab is refused');
  docsNo([{ createHeader: { type: 'DEFAULT' } }], /not allowed with a pipeline pass/, 'a request kind outside the list is refused');
  docsNo([{ updateDocumentStyle: { documentStyle: {}, fields: 'marginTop' } }], /does not say which tab/, 'a Doc style change without a tab is refused');

  // ---- Recording new tabs ------------------------------------------------------------------
  eq(rules.createdTabIds('sheets', { replies: [{}, { addSheet: { properties: { sheetId: 4242, title: 'x' } } }] }), ['4242'], 'a new Sheet tab id is read from Google\'s reply');
  eq(rules.createdTabIds('docs', { replies: [{ addDocumentTab: { tabProperties: { tabId: PASS_TAB } } }] }), [PASS_TAB], 'a new Doc tab id is read from Google\'s reply');
  eq(rules.createdTabIds('docs', { replies: [{ addSheet: { properties: { sheetId: 1 } } }] }), [], 'replies of the other kind are ignored');
  eq(rules.createdTabIds('sheets', null), [], 'no reply, nothing recorded');

  // ---- pipeline-google wiring: the old password path is unchanged ------------------------------
  const pg = read(fnDir, 'pipeline-google', 'index.ts');
  const serve = pg.slice(pg.indexOf('Deno.serve('), pg.indexOf('// One Google call for an action'));
  const OLD_GATE = [
    'const secret = clean(Deno.env.get("PIPELINE_GOOGLE_KEY"));',
    'if (!secret) return json({ ok: false, error: "not set up: PIPELINE_GOOGLE_KEY is missing (run setup_google_relay.py)" }, 503);',
    'if (!sameText(clean(req.headers.get("x-pipeline-key")), secret)) return json({ ok: false, error: "wrong or missing x-pipeline-key" }, 401);',
  ];
  let at = -1;
  for (const line of OLD_GATE) { const i = serve.indexOf(line); ok(i > at, 'old gate line present, in order: ' + line.slice(0, 40)); at = i; }
  ok(/const pass = clean\(req\.headers\.get\(PASS_HEADER\)\);\n\s*if \(pass && !clean\(req\.headers\.get\("x-pipeline-key"\)\)\) return await withPass\(req, pass\);/.test(serve), 'a pass is used only when no password header is sent');
  ok(serve.indexOf('withPass(req, pass)') < serve.indexOf(OLD_GATE[0]), 'the pass branch sits before the password gate and leaves it as it was');
  ok(/return await perform\(tok, action, b\);\n\}\);/.test(serve), 'the password path ends in the same Google calls');
  // The Google calls themselves are byte-identical to the ones before passes existed.
  const sw = pg.slice(pg.indexOf('  switch (action) {'), pg.indexOf('\n  }\n', pg.indexOf('  switch (action) {')) + 4);
  eq(crypto.createHash('sha256').update(sw + '\n').digest('hex'), 'f2c22b9c7be0a3ac149a2a0e1e928b384d54f339592782871d2a38c54ed28477', 'the action switch is unchanged since #2126');
  eq((pg.match(/withPass\(/g) || []).length, 2, 'withPass is defined once and called once');
  const wp = pg.slice(pg.indexOf('async function withPass('));
  ok(!/json\([^)]*\braw\b/.test(wp) && !/refused\([^)]*\braw\b/.test(wp) && !/console\./.test(pg), 'the pass token is never echoed or logged');
  ok(wp.includes('sb.rpc("fp_pass_use", { p_token_hash: await passHash(raw) })'), 'the pass is looked up by its hash');
  ok(/if \(pass\.expired\)[\s\S]{0,200}401/.test(wp), 'an expired pass is refused');
  ok(wp.includes('.eq("name", "config.json")') && wp.includes('.eq("key", "test_sheet")'), 'files come from config.json in the file store and the TEST Sheet from fp_settings');
  ok(wp.includes('from("fp_pass_tabs").insert(') && wp.includes('createdTabIds('), 'new tabs are recorded in fp_pass_tabs');
  ok(/\.from\("fp_pass_tabs"\)\.select\("tab_id"\)\.eq\("file_id", fileId\)\.eq\("client_slug", client\)/.test(pg), 'a pass writes only in tabs created through a pass for its own client');
  ok(/const refused = \(error: string, status = 403\)/.test(pg), 'refusals are 403 by default');
  ok(!/drive\.copy|drive\.folder/.test(wp), 'the pass path never names a Drive copy or folder call itself');

  // ---- higgsfield-mcp wiring ---------------------------------------------------------------
  const idx = read(fnDir, 'higgsfield-mcp', 'index.ts');
  const tools = idx.slice(idx.indexOf('const TOOLS = ['), idx.indexOf('// ---- Input validation'));
  ok(tools.includes('name: "pipeline_pass"'), 'the tool is offered');
  const def = tools.slice(tools.indexOf('name: "pipeline_pass"'));
  ok(/required: \["client", "target"\]/.test(def) && /enum: \["test", "client"\]/.test(def), 'pipeline_pass takes client and target (test or client)');
  ok(!/team link/i.test(def.slice(0, def.indexOf('inputSchema'))), 'the description does not mention the team link');
  for (const t of ['client_brain', 'brain_change', 'studio_latest', 'studio_profile', 'studio_profile_save', 'team_usage', 'create']) ok(tools.includes(`name: "${t}"`), `${t} is still offered`);
  ok(/if \(name === "pipeline_pass"\) \{\n\s*return await pipelinePass\(db\(\), \{ member, author, teamLink: isTeamLink\(member\), client: String\(args\.client \|\| ""\), target: args\.target \}\);/.test(idx), 'the handler passes the link kind from who.mjs');
  ok(!/VIEWER_TOOLS = new Set\([^)]*pipeline_pass/.test(idx), 'the pass is not sent to the media viewer');
  const pp = read(fnDir, 'higgsfield-mcp', 'pipelinepass.ts');
  ok(pp.includes('from "../pipeline-google/pass.mjs"'), 'the connector uses the same token and hash code as pipeline-google');
  ok(pp.includes('findClient(db, opts.client)') && pp.includes('client_slug: storeSlug(p.client_slug)'), 'the client slug is resolved like the other client tools');
  ok(/if \(target === "client" && !opts\.teamLink\) \{\s*const \{ data, error \} = await db\.from\("fp_publishers"\)/.test(pp), 'the publish list is read only for a personal link asking for a client pass');
  ok(/token_hash: await passHash\(token\)/.test(pp) && !/token:\s*token[,\s]*\}\)\s*\n?\s*\.select/.test(pp) && !/insert\(\{[^}]*\btoken\b[,}]/.test(pp), 'only the hash is stored');

  // ---- The migration ---------------------------------------------------------------------------
  const migDir = path.join(root, 'supabase', 'migrations');
  const mig = fs.readdirSync(migDir).filter((f) => /filming_pipeline_passes\.sql$/.test(f));
  eq(mig.length, 1, 'one migration');
  const sql = read(migDir, mig[0]);
  const probe = sql.split('\n').slice(0, 40).join('\n').match(/^--\s*ef-auto-deploy-applied-when:\s*(.+?)\s*$/m);
  ok(probe, 'the migration says how to tell it is applied');
  require(path.join(root, 'scripts', 'repo-vs-live')).assertReadOnlyProbe(probe[1]);
  passed++;
  for (const t of ['fp_publishers', 'fp_settings', 'fp_passes', 'fp_pass_tabs', 'fp_files', 'fp_file_history', 'fp_batch_counter', 'fp_feedback_notes']) {
    ok(new RegExp(`create table if not exists public\\.${t} \\(`).test(sql), `${t} is created`);
    ok(new RegExp(`alter table public\\.${t} enable row level security`).test(sql), `${t} has row level security`);
  }
  ok(/revoke all on table public\.fp_publishers,[\s\S]*?from public, anon, authenticated, service_role;/.test(sql), 'the table revoke names all four roles');
  for (const f of ['fp_file_save(text, text, integer, text, text)', 'fp_take_batch(text)', 'fp_pass_use(text)']) {
    ok(sql.includes(`revoke all on function public.${f} from public, anon, authenticated, service_role;`), `${f}: revoke names all four roles`);
    ok(sql.includes(`grant execute on function public.${f} to service_role;`), `${f}: service_role may execute`);
  }
  ok(!/insert into public\.fp_/i.test(sql.replace(/\$fn\$[\s\S]*?\$fn\$/g, '')), 'nothing is seeded (inserts only inside the functions)');
  ok(/token_hash text not null unique check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/.test(sql) && !/\btoken text\b/.test(sql), 'only a SHA-256 hex hash is stored, never a token column');
  ok(/expires_at timestamptz not null default now\(\) \+ interval '6 hours'/.test(sql), 'a pass expires after 6 hours by default');
  ok(/check \(target = 'test' or via = 'personal'\)/.test(sql), 'the table itself refuses a client pass from the team link');
  ok(/if p_expected_version is distinct from cur then\s*return query select false/.test(sql), 'fp_file_save refuses a stale version');
  ok(/security definer\s*set search_path = public, pg_temp/.test(sql), 'the functions pin their search_path');

  console.log(`pipeline-pass: ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
