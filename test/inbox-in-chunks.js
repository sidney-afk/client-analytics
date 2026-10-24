'use strict';
/* inbox-in-chunks.js -- the Messages inbox's `.in()` id lists stay under the gateway's URL limit
 * (production-comments/chunks.mjs, OPEN_REPAIRS 484).
 *
 * An admin with every client in scope reads about 650 open posts. message_reads was read 500 post ids per request:
 * about 17 kB of URL, above the gateway's ~16 kB limit, so the read failed and the whole inbox answered 503 for
 * that person, every time. Fictional ids only.
 *   - 656 ids of 40 characters: no part's encoded list exceeds 8 kB, nothing is lost or reordered
 *   - the old rule (500 ids per part) breaks that bound, so this test fails on it
 *   - a part never holds more than 200 ids; a single oversized id still gets its own part
 *   - every `.in()` id list in production-comments goes through chunkIds; no fixed 500-id slicing is left
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };

// The bytes an `.in()` list costs in the URL: each id encoded, joined by an encoded comma.
const encodedBytes = part => part.map(id => encodeURIComponent(String(id))).join('%2C').length;
const LIMIT = 8 * 1024;

(async () => {
  const { chunkIds, IN_MAX_ITEMS, IN_MAX_BYTES } = await import(require('node:url').pathToFileURL(path.join(root, 'supabase/functions/production-comments/chunks.mjs')).href);
  const ids = Array.from({ length: 656 }, (_, i) => ('fixture-post-' + String(i).padStart(4, '0') + '-').padEnd(40, 'x'));

  const parts = chunkIds(ids);
  const worst = Math.max(...parts.map(encodedBytes));
  ok(worst <= LIMIT, `656 ids of 40 characters: the largest part is ${worst} bytes (limit ${LIMIT})`);
  ok(parts.flat().join('|') === ids.join('|'), `every id is kept, in order (${parts.length} parts)`);
  ok(parts.every(p => p.length <= IN_MAX_ITEMS), `no part holds more than ${IN_MAX_ITEMS} ids`);

  // The rule this replaces: 500 ids per part.
  const old = [];
  for (let i = 0; i < ids.length; i += 500) old.push(ids.slice(i, i + 500));
  ok(Math.max(...old.map(encodedBytes)) > LIMIT, 'the old 500-ids-per-part rule breaks the bound (what this test guards)');

  const odd = ['a', 'x'.repeat(IN_MAX_BYTES + 10), 'b'];
  const oddParts = chunkIds(odd);
  ok(oddParts.length === 3 && oddParts.flat().join() === odd.join(), 'an id larger than a whole part gets a part of its own');
  ok(chunkIds([]).length === 0 && chunkIds(null).length === 0, 'no ids: no requests');
  const encoded = Array.from({ length: 300 }, (_, i) => 'id with spaces & symbols ' + i);
  ok(Math.max(...chunkIds(encoded).map(encodedBytes)) <= LIMIT, 'ids that grow when URL-encoded are measured encoded');

  const src = fs.readFileSync(path.join(root, 'supabase/functions/production-comments/index.ts'), 'utf8');
  const inCalls = [...src.matchAll(/\.in\("([a-z_]+)"/g)].map(m => m[1]);
  const idLists = inCalls.filter(c => c !== 'client');
  ok(idLists.length === 3 && ['id', 'deliverable_id', 'post_id'].every(c => idLists.includes(c)), 'the inbox reads three id lists with .in(): ' + idLists.join(', '));
  ok((src.match(/chunkIds\(/g) || []).length === 3, 'each of them is split by chunkIds');
  ok(!/\+= 500\b|slice\(i, i \+ 500\)/.test(src), 'no fixed 500-id slicing is left');
  ok(/if \(scope !== "all"\) q = q\.in\("client", \[\.\.\.scope\]\)/.test(src), 'the client-slug .in() only runs for a limited scope (never the all-clients list)');

  if (failures) { console.error(`inbox-in-chunks: ${failures} failed`); process.exit(1); }
  console.log('inbox-in-chunks: all passed');
})().catch(e => { console.error(e); process.exit(1); });
