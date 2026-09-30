# Failed saves: every write path checked (2026-09-29)

Priority 4 in `docs/STATE_OF_THINGS.md`: finish the failed-saves log. This is the record of
what was checked, what was found, and what changed.

## 1. Does the `traffic` column fill? Measured live

Read-only aggregate queries against the write-refusal log (counts only; no identifiers read).

| Rows recorded | Rows with `traffic` set |
|---|---|
| Browser reports, 2026-09-26 to 2026-09-29 (893 rows) | **all of them** (automation or person) |
| Browser reports, 2026-09-25 (120 rows) | 1 (the column went live partway through that day) |
| Browser reports, 2026-09-23 and 09-24 (76 rows) | none (before the column existed) |
| **Gateway rows** (from `production-write`), 2026-09-23 to 09-28 (4,299 rows) | **none, including the 15 written after 09-25** |

So the column fills for what the **browser** reports and does **not** fill for what the
**write gateway** records. Cause, checked against the deploy dates rather than assumed:

- The browser-report function (`write-diagnostics`) was redeployed on 2026-09-28 with the code
  that sets `traffic` (#1643, merged 2026-09-25 23:33 UTC).
- `production-write` was last deployed on 2026-09-25 15:51 UTC, **before** #1643 merged. The
  source in the repository already sets `traffic` on every gateway refusal
  (`requestTraffic(req)` in `supabase/functions/_shared/write-refusal-diagnostics.mjs`), so
  the fix is in the code. It is simply not deployed.

**This cannot be fixed by a pull request.** The gateway rows get `traffic` the next time the
Section 4 lane deploys `production-write` (capture script, upload, then dispatch, as in
`CLAUDE.md`). Until then the save-problems page shows those rows as "unknown" traffic, which
is honest. There have been only 15 gateway rows since 09-25 (the earlier flood of about
4,200 stopped on 09-25), so the gap is small today.

## 2. Saves that did not report, and what changed

The page sends 84 requests that are not plain reads (81 distinct places). Every one is listed
below with a decision. Before this change the log covered the Calendar, Samples, Production
and intake saves that go through the write gateway. It did not see the saves that talk to
their own Edge Function or webhook, because the gateway never sees those refusals.

Two helpers in `120-calendar-flags-write-repair` (`_writeUiTrackSave`,
`_writeUiRecordSaveFailure`) record such a refusal through the **same** beacon as the
gateway saves: same cap, same page tag (client link or staff page), same traffic tag, no
prose. They look at `response.ok` (and, for an OK answer, at a clone of the body: a refusal sent as HTTP 200 with `{"ok":false}` is recorded, and for the saves whose own code accepts only `{"ok":true}` (`requireOk`) so is an empty, unreadable or ok-less answer, because the page rejects those too), never read the response itself, and hand back the same
response or rethrow the same error, so what the save does next is unchanged.

The log's screen column stores these saves as `unknown` (the server only knows four screen
names), and the operation name is stored as the action, so the save-problems page shows
`Unknown` with an Action such as `templates_save`. No server or database change was needed.

Newly recorded: Templates save and brain change, Filming plans, caption prompts, hook library,
weekly Slack update, Workload plan date and due date, client share link, Calendar settings,
import, link adoption, archive, drag order, urgent markers and urgent ping, caption
generation, Samples archive, link adoption, drag order and urgent markers, Kasper's Calendar
and Samples saves, Production title rename (a gateway write that had no report), TikTok
uploads, cancel and retry, Hiring, Client credentials, Client profile, Sales intake submit,
and SMM weekly reports.

## 3. Not recorded, and why

- **Reads sent as a POST** (options, lists, lookups, analytics, workload snapshots, the
  archive repair viewer, the save-problems page itself): nothing is saved.
- **Public onboarding form** (`_obPost`, the draft beacon): visitors are not signed in, so a
  report would be tagged as a staff page; the form has its own backup capture and screen.
- **Time off saves (`_ptoApi`)** are not recorded yet, on purpose. The Time Off screenshot
  evidence (`qa/pto-lifecycle`) is fingerprinted against this code and its test harnesses, and
  refreshing it needs a person to re-review every frame. A one-line report there is a small
  follow-up once that review can be done.
- **Background or best-effort:** the rename drain nudge and its retry, caption job stand-down
  and cancel, the retired urgent webhook.
- **Fire-and-forget logs:** the intake submission log.
- **The client approve and request-changes requests** are not touched. Their transports
  (`_writeUiGatewayPost`, `_calUpsertFetch`, `_calUpsertFetchPinned`, `_sxrUpsertFetch`,
  `_sxrUpsertFetchPinned`) and the four button functions are byte-identical to `main`, and
  the requests the page sends are identical (`test/client-review-requests-unchanged-browser.js`).
- **Legacy queue drain** (`_writeUiGatewayPost` calls made while draining an old offline
  queue): these keep their own ring entry; the queue is being retired.

## 4. Every write path checked

<!-- inventory:begin -->
| Fragment | Function | Sends to | What it is | Recorded in | Notes |
|---|---|---|---|---|---|
| `005-head-boot.html` | `(top level)` | `svBase` POST | read |  | Boot-time sign-in and client-link checks (key-verify, token verify). They answer "who is this", they save nothing. |
| `040-shared-briefs.js` | `abortForClientEntry` | `TAB_SUMMARY_WEBHOOK` POST | read |  | Reads the tab summary by POST. |
| `040-shared-briefs.js` | `addHookToLibrary` | `HOOK_LIBRARY_WEBHOOK` POST | reports | `addHookToLibrary` | Hook library add (n8n webhook). Wrapped: a refused or failed request is recorded as hook_library_add. |
| `040-shared-briefs.js` | `promise` | `CAL_SUPABASE_URL` POST | read |  | analytics-read: reads analytics rows through the function. |
| `050-market-briefs.js` | `_tplFlush` | `writeUrl` POST | reports | `_tplFlush` | Templates save (templates-save). Recorded as templates_save. |
| `050-market-briefs.js` | `abortForClientEntry` | `CONTENT_SUMMARY_WEBHOOK` POST | read |  | Reads the content summary by POST. |
| `050-market-briefs.js` | `sendWeeklySlackUpdate` | `WEEKLY_SLACK_WEBHOOK` POST | reports | `sendWeeklySlackUpdate` | Weekly Slack update (n8n webhook). Recorded as weekly_slack_update. |
| `060-templates-filming.js` | `_fpPostPlan` | `FILMING_PLANS_EF_URL` POST | reports | `_fpPostPlan` | Filming plans save (filming-plans). Recorded as filming_plan_save. |
| `060-templates-filming.js` | `send` | `url` POST | reports | `_tplBrainPost` | Templates > brain. Only the "change" action is a save and is recorded as templates_brain_change; read and folders are reads. |
| `067-workload-board-source.js` | `wlFetchNativeSnapshot` | `WORKLOAD_PLAN_URL` POST | read |  | Workload board snapshot read. |
| `067-workload-board-source.js` | `wlFetchPlanRows` | `WORKLOAD_PLAN_URL` POST | read |  | Workload plan list read. |
| `067-workload-board-source.js` | `worker` | `WORKLOAD_LINEAR_URL` POST | read |  | Workload metadata read (action metadata). |
| `080-workload-render.js` | `_wlDueWriteRequest` | `PROD_WRITE_EF_URL` POST | reports | `_wlDueWriteRequest` | Workload due date through the write gateway. Recorded as workload_due_save (the gateway also records its own refusal). |
| `080-workload-render.js` | `_wlDueWriteRequest` | `WORKLOAD_LINEAR_URL` POST | reports | `_wlDueWriteRequest` | Workload due date, legacy route. Recorded as workload_due_save. |
| `080-workload-render.js` | `_wlPlanWriteRequest` | `WORKLOAD_PLAN_URL` POST | reports | `_wlPlanWriteRequest` | Workload plan date save. Recorded as workload_plan_save. |
| `090-workload-popovers.js` | `_wlNativeTweakComments` | `url` POST | read |  | Reads the tweak comments. |
| `100-onboarding-staff-controls.js` | `_obDraftBeacon` | `ONBOARDING_FALLBACK_URL` BEACON | public-form |  | The public onboarding form saves a draft copy when the visitor leaves. Visitors are not signed in, so a report from that page would be labelled as a staff page; the form has its own backup capture and thank-you or failure screen. |
| `100-onboarding-staff-controls.js` | `_obDraftBeacon` | `ONBOARDING_FALLBACK_URL` POST | public-form |  | Same draft copy, sent by fetch when a beacon is unavailable. |
| `100-onboarding-staff-controls.js` | `_obPost` | `url` POST | reports-in-callers | `via _siSubmit` | Shared form post. The staff Sales Intake submit records its failure as sales_intake_submit; the public onboarding form (visitors are not signed in) has its own backup capture and failure screen and is not recorded. |
| `100-onboarding-staff-controls.js` | `_syncviewVerifyStaffIdentity` | `STAFF_KEY_VERIFY_URL` POST | read |  | Staff key verification: answers who is signing in, saves nothing. |
| `112-smm-weekly-reports.js` | `send` | `url` VAR | reports | `_srpApi` | SMM weekly reports. Reads (GET) are not recorded; a submit or sync is recorded as weekly_report_<action>. |
| `120-calendar-flags-write-repair.js` | `_calUpsertFetchClientLink` | `url` POST | client-transport |  | Calendar upsert transport for the client review link (approve and request changes). Not modified by the failed-saves work; the golden test proves its requests are unchanged. |
| `120-calendar-flags-write-repair.js` | `_calUpsertFetchGuarded` | `CALENDAR_UPSERT_EF_URL` POST | client-transport |  | Staff Calendar upsert behind the saving-on check. Not modified; each staff save that uses it records its own failure (see calendar_settings_save, calendar_import, calendar_link_adopt, calendar_archive, kasper_post_save, restore). |
| `120-calendar-flags-write-repair.js` | `_calUpsertFetchPinned` | `url` POST | client-transport |  | Pinned Calendar upsert transport (status writes, including the client approve path). Not modified; its status writes record through _writeUiReportFailure. |
| `120-calendar-flags-write-repair.js` | `_syncviewIssueClientShareUrl` | `CLIENT_REVIEW_LINK_URL` POST | reports | `_syncviewIssueClientShareUrl` | Issuing a client share link (staff only). Recorded as client_link_issue. |
| `120-calendar-flags-write-repair.js` | `_writeRefusalBeacon` | `WRITE_REFUSAL_BEACON_URL` POST | the-log |  | This is the failed-saves log beacon itself. |
| `120-calendar-flags-write-repair.js` | `_writeUiGatewayPost` | `WRITE_UI_PRODUCTION_WRITE_URL` POST | client-transport | `via _writeUiReportFailure` | The gateway transport the client approve and request-changes buttons use. Not modified (test/client-review-requests-unchanged-browser.js); its callers record refusals through _writeUiReportFailure / _writeUiRecordFailure. |
| `125-title-name-rule.js` | `_renamePropPoke` | `CAL_SUPABASE_URL` POST | background |  | Nudges the rename-propagation drain; best effort by design. The rename itself is a gateway write, recorded as title. |
| `125-title-name-rule.js` | `_renamePropRetry` | `CAL_SUPABASE_URL` POST | background |  | "Retry" for a rename that did not reach the sub-issues; the server drain already logs the failure and the page keeps its own ring entry. |
| `140-calendar-legacy-outbox.js` | `_calCheckQueuedUrgent` | `WRITE_UI_PRODUCTION_WRITE_URL` POST | read |  | Asks the gateway whether a queued urgent ping was delivered (native_urgent_status). |
| `140-calendar-legacy-outbox.js` | `showUnknown` | `WRITE_UI_PRODUCTION_WRITE_URL` POST | reports | `_calUrgentSlackDispatch` | Sending an urgent ping through the gateway. A ping that went out and did not come back confirmed is recorded as urgent_ping. |
| `140-calendar-legacy-outbox.js` | `showUnknown` | `spec.url(` POST | background |  | The pre-gateway urgent webhook path; its send is retired (B2) and only fails closed. The gateway path above is the live one. |
| `160-calendar-organize-ui.js` | `_calFillComponentSubmit` | `PROD_WRITE_EF_URL` POST | reports | `_calFillComponentSubmit` | Calendar component fill. Already recorded (component_fill). |
| `160-calendar-organize-ui.js` | `_calFrameFolderEnsure` | `url` POST | read |  | Calendar Frame folder button: reads the client's saved Frame folder (brain, action folders). Nothing is saved. |
| `160-calendar-organize-ui.js` | `_calResolveThumbnailFolder` | `THUMBNAIL_FOLDER_RESOLVE_EF_URL` POST | read |  | Looks up a thumbnail folder. |
| `160-calendar-organize-ui.js` | `_thumbCompareDiscoverAvailability` | `THUMBNAIL_REVISION_READ_EF_URL` POST | read |  | Reads thumbnail revisions. |
| `160-calendar-organize-ui.js` | `_thumbCompareLoad` | `THUMBNAIL_REVISION_READ_EF_URL` POST | read |  | Reads thumbnail revisions. |
| `170-calendar-links-status.js` | `current` | `url` POST | read |  | Reads the editor options for the intake picker. |
| `180-calendar-native-post-media.js` | `_calCancelCaptionJob` | `CAPTION_JOB_UPDATE_URL` POST | background |  | "Cancel" for a caption job; the page settles the job locally if it fails. |
| `180-calendar-native-post-media.js` | `_calCapJobStart` | `GENERATE_CAPTION_URL` POST | reports | `_calCapJobSettle` | Starts a caption generation (n8n). A job that ends in error is recorded once as caption_generate, where the job settles. |
| `180-calendar-native-post-media.js` | `_calCapJobsPoll` | `CAPTION_JOB_UPDATE_URL` POST | background |  | Stand-down message for a caption job that timed out; the job already ends in error and is recorded there. |
| `180-calendar-native-post-media.js` | `_calSaveCaptionPrompt` | `writeUrl` POST | reports | `_calSaveCaptionPrompt` | Caption prompt save (caption-prompts-save). Recorded as caption_prompt_save. |
| `180-calendar-native-post-media.js` | `persistCalReorder` | `url` POST | reports | `persistCalReorder` | Calendar drag order (calendar-reorder). Recorded as calendar_reorder. |
| `186-archived-restore.js` | `_arxGatewayMove` | `url` POST | reports-in-callers | `via _arxFail` | Restore moves a work item back through the guarded production-write route. Its caller _arxRestore records a failed move through _arxFail, which reports to the log (surface calendar or sxr, operation status). |
| `186-archived-restore.js` | `_arxRestore` | `CALENDAR_REORDER_EF_URL` POST | reports-in-callers | `via _arxFail` | Restore position write. A failure is caught in _arxRestore and recorded through _arxFail (step order). |
| `200-intake-data-startup.js` | `_linearIntakeLogSubmissionRequest` | `LOG_SUBMISSION_WEBHOOK` POST | telemetry |  | Same submission log. |
| `200-intake-data-startup.js` | `_linearIntakeSendTelemetry` | `LOG_SUBMISSION_WEBHOOK` POST | telemetry |  | Fire-and-forget submission log to a sheet; not a save the person waits on. |
| `200-intake-data-startup.js` | `_runNativeIntakeJob` | `PROD_WRITE_EF_URL` POST | reports-in-callers | `via _linearSavedSend`, `_submitLinearFormRoutedOnce` | Intake create through the gateway. Already recorded (intake_create and the queue kinds) by its callers. |
| `210-production-state-writes.js` | `_prodArchiveRequest` | `PROD_ARCHIVE_EF_URL` POST | read |  | Archive repair viewer: the only actions it sends are list and issue. |
| `210-production-state-writes.js` | `_prodEnsureAssets` | `PROD_WRITE_EF_URL` POST | read |  | Reads assets. |
| `210-production-state-writes.js` | `_prodEnsureAssigneeOptions` | `PROD_WRITE_EF_URL` POST | read |  | Reads assignee options. |
| `210-production-state-writes.js` | `_prodEnsureBatchFiles` | `PROD_WRITE_EF_URL` POST | read |  | Reads batch files. |
| `210-production-state-writes.js` | `_prodEnsureLabels` | `PROD_WRITE_EF_URL` POST | read |  | Reads the label catalogue. |
| `230-production-create-comments.js` | `_prodGatewayWrite` | `PROD_WRITE_EF_URL` POST | reports-in-callers | `via _prodRunPickerWrite`, `_prodRunLabelsWrite`, `_prodSubmitComment`, `_prodCommentLifecycle`, `_prodSaveDescription`, `_prodSaveAsset`, `_prodTitleEditCommit` | The Production gateway write (status, assignee, due, labels, comments, title, description). Recorded by each caller. |
| `230-production-create-comments.js` | `_prodLoadCreateOptions` | `PROD_WRITE_EF_URL` POST | read |  | Reads the create options. |
| `230-production-create-comments.js` | `_prodPostCreatePayload` | `PROD_WRITE_EF_URL` POST | reports-in-callers | `via _prodSubmitCreate` | Production create. Recorded as create by its callers. |
| `230-production-create-comments.js` | `load` | `PROD_COMMENTS_EF_URL` POST | read |  | Reads comments. |
| `240-production-description.js` | `_prodDescriptionPostImage` | `PROD_DESCRIPTION_IMAGE_EF_URL` POST | reports-in-callers | `via _prodDescriptionUploadImage` | Description image upload. Recorded as description_image by its caller. |
| `240-production-description.js` | `_prodEnsureDescription` | `PROD_WRITE_EF_URL` POST | read |  | Reads a description. |
| `260-production-refresh-boot.js` | `_syncviewPreflightClientEntry` | `CLIENT_TOKEN_VERIFY_URL` POST | read |  | Client link check at boot. |
| `270-samples-model.js` | `_sxrFillComponentSubmit` | `PROD_WRITE_EF_URL` POST | reports | `_sxrFillComponentSubmit` | Samples component fill. Already recorded (component_fill). |
| `270-samples-model.js` | `_sxrReorderFetch` | `SXR_REORDER_EF_URL` POST | reports | `_sxrReorderFetch` | Samples drag order (sample-review-reorder), behind the saving-on check. Recorded as sample_reorder. |
| `270-samples-model.js` | `_sxrUpsertFetchClientLink` | `url` POST | client-transport |  | Samples upsert transport for the client review link (approve and request changes). Not modified by the n8n exit; the Samples golden test proves its requests are unchanged. |
| `270-samples-model.js` | `_sxrUpsertFetchGuarded` | `SXR_UPSERT_EF_URL` POST | client-transport |  | Staff Samples upsert behind the saving-on check (n8n exit PR 4). Each staff save that uses it records its own failure (sample_archive, sample_link_adopt, kasper_sample_save, urgent_marker_save). |
| `270-samples-model.js` | `_sxrUpsertFetchPinned` | `url` POST | client-transport |  | Pinned Samples upsert transport (status writes, including the client approve path). Not modified. |
| `290-samples-writes-review.js` | `_writeUiReadRepairReceipt` | `WRITE_UI_PRODUCTION_WRITE_URL` POST | read |  | Reads a repair receipt. |
| `299-instagram-upload.js` | `ctrl` | `cmint.json.upload_url` PUT | reports | `_igSubmit` | Instagram cover image upload to Post For Me storage. Recorded as instagram_cover_put. |
| `299-instagram-upload.js` | `ctrl` | `mint.json.upload_url` PUT | reports | `_igSubmit` | Instagram video upload to Post For Me storage. Recorded as instagram_storage_put. |
| `299-instagram-upload.js` | `send` | `IG_FUNCTION_URL` POST | reports | `_igCall` | Instagram upload function (mint, create, list, cancel). Create and cancel are recorded as instagram_create and instagram_cancel; list and mint are reads of state. |
| `300-tiktok-upload.js` | `_tkCancelRow` | `TIKTOK_UPLOAD_CANCEL_URL` POST | reports | `_tkCancelRow` | TikTok cancel. Recorded as tiktok_cancel. |
| `300-tiktok-upload.js` | `_tkFinishDirectSubmit` | `TIKTOK_UPLOAD_DIRECT_WEBHOOK` POST | reports | `_tkFinishDirectSubmit` | TikTok post creation after a direct upload. Recorded as tiktok_upload. |
| `300-tiktok-upload.js` | `_tkFinishPhotoSubmit` | `TIKTOK_UPLOAD_DIRECT_WEBHOOK` POST | reports | `_tkFinishPhotoSubmit` | TikTok photo post creation. Recorded as tiktok_upload. |
| `300-tiktok-upload.js` | `_tkPutDirect` | `uploadUrl` PUT | reports | `_tkPutDirect` | TikTok video upload to storage. Recorded as tiktok_storage_put. |
| `300-tiktok-upload.js` | `_tkRetryRow` | `TIKTOK_UPLOAD_STATUS_URL` POST | reports | `_tkRetryRow` | TikTok retry. Recorded as tiktok_retry. |
| `300-tiktok-upload.js` | `_tkSubmitPhotoCarousel` | `TIKTOK_UPLOAD_URL_WEBHOOK` PUT | reports | `_tkSubmitPhotoCarousel` | TikTok photo upload address. Recorded as tiktok_photo_upload. |
| `300-tiktok-upload.js` | `_tkSubmitPhotoCarousel` | `mint.upload_url` PUT | reports | `_tkSubmitPhotoCarousel` | TikTok photo upload to storage. Recorded as tiktok_photo_upload. |
| `300-tiktok-upload.js` | `idempotencyKey` | `TIKTOK_UPLOAD_WEBHOOK` POST | reports | `_tkSubmit` | TikTok upload, multipart. Recorded as tiktok_upload. |
| `310-sales-intake-hiring.js` | `send` | `HIRING_APPLICATIONS_EF_URL` POST | reports | `_hpCall` | Hiring. list and detail are reads; every other action is recorded as hiring_<action>. |
| `321-kasper-dashboard-replies.js` | `_spLoad` | `SP_EF_URL` POST | read |  | The save-problems page reading the log itself. |
| `321-kasper-dashboard-replies.js` | `send` | `CC_EDGE_URL` POST | reports | `_ccApi` | Client credentials. list and history are reads; every other action is recorded as credentials_<action>. |
| `323-kasper-dashboard-tail.js` | `_caEditPost` | `CA_WRITE_URL` POST | reports | `_caEditPost` | Client profile edit / status / refresh. Recorded as client_profile_<action>. |
| `323-kasper-dashboard-tail.js` | `stale` | `CA_READ_URL` POST | read |  | Client profile read. |
| `330-kasper-review-history.js` | `fetchOne` | `KASPER_QUEUE_URL` POST | read |  | Kasper review queue read. |
<!-- inventory:end -->

## 5. Proof

- `test/write-path-refusal-coverage.js`: the scan and this table cannot drift apart from the
  code, each "reports" decision is backed by a recorder call in the named function, and the
  helpers behave as described above.
- `test/client-review-requests-unchanged-browser.js`: the client approve and request-changes
  requests, and the source of the functions behind them, equal what `main` sent and holds.
- `docs/syncview-design/tests/failed-saves-beacon-browser.js`: in a real browser, a refused
  Templates save, Filming plan save and caption prompt save each send one report with the
  operation name, the status, the staff-page tag, and no free text; the save behaves as before.
