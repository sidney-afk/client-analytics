'use strict';
/*
 * Client Credentials must NEVER loop the passphrase prompt — regression test.
 *
 * Run:  node test/credentials-identity-persist.js   (exit 0 = all good)
 *
 * THE BUG (branch: credentials-saving-loop). A social media manager opened a
 * client's Client Credentials, entered the staff passphrase, and then every
 * Save re-opened the passcode prompt — "it asks for the passcode, and then it
 * kind of loops … the credentials are not there". Changing a field (e.g. IG →
 * Facebook) never stuck either.
 *
 * ROOT CAUSE. The staff identity (name / role / passphrase) was persisted ONLY
 * in localStorage, behind a silent try/catch. _ccIdentityLoad() re-read
 * localStorage on EVERY _ccApi() call. When that write can't land — quota
 * exhausted by the app's own large calendar caches, Safari partitioned/private
 * storage, a locked-down browser — the read kept returning null, so the prompt
 * re-opened on list, then upsert, then the post-save reload … forever. If the
 * user dismissed any prompt, that request silently failed and the list showed
 * nothing, so saves looked like they never stuck.
 *
 * THE FIX. Hold the identity in a session-authoritative in-memory copy
 * (_ccIdentityMem); localStorage is only a best-effort mirror. Once set this
 * session, memory wins, so a browser that can't persist never re-prompts.
 *
 * This harness extracts the REAL _ccIdentity* helpers from ../index.html
 * (brace-balanced, so it survives line shifts), runs them against a localStorage
 * stub whose writes can be made to fail, and asserts the loop is impossible.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

// Harness: the module-level identity state + a controllable localStorage stub.
// __ls.failWrites=true makes setItem throw like a full/blocked store.
// __resetSession() mimics a fresh page load: memory forgotten, storage kept.
const HARNESS = `
let _ccIdentityMem = null, _ccIdentityMemSet = false;
const CC_IDENTITY_KEY = 'syncview_client_credentials_identity_v1';
const __ls = {
  store: {}, failWrites: false,
  getItem(k){ return Object.prototype.hasOwnProperty.call(this.store, k) ? this.store[k] : null; },
  setItem(k, v){ if (this.failWrites) throw new Error('QuotaExceededError'); this.store[k] = String(v); },
  removeItem(k){ delete this.store[k]; },
};
const localStorage = __ls;
function __resetSession(){ _ccIdentityMem = null; _ccIdentityMemSet = false; }
`;

const REAL = [
  grabFunc('_ccIdentityLoad'),
  grabFunc('_ccIdentitySave'),
  grabFunc('_ccIdentityClearKey'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL + `
;return {
  load: _ccIdentityLoad,
  save: _ccIdentitySave,
  clearKey: _ccIdentityClearKey,
  ls: __ls,
  resetSession: __resetSession,
  mem: () => _ccIdentityMem,
};`)();

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}

const IDENT = { name: 'Laura Ospina', role: 'SMM', key: 'staff-passphrase' };

console.log('— Working localStorage: identity persists and reloads across a session —');
mod.ls.failWrites = false; mod.ls.store = {}; mod.resetSession();
mod.save(IDENT);
check('saved into localStorage', JSON.parse(mod.ls.store[Object.keys(mod.ls.store)[0]]), IDENT);
check('load returns it this session', mod.load(), IDENT);
mod.resetSession(); // new page load — memory forgotten, storage kept
check('fresh session rehydrates from localStorage', mod.load(), IDENT);

console.log('\n— THE FIX: a browser that can NOT persist must not re-prompt every call —');
mod.ls.failWrites = true; mod.ls.store = {}; mod.resetSession();
check('nothing stored yet → first load is null (prompt shows once)', mod.load(), null);
mod.save(IDENT);                                   // localStorage write throws, swallowed
check('localStorage really stayed empty (write failed)', Object.keys(mod.ls.store).length, 0);
check('but load STILL returns the identity (in-memory) → NO re-prompt', mod.load(), IDENT);
check('and again on the next call → still no loop', mod.load(), IDENT);
check('and again (upsert, then the post-save reload) → still no loop', mod.load(), IDENT);

console.log('\n— clearKey (the 401 recovery) drops only the passphrase, keeps who you are —');
mod.ls.failWrites = false; mod.ls.store = {}; mod.resetSession();
mod.save(IDENT);
mod.clearKey();
check('key removed', (mod.load() || {}).key, undefined);
check('name kept for the re-prompt default', (mod.load() || {}).name, IDENT.name);
check('role kept', (mod.load() || {}).role, IDENT.role);

console.log('\n— clearKey under a blocked store must not resurrect a stale key from localStorage —');
mod.ls.failWrites = false; mod.ls.store = {}; mod.resetSession();
mod.save(IDENT);                                   // full identity mirrored to storage
mod.ls.failWrites = true;                          // storage now frozen with the old key
mod.clearKey();                                    // 401 path: clear the bad key
check('localStorage still holds the stale full identity', !!mod.ls.store[Object.keys(mod.ls.store)[0]], true);
check('load ignores stale storage and reports the key as cleared', (mod.load() || {}).key, undefined);

console.log('\n— Source-form: the 401 recovery path is intact (clear key, force re-prompt, retry once) —');
const apiSrc = grabFunc('_ccApi');
check('_ccApi clears the key on 401', /_ccIdentityClearKey\s*\(/.test(apiSrc), true);
check('_ccApi force-re-prompts on 401', /_ccEnsureIdentity\([^)]*,\s*true\s*\)/.test(apiSrc), true);
check('_ccApi retries at most once (guarded by _retried)', /_retried/.test(apiSrc), true);

console.log('\n— Source-form: save writes the in-memory copy, load prefers it —');
const saveSrc = grabFunc('_ccIdentitySave');
check('_ccIdentitySave sets _ccIdentityMem', /_ccIdentityMem\s*=/.test(saveSrc), true);
const loadSrc = grabFunc('_ccIdentityLoad');
check('_ccIdentityLoad serves the cached copy when set', /_ccIdentityMemSet/.test(loadSrc), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll credentials-identity-persist checks passed.');
