'use strict';
/*
 * title-name-rule-drift.js — the browser, the server and SQL must split and
 * rename sub-issue titles the same way (docs/ops/RENAME_PLAN.md section B).
 *
 * Source: supabase/functions/_shared/title-name-rule.mjs
 * Copies: src/index/125-title-name-rule.js.part (browser)
 *         migrations/2026-09-23-rename-propagation.sql (syncview_title_*)
 * Also held to it: production-write/policy.mjs's intakeTitleParts and
 * intakeChildTitle, which number new sub-issues.
 *
 * This suite runs the fixture table through the module, the browser copy and
 * policy.mjs, and pins the SQL copy's regex and whitespace text byte-for-byte
 * to the module's. test/rename-propagation-postgres.js runs the same fixtures
 * through the SQL functions on a disposable Postgres.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { TITLES, RENAMES, NAMES_OF } = require('./fixtures/title-name-rule-fixtures');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function loadBrowserCopy() {
  const src = read('src/index/125-title-name-rule.js.part');
  const begin = src.indexOf('// SYNC_TITLE_RULE BEGIN');
  const end = src.indexOf('// SYNC_TITLE_RULE END');
  assert.ok(begin >= 0 && end > begin, 'browser copy markers present');
  const body = src.slice(begin, end);
  return vm.runInNewContext(body + '\nSYNC_TITLE_RULE;', {});
}

function sqlRuleBlock() {
  const sql = read('migrations/2026-09-23-rename-propagation.sql');
  const begin = sql.indexOf('-- SYNC_TITLE_RULE_SQL BEGIN');
  const end = sql.indexOf('-- SYNC_TITLE_RULE_SQL END');
  assert.ok(begin >= 0 && end > begin, 'SQL copy markers present');
  return sql.slice(begin, end);
}

const plain = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
let checks = 0;
const same = (a, b, msg) => { assert.deepEqual(plain(a), plain(b), msg); checks++; };

(async () => {
  const rule = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/title-name-rule.mjs')).href);
  const policy = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/production-write/policy.mjs')).href);
  const browser = loadBrowserCopy();

  // Constants.
  same(browser.TITLE_SEPARATOR, rule.TITLE_SEPARATOR, 'browser separator');
  same(browser.NAME_MAX, rule.NAME_MAX, 'browser cap');
  same(browser.RULE_SOURCE, rule.RULE_SOURCE, 'browser regex source');
  same(policy.INTAKE_TITLE_SEPARATOR, rule.TITLE_SEPARATOR, 'policy separator');
  same(policy.INTAKE_NAME_MAX, rule.NAME_MAX, 'policy cap');

  // Parsing.
  for (const t of TITLES) {
    const ours = rule.titleParts(t);
    same(browser.titleParts(t), ours, 'browser titleParts ' + JSON.stringify(t));
    const theirs = policy.intakeTitleParts(t);
    same(theirs, ours && { kind: ours.kind, ordinal: ours.ordinal, name: ours.name },
      'policy intakeTitleParts ' + JSON.stringify(t));
  }

  // Renaming, against owner-pinned expectations.
  for (const [oldTitle, name, expected] of RENAMES) {
    const label = JSON.stringify([oldTitle, name]).slice(0, 120);
    same(rule.renameTitle(oldTitle, name), expected, 'module renameTitle ' + label);
    same(browser.renameTitle(oldTitle, name), expected, 'browser renameTitle ' + label);
  }
  for (const [title, name] of NAMES_OF) {
    same(rule.nameOfTitle(title), name, 'module nameOfTitle');
    same(browser.nameOfTitle(title), name, 'browser nameOfTitle');
  }

  // A rename of a numbered title composes exactly what intake would have made.
  for (const [, name] of RENAMES) {
    const cleaned = rule.cleanName(name);
    if (!cleaned || rule.nameLength(cleaned) > rule.NAME_MAX) continue;
    for (const [purpose, team, kind] of [['', 'video', 'Video'], ['samples', 'graphics', 'Sample Thumbnail']]) {
      same(rule.renameTitle(kind + ' 5', name).title, policy.intakeChildTitle(purpose, team, 5, name),
        'intake composer agrees for ' + kind);
    }
  }

  // The SQL copy spells the same regexes and cap.
  const block = sqlRuleBlock();
  const ws = rule.RULE_SOURCE.whitespace;
  assert.ok(block.includes("'^[" + ws + "]+|[" + ws + "]+$'"), 'SQL trim uses the module whitespace set'); checks++;
  assert.ok(block.includes("'[" + ws + "]+', ' '"), 'SQL clean uses the module whitespace set'); checks++;
  assert.ok(block.includes("'" + rule.RULE_SOURCE.title + "'"), 'SQL title regex equals the module regex'); checks++;
  assert.ok(block.includes("char_length(v_name) > " + rule.NAME_MAX), 'SQL cap equals NAME_MAX'); checks++;
  assert.ok(block.includes("' — ' || v_name"), 'SQL composes with the separator'); checks++;
  for (const reason of ['name_too_long', 'empty_name_not_propagated', 'name_would_look_numbered']) {
    assert.ok(block.includes("'" + reason + "'"), 'SQL reason ' + reason); checks++;
  }

  console.log('title-name-rule-drift: ' + checks + ' checks passed ✅');
})().catch((e) => { console.error(e); process.exit(1); });
