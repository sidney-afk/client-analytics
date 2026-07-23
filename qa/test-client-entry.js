'use strict';

const TEST_CLIENT = Object.freeze({
  name: 'Sidney Laruel',
  slug: 'sidneylaruel',
});
const STAFF_KEY_ENV = 'SYNCVIEW_STAFF_KEY';
const ISSUER_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/client-review-link';
const ENTRY_VIEWS = new Set(['analytics', 'brief', 'calendar', 'sample-reviews']);

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
  ENTRY_VIEWS,
  ISSUER_URL,
  STAFF_KEY_ENV,
  TEST_CLIENT,
  clientEntrySafeChildEnv,
  createCurrentTestClientTokenResolver,
  currentTestClientToken,
  gotoTestClientEntry,
  requireTestClientToken,
  resolveCurrentTestClientToken,
  testClientEntryPath,
};
