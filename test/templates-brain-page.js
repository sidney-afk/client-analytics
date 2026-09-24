'use strict';
// Source checks for the brain section of the Templates page (index.html is a build output).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const checks = [
  ['brain URL resolves lazily (CAL_SUPABASE_URL is declared in a later fragment)', /function _tplBrainUrl\(\) \{ return CAL_SUPABASE_URL \+ '\/functions\/v1\/brain'; \}/.test(INDEX) && !/const BRAIN_EF_URL\s*=\s*CAL_SUPABASE_URL/.test(INDEX)],
  ['a background rerender never wipes a change being typed', INDEX.includes("if (ae && ae.closest && ae.closest('.tpl-brain-form')) return;")],
  ['unsent change text is kept per fact and restored on render', INDEX.includes("_tplBrainDraft[key] || ''") && INDEX.includes("oninput=\"_tplBrainDraft[")],
  ['after sending, facts are re-read without a reload', /\[90, 240\]\.forEach\(sec => setTimeout\(\(\) => \{ if \(_templatesSelected === name\) _tplBrainEnsure\(name, true\);/.test(INDEX)],
  ['a stale ready copy refreshes on revisit', INDEX.includes('Date.now() - (cur.at || 0) < TPL_BRAIN_STALE_MS')],
  ['errors do not auto-retry on every render', INDEX.includes("(cur.state !== 'ready' ||")],
  ['a sent change can be followed by another', INDEX.includes('function tplBrainAnother(key)')],
  ['unreachable brain falls back to last SyncView values', INDEX.includes('${_tplBrainFallback(name)}')],
  ['working links list recent Frame folders and Raw footage from batches', INDEX.includes("action: 'folders'") && INDEX.includes('${_tplRecentFolders(name)}')],
  ['the editor brief is shown first, facts folded under "All facts, with sources"', INDEX.includes('function _tplBriefView(name, b)') && INDEX.includes('All facts, with sources')],
  ['brain buttons pass keys through data attributes, not quoted JS (names with apostrophes)', !/onclick="tpl(Brain(Open|Send|Another)|Brief(Change|ToggleSource))\('\$\{/.test(INDEX) && INDEX.includes('onclick="tplBriefToggleSource(this.dataset.k)"')],
  ['brief sections are colour-coded panels with shared labels shown once', INDEX.includes('function _tplBriefKind(heading)') && INDEX.includes('tpl-brief-label') && INDEX.includes('--brief-look:')],
  ['only the clicked brief row opens a change form, never a second copy in All facts', INDEX.includes('_tplBriefFormRow === srcKey') && INDEX.includes('if (fact && !fromBrief && _tplBriefFormRow)')],
  ['a failed folders load says so and can be retried', INDEX.includes('function tplFoldersRetry()') && INDEX.includes("Couldn't load recent folders.")],
];
let fail = 0;
for (const [name, ok] of checks) { console.log((ok ? '  ok  ' : 'FAIL  ') + name); if (!ok) fail++; }
assert.strictEqual(fail, 0, fail + ' templates-brain-page check(s) failed');
console.log('templates-brain-page checks passed');
