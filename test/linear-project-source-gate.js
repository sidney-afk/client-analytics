'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

function clientSlug(value) {
  let normalized = String(value || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  normalized = normalized.replace(/^dr\.?\s+/, '');
  normalized = normalized.replace(/\s+(?:and|&)\s+/g, '&');
  return normalized.replace(/[^a-z0-9&]+/g, '');
}

async function runCase({ reroute = [], legacy, native = [], nativeError = null, pendingSlug = '', state = 'enabled' }) {
  const events = [];
  const context = {
    LINEAR_PROJECTS_WEBHOOK: 'https://legacy.invalid/webhook/linear-projects',
    CAL_SUPABASE_URL: 'https://native.invalid',
    CAL_SUPABASE_ANON_KEY: 'anon',
    linearProjects: [],
    linearClientRows: [],
    linearProjectsLoading: false,
    linearProjectsLoaded: false,
    linearProjectsLoadGeneration: 0,
    linearLegacyProjects: [],
    linearClientRegistryState: 'idle',
    _f133CanonicalTitleIsEnabled: () => state === 'enabled',
    _f133CanonicalTitleIsAbsent: () => state === 'absent',
    _f133CanonicalTitleIsPreinstallV3: () => state === 'absent',
    _f133CanonicalTitleOwnsLinkedNames: () => state !== 'absent',
    _writeUiRerouteClients: new Set(reroute),
    _writeUiPrimeRerouteFlag: async () => { events.push('flag'); },
    _writeUiRerouteUseGateway: slug => context._writeUiRerouteClients.has(clientSlug(slug)),
    _calRuntimeFlagClients: value => {
      const raw = Array.isArray(value) ? value : (value && Array.isArray(value.clients) ? value.clients : []);
      return raw.map(clientSlug).filter(Boolean);
    },
    _calV2Log: () => {},
    _linearIntakeRead: () => pendingSlug ? { payload: { client_slug: pendingSlug } } : null,
    _linearPendingNativeClientSlug: () => pendingSlug,
    calClientSlug: clientSlug,
    document: { getElementById: () => null },
    renderLinearSearchResults: () => {},
    updateLinearSearchGhost: () => {},
    updateLinearTitle: () => {},
    updateLinearFilmingPlan: () => {},
    saveLinearForm: () => {},
    console: { log() {}, error() {} },
    fetch: async (url, options = {}) => {
      if (url === context.LINEAR_PROJECTS_WEBHOOK) {
        events.push('legacy');
        assert.strictEqual(options.method, 'POST', 'legacy project source must retain its POST contract');
        return { ok: true, json: async () => legacy };
      }
      if (String(url).startsWith(context.CAL_SUPABASE_URL + '/rest/v1/clients?')) {
        events.push('native');
        if (nativeError) throw nativeError;
        return { ok: true, json: async () => native };
      }
      throw new Error('unexpected URL ' + url);
    },
  };
  vm.createContext(context);
  vm.runInContext([
    extract('_linearRebuildProjectSource'),
    extract('_linearRenderProjectSource'),
    extract('_linearReconcileProjectSelection'),
    extract('_linearRefreshProjectsForRerouteChange'),
    extract('fetchLinearProjects'),
    extract('_writeUiSetRerouteFlagValue'),
  ].join('\n'), context);
  await context.fetchLinearProjects();
  return { context, events };
}

(async () => {
  const dark = await runCase({
    legacy: { projects: ['Legacy First', 'Legacy Second', 'Legacy First'] },
  });
  assert.deepStrictEqual(Array.from(dark.context.linearProjects), ['Legacy First', 'Legacy Second']);
  assert.deepStrictEqual(Array.from(dark.context.linearClientRows), []);
  assert.deepStrictEqual(dark.events, ['legacy', 'native'],
    'every new-Submit load must check the active registry even when the old cohort is empty');

  const installedPause = await runCase({
    state: 'disabled',
    legacy: ['Legacy First'],
    native: [{ slug: 'native-only', display_name: 'Visible Installed Client', active: true }],
  });
  assert.deepStrictEqual(Array.from(installedPause.context.linearProjects), [
    'Legacy First', 'Visible Installed Client',
  ]);
  assert.deepStrictEqual(installedPause.events, ['legacy', 'native'],
    'exact false remains visibly installed and must not masquerade as the absent legacy state');

  const defaultOff = await runCase({
    state: 'absent',
    legacy: { projects: ['Legacy First', 'Legacy Second'] },
    native: [{ slug: 'not-enrolled', display_name: 'Must Stay Hidden', active: true }],
  });
  assert.deepStrictEqual(Array.from(defaultOff.context.linearProjects), ['Legacy First', 'Legacy Second']);
  assert.deepStrictEqual(defaultOff.events, ['legacy', 'flag'],
    'an absent F133 row preserves base-968a and does not broaden an empty cohort into an active-registry read');

  const cohortOff = await runCase({
    state: 'absent',
    reroute: ['enrolledclient'],
    legacy: ['Dr Enrolled Client', 'Other Legacy'],
    native: [
      { slug: 'enrolledclient', display_name: 'Enrolled Native', active: true },
      { slug: 'not-enrolled', display_name: 'Hidden Native', active: true },
    ],
  });
  assert.deepStrictEqual(Array.from(cohortOff.context.linearProjects), ['Enrolled Native', 'Other Legacy']);
  assert.deepStrictEqual(cohortOff.events, ['legacy', 'flag', 'native'],
    'absent pre-install F133 fetches and exposes only the old cohort even when the registry returns other active clients');
  const offSelected = { value: 'Enrolled Native', dataset: { clientSlug: 'enrolledclient' } };
  cohortOff.context.document.getElementById = id => id === 'linearClientSearch' ? offSelected : null;
  const offRefresh = cohortOff.context._writeUiSetRerouteFlagValue({ clients: [] }, { refreshProjects: true });
  assert.strictEqual(offSelected.value, 'Dr Enrolled Client');
  assert.strictEqual(offSelected.dataset.clientSlug, '',
    'absent pre-install F133 retains base de-enrollment reconciliation and cannot leave a removed native selection armed');
  await offRefresh;

  const mixed = await runCase({
    reroute: ['enrolledclient', 'nativeonly'],
    legacy: ['Legacy Project Name', 'Dr Enrolled Client', 'Another Legacy'],
    native: [
      { slug: 'legacyprojectname', display_name: 'Supabase Rename', kind: 'client', active: true },
      { slug: 'enrolledclient', display_name: 'Enrolled Client Native', kind: 'client', active: true },
      { slug: 'nativeonly', display_name: 'Native Only', kind: 'client', active: true },
    ],
  });
  assert.deepStrictEqual(Array.from(mixed.context.linearProjects), [
    'Supabase Rename', 'Enrolled Client Native', 'Another Legacy', 'Native Only',
  ], 'every active registry row may replace or add its canonical display name');
  assert(mixed.context.linearProjects.includes('Supabase Rename'),
    'an active non-allowlisted client must use its canonical native display name');
  assert.deepStrictEqual(Array.from(mixed.context.linearClientRows).map(row => row.slug), [
    'legacyprojectname', 'enrolledclient', 'nativeonly',
  ], 'native rows remain available for exact identity and pending-job recovery');
  assert(!mixed.events.includes('flag') && mixed.events.includes('native'),
    'the active registry load must not depend on the old cohort decision');

  const selectedInput = { value: 'Enrolled Client Native', dataset: { clientSlug: 'enrolledclient' } };
  mixed.context.document.getElementById = id => id === 'linearClientSearch' ? selectedInput : null;
  mixed.context._submitLinearFormLegacy = () => selectedInput.value;
  const deEnrollmentRefresh = mixed.context._writeUiSetRerouteFlagValue(
    { clients: [] }, { refreshProjects: true });
  assert.deepStrictEqual(Array.from(mixed.context.linearProjects), [
    'Supabase Rename', 'Enrolled Client Native', 'Another Legacy', 'Native Only',
  ], 'cohort removal cannot synchronously demote an active client to legacy');
  assert.strictEqual(mixed.context._submitLinearFormLegacy(), 'Enrolled Client Native',
    'cohort removal cannot rewrite the selected active client');
  assert.strictEqual(selectedInput.dataset.clientSlug, 'enrolledclient',
    'cohort removal cannot clear active native selection metadata');
  await deEnrollmentRefresh;
  assert.strictEqual(selectedInput.value, 'Enrolled Client Native');
  assert(mixed.context.linearProjects.includes('Enrolled Client Native'));

  const racing = await runCase({
    reroute: ['enrolledclient'],
    legacy: ['Dr Enrolled Client'],
    native: [{ slug: 'enrolledclient', display_name: 'Current Native Name', kind: 'client', active: true }],
  });
  let releaseStaleNative;
  let markStaleNativeStarted;
  const staleNativeStarted = new Promise(resolve => { markStaleNativeStarted = resolve; });
  let nativeCall = 0;
  racing.context.fetch = async (url, options = {}) => {
    if (url === racing.context.LINEAR_PROJECTS_WEBHOOK) {
      assert.strictEqual(options.method, 'POST');
      return { ok: true, json: async () => ['Dr Enrolled Client'] };
    }
    if (String(url).startsWith(racing.context.CAL_SUPABASE_URL + '/rest/v1/clients?')) {
      nativeCall++;
      if (nativeCall === 1) {
        markStaleNativeStarted();
        return new Promise(resolve => { releaseStaleNative = () => resolve({
          ok: true,
          json: async () => [{ slug: 'enrolledclient', display_name: 'Stale Native Name', kind: 'client', active: true }],
        }); });
      }
      return {
        ok: true,
        json: async () => [{ slug: 'enrolledclient', display_name: 'Fresh Native Name', kind: 'client', active: true }],
      };
    }
    throw new Error('unexpected URL ' + url);
  };
  const staleLoad = racing.context.fetchLinearProjects();
  await staleNativeStarted;
  await racing.context.fetchLinearProjects();
  releaseStaleNative();
  await staleLoad;
  assert.deepStrictEqual(Array.from(racing.context.linearProjects), ['Fresh Native Name'],
    'an older active-registry request must not overwrite a newer canonical registry read');

  const failedNative = await runCase({
    reroute: ['enrolledclient'],
    legacy: ['Legacy Survives'],
    nativeError: new Error('registry unavailable'),
  });
  assert.deepStrictEqual(Array.from(failedNative.context.linearProjects), ['Legacy Survives']);
  assert.deepStrictEqual(Array.from(failedNative.context.linearClientRows), []);
  assert.strictEqual(failedNative.context.linearClientRegistryState, 'failed',
    'a registry failure is explicit so new submission can fail closed');

  const pending = await runCase({
    legacy: ['Legacy Pending Project'],
    pendingSlug: 'pendingclient',
    native: [{ slug: 'pendingclient', display_name: 'Pending Native Name', kind: 'client', active: true }],
  });
  assert.deepStrictEqual(Array.from(pending.context.linearProjects), ['Legacy Pending Project', 'Pending Native Name'],
    'an active registry client is visible without cohort enrollment');
  assert.deepStrictEqual(Array.from(pending.context.linearClientRows).map(row => row.slug), ['pendingclient'],
    'a pending job retains its active native client row for recovery');
  assert(pending.events.includes('native'));

  const pendingOff = await runCase({
    state: 'absent',
    legacy: ['Legacy Pending Project'],
    pendingSlug: 'pendingclient',
    native: [{ slug: 'pendingclient', display_name: 'Pending Native Name', kind: 'client', active: true }],
  });
  assert.deepStrictEqual(Array.from(pendingOff.context.linearProjects), ['Legacy Pending Project'],
    'absent pre-install state keeps the pending-job registry exception out of the visible cohort dropdown');
  assert.deepStrictEqual(Array.from(pendingOff.context.linearClientRows).map(row => row.slug), ['pendingclient']);
  assert(pendingOff.events.includes('flag') && pendingOff.events.includes('native'),
    'absent pre-install state still retains the one pending native row needed for exact recorded-version recovery');

  console.log('Linear project source gate checks passed');
})().catch(error => { console.error(error); process.exit(1); });
