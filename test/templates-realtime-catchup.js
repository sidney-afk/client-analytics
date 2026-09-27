'use strict';
// Offline Templates subscription test. The page's real read and subscribe
// functions run against a fake REST response, channel, and clock.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/extract-function');

const source = fs.readFileSync(path.join(__dirname, '..', 'src/index/050-market-briefs.js.part'), 'utf8');
const start = source.indexOf('    let _tplRealtimeChannel = null;');
const end = source.indexOf('    /* SAVED COPY.', start);
assert.ok(start >= 0 && end > start, 'Templates read and channel source found');

const intervals = new Map();
let nextInterval = 1;
let statusCallback;
let restReads = 0;
let restValue = 'first';
let visible = true;
const channel = {
  on() { return this; },
  subscribe(callback) { statusCallback = callback; return this; }
};
const context = {
  console,
  document: { get visibilityState() { return visible ? 'visible' : 'hidden'; } },
  _calRuntimeFlagClient: async () => ({ channel: () => channel }),
  _tplSavedRead: () => null,
  _tplSavedWrite: () => {},
  _maybeRerenderTemplates: () => {},
  fetch: async (url, options) => {
    assert.match(url, /\/rest\/v1\/templates\?/);
    assert.equal(options.method || 'GET', 'GET');
    restReads++;
    const value = restValue;
    return { ok: true, json: async () => [{ data: { client_name: 'fixture', reels_reference_link: value } }] };
  },
  setInterval: (fn, ms) => { assert.ok(ms >= 1000, 'catch-up poll stays bounded'); const id = nextInterval++; intervals.set(id, fn); return id; },
  clearInterval: id => intervals.delete(id)
};
vm.createContext(context);
vm.runInContext([
  "let templatesData = {}, templatesLoaded = false, templatesLoadError = null;",
  "const _tplDirty = {}, _tplSaveInFlight = {};",
  "const CAL_SUPABASE_URL = 'https://example.invalid', CAL_SUPABASE_ANON_KEY = 'fixture-key';",
  "let currentNav = 'templates';",
  source.slice(start, end),
  extractFunction(source, '_tplKeepLocalEdits'),
  'async ' + extractFunction(source, 'loadTemplates'),
  'globalThis.templatesApi = { loadTemplates, data: () => templatesData, dirty: _tplDirty, setNav: value => { currentNav = value; } };'
].join('\n'), context);

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
async function tick() {
  for (const fn of [...intervals.values()]) fn();
  await settle();
}

(async () => {
  const api = context.templatesApi;
  await api.loadTemplates();
  await settle();
  assert.equal(restReads, 1, 'first load reads once');
  assert.equal(typeof statusCallback, 'function', 'subscription observes connection status');

  statusCallback('SUBSCRIBED');
  await settle();
  assert.equal(restReads, 1, 'first subscribe does not repeat the fresh REST read');
  assert.equal(intervals.size, 0, 'connected Templates view has no catch-up poll');

  statusCallback('CHANNEL_ERROR');
  restValue = 'changed while offline';
  assert.equal(intervals.size, 1, 'a failed channel starts one bounded poll');
  await tick();
  assert.equal(api.data().fixture.reels_reference_link, restValue, 'visible disconnected view catches up');

  restValue = 'changed before reconnect';
  const beforeReconnect = restReads;
  statusCallback('SUBSCRIBED');
  await settle();
  assert.equal(restReads, beforeReconnect + 1, 'reconnect performs one catch-up read');
  assert.equal(api.data().fixture.reels_reference_link, restValue, 'reconnect paints missed edit');
  assert.equal(intervals.size, 0, 'reconnect stops disconnected polling');
  statusCallback('SUBSCRIBED');
  await settle();
  assert.equal(restReads, beforeReconnect + 1, 'repeated connected status does not keep reading');

  api.data().fixture.reels_reference_link = 'local edit';
  api.dirty.fixture = { reels_reference_link: 'local edit' };
  statusCallback('TIMED_OUT');
  restValue = 'server changed again';
  await tick();
  assert.equal(api.data().fixture.reels_reference_link, 'local edit', 'catch-up preserves dirty local edit');

  const beforeHidden = restReads;
  visible = false;
  await tick();
  assert.equal(restReads, beforeHidden, 'hidden tab does not poll');
  visible = true;
  api.setNav('calendar');
  await tick();
  assert.equal(restReads, beforeHidden, 'another view does not poll Templates');

  console.log('templates-realtime-catchup: offline subscription, poll, reconnect, and local edit checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
