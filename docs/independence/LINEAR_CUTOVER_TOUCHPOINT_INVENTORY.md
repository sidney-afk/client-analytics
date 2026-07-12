# Linear cutover touchpoint inventory

**Verified:** 2026-07-12 UTC against `main` at `313624b` and the live Linear, n8n,
Supabase, and GitHub configurations. **Scope:** every runtime or scheduled path found that reads
or writes VID/GRA Linear data. Test/audit harnesses are listed separately. This document is
public-safe: no API-key values, client content, or production comment bodies are included.

The audit was read-only except for one sanctioned comment on the TEST project. That comment was
created through the production `linear-add-comment` bridge, observed through the same incremental
job used by the 30-minute refresh, and then deleted. No runtime flag, workflow, webhook, or
production row was changed.

## Disposition vocabulary

- **reroute-through-outbox** — preserve the user action, but write Supabase first through
  `deliverable-write` / `batch-write`; let `mirror_outbox` and `linear-outbound` keep Linear fresh.
- **keep-until-B5** — safe to retain during the dual-ready epoch because outbound keeps Linear
  fresh; re-source or retire during B5.
- **neutralize** — authority-gate or disable at the write-UI handoff. Leaving it live can bypass
  Supabase authority, replay a stale browser write, or import stale Linear state.
- **no-action** — no Linear dependency, already authority-safe, or disconnected test/dead code.

`VERIFIED` means the current repo source and the relevant live configuration were both checked.
Anything the connected identity could not inspect is explicitly marked `UNVERIFIED` and remains an
owner gate; this applies to the OAuth-application inventory and the `/add-to-calendar` caller.

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
- [ ] **Drain and then neutralize all three browser queues:** `syncview_linear_outbox_v1`,
  `syncview_sxr_linear_outbox_v1`, and `syncview_calCardJobs_v1`, including startup, focus, timer,
  page-hide, resume, and reassert paths.
- [ ] **Install central authority checks before the UI epoch** on `linear-set-status`,
  `linear-add-comment`, `video-form`, and `graphic-form`. Frontend checks alone do not stop old tabs.
- [ ] **Neutralize ungated inbound writers for SyncView-authoritative teams:** the calendar/sample
  branches of `MJbMZ789B5ExZz9x`, both legacy apply reconcilers, and the B1 incremental apply job.
- [ ] **Re-source intake project selection and urgent-assignee lookup** to native
  `clients` / `deliverables` / `team_members` at the epoch.
- [ ] **Activate native linkage everywhere, not only in the four Kasper predicates.** Switch link
  slots, status gates, duplicate/move checks, archive identity, focus navigation, urgent references,
  and new audit logs to `video_deliverable_id` / `graphic_deliverable_id` or a native route.
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
| VERIFIED | **Calendar status — omitted from the supplied list** | Normal card save, stale-status reassert, and Kasper persistence call `_calPushStatusToLinear`; `{issue,status}` goes to `linear-set-status`, then Linear `issueUpdate`. Calendar does not actually block `Posted`, despite the stale source comment. | A staff role key or client token may exist for the preceding card save, but **none is sent to this webhook**. Linear actor is the house `sidney@` user. | User intent: **reroute-through-outbox**. Helper, reassert, and direct bridge: **neutralize** after queue drain. | `index.html:20208-20268`, `25556-25579`, `43379-43384`; live n8n `VQqqeY9B2GZbh2Bt` v`0976710e`; execution `255235` accepted `Posted`. |
| VERIFIED | **Calendar comments** — client, SMM, and Kasper | `_calPostLinearComment` sends `{issue,body,author}` to `linear-add-comment`, then Linear `commentCreate`. The Notes modal sends every video/graphic root, reply, plain comment, and tweak; edits/resolves/deletes do not sync. | Client token / role key can authenticate the card save, but **none is sent to the Linear bridge**. `author` is cosmetic Markdown; Linear actor is the house user. | Intent: **reroute-through-outbox** with the authenticated actor/role or verified client identity. Direct helper/bridge: **neutralize**. | `index.html:20269-20292`, `28403-28493`, `29319-29380`, `43640-43643`; n8n `8stSpZUiyG7f2LQX` v`6798ea93`; TEST execution `256233`. |
| VERIFIED | **Calendar local retry queue** | `syncview_linear_outbox_v1` stores only `{kind,payload,attempts,...}`; retries on load/focus and a 60-second timer, stops automatic retry after six attempts, and retains the row until console cleanup. | No durable authenticated actor context is stored. A later flush sends no role key or client token. | **neutralize** after an all-browser diagnostic and verified drain. Reject stale flushes centrally. | `index.html:20122-20206`, `20414-20418`. |
| VERIFIED | **SXR status** | Successful sample save plus Kasper save/undo call `_sxrPushStatusToLinear`; there is no live symbol literally named `_sxrLinearPush`. `{issue,status}` reaches the shared status bridge. SXR skips `Scheduled` / `Posted`; `_sxrReassertLinearStatus` exists but has no caller. | Same gap: staff/client auth may exist for the card save but is not forwarded. House Linear actor. | Intent: **reroute-through-outbox**. Active direct helper: **neutralize**; dead reassert helper: **no-action now**, remove at B5. | `index.html:36142-36146`, `37339-37350`, `37848-37929`; dead definition `37385-37396`. |
| VERIFIED | **SXR comments** | `_sxrPostLinearComment` uses the shared `{issue,body,author}` bridge. Review tweaks, Notes roots/replies/plain messages, and Kasper tweaks all reach Linear. | No Linear-bridge auth; display author is cosmetic; house Linear actor. | Intent: **reroute-through-outbox**. Direct helper/bridge: **neutralize**. | `index.html:36687-36716`, `36943-36959`, `37352-37357`, `37848-37876`. |
| VERIFIED | **SXR local retry queue** | Separate `syncview_sxr_linear_outbox_v1`, six attempts, 60-second retry, startup/focus drain. | Payload only; no durable role key/client token/actor proof. | **neutralize** after verified drain. | `index.html:34192`, `37319-37338`, `37508-37518`. |
| VERIFIED | **Shared SMM `linear-set-status` bridge** | Public CORS POST `{issue,status}` resolves the team state and calls `issueUpdate`. If the issue is overdue, it also changes `dueDate` to current UTC date +2 days. There is no `prod_authority` check. | No caller auth. Active Code node embeds a house personal Linear key; value intentionally omitted. | **neutralize** centrally at epoch. The overdue due-date side effect is deliberately not ported. | n8n `VQqqeY9B2GZbh2Bt` v`0976710e`; 339 executions since July 1; `255235` proves status + due mutation. |
| VERIFIED | **Shared SMM `linear-add-comment` bridge** | Public CORS POST `{issue,body,author}` resolves identifier and calls `commentCreate`; no authority check. | No caller auth. Same embedded house key; actual actor is `sidney@`, regardless of `author`. | **neutralize** centrally at epoch after all callers reroute. | n8n `8stSpZUiyG7f2LQX` v`6798ea93`; 45 executions since July 1; TEST `256233`. |
| VERIFIED | **Submit — video create** | `submitLinearForm` sends `{clientName,title,notes,filmingPlans,videos[]}` to `video-form`; monolith creates a VID parent plus `Video N` children with descriptions, sort order, due dates, and a picked editor. | Browser sends **no staff role key, client token, or submitter identity**. The workflow selects a per-SMM personal Linear key solely from `clientName`; Linear creator is that SMM. | **reroute-through-outbox**: create native batch/deliverables first, then mirror. Centrally neutralize the direct-create branch. | `index.html:29998-30078`; live `BrJSe8zCKUccfmIq` v`0efdd2c7`, reachable `video-form` graph. |
| VERIFIED | **Submit — graphic create** | Same payload to `graphic-form`; creates a GRA parent and children with generated descriptions, due dates, and the configured designer. | Same unauthenticated browser call and client-selected per-SMM key. | **reroute-through-outbox** and neutralize the direct-create branch. | `index.html:29998-30078`; live `BrJSe8zCKUccfmIq` v`0efdd2c7`, reachable `graphic-form` graph. |
| VERIFIED | **Submit log** | `{timestamp,clientName,mode,webhookJson}` to `log-linear-submission`; appends the fallback `Linear Submissions` Sheet. It does **not** mutate Linear. | No browser auth; Google Sheets credential is server-side. | **keep-until-B5** (or retain as non-Linear telemetry). | `index.html:30049-30069`; reachable `Webhook6 -> Append row in sheet` branch in `BrJSe8zCKUccfmIq`. |
| VERIFIED | **Post-submit Calendar job queue — omitted** | After Linear create, `syncview_calCardJobs_v1` waits and polls `loadLinearIssues(true)` for the new VID/GRA children, derives `p_lin_*` Calendar IDs from Linear identifiers, writes the URL-linked cards, and resumes unfinished jobs on later app loads for up to 48 hours / five runs. | Same unauthenticated intake tab; the follow-up Linear read and queued job contain no role key, client token, or durable submitter identity. | Native create remains **reroute-through-outbox**. Drain/expire this queue and **neutralize** its Linear-poll/materialization follower at epoch; consume native batch/deliverable IDs from the authoritative create response. | `index.html:30080-30093`, `30102-30301`, `30313-30385`. |
| VERIFIED | **B4 server-side outbox — target path** | Native `deliverable-write` / `batch-write` ledger transaction enqueues `mirror_outbox`; scheduled drainer invokes `linear-outbound`, supporting create/status/comment/due/assignee/title/priority/parent/archive/restore. | Durable actor, role, timestamp, dedup key, and source edit clock; dedicated `SyncView Mirror` key and actor. Strict team authority + global mode gates. | **no-action** to backend design; wire every new UI mutation into it. **keep-until-B5** once live. | `TRACK_B_LINEAR_REPLACEMENT_SPEC.md:547-588`; `linear-outbound-drain.yml`; TEST issues created by `SyncView Mirror`. |

### Auth available versus auth actually sent

| Browser context | Auth available to the card/native write | Auth sent to current Linear bridge | Required epoch behavior |
|---|---|---|---|
| Client Calendar/SXR link | Verified client token | **none** | Native write verifies client token, persists client actor/role/timestamp, then outbox mirrors. |
| Signed-in staff / Kasper | Verified staff role key + roster actor | **none** | Native write verifies role key and persists the roster actor/role/timestamp before enqueue. |
| Old-tab localStorage retry | Only the saved `{issue,status}` or `{issue,body,author}` payload | **none** | Drain, expire old app versions, then reject centrally when team authority is SyncView. |
| Submit tab | Staff identity is deliberately excluded from the intake entry path | **none** | Require the epoch's approved staff/native-create authorization; never select mutation identity from `clientName`. |
| Post-submit card job | Saved client/title/mode/video numbers; no submitter proof | **none** | Drain/expire the job and return native linkage directly from the authorized create. |

### Exact submission payload

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

The creation workflows fetch a public SMM roster CSV and use its per-client personal Linear key.
The submitter is not authenticated. This is both an attribution gap and a stale-tab cutover bypass.

## Critical comment-visibility test

### Live probe

| Step | VERIFIED observation |
|---|---|
| Baseline | TEST issue `VID-12612` mapped to exactly one deliverable. Linear had two historical bridge comments; native deliverable thread count was 0; `linear_raw.issue.comments` count was 0. |
| Real bridge write | At 2026-07-12 20:18:29 UTC, the production `linear-add-comment` path posted marker `cutover-visibility-20260712201826`; n8n execution `256233` succeeded. Linear created exactly one comment at 20:18:30 under the house actor. |
| Realtime lane | After both Comment webhooks had time to settle, the deliverable thread stayed at 0, `linear_raw` stayed at 0, `updated_at` did not move, and there was no new `mirror_in_comment_add` event. |
| 30-minute refresh lane | Manually dispatched incremental run `29208341729` used the scheduled job's code path and covered the marker (`changed_since=2026-07-12T20:10:49.528Z`). It found two changed issues and one operational issue and completed successfully with zero deliverable writes. The native thread and `linear_raw` stayed at 0, no event appeared, and `updated_at` remained unchanged. |
| UI lane | Production issue detail reads `deliverable_events` and renders action labels; it never maps `linear_raw.issue.comments` into the activity feed (`index.html:32639-32669`, `33423-33440`, `33495-33503`). |
| Cleanup | Deleted probe comment `6596d87d-ab5a-4b1c-a43a-e3d9188b1ece`. Linear then had zero marker matches; after settlement, the native thread and `linear_raw` remained at 0, with no event and no `updated_at` change. |

### Definitive verdict

**Bridge-authored comments are NEVER visible as comments in the mirror tab's issue detail.**

- Realtime intentionally drops every house-authored body matching the `**… (via SyncView):**`
  convention (`linear-inbound/index.ts:569-590`, `722-748`).
- The recurring B1 incremental query does not request comments, and comment-only issue updates do
  not enter its compared deliverable field set (`b1-linear-backfill.js:427-450`, `832-836`,
  `1040-1077`).
- The detail UI renders ledger actions, not `linear_raw` comment bodies.

After the write-UI epoch, the same human message can be visible because the native comment is
written locally first. That is the authoritative local copy, not an imported bridge comment.

### Historical `linear_raw` spot-check

| VERIFIED readback | Result |
|---|---|
| All deliverables | 4,350 rows. |
| Operational `linear-backfill` rows | 1,145 total; 381 currently contain historical `linear_raw.issue.comments`, totaling 577 comments across 20 actor identities. |
| One-time catch-up marker | 486 rows retain the 2026-07-07 catch-up marker; 373 still have comments and 113 now have an empty comment node list. No captured thread reported pagination beyond the 50-comment cap. |
| Public-safe parity spots | `VID-9714` and `GRA-5239` each had 6 raw snapshot comments and 6 current Linear comments. |
| Finished-work history backfill | 3,187 `history-backfill-2026-07-10` rows; 0 raw comment threads, by design. |

So backfill-era snapshots **sometimes contain complete historical threads**, but they are not a
durable live comment lane and the Production UI does not display them. A later partial Linear issue
payload can replace `linear_raw.issue` without comments, which explains the 113 catch-up rows that
now have none.

## Reader and inbound-writer inventory

| Status | Touchpoint | Current direction and dependency | Mid-epoch / B5 answer | Disposition and evidence |
|---|---|---|---|---|
| VERIFIED | **Workload `workload_issues`** | Linear -> `BrJ` `/linear-issues` (per-SMM keys) -> scheduled `lGwC9WWPVJtxphtf` bulk upsert/mark-sweep -> Supabase -> browser. `MJbMZ` fast-upserts create/remove/state events. Browser uses anon REST + 5-minute cache; realtime is hard-disabled; error/zero rows falls back to `/linear-issues`. | Outbound freshness is sufficient mid-epoch, although non-state updates wait for the 10-minute sweep. At B5 read `deliverables + team_members`. | **keep-until-B5**. `index.html:11684-11917`; n8n `lGw` v`50a8a1e4`, exec `256237`; `/linear-issues` exec `256238`. |
| VERIFIED | **`linear-tweak-comments`** | Workload posts `{ids}` for tweak-state issues; n8n reads every SMM Linear workspace and up to 50 comments per issue, parses `(via SyncView)` author labels, returns newest 10; browser caches 5 minutes. | Works mid-epoch only while outbound mirrors the needed comments. At B5 read native card/deliverable threads. | **keep-until-B5**. `index.html:13479-13510`; n8n `d7Dod7OuQsVsl1CN` v`107de134`, exec `242240`. |
| VERIFIED | **`editors-week`** | Browser -> unauthenticated n8n -> VID Linear issue histories; counts work-to-review transitions per issue/day/kind and attributes them to current assignee. | Works mid-epoch if every native status transition mirrors out. At B5 use the `deliverable_events` query in spec section 9.11. | **keep-until-B5**. `index.html:43879-43925`; `rhDX5VfnmOylc8o7` v`892323dc`, exec `232746`. |
| VERIFIED | **`kasper-queue` feed** | Not a Linear reader. Calendar reads Supabase `calendar_posts`, then n8n `kasper-queue` -> Sheets fallback; SXR reads `sample_reviews`. | Feed survives Linear retirement. Four visibility predicates still require `graphic_linear_issue_id`. | Feed **no-action**; predicate dependency **neutralize/repoint** at epoch. `index.html:42403-42568`, `37610-37635`, `28831-28855`, `37543-37574`; n8n `TcWOfnKd4Csdnnbv` v`6fd805a3`. |
| VERIFIED | **Calendar Linear Status Sync `MJbMZ789B5ExZz9x`** | One legacy Linear webhook fans into: state -> `calendar_posts`, event -> `workload_issues`, state -> `sample_reviews`. Card/sample writes use Track-A EF/n8n client routing. **No branch checks `prod_authority`.** | Workload branch can stay while Linear is fresh. Card/sample branches are unsafe under SyncView authority and can overwrite native state. | Workload: **keep-until-B5**. Calendar/sample: **neutralize/authority-gate** at epoch. Active v`655b6aa5`, exec `256234`. |
| VERIFIED | **`linear-issue-statuses`** | Browser metadata/status pull and both legacy reconcilers -> unauthenticated `GP8CSZDNcy5sGdFr` -> Linear issue queries. | Pure reads can remain dual-ready; apply callers cannot. | Endpoint **keep-until-B5**; authority-gate callers. Active v`2203cdde`, latest exec `256255`; `index.html:20530-20689`. |
| VERIFIED | **`linear-subissues`** | Calendar import/bulk-link and Calendar/SXR point-adoption -> `Nk3pwR6Fbl4VAPqH` -> Linear parent/children/status, followed by legacy card create/link/status writes. Post-submit polling does **not** use this endpoint. | Keep lookup read-only as a rollback/import aid; native UI should use a deliverable picker. | Endpoint: **keep-until-B5**. Import/bulk-link card mutations and point-adoption: **neutralize** for SyncView-authoritative clients. Active v`9013d1af`, latest exec `253900`; `index.html:20583-20630`, `20735-21235`, `37358-37382`. |
| VERIFIED | **`linear-projects`** | Submit dropdown -> `BrJ` branch -> Linear VID projects. | Native intake should not depend on a Linear project list. | **neutralize/re-source at epoch** to native clients/projects. `index.html:11665-11682`; `BrJ` v`0efdd2c7`. |
| VERIFIED | **Urgent tweak Slack lookup, URL gates, and persistence** | Calendar, SXR, and both Kasper surfaces hide or refuse the action without `linear_issue_id`, pass that URL to `send-urgent-slack`, and persist it as `video_urgent_issue`. n8n resolves the current Linear assignee, maps email to Slack, and posts; it does not mutate Linear. | Outbound could keep the issue current, but native notification cannot remain gated, routed, or deduplicated by a Linear URL. | **neutralize** the URL dependency and re-source at epoch to `deliverables -> team_members`. `index.html:20324-20368`, `29710-29720`, `35553-35592`, `37989-38003`, `43010-43034`; n8n `TJVMyfwl85qrFGeK` v`d877feb8`. |
| VERIFIED | **B1 incremental refresh — omitted** | Every ~30 minutes: Linear changed-issues query -> `b1-linear-backfill.js --incremental --apply` -> `batch_write`, `deliverable_write`, `linear_archive`. It has **no authority check**. | Under SyncView authority it is an ungated inbound writer; it also does not import comments. | **neutralize** operational batch/deliverable apply for SyncView-authoritative teams; retain detect/archive-only or full apply only under Linear authority. `.github/workflows/b1-linear-incremental-refresh.yml`; `scripts/b1-linear-backfill.js:1003-1138`. |
| VERIFIED | **Legacy calendar reconciler — omitted** | Scheduled and pager-dispatched apply: reads Linear statuses and can pull Linear -> card or POST card -> `linear-set-status`. No authority gate. | Bidirectional writer is unsafe at handoff. | **neutralize/authority-gate** at epoch; detect-only on the non-authority side. `linear-sync-reconcile.js:98-145`, `259-291`; run `29207528715`. |
| VERIFIED | **Legacy SXR reconciler — omitted** | Calendar twin for `sample_reviews`; scheduled apply and pager dispatch with `dry_run=false`; can POST status to Linear. No authority gate. | Same cutover risk. | **neutralize/authority-gate**. `sample-linear-reconcile.js:128-174`, `260-292`; run `29207382805`. |
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
| VERIFIED | **Native linkage fields are transported but unused — omitted** | `video_deliverable_id` / `graphic_deliverable_id` are normalized, saved, rollback/clear-sentinel capable, and Kasper-persisted, but no user-visible linkage consumer reads them. | Field transport: **no-action**. Make these IDs the epoch target for every current Linear-URL predicate, identity, and route. | `index.html:17895`, `23390-23399`, `25274-25296`, `34814-34820`, `35815-35823`, `37111-37119`, `43310`. |
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

Exactly four are enabled. This corrects the older shorthand that described the legacy pair as
Issue-only: the fresh configuration shows Comment subscribed on all four.

### Mutation identities seen on the TEST project

| Status | Identity | What it proves | Disposition |
|---|---|---|---|
| VERIFIED | House/admin Linear user (`sidney@`, actor `78341487…`) | Fresh bridge comment on `VID-12612`; legacy comments/statuses and older TEST creates. Display author in comment Markdown is not the API actor. | Neutralize house-key bridges; rotate the key at B5. |
| VERIFIED | `SyncView Mirror` (`e92452e1…`) | B4 TEST parents/children including `VID-12884` / `VID-12885`; dedicated outbound identity works. | **keep-until-B5**. |
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
3. Sign in as each workspace sheet-owner account, including `sidney@…` and `house@…`; open Apps
   Script **My Triggers** and inspect every installed trigger around 23:45 UTC.
4. Open each operational workload/calendar Sheet -> **Extensions -> Apps Script** -> **Triggers**;
   inspect bound projects that are invisible to the currently connected Drive identity.
   Also inspect **Executions** and search source for `api.linear.app`, `issueUpdate`, and `dueDate`.
5. If the 23:45 trigger is found, **disable, do not delete**, capture owner/project/trigger/cadence,
   and observe two nights with the scoped D-9 detector still enabled.
6. Success criterion: neither TEST witness nor any wider VID/GRA cohort receives the 23:45 touch
   for two nights.
7. If absent, use the spec fallback: controlled rotation of remaining legacy personal Linear keys,
   one identity at a time, while keeping due-date tolerance detect-only and rollback-ready.

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
7. Ungated calendar/sample branches inside `MJbMZ789B5ExZz9x`.
8. `linear-issue-statuses`, `linear-subissues`, `linear-projects`, and urgent Slack's assignee read.
9. The `/add-to-calendar` Linear-reader/Sheet-writer branch with no confirmed caller.
10. Kasper's non-Linear feed plus four Linear-link eligibility predicates.
11. The four active Linear webhook configurations and the two observed machine identities.
12. Backfill comment snapshots are historical-only, inconsistently retained, and never rendered in
    Production issue detail.
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

## Exit gate for the write-UI epoch

Do not start native writes merely because the B4 outbound pipe is green. The epoch is complete only
when all of the following are true at once:

- all explicit UI intents in the writer table enter the native RPC/outbox path with durable
  actor/role/timestamp;
- all three browser queues are empty across staff browsers and old-version tabs are expired;
- seven-day card/meta caches are versioned or authority-filtered so stale Linear URLs cannot revive
  old gates or navigation;
- native status controls, link pickers, archive/dedupe identity, Workload navigation,
  post-submit materialization, and new audit logs no longer require a Linear URL/identifier;
- the four direct mutation webhooks refuse writes for SyncView-authoritative teams;
- `MJbMZ`, both legacy reconcilers, and B1 incremental apply cannot write authoritative fields from
  Linear for a SyncView-authoritative team;
- D-9 is disabled or the owner-approved key-rotation fallback is complete;
- an admin-scope Authorized Applications/OAuth inventory has cleared any unlisted VID/GRA writer;
- the keep-until-B5 readers remain green with outbound freshness, and their B5 replacements have
  named owners/tests.
