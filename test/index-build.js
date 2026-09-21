'use strict';
/*
 * index-build.js — gate test for src/index/INDEX.md.
 *
 * Independently derives the expected INDEX.md rows straight from
 * src/index/manifest.txt and the fragments it lists — this file does not
 * require scripts/build-index.js — and fails if the committed INDEX.md
 * differs from that independent derivation. This is what catches a stale
 * map: someone edits a fragment or the manifest and forgets to rerun
 * `npm run build:index`.
 *
 * The derivation rule mirrors the one documented in scripts/build-index.js:
 * per manifest entry, in order — the fragment's LF-delimited line count
 * (plus one for a final nonempty unterminated line), and its first banner
 * comment (a standalone `<!-- -->`, a standalone `/* *(/`, or a "decorated"
 * `//` banner line carrying a run of 3+ `-=─*#` characters — whichever
 * starts earliest in the fragment), or an em dash if none is found.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'index');
const MANIFEST_PATH = path.join(SRC_DIR, 'manifest.txt');
const INDEX_MD_PATH = path.join(SRC_DIR, 'INDEX.md');

let pass = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  pass++;
  console.log('OK  ' + msg);
}

function readManifestEntries() {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
}

function countLfDelimitedLines(buf) {
  let newlineCount = 0;
  let tailStart = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      newlineCount++;
      tailStart = i + 1;
    }
  }
  const hasTrailingUnterminatedLine = tailStart < buf.length;
  return newlineCount + (hasTrailingUnterminatedLine ? 1 : 0);
}

// A standalone opener: only whitespace between the start of its line and the token.
function findStandaloneOpeners(text, token) {
  const hits = [];
  let searchFrom = 0;
  for (;;) {
    const at = text.indexOf(token, searchFrom);
    if (at === -1) break;
    searchFrom = at + 1;
    let lineBegin = at;
    while (lineBegin > 0 && text[lineBegin - 1] !== '\n') lineBegin--;
    if (/^[ \t]*$/.test(text.slice(lineBegin, at))) hits.push(at);
  }
  return hits;
}

function trimDecorations(s) {
  let out = s;
  out = out.replace(/^[\s\-=*#>─]+/, '');
  out = out.replace(/[\s\-=*#<─]+$/, '');
  return out.trim();
}

function stripDates(s) {
  return s.replace(/\d{4}-\d{2}-\d{2}(?:[T ][0-9:]+Z?)?/g, '').replace(/ {2,}/g, ' ').trim();
}

function mdEscape(s) {
  return s.split('\\').join('\\\\').split('|').join('\\|');
}

function bannerFromDelimited(text, openAt, open, close) {
  const closeAt = text.indexOf(close, openAt + open.length);
  const inner = closeAt === -1 ? text.slice(openAt + open.length) : text.slice(openAt + open.length, closeAt);
  const candidateLines = inner.split('\n');
  for (const rawLine of candidateLines) {
    const cleaned = trimDecorations(rawLine.trim());
    if (cleaned) return cleaned;
  }
  return null;
}

function bannerFromDecoratedLineComment(text, matchStart) {
  const endOfFirst = text.indexOf('\n', matchStart);
  const firstLine = endOfFirst === -1 ? text.slice(matchStart) : text.slice(matchStart, endOfFirst);
  const firstText = trimDecorations(firstLine.replace(/^[ \t]*\/\//, '').trim());
  if (firstText) return firstText;

  let pos = endOfFirst;
  while (pos !== -1) {
    const nextEnd = text.indexOf('\n', pos + 1);
    const line = nextEnd === -1 ? text.slice(pos + 1) : text.slice(pos + 1, nextEnd);
    if (!/^[ \t]*\/\//.test(line)) return null;
    const cleaned = trimDecorations(line.replace(/^[ \t]*\/\//, '').trim());
    if (cleaned) return cleaned;
    pos = nextEnd;
  }
  return null;
}

function deriveBanner(buf) {
  const text = buf.toString('utf8');

  const htmlOpeners = findStandaloneOpeners(text, '<!--');
  const blockOpeners = findStandaloneOpeners(text, '/*');
  const decoratedLineRe = /^[ \t]*\/\/.*[\-=─*#]{3,}.*$/m;
  const decoratedMatch = decoratedLineRe.exec(text);

  const candidates = [];
  if (htmlOpeners.length) candidates.push({ kind: 'html', at: htmlOpeners[0] });
  if (blockOpeners.length) candidates.push({ kind: 'block', at: blockOpeners[0] });
  if (decoratedMatch) candidates.push({ kind: 'decorated-line', at: decoratedMatch.index });
  if (candidates.length === 0) return '—';

  candidates.sort((a, b) => a.at - b.at);
  const chosen = candidates[0];

  let banner = null;
  if (chosen.kind === 'html') banner = bannerFromDelimited(text, chosen.at, '<!--', '-->');
  else if (chosen.kind === 'block') banner = bannerFromDelimited(text, chosen.at, '/*', '*/');
  else banner = bannerFromDecoratedLineComment(text, chosen.at);

  if (!banner) return '—';
  const finalText = mdEscape(stripDates(banner));
  return finalText || '—';
}

function deriveExpectedRows() {
  const entries = readManifestEntries();
  return entries.map((entry, i) => {
    const buf = fs.readFileSync(path.join(SRC_DIR, entry));
    const lines = countLfDelimitedLines(buf);
    const banner = deriveBanner(buf);
    return `| ${i + 1} | \`${entry}\` | ${lines} | ${banner} |`;
  });
}

const actualIndexMd = fs.readFileSync(INDEX_MD_PATH, 'utf8');
const actualLines = actualIndexMd.split(/\r?\n/);
const headerAt = actualLines.findIndex((l) => l.startsWith('|---'));
ok(headerAt !== -1, 'INDEX.md has a table header separator');

const actualRows = actualLines.slice(headerAt + 1).filter((l) => l.startsWith('|'));
const expectedRows = deriveExpectedRows();

ok(actualRows.length === expectedRows.length, `INDEX.md has ${expectedRows.length} fragment row(s) (found ${actualRows.length})`);
for (let i = 0; i < expectedRows.length; i++) {
  ok(actualRows[i] === expectedRows[i], `INDEX.md row ${i + 1} matches independently derived row`);
}

console.log(`\nindex-build: ${pass} check(s) passed`);
