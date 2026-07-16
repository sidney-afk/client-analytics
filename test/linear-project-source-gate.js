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

async function runCase({ reroute = [], legacy, native = [], nativeError = null, pendingSlug = '' }) {
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
    _writeUiRerouteClients: new Set(reroute),
    _writeUiPrimeRerouteFlag: async () => { events.push('flag'); },
    _writeUiRerouteUseGateway: slug => context._writeUiRerouteClients.has(clientSlug(slug)),
    _calRuntimeFlagClients: value => {
      const raw = Array.isArray(value) ? value : (value && Array.isArray(value.clients) ? value.clients : []);
      return raw.map(clientSlug).filter(Boolean);
    },
    _calV2Log: () => {},
    _linearIntakeRead: () => pendingSlug ? { payload: { client_slug: pendingSlug } } : null,
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
    extract('_linearPendingNativeClientSlug'),
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
  assert.deepStrictEqual(dark.events, ['legacy', 'flag'],
    'an empty cohort must use only the legacy project source');

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
    'Legacy Project Name', 'Enrolled Client Native', 'Another Legacy', 'Native Only',
  ], 'only enrolled slugs may replace or add Supabase display names');
  assert(!mixed.context.linearProjects.includes('Supabase Rename'),
    'a non-enrolled registry rename must not leak into the legacy dropdown');
  assert.deepStrictEqual(Array.from(mixed.context.linearClientRows).map(row => row.slug), [
    'legacyprojectname', 'enrolledclient', 'nativeonly',
  ], 'native rows remain available for exact identity and pending-job recovery');
  assert(mixed.events.indexOf('flag') < mixed.events.indexOf('native'),
    'the native source must not load before the cohort decision');

  const selectedInput = { value: 'Enrolled Client Native', dataset: { clientSlug: 'enrolledclient' } };
  mixed.context.document.getElementById = id => id === 'linearClientSearch' ? selectedInput : null;
  mixed.context._submitLinearFormLegacy = () => selectedInput.value;
  const deEnrollmentRefresh = mixed.context._writeUiSetRerouteFlagValue(
    { clients: [] }, { refreshProjects: true });
  assert.deepStrictEqual(Array.from(mixed.context.linearProjects), [
    'Legacy Project Name', 'Dr Enrolled Client', 'Another Legacy',
  ], 'de-enrollment must synchronously rebuild the dropdown from exact legacy names');
  assert.strictEqual(mixed.context._submitLinearFormLegacy(), 'Dr Enrolled Client',
    'legacy submit must never observe the formerly enrolled native display name');
  assert.strictEqual(selectedInput.dataset.clientSlug, '',
    'de-enrollment must clear native selection metadata before legacy submit');
  await deEnrollmentRefresh;
  assert.strictEqual(selectedInput.value, 'Dr Enrolled Client');
  assert(!mixed.context.linearProjects.includes('Enrolled Client Native'));

  const racing = await runCase({
    reroute: ['enrolledclient'],
    legacy: ['Dr Enrolled Client'],
    native: [{ slug: 'enrolledclient', display_name: 'Current Native Name', kind: 'client', active: true }],
  });
  let releaseStaleNative;
  let markStaleNativeStarted;
  const staleNativeStarted = new Promise(resolve => { markStaleNativeStarted = resolve; });
  racing.context.fetch = async (url, options = {}) => {
    if (url === racing.context.LINEAR_PROJECTS_WEBHOOK) {
      assert.strictEqual(options.method, 'POST');
      return { ok: true, json: async () => ['Dr Enrolled Client'] };
    }
    if (String(url).startsWith(racing.context.CAL_SUPABASE_URL + '/rest/v1/clients?')) {
      markStaleNativeStarted();
      return new Promise(resolve => { releaseStaleNative = () => resolve({
        ok: true,
        json: async () => [{ slug: 'enrolledclient', display_name: 'Stale Native Name', kind: 'client', active: true }],
      }); });
    }
    throw new Error('unexpected URL ' + url);
  };
  const staleLoad = racing.context.fetchLinearProjects();
  await staleNativeStarted;
  await racing.context._writeUiSetRerouteFlagValue({ clients: [] }, { refreshProjects: true });
  releaseStaleNative();
  await staleLoad;
  assert.deepStrictEqual(Array.from(racing.context.linearProjects), ['Dr Enrolled Client'],
    'an older enrolled-client request must not overwrite a newer de-enrollment rebuild');

  const failedNative = await runCase({
    reroute: ['enrolledclient'],
    legacy: ['Legacy Survives'],
    nativeError: new Error('registry unavailable'),
  });
  assert.deepStrictEqual(Array.from(failedNative.context.linearProjects), ['Legacy Survives']);
  assert.deepStrictEqual(Array.from(failedNative.context.linearClientRows), []);

  const pending = await runCase({
    legacy: ['Legacy Pending Project'],
    pendingSlug: 'pendingclient',
    native: [{ slug: 'pendingclient', display_name: 'Pending Native Name', kind: 'client', active: true }],
  });
  assert.deepStrictEqual(Array.from(pending.context.linearProjects), ['Legacy Pending Project'],
    'a de-enrolled pending job must not expose its native display name');
  assert.deepStrictEqual(Array.from(pending.context.linearClientRows).map(row => row.slug), ['pendingclient'],
    'a de-enrolled pending job must retain its native client row for recovery');
  assert(pending.events.includes('native'));

  console.log('Linear project source gate checks passed');
})().catch(error => { console.error(error); process.exit(1); });
