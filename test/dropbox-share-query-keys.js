'use strict';
/*
 * A DROPBOX SHARE LINK COPIED OUT OF DROPBOX MUST BE SAVEABLE.
 *
 * OWNER REPORT, 2026-09-05, filed as a cosmetic complaint: a sub-issue's Raw
 * footage sat under a red `Invalid` beside a working "Open folder" link -- "can
 * we change the cosmetic thing that says invalid for a Dropbox folder for the
 * raw footage, because it's okay, it's acceptable."
 *
 * It was not cosmetic, and that is the reason this suite exists rather than a
 * one-line addition to the allowlist. Dropbox appends `st=` to every share link
 * its current UI produces, and a link copied while browsing into a subfolder
 * also carries `subfolder_nav_tracking=1`. Neither key was on
 * SAFE_ASSET_QUERY_KEYS, so `providerQuerySafe` refused the URL and
 * `assetUrlType` answered `invalid` -- which is not only the red pill. The same
 * predicate gates `handleBatchAssetWrite` (400 invalid_artifact_url) and
 * `canonicalArtifactUrl` (null), so no such link could be SAVED into raw
 * footage, the frame folder or the deliverable file, from any seat. All four
 * links in the owner's own screenshots failed on it.
 *
 * The 2026-09-01 ruling that widened `assetTypeAllowed` to accept a Dropbox
 * FILE for these slots was aimed at the same report and could not reach it: the
 * refusal is decided one step earlier, on the query rather than on the shape.
 *
 * What this suite protects is the pair of properties, not the key list: real
 * provider links pass, and the things that must never pass still do not.
 */
const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POLICY = path.join(ROOT, 'supabase/functions/production-write/policy.mjs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

(async () => {
  const { assetUrlType, assetTypeAllowed, canonicalArtifactUrl, assetProbeUrl } =
    await import('file://' + POLICY);

  /* ---- 1. The owner's actual links, verbatim from the report ------------ */

  /* Real share links, kept because a synthesised one would drift from the shape
     Dropbox actually emits -- which is the entire failure mode here. The path
     ids and rlkeys are share identifiers for a client folder, so they are
     REPLACED with same-shaped placeholders: this repo is public, and a live
     share link in a fixture is a link anyone can open. Only the QUERY KEYS are
     load-bearing for these assertions, and those are reproduced exactly. */
  const RAW_FOOTAGE_FILE =
    'https://www.dropbox.com/scl/fi/aaaaaaaaaaaaaaaaaaaaa/C0000.MP4?rlkey=bbbbbbbbbbbbbbbbbbbbb&st=cccccccc&dl=0';
  const FRAME_FOLDER =
    'https://www.dropbox.com/scl/fo/ddddddddddddddddddddd/EEEEEEEEEEEEEEEEEEEE?rlkey=bbbbbbbbbbbbbbbbbbbbb&st=ffffffff&dl=0';
  const PHOTOS_SUBFOLDER =
    'https://www.dropbox.com/scl/fo/ddddddddddddddddddddd/GGGGGGGGGGGGGGGGGGGG/Photos?rlkey=bbbbbbbbbbbbbbbbbbbbb&subfolder_nav_tracking=1&st=hhhhhhhh&dl=0';

  ok(assetUrlType(RAW_FOOTAGE_FILE) === 'file',
    "THE REPORT: a Dropbox file share carrying `st` types as a file rather than `invalid` -- this is the link that sat under the red pill");
  ok(assetUrlType(FRAME_FOLDER) === 'folder',
    'and a Dropbox folder share carrying `st` types as a folder');
  ok(assetUrlType(PHOTOS_SUBFOLDER) === 'folder',
    'including one copied while browsing a subfolder, which also carries `subfolder_nav_tracking`');

  for (const [label, url] of [['file', RAW_FOOTAGE_FILE], ['folder', FRAME_FOLDER], ['subfolder', PHOTOS_SUBFOLDER]]) {
    ok(assetTypeAllowed('raw_footage', url) && assetTypeAllowed('delivery_folder', url)
      && assetTypeAllowed('deliverable_file', url),
      `and the ${label} link is accepted for raw footage, the frame folder and the deliverable file -- the same predicate gates the WRITE, so this is what makes the link saveable at all rather than merely un-red`);
  }

  /* ---- 2. What must still be refused ------------------------------------ */

  ok(!assetTypeAllowed('raw_footage', 'https://docs.google.com/document/d/abc/edit'),
    'a Google Doc is still not raw footage: a brief is not footage, and the host allowlist -- not the query list -- is what protects these slots');
  ok(assetUrlType('https://evil.example.com/x?st=1') === 'invalid',
    'and an off-allowlist host is still refused outright, so widening the query list cannot let a non-provider URL through');
  ok(assetUrlType('https://www.dropbox.com/scl/fo/a/b?rlkey=k&signature=zzz') === 'invalid',
    'a credential-bearing query is still refused -- CREDENTIAL_QUERY_KEY rejects token, auth, key, secret, signature, sig, expires, credential and policy, and neither new key matches it');
  ok(assetUrlType('https://www.dropbox.com/scl/fo/a/b?rlkey=k&access_token=zzz') === 'invalid',
    'including one spelled as an access token');
  ok(assetUrlType('http://www.dropbox.com/scl/fo/a/b?rlkey=k&st=x') === 'invalid',
    'and plain HTTP is still refused whatever the query carries');

  /* ---- 3. The volatile parameter is not persisted as canonical ---------- */

  const canonical = canonicalArtifactUrl(RAW_FOOTAGE_FILE);
  ok(typeof canonical === 'string' && canonical.includes('rlkey='),
    'the canonical deliverable form keeps `rlkey`, which is the stable share identity');
  ok(typeof canonical === 'string' && !canonical.includes('st=')
    && !canonical.includes('subfolder_nav_tracking') && !canonical.includes('dl='),
    'and drops `st` along with the other display parameters -- accepted so the link VALIDATES, never stored as though it were the share identity');

  /* ---- 4. The property that made the original gap findable -------------- */

  /* Every URL the gateway BUILDS to probe with must itself pass assetUrlType.
     test/asset-probe-url-policy.js holds this for the Drive and Docs probes;
     repeated here for the Dropbox ones, because the probe rewrites the query
     (`dl` out, `raw` in) and a rewrite that produced an unprobeable URL is
     exactly how `export`/`format` went missing in 2026-08. */
  for (const url of [RAW_FOOTAGE_FILE, FRAME_FOLDER, PHOTOS_SUBFOLDER]) {
    const probe = assetProbeUrl(url);
    ok(assetUrlType(probe) !== 'invalid',
      'the probe URL built from ' + new URL(url).pathname.slice(0, 24) + '… is itself valid, so the fetch is actually attempted rather than refused at hop 0');
  }

  assert.ok(true);
  console.log(failures === 0
    ? '\nDropbox share query key checks passed'
    : '\n' + failures + ' Dropbox share query key check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
