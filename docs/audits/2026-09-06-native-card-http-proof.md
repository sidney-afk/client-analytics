# Native card HTTP proof — isolated, installation held

This is a finite G3 proof under the [canonical checklist](../independence/GO_LIVE_CHECKLIST.md), based on PR1324 `8514a83ed1a65145a3a51ffe52e5fcbb2976be31`. It consumes the separately authored native HTTP adapter and the unchanged [native SQL boundary](../ops/NATIVE_CARD_MATERIALIZATION_BOUNDARY.md). It adds tests only; it does not amend browser, writer authentication, SQL, recovery corpus, n8n, flags or deployment workflows.

Final independent result at adapter `c32b12df251bcbbf50eed6e9627b6abd030dda76`: **42 groups PASS, 64 actual loopback HTTP requests, zero external attempts**. Three separate entrypoint safety controls pass before any database import. The [sanitized evidence](2026-09-06-native-card-http-proof-evidence.json) pins the tested sources and private receipt hashes. The exact owned PostgreSQL server was stopped afterward; synthetic databases and earlier failures remain private. This closes the bounded dormant-source review, not installation readiness.

## Reproduction and isolation

Run `node test/native-card-materialization-http.js` with the existing explicit `F63_REQUIRE_POSTGRES=1` disposable PostgreSQL binding. `PGHOST` must be literal loopback (or the local `localhost` alias), `PGPORT` must name the owned disposable server, and `PGUSER`/`PGPASSWORD` identify its synthetic fixture owner. `NATIVE_CARD_TEST_PSQL` selects an existing psql executable. The wrapper clears inherited libpq routing overrides, creates a uniquely named database, installs the existing fixture migrations, and retains that database and private logs on either success or failure. It never starts, stops, or drops a server. Set `NATIVE_CARD_HTTP_OUTPUT` to an owned private directory for durable evidence.

The existing `test/run-all.js` discovery registers the test automatically; the existing PostgreSQL CI job already supplies F63. Missing opt-in is an explicit local skip and an error in CI. There is no workflow change. `NATIVE_CARD_HTTP_SOURCE_ROOT` can select the reviewed adapter checkout during parallel work; after integration it defaults to the test checkout.

`http-edge.mjs` loads the actual request handlers and unchanged authorization imports. Only the Supabase SDK transport is replaced by the existing SQL seam. A real Node HTTP listener accepts streamed Requests on its owned loopback port. The native RPC executes the actual function as `service_role`; ordinary handler operations use the fixture SQL transport. Native requests must call exactly one materialization RPC and must not enter the ordinary table/comment/event path. External fetch, socket and TLS destinations are refused. The gateway and extracted browser functions construct the submitted envelopes; one fictional browser-valid client slug replaces the older SQL fixture's hyphenated slug.

`http-lane.mjs` records hashes of the handler/helper sources, proof files, gateway, browser and SQL boundary, and verifies they remain unchanged through completion. Raw requests, database inventory, failure logs and captured sources remain private. The public evidence carries only source hashes, counts and synthetic check names.

## Finite acceptance

| Boundary | Actual test |
|---|---|
| Accepted creation | Calendar/Samples × video/thumbnail/both, real gateway manifests and extracted browser envelopes, complete scoped row equality |
| Lost response | Destroy HTTP response after commit, edit current title/status/assets/order/notes, then replay without rewriting accepted owners |
| Refusal and conservation | Default hold, unknown manifest, wrong client/card/child/body, wrong endpoint, invalid staff key and ingress-storage failure |
| Malformed success | Missing/null/wrong/string/throwing RPC response and unexpected component in a previously absent slot must never complete browser work |
| Body admission | Oversize, invalid UTF-8 and malformed JSON refuse before native or ordinary mutation |
| Ordinary writers | Rename-back, approval, note and tweak remain on their original path; no native RPC |
| Real browser consumption | Actual retained-card function adopts the full HTTP current row before recording completion |
| Legacy routing | Actual cold and failed-flag wrappers select a locally refused legacy stub; healthy flag reaches loopback EF |

An initial adapter `e4b56f582aa5c03e74b3bc93a35c0d362670c9d4` run passed 40 groups over 62 loopback requests. Adding an independent malformed-response control then exposed a real response-checker defect: a Calendar video-only success could gain a nonempty graphic slot and still return 200. That baseline stopped at 8 PASS / 1 FAIL. The actual SQL replay remained unchanged; only its returned row was fault-injected. This is a malformed-response contract defect, not evidence that SQL emits corrupt linkage. The correction compares both slots with explicit null/empty normalization; the Calendar and converse Samples negatives now refuse, with all six valid creation shapes retained. Handler/auth and SQL bytes were unchanged by this correction.

## Dated anonymous capture boundary

An optional private `NATIVE_CARD_HTTP_CAPTURE_CONFIG` JSON supplies `calendar` and `samples` objects with exact `path` and `sha256` fields. It consumes the preserved Calendar v48 and Samples v49 captures observed on 2026-09-04; those original files are never edited or published. Without the private configuration, the report explicitly says those cases were not run. They are not silently counted in hosted CI.

For each capture the fixture loads both the unchanged original and a derived copy containing only the candidate import, bounded preparse block and terminal native branch. The capture's anonymous actor/auth behavior stays intact. This limited graft excludes the candidate's outer-catch/logging additions and is not a serving release artifact. Original captures reproduce late native replay overwriting a human title; the derived native branch preserves it, while ordinary anonymous approvals/notes/tweaks still save.

## Limits and rollback

This proves loopback HTTP with real selected SQL and actual source functions. It does not execute the Deno host or Supabase SDK network stack, an n8n graph, a deployed function, or a live client journey. Native service-role RPC execution is actual; ordinary fixture transport is not installed ACL proof. No whole-schema or selected37 restore was repeated.

The original n8n bypasses and browser cold/failed-flag fallback remain an explicit release hold. A locally refused stub proves route selection, not a repaired graph. The dated anonymous captures are neither current serving equality nor permission to deploy repository auth onto frozen writers. HTTP body limits also do not establish upstream proxy limits or an operational abuse policy.

Test-only rollback removes these files and their map entry; it changes no data or serving source. Private fixture data is deliberately retained. Any eventual runtime rollback must preserve accepted receipts/current-row replay and retained owners; reverting to the old full-row writer after native acceptance can overwrite human edits.
