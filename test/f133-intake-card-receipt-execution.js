'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const edge = fs.readFileSync(path.join(
  ROOT, 'supabase', 'functions', 'production-write', 'index.ts',
), 'utf8');

let failures = 0;
function ok(condition, label) {
  if (condition) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = edge.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  const typedReturn = edge.indexOf('} {', start);
  const brace = typedReturn >= 0 ? typedReturn + 2 : edge.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < edge.length; index++) {
    const char = edge[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return edge.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

function executableReceiptFunction() {
  return extractFunction('exactIntakeCardReceipts')
    .replace(
      /function exactIntakeCardReceipts\([\s\S]*?\): \{ cards: JsonMap\[\]; superseded: boolean \} \{/,
      'function exactIntakeCardReceipts(observed, expected, itemRows, expectedBatchId, allowCurrentTitle = false) {',
    )
    .replace(
      /const exactItem = \(row: JsonMap \| null \| undefined, id: string, team: string\): boolean =>/,
      'const exactItem = (row, id, team) =>',
    );
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs',
  )).href);
  class GatewayError extends Error {
    constructor(status, code) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  const context = {
    clean: policy.clean,
    normalizeTeam: policy.normalizeTeam,
    canonicalTitle: policy.canonicalTitle,
    GatewayError,
    Map,
    Set,
  };
  vm.createContext(context);
  vm.runInContext(executableReceiptFunction(), context);

  const expected = [{
    id: 'card-1', client: 'fixture', name: 'Launch story',
    video_deliverable_id: 'video-1', graphic_deliverable_id: 'graphic-1',
  }];
  const observed = [{
    id: 'card-1', client: 'fixture', name: 'Launch story', title_revision: 0,
    video_deliverable_id: 'video-1', graphic_deliverable_id: 'graphic-1',
    linear_issue_id: 'https://linear.invalid/VID-1',
    graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
  }];
  const items = [
    {
      id: 'video-1', client_slug: 'fixture', batch_id: 'batch-1', origin: 'calendar',
      card_id: 'card-1', team: 'video', title: 'Launch story',
      linear_issue_url: 'https://linear.invalid/VID-1',
    },
    {
      id: 'graphic-1', client_slug: 'fixture', batch_id: 'batch-1', origin: 'calendar',
      card_id: 'card-1', team: 'graphics', title: 'Launch story',
      linear_issue_url: 'https://linear.invalid/GRA-1',
    },
  ];

  const valid = context.exactIntakeCardReceipts(observed, expected, items, 'batch-1');
  ok(valid.cards.length === 1 && valid.cards[0].name === 'Launch story' && valid.superseded === false,
    'gateway accepts an executed exact card and deliverable title receipt');

  const mismatched = items.map(row => ({ ...row }));
  mismatched[1].title = 'Different graphics title';
  let mismatchCode = '';
  try {
    context.exactIntakeCardReceipts(observed, expected, mismatched, 'batch-1');
  } catch (error) {
    mismatchCode = String(error && error.code || error && error.message || '');
  }
  ok(mismatchCode === 'native_card_receipt_invalid',
    'gateway rejects an executed server receipt when one deliverable title differs from its card');

  if (failures) {
    console.error(`\n${failures} F133 intake receipt execution check(s) failed.`);
    process.exit(1);
  }
  console.log('\nF133 intake receipt execution checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
