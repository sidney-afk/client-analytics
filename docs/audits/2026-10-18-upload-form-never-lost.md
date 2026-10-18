# The upload form must never lose what was sent (session Keepsake, 2026-10-18)

Goal (owner): whatever happens to a client or videographer on the upload link (`/?intake=1`) or to staff on
the Submit tab (a slow or dropped network, a server error, a double click, a closed tab, a reload, the
back button, a full or blocked browser store, an old browser), what they typed is kept, they are told plainly
whether it arrived, and a retry can never make a second upload. Counts only; no client data.

## Past failures checked against today's code

13 distinct past failures were found in OPEN_REPAIRS, the feature docs and the git history. Each is covered
by a test that still runs; none came back.

| # | Past failure | Today |
|---|---|---|
| 1 | The link blocked a client on a field she could not see (plan lookup) | Fixed earlier; "a missing plan never refuses" is still true |
| 2 | 38 of 38 clients could not submit for 10 days ("Staff sign-in required", OPEN_REPAIRS 34) | Public lane live; `test/public-intake-open-submission.js` holds it; live flag read on 2026-10-18: on |
| 3 | Browser gate removed but server still refused (401/403) | Both halves in place |
| 4 | A stale tab sent work already "In progress" (35) | The server normalises it; `test/intake-created-status-server-guard.js` |
| 5 | A "stale build watch" claimed but absent (35) | There is no service worker; the page is plain HTTP-cached. An old tab keeps working because the server accepts the old shape |
| 6 | Browser store full made every send fail forever, with a "safe to retry" lie (92) | Message fixed in 92; this audit found the same hole still open for the send itself (see Fixed 1) |
| 9 | A batch just made could not take a second post (49) | Fixed by the append migrations |
| 10 | At the Linear cutoff every intake path would refuse (181) | Native lane live; `public_intake_enabled` on |
| 11 | Editor picker greyed out by a 1,000 row cap (214, 216) | Fixed (aggregate migration) |
| 12 | Submit could post straight to the old webhook (217) | Removed; held with a visible retry (`test/linear-submit-durability.js`) |
| 13 | A silent catch hid native batches (218) | Fixed |

## What was tested

In a real headless Chromium against the mocked gateway, on the upload link at 1280 and 390 wide and on the
Submit tab at 1280, new file `docs/syncview-design/tests/upload-never-lost-browser.js` (now **203 checks**):

- typed values survive a reload, a closed and reopened tab, back then forward, and a crash with no unload (the last keystroke is kept);
- a dropped network, a 500, a 401 and a 200 that did not commit: nothing claimed, everything kept, plain words, button usable, the retry sends the same request id and ends with exactly one upload;
- the answer lost after the server kept it: the retry is the same request, one upload, and the person is told it arrived;
- a double click: one request; closed during the send and reopened: never two; a slow server: no success until the answer;
- the server took it but the calendar-card step failed: told "received", not "failed"; the retry finishes without a second batch;
- the client list down, and staff signed out: nothing sent, nothing claimed, typing kept, the reason shown;
- browser storage refusing every write (the full-store case, which Safari private windows also cause), with and without a lost answer;
- no `navigator.locks` (older browsers), with a lost answer;
- a saved send the server keeps refusing is discarded after its strikes: the typed form must come back.

Existing suites run and pass: `upload-form-browser` (77 checks), `saved-submission-browser` (43),
`prod-write-gateway-browser`, `staff-phone-browser`, `test/intake-raw-copy.js` (new, 19 checks).

Live (test client only, read plus ONE real send): `public_intake_enabled` is on; the page was driven through the real
link with the answer deliberately dropped after the server replied. Both attempts carried the same request id and
the server returned the same batch and the same two work items both times (1 batch, 2 items, never 2 batches); the
page said "Upload received. Thank you!" only after the second answer.

## What failed, and what was fixed

1. **A full or refused browser store stopped typing and stopped sending.** Every keystroke threw; the send was refused
   with "could not be saved safely in this browser". Fix: the draft save and the last-link save can no longer throw; when the
   retry copy cannot be stored the send goes out from memory with a stable request id, so a second press is the same
   request. (Test failed before: 6 checks.)
2. **A browser with no cross-tab lock could never send.** Fix: it sends without the lock (the request id is the guard). (3 checks failed before.)
3. **"Not sent" wording named no action** ("retry to resume safely"). Now: "Not sent yet. Everything you typed is saved.
   Press the button again to try again; it will not be sent twice." The status line is announced to screen readers.
4. **After the server accepted, a failed calendar step told the client link visitor about "Calendar cards".** Now
   "Your upload was received. We are finishing one last step on our side…". (3 checks failed before.)
5. **A saved send refused 2 times (4xx) or 6 loads (500) was thrown away with the only copy of the typed form.** Now the form is
   put back first and the notice says so. (3 checks failed before.)
6. **No server copy of what was typed existed before the work was built** (`public_intake_log` holds only a client, a
   request id and a count; read live: the new table does not exist yet). Now `production-write` stores the raw request
   as received in `intake_raw_submissions` as soon as the caller is accepted, one row per request id, with attempts and
   the outcome. Staff read it through `intake_raw_list` (admin and SMM keys) or the SQL in `docs/ops/INTAKE_RAW_COPY.md`.

## What Lighthouse must apply

1. Apply `migrations/2026-10-18-intake-raw-submissions.sql` (a new table; rollback at its foot). The gateway copes without it
   (`ef-auto-deploy: functions-cope-without-this`), so the merge deploys `production-write` at once and copies start the moment the table exists.
2. The Section 4 pin for `production-write` is re-pinned in this change; nothing else to do.

## What remains

- Only Chromium is installed in the build sandbox. **Safari/WebKit and Firefox were not run.** The storage and lock cases
  are emulated in Chromium. A real iPhone and a real Firefox pass is still owed.
- No staff screen lists received uploads yet (the gateway action and SQL exist).
- The raw copy is taken after a caller is accepted. A request refused before that (bad shape, flag off, rate limit) is
  not stored; the person sees the error and keeps the draft, and the refusal appears in the write-refusal log.
- If storage is full AND the tab is closed before a send finishes, nothing is saved: there is nowhere to keep it.
- **Test data left on the live system, not archived:** the repo's test-residue tool was blocked by the sandbox's permission
  check, so this session's single live send is still active on the test client: 1 batch (`bat_48060b66-c2f1-4c9b-862d-4a2ccf240cb1`),
  2 work items (`del_8812827b-8f00-4945-a961-f252f26ddcb6`, `del_35716465-7d1e-4421-8c2e-74006424b826`) and 1 calendar
  card (`p_native_9d78b6e2407db80f6b294b414256_1`). Lighthouse or the owner should archive them.
