// Staff entry gate seed for headless harnesses.
//
// SyncView's staff entry used to be one shared password, and every harness got
// past it with `localStorage.syncview_auth_v1 = 'ok'`. That password is gone
// (2026-09-10): entry is now the same roster-name + personal role key that
// already gated every capability, and a saved identity only opens the door
// once the key-verify Edge Function confirms it.
//
// A public repo cannot carry a real role key, so harnesses seed a stub
// identity and fulfil key-verify locally.
//
// BE PRECISE ABOUT WHAT THAT GRANTS. An earlier version of this comment said
// it grants "the app shell and nothing more", the way the shared password did.
// That was wrong, and Codex caught it reviewing #1385. A fulfilled key-verify
// makes _syncviewStaffIdentityValid() true, so _syncviewStaffCan() opens every
// BROWSER-side capability of the seeded role: client credentials, review
// links, intake, onboarding, hiring, PTO administration. This seed is an admin
// by default, so a suite using it sees all of them.
//
// This helper does not isolate transport or prevent writes. Staff endpoints
// that validate the stub key should refuse it, but the intentionally tokenless
// Calendar/Samples writers do not provide that protection. Each isolated suite
// must independently refuse or mock external mutations. Seed a narrower role
// than admin when a suite does not need one.
//
// Probes that need verified state keep doing what they already did (seed their
// own identity, then call _syncviewAcceptStaffVerification() in-page).
const STAFF_GATE_MEMBER = { id: 'qa_staff', name: 'QA Staff', role: 'admin', team: null };
const STAFF_GATE_KEY = 'qa-staff-gate-key';

// WHICH HELPER: a suite that already mocks key-verify wants `seedStaffIdentity`
// instead — it seeds the stored identity only and lets that suite's own mock
// answer the boot verification with its own member. Suites that manage their
// own identity outright (`b4-staff-login`, the PTO harnesses) need neither.

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
    localStorage.setItem('syncview_staff_identity_v1', payload);
    localStorage.removeItem('syncview_auth_v1');
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

// Re-creates the posture that suites predating the entry gate were written
// against: the app BOOTS, but nothing is verified. It matters for the ?prod=1
// preview lanes. Before the gate they ran with no identity at all, so the app
// never attempted a staff-gated call. Seed a verified admin instead and it does
// attempt them -- with a stub key the real backend rejects, which is a 401 and a
// console error on every one, plus read-shaped POSTs those suites never expected
// to see. Dropping the verification the instant the gate lifts keeps the door
// satisfied and leaves the app in the state those assertions describe.
//
// It wraps _syncviewAcceptStaffVerification, which the app calls at the end of a
// successful verification: the gate lifts, then this drops the flag again. The
// identity stays stored, so nothing purges and no gate returns (that is
// _syncviewStaffIdentityClear); only _syncviewStaffIdentityValid() goes false.
// init()'s own await already holds the verified identity by then, so boot
// proceeds and the anon reads still run.
async function dropVerificationAfterBoot(target) {
  await target.addInitScript(() => {
    // Poll: the app declares this function partway through a multi-megabyte
    // script, and an init script runs before any of it. The gate lift waits on a
    // network round trip, so this wins the race by a wide margin.
    const timer = setInterval(() => {
      if (typeof window._syncviewAcceptStaffVerification !== 'function') return;
      clearInterval(timer);
      const real = window._syncviewAcceptStaffVerification;
      window._syncviewAcceptStaffVerification = function () {
        const result = real.apply(this, arguments);
        try { window._syncviewInvalidateStaffVerification(); } catch (e) {}
        return result;
      };
    }, 5);
    setTimeout(() => clearInterval(timer), 30000);
  });
}

// `target` is a Playwright BrowserContext or Page.
//
// The verifier is answered with a ROUTE, not by patching window.fetch in the
// page. An in-page patch shadows a Playwright route for the same URL (it broke
// `pto-ui-polish`, whose own key-verify mock then never fired), and it is a
// mutation of the page under test that every suite would have to reason about.
// Two consequences of using a route, both about ORDER: Playwright tries the
// most recently registered route first, so call this BEFORE a specific
// key-verify mock you want to win, and AFTER any catch-all `route('**/*')`
// that would otherwise swallow it.
async function seedStaffGate(target, options) {
  await target.addInitScript(staffGateInit, staffGateIdentityJson());
  if (options && options.dropVerificationAfterBoot) await dropVerificationAfterBoot(target);
  await target.route('**/functions/v1/key-verify', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, role: STAFF_GATE_MEMBER.role, member: STAFF_GATE_MEMBER })
  }));
}

module.exports = { seedStaffGate, seedStaffIdentity, dropVerificationAfterBoot, staffGateIdentityJson, STAFF_GATE_KEY, STAFF_GATE_MEMBER };
