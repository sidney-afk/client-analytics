# Linear cutover touchpoint inventory

**Verified:** 2026-07-14 UTC against `main` at `e3961b6` and the live Linear, n8n,
Supabase, and GitHub configurations. **Scope:** every runtime or scheduled path found that reads
or writes VID/GRA Linear data. Test/audit harnesses are listed separately. This document is
public-safe: no API-key values, client content, or production comment bodies are included.

The original inventory audit was read-only except for one sanctioned comment on the TEST project. That comment was
created through the production `linear-add-comment` bridge, observed through the same incremental
job used by the 30-minute refresh, and then deleted. No runtime flag, workflow, webhook, or
production row was changed at that audit boundary. Subsequent Part 2 evidence is labeled separately:
four n8n definitions received fail-closed authority gates under private backup/readback on
2026-07-13 UTC, without a runtime-flag change, workflow activation change, Linear mutation, or
production authoritative-row write.

## Disposition vocabulary

- **reroute-through-outbox** — preserve the user action, but write Supabase first through
  `deliverable-write` / `batch-write`; let `mirror_outbox` and `linear-outbound` keep Linear fresh.
- **keep-until-B5** — safe to retain during the dual-ready epoch because outbound keeps Linear
  fresh; re-source or retire during B5.
- **neutralize** — authority-gate or disable at the write-UI handoff. Leaving it live can bypass
  Supabase authority, replay a stale browser write, or import stale Linear state.
- **no-action** — no Linear dependency, already authority-safe, or disconnected test/dead code.

`VERIFIED` means the current repo source and the relevant live configuration were both checked.
`STAGED-SOURCE-VERIFIED` means the draft source and offline behavior were checked, but the change is
not merged, deployed, or live-proven. A mixed row may say `VERIFIED BASELINE /
STAGED-SOURCE-VERIFIED`. Anything the connected identity could not inspect is explicitly marked
`UNVERIFIED` and remains an owner gate; this applies to the OAuth-application inventory and the
`/add-to-calendar` caller.

## Live posture at the audit boundary

| Check | VERIFIED evidence |
|---|---|
| Authority | `prod_authority={video:linear,graphics:linear}` at 2026-07-12 20:06 UTC. |
| Outbound | `linear_outbound_enabled={mode:off}` at 20:06 UTC. The B4 pipe is proven but paused for the pre-write-UI epoch. |
| Inbound | `linear_inbound_enabled={enabled:true}`. |
| Auth | `auth_enforcement={mode:permissive}`. |
| Workload mirror | 1,917 active `workload_issues`; newest `synced_at` 20:20 UTC. |
| Linear webhooks | Exactly four enabled; all four subscribe to both Issue and Comment. See the automation table below. |

## Mandatory write-UI epoch checklist

- [ ] **Reroute every explicit status, comment, and create intent in the writer table through the
  server-side outbox.** Do not leave a direct Linear branch beside the new button handler.
- [ ] **Make the native comment lane self-contained and visible on every lived surface.** Part 1
  created the normalized Linear issue store and Production reader, but F42/F43 prove that active
  Calendar/Samples threads were not migrated and create/lifecycle/client-read paths remain split.
- [ ] **Reconcile both comment histories, not only Linear.** The direct Linear backfill is
  idempotent, but enrollment also needs a composite-ID migration from Calendar/Samples with exact
  parent, audience, component, tweak, resolve/delete, author/time, and target parity. Provision
  about 20,000 normalized rows; size event/outbox rows and body/attachment bytes separately.
- [ ] **Drain and then neutralize all three browser queues:** `syncview_linear_outbox_v1`,
  `syncview_sxr_linear_outbox_v1`, and `syncview_calCardJobs_v1`, including startup, focus, timer,
  page-hide, resume, and reassert paths.
- [x] **Install central authority checks before the UI epoch** on `linear-set-status`,
  `linear-add-comment`, `video-form`, and `graphic-form`. Frontend checks alone do not stop old tabs.
- [ ] **Authenticate every caller of those four serving mutation routes now (F91).** Direction
  authority is not caller identity. Require an active, individually revocable staff principal or an
  owner-ratified, server-minted, short-lived exact-client intake capability; server-resolve the
  target scope and record immutable attribution. Do not defer this boundary to the write-UI epoch.
- [ ] **Standardize authority vocabulary (F55):** every browser, EF, script, reconciler, and n8n
  guard must accept only canonical `linear`/`syncview`. Remove/migrate the backend-only `supabase`
  alias, reject malformed/partial values consistently, and pass one all-consumer contract drill.
- [x] **Neutralize ungated inbound writers for SyncView-authoritative teams:** the calendar/sample
  branches of `MJbMZ789B5ExZz9x`, both legacy apply reconcilers, and the B1 incremental apply job.
- [ ] **Resolve the separate MJb operating-topology gate (F46):** its saved graph is gated but
  inactive/unpublished after a crash cluster. Choose and drill repaired/published fast path versus
  reconciler-only latency; machine-read active state, version/node fingerprint, and last green.
- [ ] **Re-source intake project selection and urgent-assignee lookup** to native
  `clients` / `deliverables` / `team_members` at the epoch.
- [ ] **Make intake durably acknowledged and complete:** no 2xx before a persisted idempotent
  receipt; no null-project fallback; every project query fully paged; browser draft retained until
  final success; retry/dead-letter/replay and partial-create TEST drills green (F44/F45).
- [ ] **Activate native linkage everywhere, not only in the four Kasper predicates.** Switch link
  slots, status gates, duplicate/move checks, archive identity, focus navigation, urgent references,
  and new audit logs to `video_deliverable_id` / `graphic_deliverable_id` or a native route.
- [ ] **Close the deliverable → card projection gap (F50):** linkage IDs alone do not update the
  Calendar/Samples review-status field when Production status changes. Implement and TEST the
  explicit vocabulary mapping, or move every affected reader to canonical deliverable state.
- [ ] **Build the canonical Graphics artifact lifecycle (F53):** give the designer a protected,
  ordinary path for assignment, file upload/link, replacement, completion, and cross-surface
  visibility. Organizer-only card-shadow edits are not a substitute for `deliverables.file_url`.
- [ ] **Exclude inactive clients end to end (F54):** remove their work from every queue and reject
  status/comment/due/assignee/file mutations server-side. Record the offboarding disposition for
  already-assigned and in-progress rows.
- [ ] **Neutralize legacy linkage writers:** manual URL edit/adoption, import/bulk-link card writes,
  and post-submit card jobs. Keep an "Open in Linear" convenience only until B5.
- [ ] **Version-bump or authority-filter the seven-day Calendar/SXR card caches** and expire
  `syncview_calLinearMeta_v1`; otherwise cached Linear URLs immediately reactivate old UI behavior.
- [ ] **Owner: locate and disable the D-9 23:45 UTC roller** before authority flips. Disable, do not
  delete, then observe two nights.
- [ ] **Owner: enumerate Authorized Applications/OAuth apps** with workspace-admin scope and record
  that no unlisted application can mutate VID/GRA before authority flips.
- [ ] Keep the temporary readers marked **keep-until-B5**, then retire them in the order in
  `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` section 13.4.

## Writer inventory

| Status | Surface / trigger | Current browser-to-Linear path and payload | Identity and auth at the call | Epoch disposition | Evidence |
|---|---|---|---|---|---|
| VERIFIED | **Calendar status — omitted from the supplied list** | Normal card save, stale-status reassert, and Kasper persistence call `_calPushStatusToLinear`; `{issue,status}` goes to `linear-set-status`, whose active graph now checks team authority before Linear `issueUpdate`. Calendar does not actually block `Posted`, despite the stale source comment. | A staff role key or client token may exist for the preceding card save, but **none is sent to this webhook**. The authority gate limits direction, not caller identity; Linear actor is the house integration user. | User intent: **reroute-through-outbox**. Central authority gate is installed; helper, reassert, and direct bridge still **neutralize** after queue drain. | `index.html:20208-20268`, `25556-25579`, `43379-43384`; live n8n `VQqqeY9B2GZbh2Bt` active v`2ab7e91f…` (2026-07-13 readback). |
| VERIFIED | **Calendar comments** — client, SMM, and Kasper | `_calPostLinearComment` sends `{issue,body,author}` to `linear-add-comment`; its active graph now checks team authority before Linear `commentCreate`. The Notes modal sends every video/graphic root, reply, plain comment, and tweak; edits/resolves/deletes do not sync. | Client token / role key can authenticate the card save, but **none is sent to the Linear bridge**. `author` is cosmetic Markdown; the authority gate limits direction, not caller identity. | Intent: **reroute-through-outbox** with the authenticated actor/role or verified client identity. Central authority gate is installed; direct helper/bridge still **neutralize** after queue drain. | `index.html:20269-20292`, `28403-28493`, `29319-29380`, `43640-43643`; n8n `8stSpZUiyG7f2LQX` active v`f214d351…` (2026-07-13 readback). |
| VERIFIED | **Calendar local retry queue** | `syncview_linear_outbox_v1` stores only `{kind,payload,attempts,...}`; retries on load/focus and a 60-second timer, stops automatic retry after six attempts, and retains the row until console cleanup. | No durable authenticated actor context is stored. A later flush sends no role key or client token. | **neutralize** after an all-browser diagnostic and verified drain. Reject stale flushes centrally. | `index.html:20122-20206`, `20414-20418`. |
| VERIFIED | **SXR status** | Successful sample save plus Kasper save/undo call `_sxrPushStatusToLinear`; there is no live symbol literally named `_sxrLinearPush`. `{issue,status}` reaches the shared status bridge. SXR skips `Scheduled` / `Posted`; `_sxrReassertLinearStatus` exists but has no caller. | Same gap: staff/client auth may exist for the card save but is not forwarded. House Linear actor. | Intent: **reroute-through-outbox**. Active direct helper: **neutralize**; dead reassert helper: **no-action now**, remove at B5. | `index.html:36142-36146`, `37339-37350`, `37848-37929`; dead definition `37385-37396`. |
| VERIFIED | **SXR comments** | `_sxrPostLinearComment` uses the shared `{issue,body,author}` bridge. Review tweaks, Notes roots/replies/plain messages, and Kasper tweaks all reach Linear. | No Linear-bridge auth; display author is cosmetic; house Linear actor. | Intent: **reroute-through-outbox**. Direct helper/bridge: **neutralize**. | `index.html:36687-36716`, `36943-36959`, `37352-37357`, `37848-37876`. |
| VERIFIED | **SXR local retry queue** | Separate `syncview_sxr_linear_outbox_v1`, six attempts, 60-second retry, startup/focus drain. | Payload only; no durable role key/client token/actor proof. | **neutralize** after verified drain. | `index.html:34192`, `37319-37338`, `37508-37518`. |
| VERIFIED | **Shared SMM `linear-set-status` bridge** | Public CORS POST `{issue,status}` resolves team authority first, then calls `issueUpdate` only for an allowed Linear-authoritative target. If the issue is overdue, it also changes `dueDate` to current UTC date +2 days. | No caller auth. Active Code node embeds a house personal Linear key; value intentionally omitted. | **Contain/authenticate now (F91)**; authority is not identity. Then **neutralize** the bridge at epoch after every caller reroutes. Port/retire the overdue side effect according to D-30. | n8n `VQqqeY9B2GZbh2Bt` active v`2ab7e91f…` (2026-07-13 readback); earlier execution `255235` proves status + due mutation. |
| VERIFIED | **Shared SMM `linear-add-comment` bridge** | Public CORS POST `{issue,body,author}` resolves team authority first, then calls `commentCreate` only for an allowed Linear-authoritative target. | No caller auth. Same embedded house key; actual Linear actor is the integration user regardless of cosmetic `author`. | **Contain/authenticate now (F91)**; then **neutralize** after all callers reroute. | n8n `8stSpZUiyG7f2LQX` active v`f214d351…` (2026-07-13 readback). |
| VERIFIED | **Submit — video create** | `submitLinearForm` sends `{clientName,title,notes,filmingPlans,videos[]}` to `video-form`; the active form graph checks team authority before its VID parent/child create branch. | Browser sends **no staff role key, client token, or submitter identity**. The workflow selects a per-SMM personal Linear key solely from `clientName`; the gate limits direction, not caller identity. | **Contain/authenticate now (F91)** with staff identity or an owner-ratified short-lived exact-client intake capability. Then **reroute-through-outbox**: durably create native batch/deliverables first, mirror, and neutralize direct create. | `index.html:29998-30078`; live `BrJSe8zCKUccfmIq` active v`d867fa43…` (2026-07-13 readback), reachable `video-form` graph. |
| VERIFIED | **Submit — graphic create** | Same payload to `graphic-form`; the active form graph checks team authority before its GRA parent/child create branch. | Same unauthenticated browser call and client-selected per-SMM key; the gate limits direction, not caller identity. | **Contain/authenticate now (F91)**; then **reroute-through-outbox** and neutralize direct create. | `index.html:29998-30078`; live `BrJSe8zCKUccfmIq` active v`d867fa43…` (2026-07-13 readback), reachable `graphic-form` graph. |
| VERIFIED | **Submit log** | `{timestamp,clientName,mode,webhookJson}` to `log-linear-submission`; appends the fallback `Linear Submissions` Sheet. It does **not** mutate Linear. | No browser auth; Google Sheets credential is server-side. | **keep-until-B5** (or retain as non-Linear telemetry). | `index.html:30049-30069`; reachable `Webhook6 -> Append row in sheet` branch in `BrJSe8zCKUccfmIq`. |
| VERIFIED | **Post-submit Calendar job queue — omitted** | After Linear create, `syncview_calCardJobs_v1` waits/polls for VID/GRA children, derives Linear-keyed card IDs, and resumes unfinished jobs. The #850 native cohort removes the Linear poll but keeps post-commit materialization/recovery actor-bound in browser localStorage (F134). | Legacy has no durable submitter identity; the native cohort binds recovery to the initiating actor without a server job/admin reassignment. | Drain/expire and **neutralize** legacy polling. Native replacement is a server-owned idempotent materialization job with protected recovery/reassignment, exact-once linkage, and no global block on unrelated intake. | `index.html` symbols `_calCardJobCreate` / `_resumePendingCalCardJobs` (`30384-30425`); original #813 review 2026-07-14, implementation merged via #850. |
| VERIFIED | **B4 server-side outbox — target mirror path** | Native ledger transactions enqueue `mirror_outbox`; drainer supports create/status/comment/due/assignee/title/priority/parent/archive/restore. The #850 browser cohort still does not expose §9.4's atomic card+deliverable title operation (F133). | Durable actor/role/time/dedup/source clock; dedicated mirror actor; authority/global gates. | **no-action only to proved mirror mechanics**. Wire every UI mutation, canonical CAS title, F50 projection and F136 current-state/assignee policy before human flip. **keep-until-B5** once live. | `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` §4.4 (`631-711`); `linear-outbound-drain.yml`; F133/F136 source matrices. |

### Auth available versus auth actually sent

| Browser context | Auth available to the card/native write | Auth sent to current Linear bridge | Required epoch behavior |
|---|---|---|---|
| Client Calendar/SXR link | Verified client token | **none** | Native write verifies client token, persists client actor/role/timestamp, then outbox mirrors. |
| Signed-in staff / Kasper | Verified staff role key + roster actor | **none** | Native write verifies role key and persists the roster actor/role/timestamp before enqueue. |
| Old-tab localStorage retry | Only the saved `{issue,status}` or `{issue,body,author}` payload; no running-build/auth-authority epoch | **none** | Drain, then reject centrally by minimum build/epoch before mutation; the advisory update banner is not expiry proof (F127). |
| Submit tab | The current bypass route deliberately omits staff identity; whether an external shareable intake capability must remain is an OPEN owner decision (F91) | **none** | Contain now: require an active revocable staff principal or an owner-ratified, server-minted, short-lived exact-client capability. Never select mutation identity or target scope from `clientName`. |
| Post-submit card job | Saved client/title/mode/video numbers; no submitter proof or running-build/auth-authority epoch | **none** | Drain/expire the job, reject stale epochs centrally, and return native linkage directly from the authorized create. |

### Authentication evidence boundary

The deployed dark baseline returned 401 for missing, garbage, mixed, and invalid staff/client
credentials; 403 for authenticated wrong-roster, wrong-client, or client-forbidden operations; and
409 for a valid staff Production write while that team remained Linear-authoritative. The
service-authenticated disposable TEST drill exercised 18 operations across two teams, saw zero
unexpected echoes, reconciled `0/0/0`, cleaned up, and left flags unchanged. The draft adds an
offline policy/source matrix for every operation and auth mode. That is not a successful live
staff-role-key/client-token browser matrix: positive TEST browser HTTP/UI proof after gateway-delta
deployment remains a mandatory owner gate.

### Legacy submission payload (pre-Part 2)

```json
{
  "clientName": "<selected project>",
  "title": "<built form title>",
  "notes": "<filming/general-drive links plus notes>",
  "filmingPlans": "<URL or empty>",
  "videos": [
    {
      "number": 1,
      "main_cam": "<URL or empty>",
      "side_cam": "<URL or empty>",
      "audio": "<URL or empty>",
      "dueDate": "YYYY-MM-DD"
    }
  ]
}
```

The legacy creation workflows fetch a public SMM roster CSV and use its per-client personal Linear
key. The submitter is not authenticated. This is both an attribution gap and a stale-tab cutover
bypass.

### Native submission payload (Part 2 stacked draft)

```json
{
  "operation": "intake_create",
  "surface": "submission",
  "client_slug": "<canonical native slug>",
  "request_id": "<stable idempotency id>",
  "source_edited_at": "<stable ISO timestamp>",
  "batch": {
    "name": "<built form title>",
    "description": "<links plus notes>",
    "filming_doc_url": "<URL or null>",
    "footage_folder_url": "<URL or null>"
  },
  "items": [
    {
      "team": "video",
      "videoNumber": 1,
      "title": "Video 1",
      "brief": "<camera/audio links>",
      "due_date": "YYYY-MM-DD",
      "status": "in_progress",
      "card_id": "<stable native Calendar card id>",
      "sort_key": 0
    },
    {
      "team": "graphics",
      "videoNumber": 1,
      "due_date": "YYYY-MM-DD",
      "status": "in_progress",
      "card_id": "<same Calendar card id>",
      "sort_key": 0
    }
  ]
}
```

The browser supplies neither assignee nor graphics brief. The verified staff role key/roster actor
is carried only in gateway headers; the server owns identity, graphics generation, assignment,
authority/parity selection, and outbox creation. An ambiguous response reuses the exact payload,
request id, and source timestamp.

## Critical comment-visibility test

### Live probe

| Step | VERIFIED observation |
|---|---|
| Baseline | TEST issue `VID-12612` mapped to exactly one deliverable. Linear had two historical bridge comments; native deliverable thread count was 0; `linear_raw.issue.comments` count was 0. |
| Real bridge write | At 2026-07-12 20:18:29 UTC, the production `linear-add-comment` path posted marker `cutover-visibility-20260712201826`; n8n execution `256233` succeeded. Linear created exactly one comment at 20:18:30 under the house actor. |
| Realtime lane | After both Comment webhooks had time to settle, the deliverable thread stayed at 0, `linear_raw` stayed at 0, `updated_at` did not move, and there was no new `mirror_in_comment_add` event. |
| 30-minute refresh lane | Manually dispatched incremental run `29208341729` used the scheduled job's code path and covered the marker (`changed_since=2026-07-12T20:10:49.528Z`). It found two changed issues and one operational issue and completed successfully with zero deliverable writes. The native thread and `linear_raw` stayed at 0, no event appeared, and `updated_at` remained unchanged. |
| UI lane | Production defines event-loader/Activity helpers but never calls them; issue detail renders normalized Comments only and never maps `linear_raw.issue.comments` into a feed (F138; source/browser call census 2026-07-14). |
| Cleanup | Deleted probe comment `6596d87d-ab5a-4b1c-a43a-e3d9188b1ece`. Linear then had zero marker matches; after settlement, the native thread and `linear_raw` remained at 0, with no event and no `updated_at` change. |

### Definitive verdict

**Bridge-authored comments are NEVER visible as comments in the mirror tab's issue detail.**

- Realtime intentionally drops every house-authored body matching the `**… (via SyncView):**`
  convention (`linear-inbound/index.ts:569-590`, `722-748`).
- The recurring B1 incremental query does not request comments, and comment-only issue updates do
  not enter its compared deliverable field set (`b1-linear-backfill.js:427-450`, `832-836`,
  `1040-1077`).
- The detail UI renders normalized Comments only; it invokes neither the native event loader/Activity
  renderer nor any `linear_raw` comment-body projection (F138).

After the write-UI epoch, the same human message can be visible because the native comment is
written locally first. That is the authoritative local copy, not an imported bridge comment.

### Historical `linear_raw` spot-check

| VERIFIED readback | Result |
|---|---|
| All deliverables | 4,350 rows. |
| Operational `linear-backfill` rows | 1,145 total; 387 have a comments array, of which 381 are non-empty and 6 empty. The non-empty arrays retain 577 comments across 20 actor identities. |
| One-time catch-up marker | 486 rows retain the 2026-07-07 catch-up marker; 373 still have non-empty arrays with 565 comments and 113 now have no comments array. No retained array reported pagination beyond the 50-comment cap. |
| Public-safe parity spots | `VID-9714` and `GRA-5239` each had 6 raw snapshot comments and 6 current Linear comments. |
| Finished-work history backfill | 3,187 `history-backfill-2026-07-10` rows; 0 raw comment threads, by design. |

So backfill-era snapshots **sometimes contain complete historical threads**, but they are not a
durable live comment lane and the Production UI does not display them. A later partial Linear issue
payload can replace `linear_raw.issue` without comments, which explains the 113 catch-up rows that
now have none.

## Comment coverage census (2026-07-12 addendum)

All counts below came from read-only, fully paged API/REST reads. Only aggregate counts and schema
shape were retained; no comment body, client/project name, API key, or sampled issue list appears in
this document.

### `deliverable_events` since B3 live

The census used `ts >= 2026-07-07T00:00:00Z` and semantic action/source filters; a text search for
"comment" would incorrectly include reconciler webhook-health summaries.

| VERIFIED event class | Ledger rows | Distinct scope | Body in event payload | Actual author in event payload |
|---|---:|---|---:|---:|
| Accepted inbound `mirror_in_comment_add` | 67 | 57 comment IDs across 37 deliverables; 10 IDs logged twice; 49 graphics / 18 video rows | 0 / 67 | 0 / 67 |
| Native/outbound `comment_change` | 6 | 6 sanctioned TEST intents | 6 / 6 | 0 / 6 |
| Comment `mirror_out_echo_dropped` | 18 | 6 TEST outbox intents, each logged three times | 0 / 18 | 0 / 18 |
| One-time `linear_comment_catchup` summary | 489 | 489 deliverables; summaries represent 825 historical comments | 0 / 489 | 0 / 489 |

There are therefore 85 direct mirror-lane rows (67 accepted inbound plus 18 echo records), but at
most 63 distinct accepted/intended comments after inbound duplicates and repeated echo records
collapse: 57 inbound comment IDs plus 6 outbound TEST intents. The inbound
event actor is a transport/system identity, not the human commenter. Live payloads and source agree:
`linear-inbound` writes body and author into mutable `deliverables.comments`, but sends only
`linear_comment_id` and image references to `eventFor` (`linear-inbound/index.ts:390-402`,
`695-705`, `746-748`). Catch-up ledger rows contain only count/pagination provenance
(`b3-comment-catchup.js:205-211`). **The event ledger cannot reconstruct comment text or authors.**

### `linear_raw` retention by cohort

| VERIFIED cohort | Rows | Rows with comments array | Non-empty arrays | Retained comments | Conclusion |
|---|---:|---:|---:|---:|---|
| All deliverables | 4,350 | 387 | 381 | 577 | Only 8.9% have any array. |
| Operational `linear-backfill` | 1,145 | 387 | 381 | 577 | Arrays exist only in this cohort. |
| `history-backfill-2026-07-10` | 3,187 | 0 | 0 | 0 | Finished-work import intentionally has no threads. |
| Recent inbound refresh (`linear_raw.inbound.webhook_timestamp >= 2026-07-10`) | 108 | 0 | 0 | 0 | Realtime refresh does not retain arrays. |
| Rows carrying `incremental_refresh` | 42 | 13 | 13 | 29 | All 13 array-bearing rows also retain the catch-up marker; this marker covers only soft-handled incremental rows and does not mean current refreshes import comments. |

Recent reads do not populate comments. Realtime inbound replaces `linear_raw.issue` wholesale except
for `parent` (`linear-inbound/index.ts:319-332`), and the B1 query does not request comments
(`b1-linear-backfill.js:427-450`). The 489 catch-up summaries represented 825 comments at capture
time, while only 565 remain in the currently marked raw rows. `linear_raw` is therefore neither a
complete history nor a safe backfill source.

### Workspace-wide Linear volume estimate

The read-only population census found 17,544 currently discoverable VID/GRA issues at the
2026-07-12 cutoff, including archived issues: 11,428 VID / 6,116 GRA and 4,232 parents / 13,312
subissues. A reproducible 256-issue sample used equal-rank creation-age quartiles inside each
team x parent/subissue cell, yielding 16 strata and 16 issues per stratum. Selection used the 16
lowest unsigned FNV-1a32 hashes of
`linear-comment-volume-v1-2026-07-12T00:55:51Z|<identifier>` in each stratum. Each issue was
requested with `limit=250` and followed until `hasNextPage=false`; all 256 fit on one page. The
sample had zero API errors and no issue exceeded 11 comments.

| VERIFIED population-weighted estimate | Result |
|---|---:|
| Mean comments per issue | 0.729 |
| Median / P75 / P90 / maximum observed | 0 / 1 / 2 / 11 |
| Zero-comment share | 53.6% |
| Estimated currently retained comments | 12,792 |
| Approximate 95% interval for total retained comments | 10,865-14,718 |
| VID / GRA estimated comments | 4,784 / 8,008 |
| Parent / subissue estimated comments | 5,303 / 7,488 |

This estimates currently retained/discoverable comments, including replies and inline description
comments but excluding issue activity history. Deleted comments and deleted/inaccessible issues are
not recoverable. The interval treats deterministic hash selection as approximately random and may
understate a rare unseen extreme tail. For an all-VID/GRA migration, **15,000 current comment
entities** is the statistical planning minimum. Provision about **20,000 comment rows** for growth
and rollback staging, and size event/outbox rows plus body/attachment bytes separately. Narrow the
population only with an explicit mapped-deliverable scope.

### Display gap and epoch deliverable

Production has dormant `_prodLoadEventsFor()` and `_prodActivity()` helpers, but runtime calls neither;
issue detail renders normalized Comments only (F138). The Activity helper's presentational shape is not
live evidence and `linear_raw` is incomplete. The epoch must:

1. make each durable comment event self-contained with body, stable author identity, timestamp,
   Linear/native comment ID, parent/thread metadata, role/audience, and edit/delete state;
2. backfill historical comments idempotently from Linear, not from the incomplete ledger/raw cache;
3. render author + body + time in issue detail and verify pagination, edits, deletes, and visibility.

## Reader and inbound-writer inventory

| Status | Touchpoint | Current direction and dependency | Mid-epoch / B5 answer | Disposition and evidence |
|---|---|---|---|---|
| VERIFIED | **Workload `workload_issues`** | Linear -> `BrJ` `/linear-issues` (per-SMM keys) -> scheduled `lGwC9WWPVJtxphtf` bulk upsert/mark-sweep -> Supabase -> browser. The inactive saved `MJbMZ` graph contains fast-upsert branches, but they are **not serving traffic**. Browser uses anon REST + 5-minute cache; realtime is hard-disabled; error/zero rows falls back to `/linear-issues`. | Current freshness is the scheduled sweep SLA, not event-time fast-upsert. At B5 read `deliverables + team_members`. | **keep-until-B5**. `index.html:11684-11917`; n8n `lGw` v`50a8a1e4`; `/linear-issues` reader; `MJbMZ` live-state readback 2026-07-13. |
| VERIFIED | **`linear-tweak-comments`** | Workload posts `{ids}` for tweak-state issues; n8n reads every SMM Linear workspace and up to 50 comments per issue, parses `(via SyncView)` author labels, returns newest 10; browser caches 5 minutes. | Works mid-epoch only while outbound mirrors the needed comments. At B5 read native card/deliverable threads. | **keep-until-B5**. `index.html:13479-13510`; n8n `d7Dod7OuQsVsl1CN` v`107de134`, exec `242240`. |
| VERIFIED | **`editors-week`** | Browser -> unauthenticated n8n -> VID Linear issue histories; the legacy response powers the Editors load, finished/still-open breakdown, weekly timelines, and cache. The issue connection pages 50 at a time but silently stops after 30 pages / 1,500 issues; each issue history is unpaged at `first:250`. The measured window hit neither cap, but completeness is not guaranteed; historical transitions are attributed to the **current** assignee. | The legacy endpoint needs immediate auth/response containment. It may remain as a contained mid-epoch reader only while native parity proves complete paging, event-time assignee, load, finished/open, timeline, cache, and historical-roster behavior. | **contain now; keep-until-B5 only after containment.** Do not wait for B5 to fix public reach. Native replacement is still blocked by missing transition/attribution parity. `index.html:43879-43925`; `rhDX5VfnmOylc8o7` v`892323dc`. |
| VERIFIED | **`kasper-queue` feed** | Not a Linear reader. Calendar reads Supabase `calendar_posts`, then n8n `kasper-queue` -> Sheets fallback; SXR reads `sample_reviews`. | Feed survives Linear retirement. Four visibility predicates still require `graphic_linear_issue_id`. | Feed **no-action**; predicate dependency **neutralize/repoint** at epoch. `index.html:42403-42568`, `37610-37635`, `28831-28855`, `37543-37574`; n8n `TcWOfnKd4Csdnnbv` v`6fd805a3`. |
| VERIFIED | **Calendar Linear Status Sync `MJbMZ789B5ExZz9x`** | The workflow is **inactive/unpublished** (`activeVersionId=null`). Its five-node saved graph contains state -> `calendar_posts`, event -> `workload_issues`, and state -> `sample_reviews` branches plus authority/Track-A routing, but that saved graph is not a live real-time path. A 24-execution crash cluster preceded the saved version and no later execution was present at the 2026-07-13 readback. | Scheduled reconcilers/sweeps provide slower healing today. Re-publishing the untested saved graph could reintroduce the crash or change write topology. | **Owner decision before parity/flip:** explain crash/soft-error branches and deliberately publish/drill the gated fast path, or ratify reconciler-only latency. Then machine-read active state, version/node fingerprint, and last-green execution. At B5 remove the chosen legacy topology. |
| VERIFIED | **`linear-issue-statuses`** | Browser metadata/status pull and both legacy reconcilers -> unauthenticated `GP8CSZDNcy5sGdFr` -> Linear issue queries. | Pure reads can remain dual-ready; apply callers cannot. | Endpoint **keep-until-B5**; authority-gate callers. Active v`2203cdde`, latest exec `256255`; `index.html:20530-20689`. |
| VERIFIED | **`linear-subissues`** | Calendar import/bulk-link and Calendar/SXR point-adoption -> `Nk3pwR6Fbl4VAPqH` -> Linear parent/children/status, followed by legacy card create/link/status writes. Post-submit polling does **not** use this endpoint. | Keep lookup read-only as a rollback/import aid; native UI should use a deliverable picker. | Endpoint: **keep-until-B5**. Import/bulk-link card mutations and point-adoption: **neutralize** for SyncView-authoritative clients. Active v`9013d1af`, latest exec `253900`; `index.html:20583-20630`, `20735-21235`, `37358-37382`. |
| VERIFIED | **`linear-projects`** | Submit dropdown -> `BrJ` branch -> Linear VID projects. | Native intake should not depend on a Linear project list. | **neutralize/re-source at epoch** to native clients/projects. `index.html:11665-11682`; `BrJ` v`0efdd2c7`. |
| VERIFIED | **Urgent tweak Slack lookup, URL gates, and persistence** | Calendar, SXR, and both Kasper surfaces hide or refuse the action without `linear_issue_id`, pass that URL to `send-urgent-slack`, and persist it as `video_urgent_issue`. n8n resolves the current Linear assignee and attempts the mapped mention, but its active graph can still post and return unconditional success when assignee/mapping is absent; the browser then latches “Sent.” The retained execution sample had mapped mentions, so this does **not** assert a historical missed recipient. | Outbound could keep the issue current, but native notification cannot remain gated, routed, deduplicated, or declared successful by a Linear URL or channel-post alone. | **neutralize** the URL dependency and re-source at epoch to immutable `deliverables -> team_members`; success requires an exact-recipient receipt (mapped member, destination/message id), with missing mapping left retryable and visibly pending. `index.html:20324-20368`, `29710-29720`, `35553-35592`, `37989-38003`, `43010-43034`; n8n `TJVMyfwl85qrFGeK` active graph read 2026-07-13. |
| VERIFIED | **B1 incremental refresh — omitted** | Every ~30 minutes: Linear changed-issues query -> `b1-linear-backfill.js --incremental --apply` -> `batch_write`, `deliverable_write`, `linear_archive`. Direction is freshly checked, but per-row/success/failure events share one action; newest-event cursor and pager age can advance/look healthy after partial failure (F131). Archive remains separate; comments are omitted. | Direction gating is not checkpoint safety. A failed run can skip older fetched-but-unwritten issues on retry and still emit a fresh heartbeat. | **keep-until-B5 only after F131.** Preserve fresh authority checks; add distinct terminal type, server run/high-water/counts, advance only complete readback success, exact-terminal paging, and failure convergence. `.github/workflows/b1-linear-incremental-refresh.yml`; `scripts/b1-linear-backfill.js:568-588,1162-1216`. |
| VERIFIED | **Combined pager/orchestrator `qllIDZPkdNAPRj0b` — omitted** | One active v1 graph dispatches five workers, reads six health sources, evaluates gates, and posts Slack. Default stop-on-error can suppress later lanes; accepted dispatches have no correlation-to-terminal receipt; Calendar/Samples inspect five unfiltered runs and pending can mask failure; outbound trusts embedded mode; diff/repair/linkage share one throttle (F132). | A fresh timestamp, quiet run, or active graph is not terminal-health proof. Samples is the last branch and remains independently scheduled. | **redesign before any monitor-backed flip claim.** Split dispatch from observation; isolate/correlate lanes; add retry/error workflow and exact terminal receipts; page missing/failed/malformed/over-age/queue-depth/mode mismatch; prove an observer outside n8n. Retain the independent Samples schedule; remove the pager dispatch first if cutting F01 burn. Sanitized active graph/settings + retained metadata census 2026-07-14. |
| VERIFIED | **Edge Alert Relay / shared alert callers — omitted** | `Tfhc3vebZyG6obOg` returns HTTP acceptance before downstream Slack, has no general terminal receipt, and shares source/containment boundaries with onboarding and inbound anomaly callers (F09/F66/F81). Sampled delivery proves only happy-path last mile. | Disabling the relay or shared secret is not lane-scoped containment; acceptance is not delivery. | **keep only after hardening.** Authenticate/version caller contracts; isolate lane controls/secrets; add correlation, dedupe, retry and terminal delivery receipts; run sanitized TEST failure receipts per caller and keep an outside-n8n observer. Live sanitized graph/caller census 2026-07-14. |
| VERIFIED | **Legacy calendar reconciler — omitted** | Scheduled and pager-dispatched apply reads both sides. Current source loads team authority, treats SyncView-authoritative or unsafe Linear reads as detect-only, and freshly rechecks authority immediately before either authoritative write. | Direction logic is currently fail-closed at the write boundary; cadence/topology and eventual retirement remain separate gates. | **keep-until-B5 / no-action to the current direction guard.** Preserve detect-only behavior and the fresh pre-apply check. `linear-sync-reconcile.js:217-303`; run `29207528715`. |
| VERIFIED | **Legacy SXR reconciler — omitted** | Calendar twin for `sample_reviews`. Current source loads team authority, treats SyncView-authoritative or unsafe Linear reads as detect-only, and freshly rechecks authority immediately before either authoritative write. | Same current direction protection; duplicate cadence and B5 retirement remain separate work. | **keep-until-B5 / no-action to the current direction guard.** Preserve detect-only behavior and the fresh pre-apply check. `sample-linear-reconcile.js:222-301`; run `29207382805`. |
| VERIFIED | **Track-B deliverable reconciler** | Reads Linear and Supabase, checks `prod_authority`, heals inward only for Linear authority and enqueues the outbox only for SyncView authority. Scheduled lane is dry-run. | This is the intended dual-ready reconciler. | **keep-until-B5** / **no-action** to direction logic. `linear-deliverables-reconcile.js:186-193`, `341-374`, `457-522`. |
| VERIFIED | **`linear-inbound` mirror** | Two HMAC Linear webhooks -> EF -> `deliverable_write` / `batch_write`; field/comment echo controls and detect-only behavior. | Needed through dual-ready fallback; detect-only for SyncView-authoritative teams. | **keep-until-B5**. `linear-inbound/index.ts`; four-webhook readback below. |
| VERIFIED; caller unknown | **`BrJ` `/add-to-calendar` legacy branch — omitted** | Served webhook reads a Linear parent/children/comments and writes a legacy Sheet. No browser caller was found and no recent branch execution appeared in the sample. | External caller/owner remains unverified. It cannot be silently ignored. | **neutralize after owner/caller confirmation**, no later than B5. Active `BrJ` v`0efdd2c7`; reachable `Webhook5` graph. |

## Field-only and navigation dependencies

These are not direct Linear mutations, but they read, persist, gate on, or navigate by
Linear-derived IDs/URLs; one also consumes the shared status reader. They must be included in the
UI epoch so native behavior is not left dependent on Linear linkage.

| Status | Touchpoint | Current dependency | Epoch disposition | Evidence |
|---|---|---|---|---|
| VERIFIED | **Calendar/SXR manual link slots and status gates — omitted** | Staff can open, paste, validate, move, or clear VID/GRA URLs. A fresh URL is saved to the legacy card and calls `linear-subissues` to adopt status. Calendar disables and Set-all skips unlinked video/graphic pills; SXR disables individual pills, although its Set-all bypasses the gate. | URL editing/adoption and URL-gated status controls: **neutralize** at epoch and repoint to native deliverable linkage. Open-in-Linear convenience: **keep-until-B5**. | `index.html:24333-24565`, `24611-24645`, `24790-24897`, `25274-25296`, `35181-35347`, `35434-35459`, `35600-35620`, `35815-35823`. |
| VERIFIED | **Calendar Linear completeness banners/cache — omitted** | `linear-issue-statuses` supplies parent/sub-issue plus project/due/editor metadata; Calendar persists it for seven days in `syncview_calLinearMeta_v1`, gates warning banners by it, and opens the Linear URL for repair. | Reader can **keep-until-B5**, but the warning data must be re-sourced to native batch/deliverable fields at epoch; cached metadata must **neutralize** through expiry/versioning. | `index.html:20420-20580`, `24615-24625`, `24670`. |
| VERIFIED | **Seven-day Calendar/SXR card caches — omitted** | `syncview_calCache_v1:*` and `syncview_sxr_cache_v1_*` persist complete legacy card objects, including both Linear URLs and native linkage IDs. Old values can drive buttons, locks, and duplicate warnings before revalidation. | **neutralize** stale link behavior at epoch with a cache-version bump or authority-aware ignore/rewrite. | `index.html:21771-21797`, `34765-34800`. |
| VERIFIED | **Native linkage fields are write-routing-only; card ownership/navigation is absent (F112)** | `video_deliverable_id` / `graphic_deliverable_id` are normalized, saved, rollback/clear-sentinel capable, and Kasper-persisted. Current-main Calendar/Samples slot renderers still consume only Linear URLs; neither surface dereferences `deliverables → team_members`, renders D-20's **View sub-issue** route, or shows the current assignee. | Field transport: **no-action**. Before the first creative flip, make these IDs the authority-aware target for every predicate, identity, route, and ownership projection; preserve the Linear link only for a Linear-authoritative grace leg. | `index.html`; #850 merged cohort; second-pass static/deployed-source and test-contract census 2026-07-14. |
| VERIFIED | **Deliverable → card review-status projection (F50)** | `video_deliverable_id` / `graphic_deliverable_id` link the rows, but a Production status mutation does not update the card's separate Calendar/Samples review status. Realtime delivery of the deliverable row is not a vocabulary projection. | **implement/re-source before the first human flip.** Define the mapping and conflict authority, or make every status reader canonical; add mismatch monitoring and two-direction TEST cases. | `index.html`; `supabase/functions/production-write/index.ts`; second-pass source and TEST-path audit 2026-07-13. |
| VERIFIED | **Graphics canonical artifact path (F53)** | The normal designer path has no protected deliverable-file upload/link/replacement action. Internal Calendar/Samples organizer fields can patch a card-side shadow, but do not populate the canonical deliverable file and are unavailable as the designer's ordinary workflow. | **build before Graphics authority.** Define allowed file types/links, replacement/version audit, assignment and done semantics, client/SMM visibility, and failure recovery. | `index.html`; Production detail/write controls; Calendar/Samples organizer-only fields; second-pass persona audit 2026-07-13. |
| VERIFIED | **Inactive-client queue and mutation boundary (F54)** | Browser queue eligibility does not require `client.active`; staff-authenticated `production-write` mutations also do not reject an inactive client for status/comment/due/assignee paths. Inactive rows can therefore remain visible, assigned, and writable. | **filter and reject before Graphics authority.** Add shared active-client queue predicates, server-side authorization for every mutation, and an explicit offboarding disposition for existing work. | `index.html` Production queue/write eligibility; `supabase/functions/production-write/index.ts`; live read-only population audit 2026-07-13. |
| VERIFIED | **Creative transition/ownership policy (F37/F136)** | Production permits same-team creative status/comment actions. Status authorization receives next state but not current state or assignee, so reviewer/terminal regressions, cancel/duplicate, and peer-work actions can pass after flip. | **implement before either creative flip.** Ratify one server role×current×next×team×assignee state machine shared with the picker; TEST all 13×13 and peer/unassigned/direct-link paths. | `index.html`; `production-write/policy.mjs`; offline policy matrix 2026-07-14. |
| VERIFIED | **Video asset preservation (F137)** | `file_url`, delivery folder, footage folder, and filming plan collapse to one priority-selected Production link labelled Delivered file; batch detail shows none. | **build before Video authority.** Preserve/render all four typed resources with accurate labels and failure/permission states; never substitute one identity for another. | `index.html` Production adapter/detail; fictional three-batch-field fixture + four-field source census 2026-07-14. |
| VERIFIED | **Native Activity/history replacement (F138)** | `deliverable_events` are written, but SPA loader/renderer helpers have no runtime call and detail renders Comments only. | **Owner decision: first-flip gate or later; wire no later than history/Inbox retirement.** Protected scoped paginated reader, redacted Activity states and exact event/paging/device proof. | `production-write`; `index.html` event helpers/detail; source/browser census 2026-07-14. |
| VERIFIED | **Calendar/Samples reorder accessibility (F135)** | Card ordering is mouse HTML5 drag/drop only; no touch/pointer/keyboard/move control exists. | **build/prove before persona sign-off.** Accessible move/position and optional touch drag use the same CAS reorder; physical mobile/keyboard tests required. | `index.html` Calendar/Samples drag wiring; fictional touch test 2026-07-14. |
| VERIFIED | **Archive anti-resurrection identity — omitted** | Calendar recognizes historical Linear-URL archive aliases; SXR writes both VID/GRA URLs into its local archive ledger and uses them to hide or restore cards. | New archive identity: **neutralize** URL keying at epoch and use native card/deliverable IDs. Historical URL aliases: **keep-until-B5** so old cards do not resurrect. | `index.html:19492-19566`, `34807-34853`, `35675-35689`, `35727-35752`. |
| VERIFIED | **Duplicate-link collision and move semantics — omitted** | Calendar/SXR duplicate detection, warning banners, conflict confirmation, and “move it here” clear the prior owner by comparing VID/GRA URLs. | **neutralize** URL uniqueness at epoch and enforce native deliverable/card linkage instead. | `index.html:19586-19634`, `24491-24542`, `35267-35323`, `35325-35347`. |
| VERIFIED | **Workload Linear deep links — omitted** | Workload search results, cards, rollup chips, and popover issue rows carry Linear URLs. Ordinary chip click opens the local popover; modifier-click and issue links follow the anchor to Linear. | **keep-until-B5** while `workload_issues` is retained; then point every link to native issue detail. | `index.html:11787-11809`, `12739-12745`, `12979-12985`, `13273-13279`, `13307-13312`, `13451-13454`, `13608-13669`. |
| VERIFIED | **Workload -> Calendar focus navigation — omitted** | “Open in content calendar” passes a Linear identifier and locates the legacy card by matching `linear_issue_id`. | Legacy-card route: **keep-until-B5**. New/native route: **neutralize** identifier matching at epoch and navigate by native deliverable/card ID. | `index.html:12961-12964`, `22507-22527`. |
| VERIFIED | **Calendar Kasper finish-log URL snapshot — omitted** | Each Calendar handoff appends its video/graphic Linear URLs to `kasper_finish_log`; this is Supabase/card telemetry, not a Linear call. SXR's separate log does not store these URLs. | New URL snapshot: **neutralize** at epoch and store native deliverable IDs. Existing history: **no-action**. | `index.html:43682-43730`. |
| VERIFIED | **Production mirror transitional fields — omitted** | Production reads native `identifier` first and only falls back to `linear_identifier`. It selects unused `linear_issue_url` / `linear_parent_ids`. Visibility still hides rows from `linear_raw` archive/delete/cancel markers; no live Linear request occurs. | Label/unused fields: **no-action** at epoch. Raw-derived visibility: **keep-until-B5** while dual-ready, then use native archive authority and remove unused selects/fallbacks. | `index.html:30691-30703`, `30756-30789`, `30827-30830`, `30858-30860`, `32602-32612`. |

## Linear-side automations, webhooks, and identities

### Enabled Linear webhook configuration

| Status | Team / name | Destination | Resources | Disposition |
|---|---|---|---|---|
| VERIFIED | VID legacy `Workload` (`a4482382-6d44-4c59-89f-809220f559cb`) | n8n `/webhook/linear-status-sync` -> `MJbMZ789B5ExZz9x` | Issue + Comment | **keep workload branch until B5; neutralize card/sample writes by authority at epoch** |
| VERIFIED | GRA legacy `Workload — Graphics` (`f4829a26-e8df-4a42-9c17-6bcf23758f5a`) | same n8n workflow | Issue + Comment | same |
| VERIFIED | VID mirror `Video SupaBase` (`a7d9a852-b44f-4d58-894c-5f6b0dc824b8`) | EF `/functions/v1/linear-inbound` | Issue + Comment | **keep-until-B5** |
| VERIFIED | GRA mirror `Graphic SupaBase` (`5132e1a6-3d06-4f72-8a8b-30e255f9f069`) | same EF | Issue + Comment | **keep-until-B5** |

Exactly four Linear webhook configurations are enabled. This corrects the older shorthand that
described the legacy pair as Issue-only: the fresh configuration shows Comment subscribed on all
four. **Enabled source configuration is not delivery proof:** the legacy pair targets inactive
`MJbMZ789B5ExZz9x`, so only the two EF destinations provide a current event-time inbound lane.

### Mutation identities seen on the TEST project

| Status | Identity | What it proves | Disposition |
|---|---|---|---|
| VERIFIED | House/admin Linear identity | Fresh bridge comment plus legacy TEST comments/statuses/creates. Display author in comment Markdown is not the API actor; exact identifiers stay in private evidence. | Neutralize house-key bridges; rotate the key at B5. |
| VERIFIED | `SyncView Mirror` | B4 TEST parent/child creation proved the dedicated outbound identity; exact actor/issue identifiers stay in private evidence. | **keep-until-B5**. |
| VERIFIED | Normal human editor | One ordinary post-July-7 TEST history event. | **no-action**. |

Full TEST project sweep: 50 issues; creators were only house (34) and Mirror (16). Since July 7,
history actors were house, Mirror, and one normal human; there were zero `botActor` and zero native
Linear `workflowMetadata` hits. A read-only integration inventory returned 113 configurations, all
Slack-family services; no other integration service appeared. OAuth applications remain
**UNVERIFIED** because the current key lacks that scope. **No other machine/integration identity was
found in TEST history.** This does not clear D-9 because that actor leaves no visible field-change
history.

### D-9 due-date roller

**VERIFIED known state:** at ~23:45 UTC, an external actor repeatedly touches VID/GRA issues. On
2026-07-11, 19 issues (15 VID / 4 GRA across 7 projects) were touched during
23:45:31.127-23:45:39.630; all ended with due date 2026-07-12. Two were Todo, so the older
"review-state only" signature is no longer exact. TEST witnesses were `GRA-6311` at 23:45:31.682
and `VID-12613` at 23:45:38.469. All 19 had zero issue-history entries in the burst minute: no
actor, bot actor, due-date change, or native-workflow metadata. This is consistent with re-saving an
already-equal due date. The prior public evidence recorded 41 touches on 2026-07-10; the job
persists, but its cohort changes.

**Eliminated:**

- all 127 live n8n workflows (80 active): the only active Linear mutation graphs are the
  webhook-only status bridge, comment bridge, and intake create workflow; none is schedule-triggered,
  and status bridge execution count was zero from 23:44-23:47;
- coincident GitHub runs `29172628273` (deliverables), `29172628745` (Calendar), and
  `29172630069` (Samples); both legacy status reconcilers reported zero corrections / zero applied;
- current repo schedules/actions as the source of the burst;
- native Linear workflow automations in the sampled TEST history (`workflowMetadata=0`).

Linear's audit log did show a Node API session under key label `Form` at 23:45:51. That is not actor
proof: coincident GitHub readers use the same credential. It is a correlation handle for the owner
to resolve, not a conclusion.

**Owner action — still required:**

1. At the next 23:44-23:47 UTC window, open Linear **Workspace Settings -> Administration ->
   Audit Log** and capture the API-key label, actor, user agent, and IP-change events.
2. In Linear **Settings -> Administration -> API** and **Account -> Security & Access**, map the
   key labeled `Form` to GitHub, n8n, or Apps Script before revoking anything; inspect workspace
   keys, Authorized Applications, and OAuth apps.
3. Sign in as each privately inventoried workspace sheet-owner account; open Apps Script
   **My Triggers** and inspect every installed trigger around 23:45 UTC. Do not list account
   addresses in the public artifact (F64).
4. Open each operational workload/calendar Sheet -> **Extensions -> Apps Script** -> **Triggers**;
   inspect bound projects that are invisible to the currently connected Drive identity.
   Also inspect **Executions** and search source for `api.linear.app`, `issueUpdate`, and `dueDate`.
5. If the 23:45 trigger is found, **disable, do not delete**, capture owner/project/trigger/cadence,
   and observe two nights with the scoped D-9 detector still enabled.
6. Success criterion: neither TEST witness nor any wider VID/GRA cohort receives the 23:45 touch
   for two nights.
7. If absent, map every shared `Form`/personal credential consumer and obtain explicit owner-signed
   detect-only acceptance with the alert/tolerance contract drilled. Any later rotation is a
   separate evidence-based credential action, not an automatic fallback or proof of neutralization.

Disposition: **neutralize** before the authority flip. Ownership remains the only unverified field.

## Test and audit tooling (not day-to-day runtime)

| Status | Tool | Capability | Disposition |
|---|---|---|---|
| VERIFIED | `b4-comment-echo-probe.js` | TEST-only app/comment round trip and cleanup; direct Linear comment delete for cleanup. | **no-action**; retain as gate harness. |
| VERIFIED | `b3-mirror-scenario-harness.js` | Fail-closed TEST Issue mutations for create/update/archive/restore/comment coverage. | **no-action**. |
| VERIFIED | `b4-linear-outbound-harness.js` | Fail-closed TEST create/status/comment/due/etc. through the new pipe. | **no-action**. |
| VERIFIED | Dead `Comment on Parent Issue` node in `BrJ` | Disabled/disconnected mutation in an unreachable AI-thumbnail chain. | **no-action now**; remove during B5 workflow teardown. |

## Findings not named in the request

Every item below is included above and must appear in the epoch spec:

1. Calendar normal status pushes, stale-status reassert, Kasper both-component pushes, and the
   Calendar localStorage queue.
2. Both Notes modals mirror plain comments and replies, not just tweak requests.
3. `linear-set-status`'s hidden overdue `dueDate +2 days` mutation.
4. Calendar's actual ability to push `Posted`.
5. The B1 30-minute incremental apply job.
6. Both scheduled/pager-dispatched legacy bidirectional reconcilers.
7. The inactive/unpublished `MJbMZ789B5ExZz9x` saved graph: authority-gated on disk, absent as a
   current fast path, with a crash/topology decision required before any publish.
8. `linear-issue-statuses`, `linear-subissues`, `linear-projects`, and urgent Slack's assignee read.
9. The `/add-to-calendar` Linear-reader/Sheet-writer branch with no confirmed caller.
10. Kasper's non-Linear feed plus four Linear-link eligibility predicates.
11. The four active Linear webhook configurations and the two observed machine identities.
12. The comment ledger is not self-contained: accepted inbound events carry neither body nor actual
    author, raw snapshots are historical-only/inconsistently retained, and Production renders no
    comment bodies. The full-VID/GRA historical backfill is approximately 12,792 comments.
13. Calendar/SXR manual Linear URL slots, link-gated status controls, completeness banners, and
    seven-day metadata/card caches.
14. Linear-URL archive aliases plus duplicate/move identity and conflict behavior.
15. The durable `syncview_calCardJobs_v1` post-submit queue, Linear polling, and `p_lin_*` card IDs.
16. Workload's Linear anchors and identifier-based Calendar focus navigation, plus urgent URL
    gating/persistence across Calendar, SXR, and both Kasper surfaces.
17. Calendar's Linear URLs inside `kasper_finish_log` and Production's legacy label/raw-visibility
    fallbacks.
18. Authorized Applications/OAuth apps are an explicit owner-scope verification gap; they are not
    treated as cleared by the API-key integration sweep.
19. Native linkage does not project Production status into the separate Calendar/Samples review
    status; a mapping or canonical-reader migration is required (F50).
20. The Graphics persona lacks a protected canonical deliverable-file lifecycle; organizer card
    shadows cannot serve as the designer workflow (F53).
21. Inactive clients can still contribute queue work and staff-authenticated mutations unless both
    readers and server authorization exclude them (F54).
22. Native Create Post can split card/deliverable title and keep post-commit recovery only in one
    actor's browser (F133/F134).
23. Creative current-state/ownership authorization, distinct Video assets, and non-mouse reorder are
    explicit first-day persona gates (F135–F137). Native Activity is required by the owner-ratified
    first-flip-or-history-retirement gate (F138); that timing remains an explicit owner decision.

## Exit gate for the write-UI epoch

Do not start native writes merely because the B4 outbound pipe is green. The epoch is complete only
when all of the following are true at once:

- all explicit UI intents in the writer table enter the native RPC/outbox path with durable
  actor/role/timestamp;
- all three browser queues are empty across staff browsers, protected endpoints reject below-minimum
  build/auth-authority epochs before mutation, and privacy-safe telemetry proves mandatory old callers
  are zero for the owner-approved window (F127); the advisory update banner is not expiry evidence;
- seven-day card/meta caches are versioned or authority-filtered so stale Linear URLs cannot revive
  old gates or navigation;
- native status controls, link pickers, archive/dedupe identity, Workload navigation,
  post-submit materialization, and new audit logs no longer require a Linear URL/identifier;
- deliverable status and card review status have an explicit, TEST-proved projection/authority
  contract, and mismatches are monitored;
- the Graphics assignment-to-artifact-to-completion loop writes one protected canonical file state
  that is visible consistently to the designer, SMM, and client;
- native intake has one canonical card/deliverable title plus a server-owned recoverable
  materialization job (F133/F134);
- creative transitions enforce current state and owner-ratified assignment scope; Video preserves
  all typed assets; Calendar/Samples reorder works by touch and keyboard (F135–F137); F138 Activity
  is protected/visible here only if the owner selects the first-flip gate, otherwise the recorded
  history-retirement gate remains blocked;
- inactive clients are excluded from every queue and server mutation, with existing work disposed
  according to the recorded offboarding rule;
- Linear and Calendar/Samples comment histories are composite-ID reconciled; every active existing
  root is replyable; one canonical create/lifecycle path projects consistently to Production,
  Calendar, Samples, and token-scoped client views with edit/delete/audience tests; canonical
  persistence precedes every Linear/mirror side effect, and save failure retains draft/queue with
  visible retry; retry produces exactly one canonical mutation plus exactly one applicable mirror
  intent while mirroring is enabled, and zero mirror/outbox intents in retired mode (F43);
- intake project reads prove complete, and a durable idempotent receipt—not an early webhook
  acknowledgement—is the only state that lets the browser clear its draft;
- the four direct mutation webhooks refuse writes for SyncView-authoritative teams;
- the same four routes reject missing, expired, revoked, cross-client, and forged caller identity or
  capability before any Linear mutation, even while the team remains Linear-authoritative (F91);
- `MJbMZ`, both legacy reconcilers, and B1 incremental apply cannot write authoritative fields from
  Linear for a SyncView-authoritative team;
- the chosen `MJbMZ` topology is machine-proved (active state, active-version/node fingerprint, and
  last-green execution): either a repaired/published TEST-drilled fast path or an explicitly
  accepted reconciler-only SLA;
- D-9 is disabled, or all shared/personal consumers are mapped and the owner has explicitly signed
  the drilled detect-only acceptance; key rotation alone is not proof;
- an admin-scope Authorized Applications/OAuth inventory has cleared any unlisted VID/GRA writer;
- the keep-until-B5 readers remain green with outbound freshness, and their B5 replacements have
  named owners/tests.
