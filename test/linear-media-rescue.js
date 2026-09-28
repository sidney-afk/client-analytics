'use strict';
/*
 * LX-E — the pure half of the Linear media rescue.
 *
 * Everything here runs offline: no network, no Deno, no live backend, so it
 * passes in the sandbox and in CI. What it is guarding:
 *
 *   1. The SCANNER reports exact offsets. The rewrite is a blind splice on
 *      those numbers into a client-facing brief, so an offset that is one
 *      character out silently eats a character of somebody's brief. Every
 *      offset below is hand-computed and written down as a literal.
 *
 *   2. The BARE-FORM TAIL. The lifted regex stops at `)` and `]` but not at
 *      `.`, so a URL ending a sentence captured the period and the splice
 *      would have deleted it. `trimBareTail` mirrors the renderer's own
 *      `trimLinkTail` (index.html:54937) so both agree where a URL ends.
 *
 *   3. The JOIN KEY. Linear re-mints the `?signature=` JWT on every read — the
 *      same file read twice five minutes apart came back with an identical
 *      path and a completely different signature (measured 2026-09-07). So
 *      `mediaKey` must ignore the query entirely, and two differently-signed
 *      URLs for one file must collapse to one key and one upload.
 *
 *   4. The ROLLBACK is the exact inverse of the forward, byte for byte.
 *
 *   5. The MANIFEST CANNOT LAND IN GIT. A stored URL carries a JWT and the
 *      workspace/file UUIDs, and this repo is public.
 *
 * No real URL appears in this file. Every fixture uses invented UUIDs.
 */
const path = require('path');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Invented, non-resolving. Shaped like the real thing (three UUID path
   segments plus a signature) so the scanner is exercised on the real shape. */
const HOST = 'https://uploads.linear.app';
const P1 = '/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333';
const P2 = '/11111111-1111-4111-8111-111111111111/44444444-4444-4444-8444-444444444444/55555555-5555-4555-8555-555555555555';
const SIG_A = '?signature=aaaa.bbbb.cccc';
const SIG_B = '?signature=dddd.eeee.ffff';
const NEW1 = 'https://x.supabase.co/storage/v1/object/public/syncview-description-images/aaa.png';
const NEW2 = 'https://x.supabase.co/storage/v1/object/public/syncview-description-images/bbb.png';

(async () => {
const M = await import('../scripts/linear-media-rescue.mjs');

/* ---- 1. Scanner offsets, hand-computed ------------------------------- */

/* `![](` is 4 characters, so the URL starts at offset 4. */
const imageForm = `![](${HOST}${P1}${SIG_A})`;
{
  const occ = M.mediaOccurrences(imageForm);
  ok(occ.length === 1, 'image form: one occurrence');
  ok(occ[0].offset === 4, 'image form: offset is the hand-computed 4');
  ok(occ[0].length === (HOST + P1 + SIG_A).length, 'image form: length is the whole signed URL');
  ok(occ[0].form === 'bare', 'image form: the URL itself is the bare form inside `![]()`');
  ok(imageForm.slice(occ[0].offset, occ[0].offset + occ[0].length) === HOST + P1 + SIG_A,
    'image form: the slice IS the URL');
}

/* `![](<` is 5 characters; the offset must skip the `<`. */
const angleForm = `![](<${HOST}${P1}${SIG_A}>)`;
{
  const occ = M.mediaOccurrences(angleForm);
  ok(occ.length === 1, 'angle form: one occurrence');
  ok(occ[0].offset === 5, 'angle form: offset skips the `<`, hand-computed 5');
  ok(occ[0].form === 'angle', 'angle form: reported as the angle form');
  ok(angleForm.slice(occ[0].offset, occ[0].offset + occ[0].length) === HOST + P1 + SIG_A,
    'angle form: the slice excludes both brackets');
}

/* Repeated occurrences, offsets independently hand-computed. */
{
  const url = HOST + P1 + SIG_A;
  const text = `a ${url} b ${url} c ${url}`;
  const occ = M.mediaOccurrences(text);
  ok(occ.length === 3, 'repeats: three occurrences');
  ok(occ[0].offset === 2, 'repeats: first at 2');
  ok(occ[1].offset === 2 + url.length + 3, 'repeats: second at 2 + len + 3');
  ok(occ[2].offset === 2 + 2 * url.length + 6, 'repeats: third at 2 + 2*len + 6');
  ok(occ.every(o => text.slice(o.offset, o.offset + o.length) === url),
    'repeats: every slice is exactly the URL');
}

/* Zero occurrences, and the shapes that must NOT match. */
{
  ok(M.mediaOccurrences('no media here at all').length === 0, 'no occurrences in plain text');
  ok(M.mediaOccurrences('').length === 0, 'no occurrences in an empty brief');
  ok(M.mediaOccurrences(null).length === 0, 'no occurrences in a null brief');
  ok(M.mediaOccurrences('https://uploads.linear.example/x').length === 0,
    'a look-alike host is not matched');
}

/* ---- 2. The trailing-punctuation bug this lane had to fix ------------- */

{
  const url = HOST + P1;
  const text = `See ${url}.`;
  const occ = M.mediaOccurrences(text);
  ok(occ.length === 1, 'trailing period: one occurrence');
  ok(occ[0].url === url, 'trailing period: the period is NOT part of the URL');
  ok(occ[0].length === url.length, 'trailing period: length excludes the period');
  const rewritten = M.rewriteText(text, occ, () => NEW1);
  ok(rewritten.text === `See ${NEW1}.`,
    'trailing period: the splice preserves the sentence-ending period');
}
{
  const url = HOST + P1;
  for (const [tail, label] of [[',', 'comma'], ['!', 'bang'], ['?', 'question'], [';', 'semicolon'], ['**', 'bold close']]) {
    const occ = M.mediaOccurrences(`x ${url}${tail} y`);
    ok(occ.length === 1 && occ[0].url === url, `trailing ${label} is excluded from the URL`);
  }
}
{
  /* `)` and `]` are excluded by the lifted regex itself, and that is what makes
     `![](url)` work at all — the closing paren must not be eaten. */
  const url = HOST + P1;
  const occ = M.mediaOccurrences(`![](${url})`);
  ok(occ.length === 1 && occ[0].url === url, 'a closing paren is excluded from the URL');
}
{
  /* The angle form is deliberately NOT tail-trimmed: the brackets delimit it
     and the renderer does not trim it either. */
  const occ = M.mediaOccurrences(`<${HOST}${P1}.>`);
  ok(occ.length === 1 && occ[0].url === HOST + P1 + '.',
    'the angle form keeps a trailing dot, matching the renderer');
}

/* ---- 3. The join key ignores the re-minted signature ------------------ */

{
  const a = HOST + P1 + SIG_A;
  const b = HOST + P1 + SIG_B;
  ok(a !== b, 'two reads of one file produce different URLs');
  ok(M.mediaKey(a) === M.mediaKey(b),
    'but mediaKey collapses them: the path is the identity, the signature is not');
  ok(M.mediaKey(a) === HOST + P1, 'mediaKey is origin + pathname with no query');
  ok(M.mediaKey(HOST + P2) !== M.mediaKey(a), 'different files keep different keys');
  ok(M.mediaKeyHash(a) === M.mediaKeyHash(b),
    'the publishable hash is stable across signatures, so it is a usable public handle');
  ok(!M.mediaKeyHash(a).includes('linear'), 'the publishable hash leaks no URL');
}
{
  /* The whole point: one brief carrying the same file under two signatures
     must rewrite both occurrences from a single uploaded object. */
  const text = `one ${HOST}${P1}${SIG_A} two ${HOST}${P1}${SIG_B}`;
  const occ = M.mediaOccurrences(text);
  const map = { [HOST + P1]: { new_url: NEW1 } };
  const out = M.rewriteText(text, occ, u => map[M.mediaKey(u)]?.new_url);
  ok(out.replaced === 2, 'both differently-signed occurrences resolve from one upload');
  ok(out.text === `one ${NEW1} two ${NEW1}`, 'and both are rewritten to the same new URL');
}

/* ---- 4. The splice preserves every non-URL byte ---------------------- */

{
  const text = [
    '# Brief',
    '',
    `![](${HOST}${P1}${SIG_A})`,
    '',
    'Match the reference above. Notes: **bold**, `code`, a Drive link',
    'https://drive.google.com/file/d/abc/view and an apostrophe: it\'s fine.',
    '',
    `![alt text](<${HOST}${P2}${SIG_B}>)`,
    '',
    'End.',
  ].join('\n');
  const occ = M.mediaOccurrences(text);
  ok(occ.length === 2, 'mixed brief: exactly the two Linear URLs are found');
  const map = { [HOST + P1]: { new_url: NEW1 }, [HOST + P2]: { new_url: NEW2 } };
  const out = M.rewriteText(text, occ, u => map[M.mediaKey(u)]?.new_url);

  ok(!out.text.includes('uploads.linear.app'), 'mixed brief: no Linear URL survives');
  ok(out.text.includes(`![](${NEW1})`), 'mixed brief: `![](…)` stays image syntax');
  ok(out.text.includes(`![alt text](<${NEW2}>)`), 'mixed brief: the angle form stays the angle form');
  ok(out.text.includes('https://drive.google.com/file/d/abc/view'), 'mixed brief: a Drive link is untouched');
  ok(out.text.includes('**bold**') && out.text.includes('`code`'), 'mixed brief: markdown is untouched');
  ok(out.text.includes("it's fine."), 'mixed brief: an apostrophe survives the round trip');

  /* Every character that is not inside a replaced run is byte-identical. */
  const strip = s => s.replace(/https?:\/\/\S*?(?=[)>\s]|$)/g, '<URL>');
  ok(strip(out.text) === strip(text), 'mixed brief: every non-URL byte is identical');
}
{
  /* An occurrence with no uploaded object is left alone, not blanked. */
  const text = `![](${HOST}${P1}${SIG_A})`;
  const out = M.rewriteText(text, M.mediaOccurrences(text), () => undefined);
  ok(out.replaced === 0 && out.skipped.length === 1, 'an unresolved occurrence is reported as skipped');
  ok(out.text === text, 'and the brief is returned untouched rather than emptied');
}
{
  /* If the recorded offset no longer matches the recorded URL, refuse. */
  let threw = false;
  try {
    M.rewriteText('completely different text', [{ offset: 0, length: 5, url: 'https://x' }], () => NEW1);
  } catch (_) { threw = true; }
  ok(threw, 'a stale offset throws rather than splicing the wrong bytes');
}

/* ---- 5. The SQL is a compare-and-swap that fails loudly --------------- */

{
  const rows = [{
    table: 'deliverables', column: 'brief', id: 'GRA-1',
    from: "old brief with 'quotes'", to: 'new brief',
  }];
  const sql = M.buildSql(rows, { title: 'test' });
  ok(sql.startsWith('-- test'), 'sql: carries its title');
  ok(sql.includes('begin;') && sql.includes('commit;'), 'sql: one transaction');
  ok(sql.includes("and brief = 'old brief with ''quotes'''"),
    'sql: the WHERE pins the exact pre-image, with quotes doubled');
  ok(!/where id = '[^']*';/.test(sql), 'sql: no statement matches on id alone');
  ok(sql.includes('raise exception'), 'sql: a mismatch raises');
  ok(sql.includes('lxe_applied'), 'sql: every row banks its row_count for the guard');
  ok((sql.match(/\$lxe_guard\$/g) || []).length === 2,
    'sql: exactly one dollar-quoted block, and it is the guard');
  const guard = sql.slice(sql.indexOf('do $lxe_guard$'));
  ok(!guard.includes('old brief'), 'sql: no corpus text is inside the dollar-quoted block, so no tag can collide');
}
{
  ok(M.sqlText("it's") === "'it''s'", 'sqlText doubles a single quote');
  ok(M.sqlText('a\\b') === "'a\\b'", 'sqlText leaves a backslash literal (standard_conforming_strings)');
}

/* ---- 6. Forward and rollback are exact inverses ----------------------- */

{
  const original = `see ${HOST}${P1}${SIG_A} and ${HOST}${P2}${SIG_B}.`;
  const occ = M.mediaOccurrences(original);
  const map = { [HOST + P1]: { new_url: NEW1 }, [HOST + P2]: { new_url: NEW2 } };
  const forwardText = M.rewriteText(original, occ, u => map[M.mediaKey(u)]?.new_url).text;

  const fwd = M.buildSql([{ table: 'deliverables', column: 'brief', id: 'GRA-1', from: original, to: forwardText }], { title: 'f' });
  const back = M.buildSql([{ table: 'deliverables', column: 'brief', id: 'GRA-1', from: forwardText, to: original }], { title: 'r' });

  ok(fwd.includes(M.sqlText(original)) && fwd.includes(M.sqlText(forwardText)),
    'forward carries both the old and the new literal');
  ok(back.includes(`and brief = ${M.sqlText(forwardText)}`),
    'rollback is guarded on the NEW literal, so it cannot fire twice or clobber a later edit');
  ok(back.includes(`set brief = ${M.sqlText(original)}`),
    'rollback restores the original bytes exactly');
  ok(forwardText !== original, 'the forward genuinely changed something');

  /* Replaying rollback over the forward text returns the original. */
  const replayed = forwardText
    .split(NEW1).join(HOST + P1 + SIG_A)
    .split(NEW2).join(HOST + P2 + SIG_B);
  ok(replayed === original, 'replaying the inverse substitution reproduces the original byte for byte');
}

/* ---- 7. The manifest may not be written into a git tree --------------- */

{
  let threw = false;
  let message = '';
  try { M.assertPrivatePath(path.join(__dirname, '..', 'docs', 'ops', 'manifest.json')); }
  catch (error) { threw = true; message = String(error.message); }
  ok(threw, 'writing a manifest inside this repo is refused');
  ok(/public/.test(message), 'and the refusal says why: the repo is public');
}
{
  let ok_ = true;
  try { M.assertPrivatePath(path.join(require('node:os').tmpdir(), 'nowhere-near-git', 'manifest.json')); } catch (_) { ok_ = false; }
  ok(ok_, 'a path outside any git tree is allowed');
}

/* ---- 8. This suite itself leaks nothing ------------------------------ */

{
  const self = require('fs').readFileSync(__filename, 'utf8');
  const real = self.match(/uploads\.linear\.app\/[0-9a-f]{8}-/gi) || [];
  ok(real.length === 0, 'no captured Linear URL is embedded in this test');
  /* Built from parts so this check does not trip over its own pattern. */
  const jwtProbe = new RegExp('signature=' + 'eyJ');
  ok(!jwtProbe.test(self.replace(/'eyJ'/g, '')), 'no real signed JWT is embedded in this test');
}

if (failures) {
  console.error(`\n${failures} linear media rescue check(s) failed ❌`);
  process.exit(1);
}
console.log('\nLinear media rescue checks passed');
})();
