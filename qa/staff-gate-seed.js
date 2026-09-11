// Staff entry gate seed for headless harnesses.
//
// SyncView's staff entry used to be one shared password, and every harness got
// past it with `localStorage.syncview_auth_v1 = 'ok'`. That password is gone
// (2026-09-10): entry is now the same roster-name + personal role key that
// already gated every capability, and a saved identity only opens the door
// once the key-verify Edge Function confirms it.
//
// A public repo cannot carry a real role key, so harnesses seed a stub
// identity and fulfil key-verify locally. This grants exactly what the shared
// password granted before — the app shell — and nothing more: every outbound
// staff call still carries this stub key to the REAL backend, which rejects
// it, so no probe can write with it. Probes that need verified state keep
// doing what they already did (seed their own identity, then call
// _syncviewAcceptStaffVerification() in-page).
const STAFF_GATE_MEMBER = { id: 'qa_staff', name: 'QA Staff', role: 'admin', team: null };
const STAFF_GATE_KEY = 'qa-staff-gate-key';

// WHICH HELPER: `seedStaffGate` patches `window.fetch` to answer key-verify
// in-page, which SHADOWS a Playwright route for the same URL — the request
// never reaches the network layer, so a suite's own key-verify mock never
// fires and a suite that counts hits on it hangs (this is what broke
// `pto-ui-polish` on #1385). A suite that already mocks key-verify wants
// `seedStaffIdentity` instead: it seeds the stored identity only, and lets
// that suite's own mock answer the boot verification with its own member.
// Suites that manage their own identity outright (`b4-staff-login`, the PTO
// harnesses) need neither.

// Serialized so it can also be dropped into a storageState fixture.
function staffGateIdentityJson() {
  return JSON.stringify({
    key: STAFF_GATE_KEY,
    role: STAFF_GATE_MEMBER.role,
    member: STAFF_GATE_MEMBER,
    verified_at: new Date().toISOString()
  });
}

// Runs in the page before any app script. Must never throw: index.html's boot
// gate is asserted to boot clean with no console error.
function staffGateInit(payload) {
  try {
    localStorage.setItem('syncview_staff_identity_v1', payload.identity);
    localStorage.removeItem('syncview_auth_v1');
    if (window.__syncviewStaffGateStub) return;
    window.__syncviewStaffGateStub = true;
    const real = window.fetch;
    window.fetch = function (input, init) {
      let url = '';
      try { url = String((input && input.url) || input || ''); } catch (e) {}
      if (url.indexOf('/functions/v1/key-verify') !== -1) {
        return Promise.resolve(new Response(payload.body, {
          status: 200, headers: { 'Content-Type': 'application/json' }
        }));
      }
      return real.apply(this, arguments);
    };
  } catch (e) {}
}

// For suites that already mock key-verify: seed ONLY the stored identity, so
// their own mock answers the boot verification. `member` defaults to the stub
// above; pass the member that suite's mock returns so the two agree.
async function seedStaffIdentity(target, member, key) {
  const row = member || STAFF_GATE_MEMBER;
  await target.addInitScript(payload => {
    try {
      localStorage.setItem('syncview_staff_identity_v1', payload);
      localStorage.removeItem('syncview_auth_v1');
    } catch (e) {}
  }, JSON.stringify({
    key: key || STAFF_GATE_KEY,
    role: row.role,
    member: row,
    verified_at: new Date().toISOString()
  }));
}

// `target` is a Playwright BrowserContext or Page.
async function seedStaffGate(target) {
  await target.addInitScript(staffGateInit, {
    identity: staffGateIdentityJson(),
    body: JSON.stringify({ ok: true, role: STAFF_GATE_MEMBER.role, member: STAFF_GATE_MEMBER })
  });
}

module.exports = { seedStaffGate, seedStaffIdentity, staffGateIdentityJson, STAFF_GATE_KEY, STAFF_GATE_MEMBER };
