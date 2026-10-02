'use strict';

// The client profile's "Onboarding" button paints from a saved copy of the
// slug index, so it does not wait for three list fetches. Checks the saved copy
// is tied to the signed-in staff member, expires, is only replaced by a
// complete answer, and that an unchanged answer does not re-render the page.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function ok(value, message) {
  if (!value) {
    console.error('FAIL onboarding-badge-instant:', message);
    process.exit(1);
  }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let i = INDEX.indexOf('{', at); i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}' && --depth === 0) return INDEX.slice(at, i + 1);
  }
  throw new Error('unbalanced function: ' + name);
}

const NAMES = ['_obvSlugCacheOwner', '_obvSlugCacheLoad', '_obvSlugCacheSave', '_obvSameSlugSet',
  '_obvPrefetchSlugIndex', '_obvEnsureSlugIndex', '_obvHasOnboarding'];

function makeWorld({ member = 'm1', can = true, saved = null, results = [] } = {}) {
  const store = new Map();
  if (saved) store.set('syncview_onboarding_slugs_v1', JSON.stringify(saved));
  const world = {
    renders: 0,
    fetches: 0,
    store,
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    _syncviewStaffIdentityForHeaders: () => (member ? { key: 'k', role: 'admin', member: { id: member } } : null),
    _syncviewStaffCan: () => can,
    _obvFetchLists: () => { world.fetches++; return Promise.resolve(results); },
    wlNormalizeClient: n => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    _templatesSelected: 'Test Client',
    _obvSelected: null,
    document: { getElementById: () => ({ set innerHTML(v) { world.renders++; } }) },
    renderClientTemplate: () => '',
    mountTemplatesView: () => {},
    Date, JSON, Array, Set, Number, String, Promise,
  };
  const src = [
    "var _obvSlugSet = null, _obvSlugLoading = false, _obvSlugFresh = false;",
    "const OBV_SLUG_CACHE_KEY = 'syncview_onboarding_slugs_v1';",
    "const OBV_SLUG_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;",
    ...NAMES.map(grabFunc),
    "this.api = { ensure: _obvEnsureSlugIndex, prefetch: _obvPrefetchSlugIndex, has: _obvHasOnboarding };",
  ].join('\n');
  vm.createContext(world);
  vm.runInContext(src, world);
  return world;
}

const flush = () => new Promise(r => setImmediate(r));
const ok3 = slugs => [{ status: 'fulfilled', value: slugs.map(slug => ({ slug })) },
  { status: 'fulfilled', value: [] }, { status: 'fulfilled', value: [] }];

(async () => {
  ok(INDEX.includes('_obvPrefetchSlugIndex();'), 'the Templates list warms the index');

  // 1. Saved copy for this member: the button is there before any fetch returns.
  let w = makeWorld({ saved: { owner: 'm1', at: Date.now(), slugs: ['testclient'] }, results: ok3(['testclient']) });
  w.api.ensure();
  ok(w.api.has('Test Client'), 'saved copy paints the button instantly');
  await flush();
  ok(w.renders === 0, 'unchanged answer does not re-render');

  // 2. Another member's saved copy is ignored.
  w = makeWorld({ member: 'm2', saved: { owner: 'm1', at: Date.now(), slugs: ['testclient'] }, results: ok3([]) });
  w.api.ensure();
  ok(!w.api.has('Test Client'), "another member's saved copy is not used");

  // 3. An expired saved copy is ignored.
  w = makeWorld({ saved: { owner: 'm1', at: Date.now() - 8 * 86400000, slugs: ['testclient'] }, results: ok3([]) });
  w.api.ensure();
  ok(!w.api.has('Test Client'), 'expired saved copy is not used');

  // 4. A fresh answer that differs re-renders once and is saved.
  w = makeWorld({ results: ok3(['testclient']) });
  w.api.ensure();
  ok(!w.api.has('Test Client'), 'no saved copy, no button yet');
  await flush();
  ok(w.api.has('Test Client') && w.renders === 1, 'fresh answer shows the button with one re-render');
  ok(JSON.parse(w.store.get('syncview_onboarding_slugs_v1')).slugs[0] === 'testclient', 'complete answer is saved');
  w.api.ensure();
  ok(w.fetches === 1, 'fetched once per page load');

  // 5. A partial answer is shown but never replaces the saved copy.
  w = makeWorld({ saved: { owner: 'm1', at: Date.now(), slugs: ['testclient'] },
    results: [{ status: 'fulfilled', value: [] }, { status: 'rejected', reason: new Error('x') }, { status: 'fulfilled', value: [] }] });
  w.api.ensure();
  await flush();
  ok(JSON.parse(w.store.get('syncview_onboarding_slugs_v1')).slugs.length === 1, 'partial answer does not overwrite the saved copy');

  // 6. The list page never fetches without a signed-in onboarding reader.
  w = makeWorld({ member: null });
  w.api.prefetch();
  ok(w.fetches === 0, 'no sign-in, no prefetch (never opens the dialog)');
  w = makeWorld({ can: false });
  w.api.prefetch();
  ok(w.fetches === 0, 'no onboarding access, no prefetch');
  w = makeWorld({ results: ok3([]) });
  w.api.prefetch();
  ok(w.fetches === 1, 'signed-in reader: list page warms the index');

  console.log('PASS onboarding-badge-instant');
})().catch(e => { console.error('FAIL onboarding-badge-instant:', e && e.stack || e); process.exit(1); });
