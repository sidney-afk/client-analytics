# A2 — Linear-era dead-code inventory

Baseline: `a74bd3f92e057f93357bd5c7e7c52935012c8765` (2026-09-21). Supervisor: Fable.
Roadmap read from `claude/optimistic-rubin-o7jj1z` at `f2d3bd6beb1bacbc9e76a7cb280f1a2592e55b85`, phase A. Own branch starts from `origin/main`.

## Decision boundaries

`DELETE-NOW` means eligible for B1 before key revocation, **not permission to delete an entire named function**. Branch-only rows say what to remove. A reachable obsolete transport requires a reviewed retirement change preserving source saves, errors and debt; it is not an unreferenced-code deletion. `AFTER-STEP-7` defers every Linear reader (including orphan readers and their dedicated UI/state). Step 7 alone does not make a still-used reader safe: replace remaining uses first. `RETAIN` rows are explicit false positives excluded from the deletion worklist; neither cutoff nor key revocation justifies their removal.

Evidence: repository source and assembled-page lexical references, not a fresh production measurement. `docs/truth/BRIEFING.md` live-safety section and `docs/ops/LINEAR_EXIT_EXECUTION_MAP.md` cutoff rows document `linear_outbound_enabled={mode:off}`, `linear_legacy_parity_enabled={enabled:false}`, video/graphics `prod_authority=syncview`, full-roster `write_ui_reroute_clients`, and `linear_inbound_enabled={enabled:true}`. Outbound/parity flipped 2026-09-20. The execution map records retired card-reconciler/B1 schedules but an active Workload reconcile with 28 legacy rows. None of these historical measurements was re-run here.

**Finding A2-1:** the browser does not read either cutoff flag; there is no universal browser cutoff guard. Full enrollment does not close client-comment missing-context/crosswalk fallback. `_calPostLinearComment` and `_sxrPostLinearComment` can still select legacy transport. `_writeUiResumeLegacyQueues` still processes browser-local debt. Deleting `_writeUiLegacyOutbox*` or all of fragment 140 would remove working preservation/recovery. This is a code-reading finding, not a claimed new live incident.

**Finding A2-2:** Linear reads remain: project loading is unconditional; foreign Workload metadata/feedback is consumed; Calendar v1 reconciliation remains reachable via v2 disable. Do not label these globally dead because schedulers are retired.

## Measurement and reconciled negative results

First sweep: `rg -n "linear-outbound|mirror_outbox|_writeUiLegacyOutbox|_calPushStatusToLinear|linear\.app|linear_outbound_enabled|linear_legacy_parity_enabled|reconcil" src/index/ --glob "*.part"`. Second shape: endpoint constants and their fetch sites, function declarations containing Linear/Legacy/Outbox/Provider/Import, bare `b1` references, and external `href` interpolation. Each table entry was then matched by exact symbol boundary against assembled `index.html`.

Reference column lists **all lexical matching assembled-page line numbers**, including declaration, comments, inline handlers and callbacks; these are conservative remaining-reference candidates, not a call-count claim. Inspect the listed lines to distinguish calls from documentation. Orphan claims additionally inspected each non-comment reference. Fragment lines are baseline-relative approximate anchors. No runtime tracing or browser-local debt census was performed.

| Requested family | Reconciled result |
|---|---|
| `linear-outbound` browser calls | Zero direct calls; only comment at assembled line 53588. Gateway parity payloads are inventoried under 120. |
| `mirror_outbox` browser writers | Zero literal references in fragments or assembled page. Server outbox behavior is outside A2; local outboxes are not that table. |
| Cutoff flag browser guards | Zero literal references to either cutoff flag. Browser decisions use authority, enrollment and canonical context; server cutoff is not browser unreachability. |
| B1 import browser half | No `b1-import` call. Six `b1-linear` mentions are comments/schema provenance at 14866, 44511, 55288, 56066, 84250, 84270. The dedicated Calendar import cluster in 150 is inventoried separately. Imported IDs/parent topology in 210/220 are still native data compatibility. |
| `linear.app` builders | Eight literal lines: 15361, 37076, 37078, 37374, 37376, 42100, 60526, 70177. These are comments, placeholders or validation copy, not literal URL constructors. Actual external links interpolate stored URLs in 080/160/270. `wlSyncLinearUrl` builds a local link. |
| Retired reconcilers | Browser status reader in 150 and paste reader in 290 deferred; local/native cache reconciliation in 130/150/280/290 is still used and excluded. Production full-reconcile refresh in 250/260 reads native data, not the retired Linear worker. |

## Inventory by fragment

### `src/index/060-templates-filming.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~1623 `VIDEO_FORM_WEBHOOK` | DELETE-NOW | Only legacy intake target selection; remove after the orphan submission chain and preserve held receipt display. | 14151, 51143 |
| ~1624 `GRAPHIC_FORM_WEBHOOK` | DELETE-NOW | Only legacy intake target selection; remove after the orphan submission chain and preserve held receipt display. | 14152, 51144 |
| ~1625 `LINEAR_PROJECTS_WEBHOOK` | AFTER-STEP-7 | Live Linear project reader remains in fetchLinearProjects; not dead. Replace its source before removal. | 14153, 14271 |
| ~1671 `linearLegacyProjects` | AFTER-STEP-7 | Legacy project cache/merge and de-enrollment fallback; still consumed by project selection. Remove with the Linear project read. | 14199, 14218, 14242, 14252, 14268, 14302 |
| ~1685 `_linearRebuildProjectSource` — legacy source leg only | AFTER-STEP-7 | Legacy project-source leg still participates in Submit. Full-roster enrollment does not suppress the fetch; preserve native rows, selection and draft behavior. | 14213, 14257, 14304 |
| ~1708 `_linearReconcileProjectSelection` — legacy source leg only | AFTER-STEP-7 | Legacy project-source leg still participates in Submit. Full-roster enrollment does not suppress the fetch; preserve native rows, selection and draft behavior. | 14236, 14258 |
| ~1737 `fetchLinearProjects` — legacy source leg only | AFTER-STEP-7 | Legacy project-source leg still participates in Submit. Full-roster enrollment does not suppress the fetch; preserve native rows, selection and draft behavior. | 14261, 14262, 14265, 23405, 51710 |

### `src/index/070-workload-source.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~2 `LINEAR_ISSUES_WEBHOOK` | AFTER-STEP-7 | Direct Linear issue reader is orphaned after wlDiscoverProviderIssues removal; literal caller sweep confirms no executable caller of the function. Reader deferred by owner rule. | 14318, 15236, 15237 |
| ~3 `LINEAR_TWEAK_COMMENTS_WEBHOOK` | AFTER-STEP-7 | Still used by _wlLegacyFetchTweakComments for the legacy partition; not dead. | 14319, 21368 |
| ~4 `LINEAR_ISSUES_CACHE_KEY` | RETAIN | Cache, mirror adapter or diagnostic, not proven exclusively dead; reference sweep is supplied for follow-up. Do not delete from name or age. | 14320, 14395, 14403, 14414 |
| ~5 `LINEAR_ISSUES_TTL_MS` | RETAIN | Cache, mirror adapter or diagnostic, not proven exclusively dead; reference sweep is supplied for follow-up. Do not delete from name or age. | 178, 14321, 14417 |
| ~77 `wlReadCache` | RETAIN | Cache, mirror adapter or diagnostic, not proven exclusively dead; reference sweep is supplied for follow-up. Do not delete from name or age. | 14393, 15207, 16157, 17594, 17882 |
| ~86 `wlWriteCache` | RETAIN | Cache, mirror adapter or diagnostic, not proven exclusively dead; reference sweep is supplied for follow-up. Do not delete from name or age. | 14402, 15223, 15244, 15926, 16081 |
| ~97 `wlDropCache` | RETAIN | Cache, mirror adapter or diagnostic, not proven exclusively dead; reference sweep is supplied for follow-up. Do not delete from name or age. | 14413, 16276 |
| ~100 `wlIsFresh` | RETAIN | Cache, mirror adapter or diagnostic, not proven exclusively dead; reference sweep is supplied for follow-up. Do not delete from name or age. | 14416, 15208, 16113 |
| ~193 `_wlV2MapRow` | RETAIN | Cache, mirror adapter or diagnostic, not proven exclusively dead; reference sweep is supplied for follow-up. Do not delete from name or age. | 14509, 14668, 15048, 19320 |
| ~321 `_wlV2FetchIssues` | RETAIN | Cache, mirror adapter or diagnostic, not proven exclusively dead; reference sweep is supplied for follow-up. Do not delete from name or age. | 14637, 15220, 17728 |
| ~444 `_wlNativeDiffReport` | RETAIN | Cache, mirror adapter or diagnostic, not proven exclusively dead; reference sweep is supplied for follow-up. Do not delete from name or age. | 14760, 14846 |
| ~622 `_wlLegacyCheckWatermark` | AFTER-STEP-7 | No executable caller found; retained old mirror/metadata snapshot chain. Conservatively defer the Linear-derived read chain. | 14938 |
| ~889 `_wlLegacyLoadLinearIssues` | AFTER-STEP-7 | Direct Linear issue reader is orphaned after wlDiscoverProviderIssues removal; literal caller sweep confirms no executable caller of the function. Reader deferred by owner rule. | 15200, 15205 |
| ~935 `WL_LINEAR_READ_TIMEOUT_MS` | AFTER-STEP-7 | Used by the remaining foreign Linear metadata reader; remove with that reader. | 15251, 15398 |
| ~1053 `wlFetchForeignLinearMetadata` | AFTER-STEP-7 | Called by native snapshot foreign-row handling and wlFetchLinearMetadata. Workload legacy rows remain; a replacement is required, not merely key revocation. | 15135, 15369, 15776 |
| ~1410 `wlFetchLinearMetadata` — foreign Linear partition only | AFTER-STEP-7 | Mixed native/foreign metadata function; only Linear partition is in scope. Called by orphan snapshot/refresh chains; preserve any shared native consumers. | 15152, 15726, 16229, 17734 |
| ~1810 `_wlLegacyLoadSnapshot` | AFTER-STEP-7 | No executable caller found; retained old mirror/metadata snapshot chain. Conservatively defer the Linear-derived read chain. | 16126 |

### `src/index/080-workload-render.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~165 `_wlLegacyRefetchSilent` | AFTER-STEP-7 | No executable caller found; orphan refresh chain still reads mirror/metadata. Defer with its reader dependencies. | 17704 |
| ~650 `wlDueWriteRoute` | RETAIN | Foreign-row authority routing is still used by due-date UI. Preserve until foreign-row ownership and replacement are proven. | 15278, 18189, 18536, 19584 |
| ~934 `_wlDueWriteRequest` — legacy due-date branch at ~962 | RETAIN | WORKLOAD_LINEAR_URL write branch remains for foreign Linear-authority rows; both video/graphics being native does not prove every Workload row native. | 18473, 18557 |
| ~2735 `wlSyncLinearUrl` | RETAIN | Builds a local ?prod=1&d= link, not a linear.app URL; used by current native navigation. | 19335, 20274, 20414, 20429, 21691 |
| ~2881 `renderLooseIssueStrip` — external href branches ~2881,2892 | DELETE-NOW | Existing parent.url and s.url external-link anchors are obsolete Linear escape hatches, still rendered. Remove only those anchors, retaining local links and grouping. | 20260, 20264, 20326 |

### `src/index/090-workload-popovers-navigation.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~13 `WL_TWEAK_COMMENTS_TTL_MS` | AFTER-STEP-7 | Legacy tweak-comment cache owned by the remaining Linear reader; remove only after its consumers are replaced. | 20885, 20968, 21353 |
| ~14 `_wlTweakCommentsCache` | AFTER-STEP-7 | Legacy tweak-comment cache owned by the remaining Linear reader; remove only after its consumers are replaced. | 20886, 21352, 21378, 21382 |
| ~477 `_wlLegacyFetchTweakComments` | AFTER-STEP-7 | wlFetchTweakComments still calls this for legacy IDs. Reads Linear through the tweak-comments endpoint; not dead until foreign feedback is replaced. | 20893, 21150, 21349 |

### `src/index/100-onboarding-staff-controls.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~1064 `LINEAR_SUBISSUES_URL` | AFTER-STEP-7 | Endpoint constant still has reader consumers listed here; key revocation alone is not replacement. WORKLOAD_LINEAR_URL also serves the retained foreign due-date writer. | 24549, 36886, 37102, 37400, 74794 |
| ~1065 `LINEAR_SET_STATUS_URL` | DELETE-NOW | Obsolete n8n transport constants; still referenced. Remove last, only after transport branches are retired and client source-save/recovery is preserved. | 24550, 27716, 27998, 28148, 35345, 35519, 73764, 73888 |
| ~1066 `LINEAR_STATUSES_URL` | AFTER-STEP-7 | Endpoint constant still has reader consumers listed here; key revocation alone is not replacement. WORKLOAD_LINEAR_URL also serves the retained foreign due-date writer. | 24551, 36819, 36974 |
| ~1067 `LINEAR_ADD_COMMENT_URL` | DELETE-NOW | Obsolete n8n transport constants; still referenced. Remove last, only after transport branches are retired and client source-save/recovery is preserved. | 24552, 27717, 27998, 28149, 35345, 35545, 73764, 73910 |
| ~1117 `WORKLOAD_LINEAR_URL` | AFTER-STEP-7 | Endpoint constant still has reader consumers listed here; key revocation alone is not replacement. WORKLOAD_LINEAR_URL also serves the retained foreign due-date writer. | 15402, 15406, 18501, 18505, 24602 |

### `src/index/120-calendar-flags-write-repair.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~398 `_writeUiRerouteUseGatewayFailClosed` | RETAIN | Active routing, seal or canonical-comment safety helper; does not read either cutoff flag. Its false/legacy result can still be meaningful for unbound/client contexts. | 27714, 27996, 28159, 28454, 28462 |
| ~625 `_writeUiLinkSlotSealed` | RETAIN | Active routing, seal or canonical-comment safety helper; does not read either cutoff flag. Its false/legacy result can still be meaningful for unbound/client contexts. | 28386, 36657, 36788, 36790, 36796, 36797, 41652, 41754, 41982, 42282, 42293, 42294, 69426, 69437, 69500, 70090, 70786 |
| ~640 `_writeUiLinkSlotSealedLive` | RETAIN | Active routing, seal or canonical-comment safety helper; does not read either cutoff flag. Its false/legacy result can still be meaningful for unbound/client contexts. | 28401, 37260, 37592, 37593, 41845, 42084, 42195, 69768, 69837, 70167, 70277 |
| ~695 `_writeUiUseGatewayWhenReady` | RETAIN | Active routing, seal or canonical-comment safety helper; does not read either cutoff flag. Its false/legacy result can still be meaningful for unbound/client contexts. | 28456, 28927, 35579, 35640, 35721, 49845, 73060, 73941, 74023 |
| ~1210 `_prodCommentAddRoutesLegacy` | RETAIN | Active routing, seal or canonical-comment safety helper; does not read either cutoff flag. Its false/legacy result can still be meaningful for unbound/client contexts. | 28971, 35705, 49863, 49872, 73054, 73067 |
| ~1328 `_writeUiLegacyResumeOwner` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 29089, 35095, 35104, 73539, 73547, 74621, 74751 |
| ~1353 `_writeUiLegacyResumeOwnerKey` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 29114, 35108, 73551, 74625 |
| ~1360 `_writeUiLegacyResumeOwnerCurrent` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 29121, 30285, 35096, 35100, 35105, 35123, 35125, 35127, 35145, 35164, 35191, 35348, 35400, 35465, 35480, 73540, 73543, 73548, 73566, 73568, 73570, 73581, 73597, 73624, 73767, 73810, 73856, 73871, 74622, 74630, 74638, 74652, 74655, 74664, 74736, 74752 |
| ~1375 `_writeUiLegacyItemOwnedBy` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 29136, 35130, 73573, 74643, 74645, 74754, 74756 |
| ~1388 `_writeUiLegacyRetainFrom` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 29149, 35166, 35193, 35350, 35402, 35431, 73599, 73626, 73769, 73812, 73835 |
| ~2521 `_writeUiGatewayPost` — legacyParity / intent.legacyOnly / retry branches ~2535–2608 | DELETE-NOW | Only legacyParity payload construction and legacy-authority retry legs: prod_authority video/graphics is syncview; server outbound/parity are documented off. Native gateway, errors, receipt hooks and owner checks must stay. | 28366, 28397, 30263, 30282, 35405, 73815 |

### `src/index/130-calendar-model-cache.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~140 `_calLinearUrlFor` | RETAIN | Accessor for persisted identity, shared by native writes and recovery; does not construct a linear.app URL. | 28325, 30826, 33516, 33819, 34439, 34665, 35657, 48471, 49873, 49900, 74401, 83598, 83915 |
| ~2685 `LINEAR_OUTBOX_KEY` | RETAIN | Local recovery storage/retry configuration still read by active resume machinery; not a mirror_outbox writer. | 33371, 33380, 33388, 33389, 74602 |
| ~2687 `LINEAR_OUTBOX_MAX_ATTEMPTS` | RETAIN | Local recovery storage/retry configuration still read by active resume machinery; not a mirror_outbox writer. | 33373, 35344, 35452 |
| ~2688 `LINEAR_OUTBOX_RETRY_MS` | RETAIN | Local recovery storage/retry configuration still read by active resume machinery; not a mirror_outbox writer. | 33374, 35101 |
| ~2692 `_linearOutboxRead` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33378, 33434, 35128, 35488, 35492, 74642, 74753, 74777 |
| ~2699 `_linearOutboxWrite` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33385, 33437, 35489 |
| ~2707 `_linearOutboxEnqueue` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33393, 35529, 35555, 73524, 73530 |
| ~2581 `_calLinearSubs` | AFTER-STEP-7 | Dedicated Linear import selection state; reader cluster remains until Step 7. | 33267, 37051, 37160, 37207, 37210, 37236, 37237, 37238, 37239, 37243, 37244 |
| ~2584 `_calSubDragIdx` | AFTER-STEP-7 | Dedicated Linear import drag state; remove with its reader UI. | 33270, 37213, 37219, 37228, 37234, 37235 |
| ~2582 `_calLinearParent` | AFTER-STEP-7 | Dedicated Linear import parent state; remove with the 150 reader/UI cluster. | 33268, 37158, 37210, 37239 |
| ~2583 `_calLinearGraphicParent` | AFTER-STEP-7 | Dedicated Linear import parent state; remove with the 150 reader/UI cluster. | 33269, 37159, 37171, 37210, 37239 |


### `src/index/140-calendar-legacy-outbox.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~1 `_writeUiLegacyOutboxItems` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33433, 33624, 34033, 34043, 34348, 34379, 34814, 34831, 34864, 34883, 34903, 34961, 34966, 35047, 35057 |
| ~4 `_writeUiLegacyOutboxWrite` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33436, 34040, 34828, 34900, 35054 |
| ~7 `_writeUiLegacyOutboxWithLock` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33439, 33841, 34032, 35040 |
| ~18 `_writeUiLegacyDrainWithLock` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33450, 33840, 34262, 35126, 73569 |
| ~28 `_writeUiLegacyTargetWithLock` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33460, 48334, 72271 |
| ~39 `_writeUiLegacyGateTargetIdentity` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33471, 33482, 33485, 33553, 33584, 33585, 33625, 33646, 33797, 34688 |
| ~46 `_writeUiLegacyGateTargets` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33478 |
| ~52 `_writeUiLegacySourceCommentReflected` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33484, 33514, 33652, 33704, 33764 |
| ~70 `_writeUiLegacyGateStatusMatches` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33502, 33518 |
| ~81 `_writeUiLegacyGateReflected` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33513, 33653, 33705, 33772 |
| ~90 `_writeUiLegacyGateSignature` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33522, 33586, 33678, 34152, 34153, 34229, 34230, 34256, 34257, 35171, 35214, 73604, 73647 |
| ~111 `_writeUiLegacyTargetPair` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33543, 33662 |
| ~189 `_writeUiLegacyTargetDecision` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33621, 33845, 34777 |
| ~353 `_writeUiLegacyTeamRearmValid` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33785, 33856 |
| ~405 `_writeUiLegacyTargetLedgerWithLock` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33837, 33844, 33901, 33921, 34776 |
| ~411 `_writeUiLegacyInspectTargetTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33843, 48350, 72287 |
| ~460 `_writeUiLegacyRefreshActiveTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33892, 48353, 72290 |
| ~599 `_writeUiLegacyAppendOutboxItem` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33427, 34031, 73534 |
| ~619 `_writeUiLegacyApprovalClears` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33808, 34051, 34060, 34067, 34073, 34075, 34478, 34698 |
| ~626 `_writeUiLegacyApprovalClearsFromEdits` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34058, 34682, 34699 |
| ~633 `_writeUiLegacyApprovalClearsValid` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33563, 33600, 33802, 34065, 34413, 34526 |
| ~639 `_writeUiLegacyApprovalClearsForReconcile` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33519, 34071, 34559 |
| ~648 `_writeUiLegacyItemSignature` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34080, 34122 |
| ~689 `_writeUiLegacyItemMatches` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34036, 34045, 34121, 34194, 34266, 34274, 34797, 34835, 34866, 34906, 35051, 35059 |
| ~692 `_writeUiLegacyCommittedTweakRead` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33627, 34124, 34148, 34191, 34226, 34252, 34263, 34271, 34282, 34607, 34630, 34791 |
| ~698 `_writeUiLegacyCommittedTweakWrite` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34130, 34190, 34268 |
| ~704 `_writeUiLegacyTweakKey` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34136, 34147, 34225, 34251, 34790 |
| ~712 `_writeUiLegacyRememberCommittedTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33655, 33902, 33922, 34144, 35223, 35274, 35370, 73656, 73707, 73785 |
| ~764 `_writeUiLegacySupersededSourceItem` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33654, 33920, 34196, 35220, 73653 |
| ~771 `_writeUiLegacySupersededTeamItem` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34203, 35221, 73654 |
| ~778 `_writeUiLegacyTeamDeliveryReceiptItem` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34210, 35369, 73784 |
| ~789 `_writeUiLegacyRecordedTeamDeliveryReceiptItem` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34221, 35289, 73722 |
| ~814 `_writeUiLegacyStoredTeamTerminalItem` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34246, 35172, 73605 |
| ~828 `_writeUiLegacyRetireCommittedTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34260, 34325 |
| ~848 `_writeUiLegacyCommittedTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34280, 34363, 34366, 34618, 48615, 48701, 72546, 72633 |
| ~915 `_writeUiLegacyPendingTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34347 |
| ~945 `_writeUiLegacyPinnedSourceTransport` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34377, 48519, 72449 |
| ~952 `_writeUiLegacySourceRows` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34384, 34426 |
| ~976 `_writeUiLegacySourceGateState` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33894, 34408, 35190, 73623 |
| ~1071 `_writeUiLegacyReconcileCommittedTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34503, 34625, 35275, 48548, 48603, 48629, 48677, 48718, 72477, 72532, 72558, 72606, 72648, 73708 |
| ~1174 `_writeUiLegacyReconcileCommittedTombstones` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34606, 74504 |
| ~1196 `_writeUiLegacyHydrateConfirmedCacheAfterAuthority` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34628, 74672 |
| ~1232 `_writeUiBuildDeferredLegacyTweakRecords` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34664, 34751 |
| ~1309 `_writeUiQueueDeferredLegacyTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34741, 35664, 48488, 72418 |
| ~1486 `_writeUiScheduleDeferredLegacyTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34918, 34953, 48550, 48583, 48633, 48657, 48695, 72479, 72512, 72562, 72586, 72627 |
| ~1490 `_writeUiLegacyDeliveryUnconfirmedError` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 29877, 34922, 35003, 35008, 35037 |
| ~1495 `_writeUiFlushDeferredLegacyTweak` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34927, 48575, 48649, 72504, 72578 |
| ~1607 `_writeUiLegacyFinalizeFlush` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 35039, 35461, 73852 |
| ~1633 `_writeUiLegacyQuarantine` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 35065, 35206, 35261, 35266, 35332, 35339, 35386, 35395, 35439, 35453, 73639, 73694, 73699, 73751, 73758, 73801, 73805, 73840, 73845 |
| ~1655 `_writeUiLegacyQuarantineRead` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 35087, 35093, 74782 |
| ~1662 `_linearOutboxScheduleRetry` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33428, 34920, 35094, 35480 |
| ~1671 `_linearOutboxFlush` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34928, 35100, 35103, 74648, 74660 |
| ~1690 `_linearOutboxFlushRun` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 35112, 35122 |
| ~1913 `_linearOutboxFlushRun` — network dispatch branches only | DELETE-NOW | Direct fetch(endpoint) ~1923 and legacyOnly gateway dispatch ~1973 are obsolete network legs. Active source gates, committed receipts, leases and quarantine are NOT dead. | 35112, 35122 |
| ~2066 `_calLinearPushLatest` | DELETE-NOW | Only direct legacy status latest-wins tracking; remove with _calLegacyPushStatusToLinear. _calLinearPushChain is shared and stays. | 35498, 35514, 35516 |
| ~2067 `_calLegacyPushStatusToLinear` | DELETE-NOW | Obsolete direct n8n network sender, not universally unreachable: caller/ref list remains. Full-roster status routing normally bypasses it; client/unlinked comment fallback is still reachable. Retire with source-save and visible debt preserved; no whole-function deletion while callers remain. | 35499, 35583, 43600 |
| ~2105 `_calLegacyPostLinearComment` | DELETE-NOW | Obsolete direct n8n network sender, not universally unreachable: caller/ref list remains. Full-roster status routing normally bypasses it; client/unlinked comment fallback is still reachable. Retire with source-save and visible debt preserved; no whole-function deletion while callers remain. | 35537, 35725 |
| ~2131 `_calPushStatusToLinear` — legacy transport leg only | DELETE-NOW | Only the !gateway leg at ~2147–2153 is legacy. Native _writeUiGatewayWithRepair path and chain are live; never delete the wrapper. | 35563, 35642, 35647, 43359, 43397, 45714, 83598 |
| ~2197 `_calReassertLinearStatus` — Linear-only branch | DELETE-NOW | Only authority==linear / linearOnly branch ~2212–2215 is obsolete. Native reassert is still invoked by Calendar hydration; preserve it. | 35566, 35629, 38853, 73928 |
| ~2221 `_calPostLinearComment` — legacy transport leg only | DELETE-NOW | Only direct legacy dispatch leg ~2287–2295. Client gateway context or crosswalk failure can still enter it even with roster enrolled; requires source-save/recovery-preserving retirement. | 28002, 33408, 35302, 35653, 48471, 49873, 49903, 74401, 83836, 83916 |
| ~3125 `_calLinearMetaByIdent` | AFTER-STEP-7 | Linear metadata cache/constants, paired with the reader in 150. Preserve native seal behavior while removing reader-owned state. | 36557, 36591, 36601, 36609, 36659, 36847, 36849, 36856 |
| ~3135 `CAL_LINEAR_META_LS_KEY` | AFTER-STEP-7 | Linear metadata cache/constants, paired with the reader in 150. Preserve native seal behavior while removing reader-owned state. | 36567, 36584, 36602 |
| ~3136 `CAL_LINEAR_META_TTL_MS` | AFTER-STEP-7 | Linear metadata cache/constants, paired with the reader in 150. Preserve native seal behavior while removing reader-owned state. | 36568, 36586 |
| ~3137 `CAL_LINEAR_META_FORCE_MIN_MS` | AFTER-STEP-7 | Linear metadata cache/constants, paired with the reader in 150. Preserve native seal behavior while removing reader-owned state. | 36569, 36815 |
| ~3117 `_calParentLinks` | AFTER-STEP-7 | Linear metadata cache for parent-link banners; remove with 150 reader and banner consumers. | 36549, 36556, 36587, 36602, 36608, 36626, 36658, 36852, 36857, 36879, 36895, 36900 |
| ~3143 `_calLinearStatusMetaAt` | AFTER-STEP-7 | Reader cache timestamp; remove with _calRefreshParentLinkFlags. | 36575, 36815, 36835 |
| ~3144 `_calLinearStatusMetaSig` | AFTER-STEP-7 | Reader cache signature; remove with _calRefreshParentLinkFlags. | 36576, 36815, 36834 |
| ~3145 `_calStatusMetaUnsupported` | AFTER-STEP-7 | Reader support flag; not a cutoff flag. Remove with _calRefreshParentLinkFlags. | 36577, 36812, 36830 |


### `src/index/150-calendar-hydration-import.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~1 `_calHydrateLinearMeta` | AFTER-STEP-7 | Linear status/meta reader or its dedicated cache/banner. Native seals suppress most reads; _calReconcileLinearStatuses is only skipped by _calV2Ready and v2 can be disabled. Not globally unreachable; remove reader path with its callers after replacement. | 36578, 36777, 38624, 74674 |
| ~19 `_calPersistLinearMeta` | AFTER-STEP-7 | Linear status/meta reader or its dedicated cache/banner. Native seals suppress most reads; _calReconcileLinearStatuses is only skipped by _calV2Ready and v2 can be disabled. Not globally unreachable; remove reader path with its callers after replacement. | 36596, 36864 |
| ~28 `_calPruneLinearMetaForAuthority` | AFTER-STEP-7 | Linear status/meta reader or its dedicated cache/banner. Native seals suppress most reads; _calReconcileLinearStatuses is only skipped by _calV2Ready and v2 can be disabled. Not globally unreachable; remove reader path with its callers after replacement. | 36605, 74673 |
| ~59 `_calLinearMissingForCard` | AFTER-STEP-7 | Linear status/meta reader or its dedicated cache/banner. Native seals suppress most reads; _calReconcileLinearStatuses is only skipped by _calV2Ready and v2 can be disabled. Not globally unreachable; remove reader path with its callers after replacement. | 36636, 36780, 42300 |
| ~198 `_calRefreshParentLinkFlags` | AFTER-STEP-7 | Linear status/meta reader or its dedicated cache/banner. Native seals suppress most reads; _calReconcileLinearStatuses is only skipped by _calV2Ready and v2 can be disabled. Not globally unreachable; remove reader path with its callers after replacement. | 36633, 36775, 39105, 39110 |
| ~305 `_calSyncStatusFromLinear` | AFTER-STEP-7 | Linear status/meta reader or its dedicated cache/banner. Native seals suppress most reads; _calReconcileLinearStatuses is only skipped by _calV2Ready and v2 can be disabled. Not globally unreachable; remove reader path with its callers after replacement. | 36882, 42069, 42187, 42232 |
| ~376 `_calReconcileLinearStatuses` | AFTER-STEP-7 | Linear status/meta reader or its dedicated cache/banner. Native seals suppress most reads; _calReconcileLinearStatuses is only skipped by _calV2Ready and v2 can be disabled. Not globally unreachable; remove reader path with its callers after replacement. | 36953, 39104 |
| ~472 `openCalLinearImport` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37049, 39744 |
| ~481 `closeCalLinearImport` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37058, 37070, 37082, 37100, 37186, 37264, 37309, 37317, 37319, 39798 |
| ~486 `_calRenderLinearImportStart` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37056, 37063, 37098, 37120, 37152, 37201 |
| ~516 `_calLinearImportFetch` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37083, 37089, 37091, 37093 |
| ~578 `_calRenderLinearSubPick` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37150, 37155, 37210, 37239 |
| ~628 `_calSubToggle` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37176, 37205 |
| ~632 `_calInvertSubOrder` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37193, 37209 |
| ~635 `_calSubDragStart` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37173, 37212 |
| ~641 `_calSubDragOver` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37173, 37218 |
| ~647 `_calSubDragLeave` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37173, 37224 |
| ~650 `_calSubDragEnd` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37173, 37227, 37236 |
| ~655 `_calSubDrop` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37173, 37232 |
| ~664 `_calRunLinearImport` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37202, 37241 |
| ~748 `_calBulkLinkSubs` | AFTER-STEP-7 | State used solely by dedicated bulk Linear linking cluster; remove after reader/UI consumers. | 37325, 37342, 37449, 37462, 37467, 37469, 37481, 37482, 37552, 37566, 37578, 37579, 37602, 37645 |
| ~749 `_calBulkLinkParent` | AFTER-STEP-7 | State used solely by dedicated bulk Linear linking cluster; remove after reader/UI consumers. | 37326, 37343, 37450, 37515, 37646 |
| ~750 `_calBulkLinkGraphicParent` | AFTER-STEP-7 | State used solely by dedicated bulk Linear linking cluster; remove after reader/UI consumers. | 37327, 37451, 37483, 37516, 37549 |
| ~751 `_calBulkLinkPosts` | AFTER-STEP-7 | State used solely by dedicated bulk Linear linking cluster; remove after reader/UI consumers. | 37328, 37344, 37362, 37462, 37464, 37481, 37484, 37507, 37508, 37528, 37539, 37542, 37543, 37550, 37556, 37561, 37565, 37566, 37578, 37579, 37647 |
| ~752 `openCalBulkLinearSync` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37329, 39745 |
| ~761 `_calOpenBulkLinkOverlay` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37338, 41517 |
| ~777 `closeCalBulkLinkOverlay` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37354, 37368, 37380, 37398, 37522, 37586, 37635, 37640, 39801, 46533 |
| ~782 `_calRenderBulkLinkStart` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37352, 37359, 37396, 37418, 37455, 37534 |
| ~814 `_calBulkLinkFetch` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37381, 37387, 37389, 37391 |
| ~881 `_calBulkLinkNormName` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37458, 37465, 37467, 37471 |
| ~884 `_calBulkLinkAutoMatch` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37452, 37461 |
| ~902 `_calRenderBulkLinkMatch` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37453, 37479 |
| ~961 `_calBulkLinkPick` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37504, 37538 |
| ~1000 `_calBulkLinkApply` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37250, 37535, 37577 |
| ~1062 `_calBulkLinkFinish` | AFTER-STEP-7 | Dedicated Linear import/bulk-link cluster. Fetches read LINEAR_SUBISSUES_URL; apply is sealed under current authority, but opening/fetching remains reachable. Remove cluster together after Step 7, preserving generic CSV/sheet import and shared upsert. | 37597, 37637, 37639 |

### `src/index/160-calendar-organize-ui.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~2193 `_calLinearSlotHtml` — external href rendering only | DELETE-NOW | Stored-URL external-link rendering still exists after sealing. Remove only Linear external anchors/mark, preserving native link controls and existing-link clearing; not an unused whole renderer. | 28418, 41646, 41933, 41934 |
| ~2479 `_calLinearPileHtml` — external href rendering only | DELETE-NOW | Stored-URL external-link rendering still exists after sealing. Remove only Linear external anchors/mark, preserving native link controls and existing-link clearing; not an unused whole renderer. | 41932, 41955, 42371 |
| ~2592 `_calLinearCommit` — nonempty legacy paste/read branch only | AFTER-STEP-7 | Nonempty pasted-link path invokes Linear status reader only after live seal permits it. Clearing existing links remains supported; retain that branch. | 41980, 41992, 41999, 42035, 42045, 42222 |

### `src/index/170-calendar-links-status.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~1430 `_calLegacyPushStatusToLinear` — call site in source-save path; symbol defined in 140 | DELETE-NOW | Extra direct sender call at source-save completion. Must be removed with 140 sender while preserving confirmed source save and diagnostics. | 35499, 35583, 43600 |
| ~1937 `_calLegacyVideoEditorPool` | RETAIN | Reads native team_members roster, despite its name; called on provider/unsupported gateway response. Not exclusively Linear transport. | 44080, 44094, 44107 |

### `src/index/200-intake-data-startup.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~546 `_linearSubmissionHoldSnapshot` | RETAIN | Active hold/recovery compatibility; retired discovery now reports a visible hold rather than querying Linear. Do not silently remove pending-job handling. | 50996, 51013, 51053, 51746, 51892 |
| ~662 `_linearReceiptStoreRead` | RETAIN | Active hold/recovery compatibility; retired discovery now reports a visible hold rather than querying Linear. Do not silently remove pending-job handling. | 51112, 51234, 51276, 51374 |
| ~692 `_linearTargetForTeam` — url fields only | DELETE-NOW | Legacy endpoint-selection fields only; helper also formats recovery labels. Remove URL fields only after legacy sender retirement; keep label/recovery consumers. | 51142, 51228, 51254, 51295, 51516, 51552, 51586, 51602 |
| ~875 `_linearAwaitCreate` | DELETE-NOW | Orphan legacy webhook submission chain: submitLinearForm calls _submitLinearFormRoutedOnce, which holds instead of calling this chain. _submitLinearFormLegacy has no executable caller. Remove internal network chain; preserve active hold/receipt recovery. | 51325, 51552 |
| ~973 `_submitLinearFormOnce` | DELETE-NOW | Orphan legacy webhook submission chain: submitLinearForm calls _submitLinearFormRoutedOnce, which holds instead of calling this chain. _submitLinearFormLegacy has no executable caller. Remove internal network chain; preserve active hold/receipt recovery. | 51423, 51664, 52295 |
| ~1213 `_submitLinearFormLegacy` | DELETE-NOW | Orphan legacy webhook submission chain: submitLinearForm calls _submitLinearFormRoutedOnce, which holds instead of calling this chain. _submitLinearFormLegacy has no executable caller. Remove internal network chain; preserve active hold/receipt recovery. | 51663, 52296 |
| ~1438 `_linearResumeSubmissionHold` | RETAIN | Active hold/recovery compatibility; retired discovery now reports a visible hold rather than querying Linear. Do not silently remove pending-job handling. | 51888, 68287, 74639, 74640 |
| ~1849 `_writeLinearVideoCardsToCalendar` | RETAIN | Active hold/recovery compatibility; retired discovery now reports a visible hold rather than querying Linear. Do not silently remove pending-job handling. | 15190, 15195, 51625, 52299, 52421 |
| ~719 `_linearConfirmedCreate` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51169, 51351 |
| ~734 `_linearConfirmedReceived` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51184, 51352 |
| ~714 `_linearResponseParentId` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51164, 51175, 51205, 51359 |
| ~746 `_linearSafeReceiptRef` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51196, 51211, 51318, 51360, 51540, 51548, 51579 |
| ~759 `_linearReceiptFailure` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51209, 51345, 51347, 51354, 51366 |
| ~766 `_linearCreateError` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51216, 51354 |
| ~783 `_linearPrepareReceipts` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51233, 51453 |
| ~923 `_linearApplyReceiptOutcomes` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51373, 51584 |
| ~698 `_linearSelectedTeams` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51148, 51435 |
| ~705 `_linearReceiptKey` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51155, 51256, 51296 |
| ~776 `_linearRecoveryIdText` | DELETE-NOW | Only called/referenced within the orphan legacy Submit chain; remaining references listed. Remove with that chain, preserving the separately retained native hold/recovery entry points. | 51226, 51587, 51603, 51650 |


### `src/index/260-production-refresh-boot.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~1853 `_writeUiCancelClientLegacyRetryTimers` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 67972, 67984 |

### `src/index/270-samples-model.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~33 `SXR_LINEAR_OUTBOX_KEY` | RETAIN | Browser-local pending debt key is still resumed; not a server mirror_outbox writer. | 68328, 73517, 73518, 74602 |
| ~1121 `_sxrLinearSlotHtml` — external href rendering only | DELETE-NOW | Stored-URL external-link rendering still exists after sealing. Remove only Linear external anchors/mark, preserving native link controls and existing-link clearing; not an unused whole renderer. | 69416, 69983, 69984 |
| ~1687 `_sxrLinearPileHtml` — external href rendering only | DELETE-NOW | Stored-URL external-link rendering still exists after sealing. Remove only Linear external anchors/mark, preserving native link controls and existing-link clearing; not an unused whole renderer. | 69982, 70828 |
| ~1847 `_sxrLinearCommit` — nonempty legacy paste/read branch only | AFTER-STEP-7 | Nonempty pasted-link path invokes Linear status reader only after live seal permits it. Clearing existing links remains supported; retain that branch. | 70100, 70135, 70142, 70267 |

### `src/index/280-samples-cards-notes.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~687 `_sxrLinearUrlFor` | RETAIN | Persisted identity accessor shared with native save/recovery; not a URL builder. | 33516, 33818, 34438, 34665, 71678, 72401, 73068, 74400, 75375, 75433 |
| ~2526 `_sxrLinearOutboxRead` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33434, 73517, 73571, 73875, 73876, 74644, 74755, 74778 |
| ~2527 `_sxrLinearOutboxWrite` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 33437, 73518, 73875 |
| ~2528 `_sxrLinearOutboxEnqueue` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 73519, 73895, 73917 |
| ~2547 `_sxrLinearOutboxScheduleRetry` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34919, 73535, 73538, 73871 |
| ~2555 `_sxrLinearOutboxFlush` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 34928, 73543, 73546, 74649, 74661 |
| ~2574 `_sxrLinearOutboxFlushRun` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 73555, 73565 |
| ~2773 `_sxrLinearOutboxFlushRun` — network dispatch branches only | DELETE-NOW | Obsolete direct fetch and legacyOnly gateway legs ~2773–2840. Preserve source-save reconciliation, pending debt and quarantine. | 73555, 73565 |
| ~2887 `_sxrLinearPushLatest` | DELETE-NOW | Only legacy status latest-wins state. Remove with _sxrLegacyPushStatusToLinear; shared _sxrLinearPushChain stays. | 73878, 73883, 73885 |


### `src/index/290-samples-writes-review.js.part`

| Fragment line / symbol / scope | Timing | Reason and remaining-use boundary | Assembled `index.html` references |
|---|---|---|---|
| ~1 `_sxrLegacyPushStatusToLinear` | DELETE-NOW | Obsolete direct n8n sender still has wrapper callers. Client/unlinked comment fallback remains reachable; retire only with source-save and recoverable pending debt intact. | 71500, 73879, 73945, 75435 |
| ~25 `_sxrLegacyPostLinearComment` | DELETE-NOW | Obsolete direct n8n sender still has wrapper callers. Client/unlinked comment fallback remains reachable; retire only with source-save and recoverable pending debt intact. | 73903, 74027, 75440 |
| ~47 `_sxrPushStatusToLinear` — legacy transport branch only | DELETE-NOW | Only legacy transport leg. Native gateway/repair path is active; comments can still enter fallback on missing canonical context. | 70513, 71154, 71372, 71396, 73925, 74826, 75414 |
| ~93 `_sxrPostLinearComment` — legacy transport branch only | DELETE-NOW | Only legacy transport leg. Native gateway/repair path is active; comments can still enter fallback on missing canonical context. | 35742, 71679, 72401, 72717, 73058, 73068, 73971, 74400, 75383 |
| ~742 `_writeUiResumeLegacyQueues` | RETAIN | Still wired local debt/lease/source-save/quarantine/replay machinery. Browser-local outstanding debt was not measured; do not discard it or its native recovery. Remove only the separately listed network branches. | 25224, 25379, 68169, 74620, 74747, 74748, 74749, 74768, 74769, 74770 |
| ~912 `_sxrSyncStatusFromLinear` | AFTER-STEP-7 | Remaining pasted-link reader; current live seal blocks nonempty writes, not arbitrary direct invocation. Remove with 270 nonempty paste branch. | 70161, 70272, 70330, 71154, 74790 |
| ~936 `_sxrLinearReassertAt` | DELETE-NOW | Reassert helper has no executable caller in assembled page; timer/map only feed it. Unlike Calendar twin, this whole orphan cluster can be removed. | 74814, 74824, 74825 |
| ~937 `SXR_LINEAR_REASSERT_MS` | DELETE-NOW | Reassert helper has no executable caller in assembled page; timer/map only feed it. Unlike Calendar twin, this whole orphan cluster can be removed. | 74815, 74824 |
| ~938 `_sxrReassertLinearStatus` | DELETE-NOW | Reassert helper has no executable caller in assembled page; timer/map only feed it. Unlike Calendar twin, this whole orphan cluster can be removed. | 74816 |

## Deferred server dependency (not a fragment count)

`scripts/native-brief-media-copy.mjs`: Linear re-fetch is `AFTER-STEP-7`; roadmap B2 requires real `apply` before key revocation. Preserve the tool, credentials and existing asset references until that owner/Storage gate is satisfied. Browser comment attachments and description media in 230/240/250 remain native/history display paths; do not remove `uploads.linear.app` references as dead code or imply copied media is verified. `linear-inbound`, `linear-outbound`, drain workflows and secrets belong to B2, not this browser inventory.

## Counts per fragment

Counts are **rows/removal units**, not number of functions or estimated lines to delete. A shared function can have a removable branch row and a retained recovery row. Zero means no exclusively Linear/legacy-transport removal unit identified by these sweeps, not absence of the word Linear.

| Fragment (`src/index/`) | DELETE-NOW | AFTER-STEP-7 | RETAIN / not dead |
|---|---:|---:|---:|
| `000-head.html.part` | 0 | 0 | 0 |
| `005-head-boot.html.part` | 0 | 0 | 0 |
| `010-styles-foundation.css.part` | 0 | 0 | 0 |
| `020-styles-surfaces.css.part` | 0 | 0 | 0 |
| `030-body-shell.html.part` | 0 | 0 | 0 |
| `040-shared-briefs.js.part` | 0 | 0 | 0 |
| `050-market-briefs.js.part` | 0 | 0 | 0 |
| `060-templates-filming.js.part` | 2 | 5 | 0 |
| `070-workload-source.js.part` | 0 | 8 | 9 |
| `080-workload-render.js.part` | 1 | 1 | 3 |
| `090-workload-popovers-navigation.js.part` | 0 | 3 | 0 |
| `100-onboarding-staff-controls.js.part` | 2 | 3 | 0 |
| `110-time-off-reports.js.part` | 0 | 0 | 0 |
| `120-calendar-flags-write-repair.js.part` | 1 | 0 | 10 |
| `130-calendar-model-cache.js.part` | 0 | 4 | 7 |
| `140-calendar-legacy-outbox.js.part` | 7 | 8 | 53 |
| `150-calendar-hydration-import.js.part` | 0 | 35 | 0 |
| `160-calendar-organize-ui.js.part` | 2 | 1 | 0 |
| `170-calendar-links-status.js.part` | 1 | 0 | 1 |
| `180-calendar-native-post-media.js.part` | 0 | 0 | 0 |
| `190-calendar-approval-comments.js.part` | 0 | 0 | 0 |
| `200-intake-data-startup.js.part` | 15 | 0 | 4 |
| `210-production-state-writes.js.part` | 0 | 0 | 0 |
| `220-production-attribution-views.js.part` | 0 | 0 | 0 |
| `230-production-create-comments.js.part` | 0 | 0 | 0 |
| `240-production-description.js.part` | 0 | 0 | 0 |
| `250-production-controls-data.js.part` | 0 | 0 | 0 |
| `260-production-refresh-boot.js.part` | 0 | 0 | 1 |
| `270-samples-model.js.part` | 2 | 1 | 1 |
| `280-samples-cards-notes.js.part` | 2 | 0 | 7 |
| `290-samples-writes-review.js.part` | 7 | 1 | 1 |
| `300-tiktok-upload.js.part` | 0 | 0 | 0 |
| `310-tiktok-pilot-sales.js.part` | 0 | 0 | 0 |
| `320-kasper-dashboard-replies.js.part` | 0 | 0 | 0 |
| `330-kasper-review-history.js.part` | 0 | 0 | 0 |
| `340-editors-date-picker.js.part` | 0 | 0 | 0 |
| `350-footer.html.part` | 0 | 0 | 0 |
| **Total: 37 fragments** | **42** | **70** | **97** |

## Suggested B1 PR order — smallest and safest first

1. **290 orphan reassert cluster:** `_sxrReassertLinearStatus`, `_sxrLinearReassertAt`, `SXR_LINEAR_REASSERT_MS`; zero executable caller, no remaining reader dependency. Do not include the active Calendar twin.
2. **200 orphan legacy Submit sender chain:** retire `_submitLinearFormLegacy` / `_submitLinearFormOnce` / `_linearAwaitCreate`; prune 060 endpoint constants and 200 URL fields only after their reference closure. Preserve held drafts, receipt identities and visible recovery.
3. **External navigation, one feature per PR:** 080, then 160/270 external Linear anchors. Keep local Sync navigation and link clearing. These anchors are reachable UI, so explicitly review the intended navigation removal rather than claiming no behavior change.
4. **120/140 Calendar parity and transport legs, coordinated with 170 call site:** first remove dead Linear-authority parity retry branches, then close reachable legacy dispatch with source-save/debt preservation. Keep native `_calPushStatusToLinear`, `_calPostLinearComment`, reassert and the shared push chain. Client-context fallback is an acceptance blocker, not evidence of deadness.
5. **280/290 Samples transport legs:** same receipt/source-save/client-fallback proof. Retain local ledger and recovery machinery. Delete 100 status/comment endpoint constants only when both surfaces have no remaining references.
6. **Stop before reader rows:** 060 project source, 070/090 foreign Workload reads, 100 reader endpoints and 140/150/160/270/290 reader clusters remain AFTER-STEP-7. Revisit explicit RETAIN rows only on new proof; Step 7 does not erase local debt or replace foreign Workload rows.

Every B1 PR must grep removed symbols in the assembled page, run `npm run check:index`, `node test/run-all.js` and the browser gate, record page bytes before/after, and receive Codex review. This audit changes no code and establishes no live deletion/credential/merge authorization.

Token usage: this runtime exposes no session token counter; exact usage and a reliable total estimate are unavailable.
