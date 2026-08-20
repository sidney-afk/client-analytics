'use strict';

/*
 * THE PROPERTY: every URL `assetProbeUrl` constructs must pass `assetUrlType`.
 *
 * `boundedAssetFetch` derives a probe URL from an already-validated share link,
 * then validates that derived URL again through `assetProbeRedirectAllowed` ->
 * `assetUrlType`. If the two disagree, the probe throws `asset_redirect_invalid`
 * at hop 0 and never makes a single request — while reporting the generic
 * `unavailable`, which reads like a network or sharing problem.
 *
 * They did disagree, silently, for as long as the probe has existed:
 * `assetProbeUrl` adds `export=download` for Drive and `format=pdf` for Docs,
 * and neither key was in `SAFE_ASSET_QUERY_KEYS`. Every Google Drive and Google
 * Docs artifact was therefore unprobeable, which — once Graphics moves to
 * SyncView authority — means no Drive-hosted graphic could ever pass
 * `assertGraphicsApprovalArtifact`. Dropbox worked, because `raw` and `rlkey`
 * were both allowed, which is exactly why the failure looked provider-specific
 * rather than structural.
 *
 * This file asserts the PROPERTY, not the instance. A future provider added to
 * `assetProbeUrl` with a query key nobody added to the allowlist fails here
 * instead of in production.
 */

const {
  assetProbeUrl,
  assetUrlType,
  assetTypeAllowed,
} = require('../supabase/functions/production-write/policy.mjs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

/*
 * Every share-link shape the gateway accepts as input. If `assetUrlType`
 * classifies the INPUT as usable, the probe URL derived from it must also be
 * usable — otherwise the artifact is accepted at submission and then
 * permanently unverifiable.
 */
const ACCEPTED_INPUTS = [
  ['drive file /file/d/', 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view?usp=sharing'],
  ['drive file ?id=', 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQr'],
  ['drive file + resourcekey',
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view?usp=sharing&resourcekey=0-xY'],
  ['google doc', 'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQr/edit'],
  ['dropbox file', 'https://www.dropbox.com/scl/fi/abc123/graphic.png?rlkey=zz&dl=0'],
];

console.log('every probe URL the gateway builds must satisfy its own URL policy');
for (const [label, input] of ACCEPTED_INPUTS) {
  const inputType = assetUrlType(input);
  ok(inputType !== 'invalid', `${label}: the input is accepted (${inputType})`);
  if (inputType === 'invalid') continue;

  let probe;
  try {
    probe = assetProbeUrl(input);
  } catch (error) {
    ok(false, `${label}: assetProbeUrl threw — ${error && error.message}`);
    continue;
  }
  const probeType = assetUrlType(probe);
  ok(probeType !== 'invalid',
    `${label}: the probe URL it builds is also accepted (got ${probeType})`);
}

/*
 * The same property stated the way the failure actually presents: a graphics
 * deliverable whose file_url is accepted at submission must remain probeable.
 * This is the assertion that maps directly to
 * `assertGraphicsApprovalArtifact` refusing an SMM approval after the flip.
 */
console.log('a deliverable_file accepted at submission stays probeable');
for (const [label, input] of ACCEPTED_INPUTS) {
  if (!assetTypeAllowed('deliverable_file', input)) continue;
  ok(assetUrlType(assetProbeUrl(input)) !== 'invalid',
    `${label}: accepted as a graphics artifact and still probeable`);
}

/*
 * The guard must stay a guard. Widening the allowlist must not admit a
 * credential-bearing URL, and must not turn a folder into a file.
 */
console.log('widening the allowlist did not weaken the guard');
{
  ok(assetUrlType('https://drive.google.com/file/d/1Abc/view?token=secret123') === 'invalid',
    'a credential-style query key is still refused');
  ok(assetUrlType('https://drive.google.com/file/d/1Abc/view?access_key=abc') === 'invalid',
    'and so is an access key');
  ok(assetUrlType('https://drive.google.com/drive/folders/1Abc') === 'folder',
    'a Drive folder is still TYPED a folder, never silently retyped as a file');
  /* OWNER RULING 2026-08-16 replaced the assertion that used to sit here
   * ("and a folder is still refused as a graphics artifact"). The team ships
   * graphics as Frame.io review links and Drive folders of frames, and on flip
   * day the strict reading left 1,972 of 2,009 active graphics deliverables
   * unable to reach SMM approval. The TYPE is unchanged — a folder is still a
   * folder, so `raw_footage` and `delivery_folder` keep their exact meaning —
   * only the Graphics artifact slot now accepts one. */
  ok(assetTypeAllowed('deliverable_file', 'https://drive.google.com/drive/folders/1Abc'),
    'a folder IS an acceptable graphics artifact (owner ruling), while staying typed as a folder');
  ok(!assetTypeAllowed('deliverable_file', 'https://docs.google.com/document/d/1Abc/edit'),
    'the widening stopped at folders — a Google Doc is a brief, never the deliverable');
  ok(assetUrlType('http://drive.google.com/file/d/1Abc/view') === 'invalid',
    'plain http is still refused');
  ok(assetUrlType('https://evil.example.com/file/d/1Abc/view') === 'invalid',
    'an unlisted host is still refused');
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nasset probe URL policy: all checks passed');
