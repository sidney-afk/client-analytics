'use strict';

const TEST_CLIENT = Object.freeze({
  name: 'Sidney Laruel',
  slug: 'sidneylaruel',
});
const STAFF_KEY_ENV = 'SYNCVIEW_STAFF_KEY';
const ISSUER_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/client-review-link';
const ENTRY_VIEWS = new Set(['analytics', 'brief', 'calendar', 'sample-reviews']);
// Immutable capability census for every scheduled probe that actually opens a
// strict client surface. The array is exported so the schedule-to-capability
// contract can be audited; lookup stays private so callers cannot mutate it.
// Everything else remains credential-free, including manually selected
// parity/utility probes.
const CLIENT_ENTRY_PROBE_FILES = Object.freeze([
  'ot_temporal_client_combo.js',
  'p30_linear_client.js',
  'p31_caption_gen.js',
  'p36_full_sync.js',
  'p39_kasper_inbox.js',
  'p40_unread_dot.js',
  'p41_tweak_rounds.js',
  'p42_concurrent_components.js',
  'p43_smm_client_concurrent.js',
  'p44_kasper_clobber_blastradius.js',
  'p45_aat_flow.js',
  'p47_title_review.js',
  'p48_schedule_post_archive.js',
  'p49_realtime_propagation.js',
  'p50_mixed_state_card.js',
  'p51_client_tweak_roundtrip.js',
  'p52_alt_caption.js',
  'p55_kasper_comment.js',
  'p57_smm_review_sheet.js',
  'p58_bulk_archive_color.js',
  'p60_modal_smm.js',
  'p61_modal_client.js',
  'p62_modal_resolve_delete.js',
  'p63_client_privacy_filter.js',
  'p65_concurrent_same_thread.js',
  'p67_thumb_rev_cachebust.js',
  'p69_date_reschedule.js',
  'p70_rapid_realtime_converge.js',
  'p71_full_pipeline_capstone.js',
  'p72_cross_surface_thread.js',
  'p73_resolve_unresolve.js',
  'p74_delete_cascade.js',
  'p75_unread_notes_lifecycle.js',
  'p79_request_approve_pingpong.js',
  'p80_concurrent_comment_status.js',
  'p83_reply_to_resolved.js',
  'p84_concurrent_double_approve.js',
  'p85_review_gate_enforcement.js',
  'sxr_client_persist_guard.js',
]);
const CLIENT_ENTRY_PROBE_FILE_SET = new Set(CLIENT_ENTRY_PROBE_FILES);

function normalizeClient(value) {
  let text = String(value == null ? '' : value).trim().toLowerCase();
  try { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  text = text.replace(/^dr\.?\s+/, '').replace(/\s+(?:and|&)\s+/g, '&');
  return text.replace(/[^a-z0-9&]+/g, '');
}

function cleanCredential(value) {
  const credential = String(value == null ? '' : value).trim();
  if (!credential || credential.length > 4096 || /[\u0000-\u001f\u007f]/.test(credential)) return '';
  return credential;
}

function probeNeedsClientEntry(file) {
  const name = String(file == null ? '' : file).split(/[\\/]/).pop();
  return CLIENT_ENTRY_PROBE_FILE_SET.has(name);
}

function clientEntryProbeChildEnv(file, source = process.env) {
  const safe = clientEntrySafeChildEnv(source);
  if (probeNeedsClientEntry(file)) {
    const staffKey = cleanCredential(source[STAFF_KEY_ENV]);
    if (staffKey) safe[STAFF_KEY_ENV] = staffKey;
  }
  return safe;
}

function requireTestClientToken(explicitToken) {
  const token = cleanCredential(explicitToken);
  if (!token) {
    throw new Error(
      'An explicit current TEST-client token is required; resolve it inside this harness process before opening a client route',
    );
  }
  return token;
}

function testClientEntryPath(view = 'calendar', name = TEST_CLIENT.name, explicitToken) {
  const entryView = String(view || '').trim().toLowerCase();
  if (!ENTRY_VIEWS.has(entryView)) throw new Error(`Unsupported TEST client entry view: ${entryView || '(empty)'}`);
  if (normalizeClient(name) !== TEST_CLIENT.slug) {
    throw new Error('Live client-entry harnesses are restricted to the TEST client');
  }

  const query = new URLSearchParams({
    c: TEST_CLIENT.name,
    t: requireTestClientToken(explicitToken),
  });
  if (entryView !== 'analytics') query.set('v', entryView);
  if (entryView === 'sample-reviews') query.set('sxr', '1');
  return `/index.html?${query.toString()}`;
}

function clientEntryNavigationError(view) {
  const entryView = String(view || '').trim().toLowerCase();
  const safeView = ENTRY_VIEWS.has(entryView) ? entryView : 'entry';
  const error = new Error(`TEST client ${safeView} navigation failed before boot`);
  error.name = 'TestClientNavigationError';
  return error;
}

async function gotoTestClientEntry(page, options = {}) {
  const view = options.view || 'calendar';
  const name = options.name || TEST_CLIENT.name;
  const path = testClientEntryPath(view, name, options.token);
  const origin = String(options.origin == null ? '' : options.origin).replace(/\/+$/, '');
  try {
    if (!page || typeof page.goto !== 'function') throw new Error('missing page');
    return await page.goto(origin + path, options.gotoOptions || {});
  } catch (_) {
    // Playwright includes the complete navigation URL in its errors. Client
    // entry URLs contain the credential, so never retain the original error,
    // URL, or cause on the replacement that runners print.
    throw clientEntryNavigationError(view);
  }
}

async function resolveCurrentTestClientToken(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const staffKey = cleanCredential(
    options.staffKey === undefined ? process.env[STAFF_KEY_ENV] : options.staffKey,
  );
  if (!staffKey) {
    throw new Error(`${STAFF_KEY_ENV} is required to resolve the current TEST-client token`);
  }
  if (typeof fetchImpl !== 'function') throw new Error('TEST client token resolver has no fetch implementation');

  let response;
  try {
    response = await fetchImpl(ISSUER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Syncview-Key': staffKey,
      },
      body: JSON.stringify({ client: TEST_CLIENT.slug }),
    });
  } catch (_) {
    throw new Error('TEST client token resolver request failed');
  }

  let body = null;
  try { body = await response.json(); } catch (_) {}
  if (!response || response.ok !== true) {
    const status = Number(response && response.status) || 0;
    throw new Error(`TEST client token resolver failed (HTTP ${status || 'unknown'})`);
  }
  const token = cleanCredential(body && body.token);
  if (!body || body.ok !== true || normalizeClient(body.client) !== TEST_CLIENT.slug || !token) {
    throw new Error('TEST client token resolver returned an invalid contract');
  }
  return token;
}

function createCurrentTestClientTokenResolver(options = {}) {
  let currentTokenPromise = null;
  return function currentTestClientToken() {
    if (!currentTokenPromise) {
      currentTokenPromise = resolveCurrentTestClientToken(options).catch(error => {
        currentTokenPromise = null;
        throw error;
      });
    }
    return currentTokenPromise;
  };
}

function clientEntrySafeChildEnv(source = process.env) {
  const safe = { ...source };
  delete safe[STAFF_KEY_ENV];
  delete safe.SYNCVIEW_TEST_CLIENT_TOKEN;
  return safe;
}

const currentTestClientToken = createCurrentTestClientTokenResolver();

module.exports = {
  CLIENT_ENTRY_PROBE_FILES,
  ENTRY_VIEWS,
  ISSUER_URL,
  STAFF_KEY_ENV,
  TEST_CLIENT,
  clientEntryProbeChildEnv,
  clientEntrySafeChildEnv,
  createCurrentTestClientTokenResolver,
  currentTestClientToken,
  gotoTestClientEntry,
  probeNeedsClientEntry,
  requireTestClientToken,
  resolveCurrentTestClientToken,
  testClientEntryPath,
};
