'use strict';
// TikTok Upload showed its limit as "287.0 MB". Both byte formatters (Upload
// and Pilot) now drop a bare ".0" and keep a real decimal. Executes the
// shipped functions extracted from index.html.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  const start = INDEX.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing ' + name);
  let depth = 0;
  for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}' && --depth === 0) return INDEX.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}
const limitExpr = (INDEX.match(/const TIKTOK_MAX_BYTES\s*=\s*([^;]+);/) || [])[1];
const TIKTOK_MAX_BYTES = limitExpr ? vm.runInNewContext(limitExpr) : NaN;
for (const name of ['_tkFormatBytes', '_ttpFormatBytes']) {
  const ctx = {};
  vm.runInNewContext(extract(name) + `; this.fmt = ${name};`, ctx);
  const fmt = ctx.fmt;
  assert.equal(fmt(287 * 1024 * 1024), '287 MB', name + ': a whole number of MB has no ".0"');
  assert.equal(fmt(12.4 * 1024 * 1024), '12.4 MB', name + ': a real decimal is kept');
  assert.equal(fmt(2 * 1024 * 1024 * 1024), '2 GB', name + ': GB also drops ".0"');
  assert.equal(fmt(512), '512 B', name + ': bytes are whole');
  assert.equal(fmt(0), '0 B', name + ': zero');
  if (name === '_tkFormatBytes' && Number.isFinite(TIKTOK_MAX_BYTES)) {
    assert(!/\.0 /.test(fmt(TIKTOK_MAX_BYTES)), 'the shipped video limit label has no ".0": ' + fmt(TIKTOK_MAX_BYTES));
    console.log('  video limit label: ' + fmt(TIKTOK_MAX_BYTES));
  }
}
console.log('tiktok-size-label: byte labels drop a bare ".0" ✅');
