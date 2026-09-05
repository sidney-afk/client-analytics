// p96_description_image_upload.js -- the deployed description-image-upload
// function, exercised against the LIVE backend the way the browser uses it.
//
// Codex on #1310 (round two): a main-push deploy added a production writer
// and nothing under qa/ touched it, so a deployed CORS, auth, runtime-flag,
// ledger or Storage failure would reach staff before any robot. This is the
// bounded journey. No browser: the browser half is proven by
// test/prod-description-image-paste.js; what only the live estate can prove
// is that the FUNCTION answers, in the right order, with the right refusals.
//
// Two tiers, so the probe is useful with the credentials the nightly holds:
//   Always (needs SYNCVIEW_STAFF_KEY, like every staff probe):
//     - the CORS preflight the browser sends, with the two image headers;
//     - no key            -> 401 credentials_required   (deploy + flag are live)
//     - key, no actor     -> 403 roster_actor_required  (key accepted, roster consulted)
//     - key, no actor, an SVG labelled PNG -> STILL 403, never 415: the actor
//       gate stands in front of the byte check, so an unbound caller cannot
//       even probe the sniffer.
//   Full journey (also needs SYNCVIEW_STAFF_ACTOR: an ACTIVE admin/SMM roster
//   name the key's role resolves; never committed, only ever in the secret):
//     - a real 1x1 PNG uploads, answers an https URL, and the URL serves the
//       SAME bytes back (bucket public, object written, ledger row accepted);
//     - the same bytes labelled image/gif -> 415 image_type_mismatch;
//     - SVG bytes labelled image/png      -> 415 image_bytes_unrecognized;
//     - a PNG cut off after its header    -> 415 image_incomplete.
//   RETAINED FIXTURE, on purpose: each full run leaves one 68-byte 1x1 PNG in
//   the public bucket and one ledger row attributed to the probe's actor with
//   client sidneylaruel. There is no delete endpoint (deletion is a Storage
//   action, not part of the contract), and one row per night is a rounding
//   error against the 120/hour per-actor ceiling.
'use strict';

const URL_FN = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/description-image-upload';
const ANON = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA'; // browser-safe publishable key, the one index.html ships
const STAFF_KEY = String(process.env.SYNCVIEW_STAFF_KEY || '').trim();
const STAFF_ACTOR = String(process.env.SYNCVIEW_STAFF_ACTOR || '').trim();
const TEST_CLIENT = 'sidneylaruel';
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  ok   ' + label + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.log('  FAIL ' + label + (detail ? '  [' + detail + ']' : '')); }
}

async function post(bytes, contentType, headers) {
  const h = Object.assign({
    apikey: ANON,
    Authorization: 'Bearer ' + ANON,
    Accept: 'application/json',
    'Content-Type': contentType,
  }, headers || {});
  const response = await fetch(URL_FN, { method: 'POST', headers: h, body: bytes });
  let json = null;
  try { json = await response.json(); } catch (_) {}
  return { status: response.status, json: json || {} };
}

(async () => {
  console.log('p96 description-image-upload: live function contract');
  if (!STAFF_KEY) {
    console.log('  FAIL SYNCVIEW_STAFF_KEY is not set; this probe cannot run');
    process.exit(1);
  }

  // 1. The preflight the browser sends before a raw-bytes POST.
  const pre = await fetch(URL_FN, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://syncview.synchrosocial.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, x-syncview-key, x-syncview-actor, x-syncview-role, x-syncview-image-client, x-syncview-image-issue',
    },
  });
  const allowHeaders = String(pre.headers.get('access-control-allow-headers') || '').toLowerCase();
  ok(pre.status === 204 || pre.status === 200, 'preflight answers', 'status=' + pre.status);
  ok(/x-syncview-image-client/.test(allowHeaders) && /x-syncview-image-issue/.test(allowHeaders) && /x-syncview-actor/.test(allowHeaders),
    'preflight allows the staff and image attribution headers', allowHeaders.slice(0, 120));

  // 2. Order of refusals with no actor bound: flag, then key, then roster.
  const noKey = await post(ONE_BY_ONE_PNG, 'image/png');
  ok(noKey.status === 401 && noKey.json.error === 'credentials_required',
    'no key -> 401 credentials_required (the function is deployed and its flag is enabled)', noKey.status + ' ' + noKey.json.error);
  ok(noKey.json.error !== 'upload_disabled', 'the runtime flag is not switched off', noKey.json.error);

  const noActor = await post(ONE_BY_ONE_PNG, 'image/png', { 'X-Syncview-Key': STAFF_KEY });
  ok(noActor.status === 403 && noActor.json.error === 'roster_actor_required',
    'key without an actor -> 403 roster_actor_required (key accepted, roster consulted)', noActor.status + ' ' + noActor.json.error);

  const svgNoActor = await post(SVG, 'image/png', { 'X-Syncview-Key': STAFF_KEY });
  ok(svgNoActor.status === 403,
    'an unbound caller cannot reach the byte check: SVG-as-PNG is still 403, never 415', svgNoActor.status + ' ' + svgNoActor.json.error);

  if (!STAFF_ACTOR) {
    console.log('  (SYNCVIEW_STAFF_ACTOR not set: the bound-actor journey is skipped; the contract above is what this run proves)');
  } else {
    const bound = { 'X-Syncview-Key': STAFF_KEY, 'X-Syncview-Actor': STAFF_ACTOR, 'X-Syncview-Image-Client': TEST_CLIENT, 'X-Syncview-Image-Issue': 'p96-probe' };

    // 3. The happy path, then the bytes are read back through the public URL.
    const up = await post(ONE_BY_ONE_PNG, 'image/png', bound);
    const url = String(up.json.url || '');
    ok(up.status === 200 && up.json.ok === true, 'a real 1x1 PNG uploads', up.status + ' ' + (up.json.error || ''));
    ok(/^https:\/\/[^\s)]+\/storage\/v1\/object\/public\/syncview-description-images\/[0-9a-f-]{36}\.png$/.test(url),
      'and answers a public https URL with a UUID name and the VERIFIED extension', url.replace(/[0-9a-f-]{36}/, '<uuid>'));
    ok(up.json.width === 1 && up.json.height === 1 && up.json.mime_type === 'image/png',
      'with the dimensions and mime the bytes prove', JSON.stringify({ w: up.json.width, h: up.json.height, m: up.json.mime_type }));
    if (url) {
      const back = await fetch(url);
      const body = Buffer.from(await back.arrayBuffer());
      ok(back.status === 200 && body.equals(ONE_BY_ONE_PNG), 'the URL serves the same bytes back (bucket public, object written)', back.status + ' ' + body.length + 'B');
      ok(/^image\/png/.test(String(back.headers.get('content-type') || '')), 'served as image/png', back.headers.get('content-type'));
    }

    // 4. The three refusals the byte check owes, from a bound caller.
    const mismatch = await post(ONE_BY_ONE_PNG, 'image/gif', bound);
    ok(mismatch.status === 415 && mismatch.json.error === 'image_type_mismatch', 'PNG bytes labelled GIF -> 415 image_type_mismatch', mismatch.status + ' ' + mismatch.json.error);
    const svg = await post(SVG, 'image/png', bound);
    ok(svg.status === 415 && svg.json.error === 'image_bytes_unrecognized', 'SVG labelled PNG -> 415 image_bytes_unrecognized', svg.status + ' ' + svg.json.error);
    const truncated = await post(ONE_BY_ONE_PNG.subarray(0, 33), 'image/png', bound);
    ok(truncated.status === 415 && truncated.json.error === 'image_incomplete', 'a PNG cut off after IHDR -> 415 image_incomplete', truncated.status + ' ' + truncated.json.error);
  }

  console.log(`\np96: ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error('p96 EXCEPTION:', error && error.stack || error);
  process.exit(1);
});
