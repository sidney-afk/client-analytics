# Production polish: Create Post editor read fixture

At published integration head `5e6095bc025ce819ae701f69828ca48cd9abe161`,
Production polish run `34006314735`, job `101414057161`, failed in
`pwg_calendar_native_intake`. Independent real-Chromium reproduction found a
fixture-contract defect in `prod-write-gateway-browser.js`, not evidence of an
application or authorization regression.

Create Post now requests `action: intake_editor_options`. The older mock did
not handle this read, so it fell through into `writes[]`. Opening the second
Create Post dialog therefore changed the write counter, and the test stopped
waiting before the real Calendar `intake_create` request arrived. The preserved
baseline reproduces the exact assertion: “new-batch Calendar intake did not
reach the gateway.”

The fixture now returns the actual scoped `intake-editor-options-v1` DTO for
its explicitly native admission scenario, with the existing authenticated
staff/client/surface guards. It records this in a separate read collection and
asserts that no editor read enters write accounting. The wait now selects the
actual Calendar intake operation. Existing client ownership, batch CAS,
paired-item, native-ID, gateway-before-card and frozen-writer assertions remain.
No application, Edge Function, migration, writer or authentication code changes.

The isolated Calendar phase and the **complete existing gateway-browser suite**
both reproduce baseline failure and pass after the correction. A private
wrapper runs the actual suite with synthetic backend routes and aborts unmatched
HTTP requests; the full-suite assertions are unchanged apart from the committed
read-specific checks and corrected wait. Exact source and private log hashes
are in the [public-safe receipt](2026-09-06-production-intake-polish-fixture.json).
This is browser fixture proof, not actual backend/SQL, deployment or live write
proof. The full aggregate Production polish gate was not repeated, and the
published `5e6095bc` CI failure remains the historical result until a new
candidate is published and checked.
