# Step K report: client approve and request-changes off n8n

Status 2026-10-01. Read-only report. Nothing in the page, the functions or n8n was changed for step K.

## Short answer

The server side is already ready. `calendar-upsert` and `sample-review-upsert` accept a client's share-link token, and all 43
clients are in all four routing flags. What still sends a client link to n8n is page logic, in two places:

1. **The flag default.** A client link picks the function or n8n by looking up the client in the routing flag. The flag is read
   at page boot and cached, so a client link opened before the flag loads goes to n8n.
2. **Pinned repairs.** A saved-for-retry write remembers its route. One pinned to `webhook` is replayed to n8n for client links.

## Proposed change (not started)

- Client links always send to the function, with no flag lookup (Calendar: `_calUpsertFetchClientLink`; Samples:
  `_sxrUpsertFetchClientLink`).
- Pinned `webhook` repairs for client links go to the function too.
- Replace the two byte-for-byte carve-out tests with tests that prove a client link only ever reaches the function, and that a
  token for another client is refused.
- Keep the n8n upsert workflows on until their runs show zero calls (30 day rule, earliest 2026-10-29).

Effort M, risk high (it is the client-facing approve button). Test client only: `sidneylaruel`.

## What the remaining n8n runs are

Runs since 2026-09-30 00:00 UTC: 335 Calendar Upsert Post, 178 Sample Review Upsert. I opened the headers and body of five of
them (spread over both days and both workflows). All five were `curl` calls from cloud addresses for the test client with
synthetic ids, so they look like test traffic, not real clients. I did not open all 513, so "all test traffic" is likely, not
proven. The plan's check 1 (split by payload) should be repeated over the full list before anything is switched off.

Known real caller still on n8n: Generate Caption's Save step (`calendar-upsert-post`). That is a separate later step.

## Risks

- A wrong change here stops clients approving. Ship behind the existing test client first, then run the Calendar browser gate.
- Old open tabs keep the old page for hours; the n8n workflows must stay on through that.

## Waiting on the owner

Say go and I build it as one branch and one PR.
