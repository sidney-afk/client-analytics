'use strict';
// syncview-session: pure rules plus source wiring. Offline.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/syncview-session/index.ts'), 'utf8');
const config = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');

(async () => {
  const p = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/syncview-session-policy.mjs')).href);
  const now = Date.parse('2026-09-27T12:00:00Z');

  assert.strictEqual(p.bearerToken('Bearer abc.def'), 'abc.def');
  assert.strictEqual(p.bearerToken('bearer  x '), 'x');
  assert.strictEqual(p.bearerToken(''), '');
  assert.strictEqual(p.bearerToken('Basic x'), '');

  assert.strictEqual(p.guestRefusal(null), 'session_required');
  assert.strictEqual(p.guestRefusal({ id: 'u' }), 'guest_session_required');
  assert.strictEqual(p.guestRefusal({ id: 'u', is_anonymous: false }), 'guest_session_required');
  assert.strictEqual(p.guestRefusal({ id: 'u', is_anonymous: true }), '');

  assert.deepStrictEqual(p.sessionClaims({ kind: 'staff', role: 'smm' }, now), {
    svc_scope: 'staff', svc_client: '', svc_role: 'smm', svc_version: 1, svc_stamped_at: '2026-09-27T12:00:00.000Z', svc_expires_at: '2026-09-27T20:00:00.000Z',
  });
  assert.deepStrictEqual(p.sessionClaims({ kind: 'client', slug: 'testclient' }, now), {
    svc_scope: 'client', svc_client: 'testclient', svc_role: '', svc_version: 1, svc_stamped_at: '2026-09-27T12:00:00.000Z', svc_expires_at: '2026-09-27T20:00:00.000Z',
  });
  // Every claim key is always written, so a re-stamp never leaves stale scope.
  const keys = o => Object.keys(o).sort().join();
  assert.strictEqual(keys(p.sessionClaims({ kind: 'staff', role: 'admin' }, now)), keys(p.sessionClaims({ kind: 'client', slug: 'x' }, now)));
  for (const bad of [null, {}, { kind: 'staff', role: 'owner' }, { kind: 'client', slug: ' ' }, { kind: 'guest' }]) {
    assert.strictEqual(p.sessionClaims(bad, now), null);
  }

  // The stamp is bounded: 8 hours, so a refresh cannot extend revoked access past it.
  assert.strictEqual(p.STAMP_TTL_MS, 8 * 60 * 60 * 1000);
  assert(fs.existsSync(path.join(ROOT, 'docs/ops/SYNCVIEW_SESSION.md')), 'design record exists');

  // Wiring: guest check before credentials, shared writer auth, service-role
  // app_metadata write only, no signing secret, gateway JWT check off.
  const order = ['auth.getUser(', 'guestRefusal(', 'authorizeBrowserWrite(', 'sessionClaims(', 'updateUserById('];
  let at = -1;
  for (const marker of order) { const i = src.indexOf(marker); assert(i > at, 'order: ' + marker); at = i; }
  assert(/updateUserById\(user\.id, \{ app_metadata: claims \}\)/.test(src), 'writes app_metadata only');
  assert(!/user_metadata/.test(src), 'never user_metadata (the user can edit that)');
  assert(!/JWT_SECRET|jwt\.sign|SignJWT|\.from\(/.test(src.replace(/authorizeBrowserWrite\(admin/g, '')), 'no signing, no direct table access');
  assert(/\[functions\.syncview-session\]\s*\nverify_jwt = false/.test(config), 'config entry');
  console.log('syncview-session: OK');
})().catch(e => { console.error(e); process.exit(1); });
