'use strict';
/*
 * The Graphics SMM-approval artifact gate, EXECUTED rather than pattern-matched.
 *
 * `test/production-attachments.js` pins this gate's shape with source regexes.
 * That is necessary — the edge function is Deno TypeScript and cannot simply be
 * required here — but it cannot answer the question that decides a Monday
 * morning: given a real deliverable row and a real card row, WHICH link does
 * the gate choose, and does it still refuse what it must refuse?
 *
 * So this suite slices `graphicsApprovalArtifactCandidate` out of the deployed
 * source, strips only its type annotations, and runs it against fake rows using
 * the REAL `canonicalArtifactUrl` from policy.mjs.
 *
 * WHY IT EXISTS (2026-08-16, the day of the graphics flip): `file_url` is
 * settable only through the Production tab's attach box or the B1 delivery-link
 * sweep, and that sweep harvests links out of LINEAR comments — a source the
 * flip retired the same day this gate became load-bearing. Measured that day:
 * 1,972 of 2,009 active graphics deliverables had no canonical link, while
 * 6,431 calendar cards carried a thumbnail link the gate could not see.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const EDGE = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

(async () => {
  const { canonicalArtifactUrl } = await import(
    'file://' + path.join(ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs'));

  const start = EDGE.indexOf('async function graphicsApprovalArtifactCandidate(');
  const end = EDGE.indexOf('\nasync function assertGraphicsApprovalArtifact(', start);
  ok(start > -1 && end > start, 'the candidate resolver is present in the deployed source');
  const source = EDGE.slice(start, end)
    .replace('supabase: SupabaseClient,', 'supabase,')
    .replace('deliverable: JsonMap,', 'deliverable,')
    .replace(/\)\s*:\s*Promise<\{[^}]*\}\s*\|\s*null>\s*\{/, ') {')
    .replace('const card = (data || {}) as JsonMap;', 'const card = data || {};');

  class GatewayError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const context = {
    clean: value => String(value == null ? '' : value).trim(),
    canonicalArtifactUrl,
    GatewayError,
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}; this.graphicsApprovalArtifactCandidate = graphicsApprovalArtifactCandidate;`,
    context);
  const candidate = context.graphicsApprovalArtifactCandidate;

  // A fake PostgREST-ish client that returns exactly one card row.
  const clientFor = (cardRow, error = null) => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: cardRow, error }) }),
      }),
    }),
  });

  const DRIVE_FILE = 'https://drive.google.com/file/d/TEST_FILE_ID/view?usp=drive_link';
  const DRIVE_FOLDER = 'https://drive.google.com/drive/folders/TEST_FOLDER_ID';
  const FRAME_SHARE = 'https://f.io/TEST_SHARE';
  const GOOGLE_DOC = 'https://docs.google.com/document/d/TEST_DOC/edit';
  const DELIVERABLE = { id: 'del-1', team: 'graphics', card_id: 'card-1' };

  // 1. The canonical field still wins whenever it resolves.
  let got = await candidate(clientFor({ id: 'card-1', thumbnail_url: DRIVE_FILE }), {
    ...DELIVERABLE, file_url: 'https://www.dropbox.com/scl/fi/TEST_FILE?raw=1',
  });
  ok(got && got.source === 'deliverable', 'a resolvable file_url is preferred over the card link');

  // 2. The fallback picks up the card thumbnail when file_url is empty.
  got = await candidate(clientFor({ id: 'card-1', thumbnail_url: DRIVE_FILE }), DELIVERABLE);
  ok(got && got.source === 'card' && got.url === DRIVE_FILE,
    'an empty file_url falls back to the bound card thumbnail');

  // 3. The owner's shapes: a Frame.io link and a Drive FOLDER both qualify.
  got = await candidate(clientFor({ id: 'card-1', thumbnail_url: FRAME_SHARE }), DELIVERABLE);
  ok(got && got.source === 'card' && got.url === FRAME_SHARE,
    'a Frame.io link on the card is a usable Graphics deliverable');
  got = await candidate(clientFor({ id: 'card-1', thumbnail_url: DRIVE_FOLDER }), DELIVERABLE);
  ok(got && got.source === 'card' && got.url === DRIVE_FOLDER,
    'a Drive folder on the card is a usable Graphics deliverable');

  // 4. Widening the shape did not widen the allowlist: a Doc is still a brief.
  got = await candidate(clientFor({ id: 'card-1', thumbnail_url: GOOGLE_DOC }), DELIVERABLE);
  ok(got === null, 'a Google Doc on the card is still refused');
  got = await candidate(
    clientFor({ id: 'card-1', thumbnail_url: 'https://example.com/whatever.png' }), DELIVERABLE);
  ok(got === null, 'an off-allowlist link on the card is still refused');

  // 5. Binding: a card naming a different graphic deliverable cannot speak here.
  got = await candidate(
    clientFor({ id: 'card-1', thumbnail_url: DRIVE_FILE, graphic_deliverable_id: 'del-OTHER' }),
    DELIVERABLE);
  ok(got === null, 'a card bound to a different graphic deliverable is refused');
  got = await candidate(
    clientFor({ id: 'card-1', thumbnail_url: DRIVE_FILE, graphic_deliverable_id: 'del-1' }),
    DELIVERABLE);
  ok(got && got.source === 'card', 'a card that names THIS deliverable is accepted');

  // 6. No card, wrong card, empty thumbnail, or no binding at all: fail closed.
  ok(await candidate(clientFor(null), DELIVERABLE) === null, 'a missing card row fails closed');
  ok(await candidate(clientFor({ id: 'card-OTHER', thumbnail_url: DRIVE_FILE }), DELIVERABLE) === null,
    'a card whose id does not match fails closed');
  ok(await candidate(clientFor({ id: 'card-1', thumbnail_url: '' }), DELIVERABLE) === null,
    'a card with no thumbnail fails closed');
  ok(await candidate(clientFor({ id: 'card-1', thumbnail_url: DRIVE_FILE }),
    { id: 'del-1', team: 'graphics' }) === null,
  'a deliverable with no card_id never reaches the fallback');

  // 7. A lookup error must not be swallowed into "no artifact" — that would
  //    turn a transient database blip into a refusal nobody can act on.
  let threw = null;
  try {
    await candidate(clientFor(null, { message: 'boom' }), DELIVERABLE);
  } catch (error) { threw = error; }
  ok(threw && threw.status === 503 && threw.code === 'entity_lookup_unavailable',
    'a card lookup failure raises 503, never a silent artifact refusal');

  if (failures) {
    console.error(`\n${failures} graphics artifact fallback check(s) failed`);
    process.exit(1);
  }
  console.log('\ngraphics artifact card-fallback checks passed');
})();
