# SyncLinear replacement / Linear exit strategy

Status: analysis-only PR. No production behaviour, database row, runtime flag, Edge Function, n8n workflow, or client link was changed.

Repository base independently audited: 00d0e8883f754dd03676216e23a602a9e5bd353c (origin/main, 2026-09-03).

## Non-negotiable outcome

The goal is not to delete work or merely remove a provider integration. SyncLinear must serve every capability that still matters before Linear is switched off. The hard acceptance criterion is the client share-link experience: a client must continue to load content, approve, request tweaks, and write notes/comments throughout every migration step.

The frozen client-writer rule controls this document. Calendar and Sample Review writers must remain open/tokenless for the existing share-link population unless the owner explicitly authorizes a fresh-link reissue for every active client. Re-gating them previously produced client-wide 401s. Evidence: AGENTS.md:3-14.

## Phase 1 — independent blind audit

This section was written before opening the prior branch, the prior exit-plan documents, or the named Open Repairs entries. It is a frozen record of the independent evidence used for Phase 2.

### Method and evidence limits

1. I traced from route mounts, visible controls, and real event handlers to the eventual browser fetch or Edge Function operation. A literal near a function is not treated as proof that the function is reachable. Each surface below distinguishes always-called, conditional, dormant, and unproven paths.
2. I inspected the live n8n published graphs read-only. For simple webhook/schedule graphs, reachability was checked from the real trigger through active connection edges to a direct Linear API node. For complex graphs, node presence alone is not treated as a call proof; conditional predicates and request payloads remain explicitly marked where not run.
3. I performed public, read-only REST measurements using the browser's published configuration. Counts are aggregates only; no display names, client slugs, share tokens, or row contents are recorded here. Anonymous RLS visibility is not equivalent to privileged operational completeness.
4. I read the runtime-flag rows live. A healthy flag value proves only the normal branch at that instant. It does not make a source-defined timeout/failure branch unreachable.
5. Source is not production proof for manual/no-CI Edge Functions. The deploy manifest says exactly that: no CI deploy path means this repository has no deployment path; it says nothing by itself about the serving revision. Evidence: docs/ops/EF_DEPLOY_MANIFEST.md:3-7.
6. No real approval, comment, tweak, intake, flag-failure injection, or deployed-function source fingerprint was executed. Any conclusion requiring one is labelled UNPROVEN.

### Read-only live snapshot

The following measurements were taken on 2026-09-03 between 20:55Z and 21:10Z. They are point-in-time evidence, not a release certification.

| Measurement | Result | What it proves / does not prove |
| --- | ---: | --- |
| Active roster versus each of calendar-upsert cohort, Sample Review cohort, and write-UI reroute cohort | 43 versus 43; zero aggregate difference | The normal healthy browser route currently selects the cohort for every active client. It does not prove flag-read failure is safe. |
| Production authority | video = SyncView; graphics = SyncView | Both teams are configured SyncView-authoritative at this moment. It does not prove every code path actually reads that value before calling Linear. |
| Client-comment gateway | enabled | The intended native comment route is on. It does not prove every comment type is eligible for it. |
| Linear outbound | mode = live | Native commits are still configured to create/drain Linear mirror work. This is positive evidence that Linear cannot be removed tonight. |
| Legacy parity / public intake | enabled / enabled | There is still a legacy lane and an externally reachable public intake lane. |
| Calendar rows readable anonymously | 9,822 total; 783 non-archived | A public-source measurement only; it is not a privileged completeness audit. |
| Sample Review rows readable anonymously | 6,594 total; 19 non-archived | Same limitation. |
| Non-archived Calendar component slots | 1,354 non-empty legacy-link slots; 1,157 non-empty native-deliverable slots; 197 legacy-link-without-native slots | There is historic/current linkage debt under a broad non-archived definition. It does not say all 197 are currently actionable. |
| Non-archived Sample component slots | 23 non-empty legacy-link slots; 23 native-deliverable slots; zero legacy-link-without-native slots | Under this broad definition, Samples has no corresponding live legacy-only slot. |
| Existing actionable-link classifier | 114 actionable Calendar components and 7 actionable Sample components had a native ID; zero lacked one | This is encouraging for the current reviewable subset. It does not prove every action reaches or is accepted by the deployed gateway. The classifier's definition is source documented at scripts/calendar-native-link-gap-check.js:3-43. |
| Deliverables visible anonymously | 6,303 rows; 6,300 have both a Linear UUID and Linear URL; 3 have neither; all reported sync_state = clean | SyncLinear has a large native record set, but nearly every visible deliverable still carries Linear identity. This does not prove that all Linear work has a native row. |
| Workload sources visible anonymously | 2,018 active rows in workload_issues; 6,349 active rows in workload_issues_native_v1 | The two sources have materially different active populations, so a source swap cannot be inferred safe from counts alone. |
| Native-work visibility check | 21 real-client rows classified invisible to their owner: 5 inactive mirror, 6 never imported, 10 parked by name; exit non-zero against the script's baseline | Workload is not safe to use as a Linear-free source today. The script is read-only and explicitly models the population the screen renders: scripts/workload-native-visibility-check.js:1-15, :95-99, :236-335. |

The anonymous reader could not read production_comments, workload_plan, or privileged mirror_outbox state. Those fields are not assumed empty; they are UNPROVEN until a private, privileged preflight captures them.

### Immediate conclusion

Linear cannot be switched off tonight without client-visible risk.

This conclusion has four independent bases:

1. Client Calendar/Sample writes deliberately fall back to legacy n8n/Linear transports if the routing-flag read is slow, absent, or malformed. This is a reachable fault branch, not an always-called branch. Evidence: index.html:25073-25138, :25537-25549, :32134-32251, :64948-65123.
2. A native write under the currently live outbound mode commits SyncLinear first and then schedules a Linear mirror asynchronously. Evidence: supabase/functions/production-write/index.ts:5434-5471, :1659-1666; live flag snapshot above.
3. Native/public intake calls Linear project validation before it evaluates SyncView authority. If the audited source is deployed, a Linear shutdown turns the public native intake into a pre-write 503. Evidence: supabase/functions/production-write/index.ts:5953-6009, :2398-2423, :2213-2226, :2176-2197. Deployment state is UNPROVEN because production-write is manual/pinned deployment only. Evidence: docs/ops/EF_DEPLOY_MANIFEST.md:45.
4. The Workload reader and background reconcile still use Linear-derived identity/population; its own native visibility check is red. Evidence: index.html:13915-13923, :14095-14112, :14407-14446; scripts/workload-native-visibility-check.js:1-15, :236-335.

The encouraging counter-fact is real but insufficient: client content reads are primarily native Calendar/Sample REST reads, and the presently actionable review subset has native IDs. Evidence: index.html:34584-34620, :60922-61040; live aggregate above.

## Reachability map

### Client share-link surfaces

| Surface and actor | Reachable entry and actual chain | Linear involvement | If Linear were unavailable tonight | Evidence / confidence |
| --- | --- | --- | --- | --- |
| Share-link bootstrap, client | Verified link -> client-token-verify -> allowed client route initialization. Current routes are analytics, calendar, brief, and sample-reviews; legacy v=samples is normalized to sample-reviews. | No demonstrated direct browser Linear call. | If the verifier remains healthy, Linear alone should not prevent entry. If verifier fails, the client sees an explicit verification/no-data retry screen. Serving verifier revision is UNPROVEN. | index.html:59765-59770, :59818-60056, :59979-59996, :59454-59470; manifest: docs/ops/EF_DEPLOY_MANIFEST.md:30. |
| Client Calendar content | Verified client Calendar mount -> Calendar v2 direct read of calendar_posts -> n8n calendar-get fallback/cache/error presentation. A reachable v1 lane is selected by the sticky `?v2=0` kill switch. | V2 parent/project/due/editor enrichment calls linear-issue-statuses after foreground load; source catches failure and uses it for display metadata, not the primary card read. Separately, the reachable v1 lane invokes LINEAR_STATUSES_URL, maps provider statuses, and flushes them back to the source; that is a gated client-load provider dependency, not decoration. Deliverable-link adoption can repopulate legacy link fields if its predicate matches. | V2 cards should continue to display through healthy native reads; decorations can become stale or absent. When v1 is selected, its provider-status fetch/flush cannot complete if Linear is unavailable. Prevalence of the v1 lane, deployed n8n fallback behavior, and any current adoption trigger are UNPROVEN. | index.html:59402-59451, :34489-34620, :34815-35283, :32931-33115, :33197-33289, :35264-35270. |
| Client Calendar approve/tweak status | Client review handler -> shared Calendar flush -> native production-write when reroute/gateway conditions are true, otherwise legacy linear-set-status. | Native path is still mirrored asynchronously while outbound is live. Routing failure permits legacy n8n/Linear status send after source persistence. | Healthy native path can preserve the source action, but its provider mirror is pending. Under routing failure, the client can see a saved approval/tweak while the legacy delivery fails and is locally queued. That violates the no-silent-failure requirement. | index.html:43466-44020, :39161-39634, :32134-32251, :39530-39541, :32161-32168; supabase/functions/production-write/index.ts:5434-5471. |
| Client Calendar plain note | Client plain-comment handler -> Calendar source writer. | Caption/title-only comments are source-only; not every note calls Linear. | These notes should remain if the frozen writer remains available. Exact deployed writer behaviour is UNPROVEN. | index.html:43596-43635, :32287-32311; AGENTS.md:3-14; manifest: docs/ops/EF_DEPLOY_MANIFEST.md:26. |
| Client Calendar component note / tweak request | Composer or tweak handler -> _calPostLinearComment -> native canonical comment route only if its exact gate/crosswalk is ready; otherwise legacy linear-add-comment. | Conditional native/legacy transport. The conditional matters: neither all comments nor none are legacy. | Healthy native canonical comments can persist in SyncLinear, but live outbound still mirrors applicable comments. The fallback can show a source save while legacy delivery is queued/failed. | index.html:32287-32400, :43637-43853, :44984-45151, :54715-54785. |
| Client Sample Reviews content | Verified sample-reviews route -> sample_reviews REST -> n8n fallback/cache/error state. | No direct primary browser Linear read was proven. | Healthy native reads preserve reviewable content. **Correction after the deeper trace:** the fallback does not validate its HTTP response or payload shape and can cache/render a false empty success. This is a P0 cutover blocker; see `docs/audits/2026-09-03-synclinear-linear-exit-deep-dive.md`. | index.html:59454-59470, :60922-61040, :64300-64337. |
| Client Sample Reviews approve/tweak/status | Client review action -> Sample flush -> native gateway if routed; otherwise legacy linear-set-status. | Conditional fallback to legacy; linked canonical-comment gate specifically remains fail-closed native rather than falling back in every case. | Same outage risk as Calendar for status and fallback comment paths. The live actionable subset had native IDs, but that is not a deployed execution test. | index.html:62369-62642, :62834-63736, :64948-65124, :65087-65091. |
| Public Submit/intake | ?intake=1 locks to Submit -> submitLinearForm -> routed native intake_create only when reroute state resolves; receipt/state/cohort fallback selects legacy video/graphic n8n form paths. | Submit always attempts the legacy linear-projects read on a cold project list. Native gateway then invokes Linear project validation before authority. Legacy fallback goes to Linear-target workflows. | A healthy, deployed native route may create native rows, but still has a live Linear mirror. A routing failure/legacy receipt produces visible failure or incomplete/retry behaviour. If source head production-write is deployed, even native public intake 503s before native write when Linear is off. | index.html:13678-13681, :13790-13839, :46463-46755, :46765-46895, :60086-60165; production-write evidence above. |
| Old client Samples module | Source exists but the ordinary strict client route directs samples to sample-reviews before the old module mount. | No demonstrated active client browser Linear call. | It is legacy/dead-end source, not evidence of a supported current client surface. Direct invocation outside the normal router is UNPROVEN. | index.html:20751, :20890-20900, :19654-19664. |

### Staff surfaces

| Surface and actor | Reachable entry and actual chain | Linear involvement | If Linear were unavailable tonight | Evidence / confidence |
| --- | --- | --- | --- | --- |
| Submit, staff | Header Submit -> #linear -> same form and routed intake chain as public Submit. It also loads the legacy project endpoint on a cold list. | Native route has the pre-authority project validation; old receipts/non-cohort use legacy n8n intake. | Staff sees explicit incomplete/retry failure in legacy routes; native source can also fail if the deployed gateway is the audited revision. Client/public intake is more serious because there is no staff available to explain it. | index.html:7807-7810, :20853-20858, :13790-13839, :46719-46895; supabase/functions/production-write/index.ts:5953-6009. |
| Filming Plans, staff | #filming-plans -> staff-gated filming-plans Edge Function GET/POST. | No direct browser Linear call found. Calls named updateLinearFilmingPlan only update the Submit UI with the native plan data. | No proven direct Linear outage on this surface. Deployed Edge Function transitive behaviour is UNPROVEN, although it has a main-push deploy path. | index.html:8392-8402, :13385-13580, :20869-20873; supabase/functions/filming-plans/index.ts:1-146; manifest: :32. |
| Content Calendar / SMM | #calendar -> shared Calendar engine. Staff Create Post enters native intake when rerouted; otherwise adds a local/source card through Calendar writer. | Status/comment/tweak branches inherit the same native-or-legacy routing. Successful native Create Post explicitly reports a draining Linear mirror. | A flag-read outage can push staff creation/status/comment activity into n8n/Linear. This is staff-visible, but it can create a card that looks created while the intended work item is not. | index.html:40725-40973, :40936-40950, :32134-32400, :25087-25141. |
| Create Post — Calendar | addCalBlankCard is a real staff entry. Rerouted staff opens _calOpenNativePost, which submits intake_create. Client use only makes a collaborative blank suggestion, not a production work item. | intake_create has the Linear project validation and live mirror. Non-rerouted staff gets source/local fallback rather than native work creation. | Must not switch provider off until native-only creation has a provider-free mapping and every old/local result is either materialized or visibly recoverable. | index.html:40812-40973, :46719-47141; supabase/functions/production-write/index.ts:5997-6009. |
| Create Post — Samples | addSxrBlankCard is staff-only for actual creation and delegates to the same native dialog. | Same intake project-validation and mirror dependency. | Same blocker. It does not create a subissue directly from Production. | index.html:61968-62000, :40458-40951. |
| SyncLinear / Production board | #production -> native production projections/REST -> production-write for native committed writes; production-comments for thread reads. Ordinary client navigation is rejected. | Browser normal reads/writes do not directly fetch Linear. The server still has direct Linear dependencies: label catalogue/read and label write call Linear even under SyncView authority; all native mutations schedule a Linear mirror while mode is live. | Board data may render, but label reads/edits fail if the audited manual gateway is live. Other writes can commit natively and accumulate failed mirror work until the mirror is retired. | index.html:20729-20848, :20859-20863, :48368-48536, :53063-53149, :53649-53729; supabase/functions/production-write/index.ts:4636-4676, :5175-5221, :5434-5471. |
| SyncLinear create/subissue controls | Production creation is deliberately closed before its dormant creation code. The UI tells staff to create posts from Calendar/Samples. | The dead code below the unconditional production_create_closed throw contains Linear state/catalog work, but it is not reachable through the normal UI. | The stated constraint is presently upheld by normal UI: no Production-created subissue. Backend direct callers were not authenticated/tested, so absence of an external caller is UNPROVEN. | index.html:52200-52256, :47770-47796; supabase/functions/production-write/index.ts:3455-3488. |
| Workload | #workload -> default v2 workload_issues REST read. Manual/forced refresh bypasses it to linear-issues. The native parallel view is diagnostic only; it never renders the board. | n8n reconcile repopulates workload_issues from Linear every 10 minutes; fallback/forced refresh calls linear-issues. Tweak popover reads linear-tweak-comments. Linear-authority deadline edit uses workload-linear; SyncView authority deadline edit uses production-write. | Cached/mirrored rows may display, but forced refresh, manual refresh, residual authority path, tweak comment preview, and source population fail. The native active population does not match the Linear-derived one, and visibility gate is red. | index.html:13915-13951, :14095-14112, :14114-14135, :14407-14446, :14873-15055, :17025-17160, :18989-19039; live measurements above. |
| Kasper review board | Feature-gated Kasper route -> Calendar REST/n8n fallback. Internal plain notes persist source data; tweak requests use _calPostLinearComment; status persistence uses _calPushStatusToLinear. | Inherits Calendar native-versus-legacy branch. | Healthy native path may continue, but a flag outage reopens legacy status/comment delivery. Non-review Kasper subtab dependencies were not fully traced. | index.html:59481-59503, :72812-73040, :73868-73951, :74113-74272. |
| TikTok upload / TikTok pilot | Reachable staff-gated browser forms post their own n8n webhooks. | No direct browser Linear fetch found. | No direct browser Linear outage was proven; transitive workflow behaviour is UNPROVEN. | index.html:8459-8500, :67534-67770, :68666-68702. |
| Hook library, market research, and briefs | Browser calls their named n8n/webhook functions. | No direct browser Linear fetch found. | No direct browser Linear outage was proven; downstream workflow behaviour is UNPROVEN. | index.html:9100-9134, :9699-9813. |

### Comments, notes, and tweaks crosswalk

| Action | Native authority target | Legacy/fallback target | Client effect if the legacy target is off |
| --- | --- | --- | --- |
| Calendar status/approval/tweak state | production-write, with a native deliverable ID | linear-set-status through n8n | Source card can persist while the cross-system delivery is queued/failed. Evidence: index.html:32134-32251, :39161-39634. |
| Calendar caption/title note | Calendar source writer | none demonstrated | No Linear dependency in this action; writer availability remains deployment-UNPROVEN. Evidence: index.html:32287-32311, :43596-43635. |
| Calendar component comment / tweak request | production-write / native comment lifecycle when exact client gate is ready | linear-add-comment through n8n | Conditional exposure: some comments are native fail-closed; fallback routes can lose team delivery behind a saved card. Evidence: index.html:32287-32400, :43637-43853, :44984-45151. |
| Sample status/approval/tweak state | production-write | linear-set-status through n8n | Same conditional silent-delivery risk. Evidence: index.html:62369-62642, :64948-65015. |
| Sample plain review note | Sample source writer | none demonstrated | No direct Linear call established. Evidence: index.html:63301-63318. |
| Sample component comment | native canonical comment route when linked and eligible | legacy add-comment only in the relevant fallback/unlinked cases | Do not overstate this as universal fallback; linked client comment code fails closed rather than automatically entering Linear. Evidence: index.html:65040-65123. |
| Kasper internal note | Calendar source persistence | none demonstrated | No direct Linear call established. Evidence: index.html:74113-74166. |
| Kasper tweak request | _calPostLinearComment native-or-legacy branch | linear-add-comment when routed legacy | Same fallback risk. Evidence: index.html:74168-74272. |
| Workload tweak preview | no native equivalent currently | linear-tweak-comments n8n workflow | Staff loses the inline comment/context and is told to open Linear. Evidence: index.html:18989-19039, :19256-19271. |

### Published n8n dependency map

The following is live published-graph evidence read on 2026-09-03. No graph was changed. The simple three-node webhooks have a real active webhook trigger and a connected active node containing a direct Linear GraphQL call; that is stronger than a name search.

| Published workflow | Active reachable Linear behaviour | Browser/server caller or scheduled trigger | Exit implication |
| --- | --- | --- | --- |
| SyncView Calendar - Linear Add Comment | Receive POST -> Post Comment To Linear -> response | Browser LINEAR_ADD_COMMENT_URL | Must be replaced by canonical SyncLinear comment persistence before the fallback is retired. |
| SyncView Calendar - Linear Set Status | Receive POST -> Apply Status to Linear -> response | Browser LINEAR_SET_STATUS_URL | Must not remain a reachable fallback for client approval/tweak. |
| SyncView Calendar — Linear Issue Statuses | Receive POST -> Fetch Issue Statuses -> response | Calendar parent/status enrichment and reconciler paths | Replace with native deliverable/status projection or degrade visibly as non-essential metadata. |
| SyncView Calendar — Linear Sub-Issues | Receive POST -> Fetch Sub-Issues -> response | Calendar/Sample link/import helpers | Retire only after link/import migration and dead-control sweep. |
| SyncView Workload — Reconcile | Every 10 min -> Fetch & Build Rows -> workload_issues upsert/deactivate | Scheduled | The current Workload primary source is Linear-derived. Native source must become authoritative first. |
| SyncView Workload — Tweak Comments | Receive POST -> Fetch Comments From Linear -> response | Workload popover | Replace with production_comments or a native review-event projection. |
| SyncView — Urgent Tweak -> Slack | Receive POST -> Linear: Resolve Assignee -> Slack | Calendar urgent-tweak action | Replace assignee lookup with SyncLinear/team_members resolution before Linear shutdown. |
| VIDEO PRODUCTION AUTOMATION | Live webhooks include video-form, graphic-form, linear-projects, log-linear-submission, and linear-issues. Active reachable direct Linear nodes include project/editor/project lookup and legacy F44 workers. | Submit legacy fallbacks, project list, Workload forced read | The normal authority branch inside this complex workflow was not executed; do not assume all requests call Linear. Browser entry to these paths is independently proven above. |
| Calendar/Sample upsert workflows | Active upsert/source-mirror workflows contain legacy-named fields but no direct Linear API node was established in the graph pass. | Browser fallback writers | They must remain available to current client links until a native client-safe writer is independently deployed and tested. Do not conflate a field named Linear with a provider call. |

### Deployment facts that change the conclusion

| Function / path | Repository deploy ownership | Consequence for this audit |
| --- | --- | --- |
| calendar-upsert | No CI deploy path | The source imports browser-write authentication, but the frozen directive says live writer must be open/tokenless. Repository source cannot resolve that conflict. Deployed capability is UNPROVEN. Evidence: docs/ops/EF_DEPLOY_MANIFEST.md:25-27; AGENTS.md:3-14. |
| sample-review-upsert | No CI deploy path | Same conclusion. Evidence: docs/ops/EF_DEPLOY_MANIFEST.md:49-50. |
| client-token-verify | Deliberate manual/no-CI | Share-link bootstrap source is not evidence of the deployed verifier. Evidence: docs/ops/EF_DEPLOY_MANIFEST.md:29-30. |
| production-write and production-comments | Manual pinned-SHA workflows only | Checked-in Linear dependencies are a serious candidate blocker but must be fingerprint/read back before asserting they serve production. Evidence: docs/ops/EF_DEPLOY_MANIFEST.md:43-45. |
| linear-outbound and linear-inbound | Manual pinned-SHA workflows only | Live flags and endpoint/workflow state prove the lanes are enabled, but exact deployed source revision still requires operator readback. Evidence: docs/ops/EF_DEPLOY_MANIFEST.md:38-39. |
| filming-plans | Main-push plus manual | Repository is stronger evidence for source deployment coverage, but not a proof of exact serving revision. Evidence: docs/ops/EF_DEPLOY_MANIFEST.md:32. |
| workload-linear and workload-plan | Deliberate manual/no-CI | Workload Linear/source-only claims must never be read as current serving behaviour without exact operator proof. Evidence: docs/ops/EF_DEPLOY_MANIFEST.md:56-57. |

### Monitoring state observed during Phase 1

The existing watcher set is not a cutover proof today.

* Calendar E2E nightly was active but its latest three scheduled runs were failures. The latest reported three of 69 probes failed. This proves the watcher is noisy/red; it does not prove a client-facing defect caused the failure.
* Samples E2E nightly was active but two of its latest three scheduled runs failed. The latest failure was in sxr_gating_flags. Again, this is not evidence that a client action is broken, but it cannot be used as green protection.
* Production write gateway TEST drill had three recent scheduled successes. It is valuable native-write evidence for its fixture, not a proof of existing client share links.
* Production write-UI shadow audit had three recent failures. Its latest failed log contained missing credential and a Linear GraphQL entity-not-found error, so it is presently not a clean cutover monitor.
* Monitoring dead-man's switch had recent scheduled successes. It proves monitored lanes emitted heartbeats, not that they passed. Existing documentation makes the same distinction. Evidence: docs/ops/MONITORING.md:33-35.

These are live GitHub workflow metadata/log reads from 2026-09-03. The individual existing workflow definitions are listed at .github/workflows/calendar-e2e-nightly.yml, .github/workflows/samples-e2e-nightly.yml, .github/workflows/production-write-drill.yml, .github/workflows/production-shadow-audit.yml, and .github/workflows/monitoring-deadman.yml.

### Phase 1 unknowns — do not infer them

1. The exact deployed revisions of every no-CI/manual Edge Function listed above.
2. Whether the deployed calendar/sample writers are still tokenless/open as AGENTS requires, despite audited source importing credentials-required helper code.
3. The live mirror_outbox pending/failed/age distribution, production_comments count/coverage, and workload_plan key migration state. Anonymous RLS denied these reads.
4. Whether every Linear issue, comment, attachment, project, label, status history, parent relationship, and assignee relation that matters has a complete native record. The public counts actively disprove treating visible deliverable count as sufficient.
5. Whether every current share-link can perform all actions on the deployed writer; no real client mutation or fault injection was authorized.
6. Whether the live n8n calendar-get/Sample fallback or other non-Linear-named workflows transitively call Linear.
7. Whether the checked-in Pages HTML is the currently served HTML.
8. Whether any current client page-load triggers legacy-link adoption.
9. Whether direct callers can bypass the Production UI's closed creation control.
10. Whether all hidden/conditional user-visible text has been found. The Phase 3 cosmetic sweep must be executed mechanically as part of implementation.

### Phase 1 decision

Do not switch Linear off, disable the Linear credentials, set outbound off as a substitute for completion, or change a client writer during this work. The next phase evaluates the prior attempt against this frozen independent map.

## Phase 2 — judgment of the prior attempt

### Retrieval, scope, and scoring

The named branch had been deleted by the time Phase 2 began. It was recovered from the immutable pull-request ref for PR 1248, whose head is e1f55b4. PR 1248 was merged and then wholly reverted by PR 1250 at the owner's direction. Therefore its native Calendar projection, dependency analyzer, documents, and tests are historical review material, not current production evidence. The current reconciler still calls the Linear status webhook and gates the SyncView pull-only lane on outbound mode being live: scripts/linear-sync-reconcile.js:53-60, :150-154, :371-372.

A verdict has a deliberately narrow meaning:

| Verdict | Meaning in this review |
| --- | --- |
| CONFIRMED | The independently frozen Phase 1 evidence supports the same scoped claim. |
| WRONG | The independent evidence contradicts the claim as written. A narrower related fact can still be true. |
| UNPROVEN | The claim needs a deployed revision, privileged measurement, executed workflow path, or owner decision that Phase 1 did not establish. |
| MISSING | The prior material omitted a dependency, safety condition, or constraint discovered independently. |

Rows group inseparable claims only. When a source fact and a production conclusion differ, they are scored separately rather than letting a true source observation certify production.

### Exit-plan claims

| Prior substantive claim | Verdict | Independent judgment and evidence |
| --- | --- | --- |
| The four-question method is necessary: reachability, deployment, flags, and live data. | CONFIRMED | This is the correct standard. Phase 1 used all four and found that healthy enrollment does not make the flag-failure lane unreachable. See index.html:25073-25138 and :25537-25549; EF deploy limits are explicit at docs/ops/EF_DEPLOY_MANIFEST.md:3-7. |
| The prior analyzer answers reachability from live entry points. | WRONG | It reports functions whose names match handle[A-Z], not request-dispatch entries, and only scans six Edge Function files. It does not trace the SPA, n8n, dynamic endpoints, HTTP operation dispatch, imports, callbacks, feature flags, or data. Its limitations are material, not merely theoretical; see the tooling review below. |
| Both teams are SyncView-authoritative, and every active client is in the three native cohorts. | CONFIRMED | The read-only snapshot independently measured SyncView authority for both teams and 43 active entries with zero aggregate cohort difference. This proves only the healthy configuration branch. |
| Staff and client write paths already go native; legacy lanes carry no live traffic while flags are healthy. | WRONG | The healthy cohort observation is real, but the claim broadens it into a safe operational conclusion. A missing, malformed, or delayed flag deliberately permits the Calendar/Sample legacy status and comment transports: index.html:25073-25138, :32134-32400, :64948-65123. Phase 1 did not measure traffic on every legacy endpoint, so the traffic portion is also UNPROVEN. |
| Only three mechanical facts remain before switch-off. | WRONG | It omits the client fault lane, active asynchronous Linear mirroring, cached-browser compatibility, active n8n Linear workflows, protected outbox/export state, and the share-link writer deployment contradiction. Native commits still schedule outbound work under the live flag: supabase/functions/production-write/index.ts:5434-5471, :1659-1666. |
| Nothing a client sees is read from Linear. | WRONG | Primary card reads are native, which is encouraging, but this statement is too broad. A successful Calendar load calls parent metadata refresh and link adoption after card load; the status metadata read is caught but remains a dependency for displayed decoration: index.html:32931-33115, :35261-35283. More importantly, client actions can route to Linear on a flag-read failure. |
| workload-linear is dead on both ends and may be deleted. | WRONG | Current source directly calls Linear and has a Linear-authority due-date mutation: supabase/functions/workload-linear/index.ts:135-178, :386-475. It also has no CI deployment path, so neither source nor a header can certify its serving behavior: docs/ops/EF_DEPLOY_MANIFEST.md:56-57. |
| The named Calendar Linear status workflow is inactive and safe to preserve/retire later. | UNPROVEN | Source cannot prove a named n8n workflow's activation state. Phase 1 independently found active direct provider status/comment workflows, but did not prove the prior document's exact workflow identity/state. Its retirement conclusion is therefore unsupported. |
| The Calendar card banner is a live per-load Linear read; Create Post reaches projectForIntake then readLinearProject; Workload is Linear-derived. | CONFIRMED as source reachability; UNPROVEN as deployed behavior where applicable | Phase 1 independently reached the same browser and gateway chains: index.html:32931-33115; supabase/functions/production-write/index.ts:5953-6009, :2398-2423, :2176-2226; index.html:13915-13951, :14407-14446. Production-write and Workload functions are manual/pinned or no-CI deployments, so checked-in source cannot prove the serving revision. |
| The Submit picker depends on Linear and is display-only. | UNPROVEN | The cold browser path calls the legacy-named linear-projects endpoint: index.html:13678-13681, :13790-13839. Phase 1 did not execute its live n8n path, so whether its current server implementation calls Linear and whether it gates a submission are not established. |
| Kasper's board, the client Calendar, client Samples, and Sample status are clean. | WRONG | Kasper status and tweak actions inherit the Calendar native-or-legacy routing: index.html:73868-74272. Client Calendar and Sample approval/tweak/comment actions retain the same fault fallback: index.html:43466-44020, :62369-62642, :64948-65123. The claim could only be true of selected primary reads, not of the surfaces as a whole. |
| Production-tab creation is closed; Calendar/Samples creation reaches a live Linear validation; labels and assignee providers read Linear. | CONFIRMED as source reachability; UNPROVEN as deployment | The closed Production route is reached only after an unconditional closure: supabase/functions/production-write/index.ts:3417-3486. Intake, component fill, label read/write, and assignee eligibility have the cited provider paths in current source: :2398-2423, :4636-4676, :5175-5221, :2480-2576. The manifest makes the serving production-write revision unproven: docs/ops/EF_DEPLOY_MANIFEST.md:43-45. |
| Status, due-date, and description entity operations are Linear-free. | UNPROVEN | The prior static tool can show an absence in its parsed source subset, but it does not establish dispatch, imports, runtime branches, or deployed code. This narrower source assertion needs a request-level test before it can become a production claim. |
| The repository table describes live production-write behavior because it has a deploy lane and a stated deployed version. | WRONG | The manifest says production-write is a manual pinned-SHA deployment, not a current-revision attestation: docs/ops/EF_DEPLOY_MANIFEST.md:43-45. No deployed source fingerprint was obtained in Phase 1. |
| The Calendar has no native status path, so the branch's native projection was the first safe exit move. | WRONG as a current-state assertion and as a Linear-off design | PR 1250 reverted the whole PR 1248 change before it became a standing cutover. Worse, the branch built all linked URLs and awaited resolveLinear before reaching nativeOwns: PR 1248 scripts/linear-sync-reconcile.js:327-343, :404-445. Its resolver retries the Linear webhook and throws on failure, so a provider outage aborts the job before any native write: :151-189. Current source retains the Linear status resolve and outbound-live gate: scripts/linear-sync-reconcile.js:150-154, :371-372. |
| No Linear-only work remains on either Calendar surface, so the linkage gate is met. | UNPROVEN and insufficient | Phase 1's narrow actionable classifier found zero missing native IDs among 114 Calendar and 7 Sample components. Its broader non-archived measurement still found 197 Calendar legacy-link-without-native slots. Neither anonymous measure covers protected outbox, archived/deleted history, all work types, or a deployed action test. A zero count under one classifier cannot close the migration gate. |
| Workload's native view is ready once its key migration is done; several native-source blockers are empty. | WRONG | The exact live native-visibility check exited non-zero with 21 real rows invisible to their owner, including never-imported and parked rows. Its active source populations also differ materially: 2,018 Linear-derived rows versus 6,349 native-view rows in the anonymous snapshot. A simple reader swap remains unsafe. |
| Urgent tweak needs a native assignee source, and Workload tweak comments need a native reader; both n8n changes require explicit owner approval. | CONFIRMED | Phase 1 found the active urgent-tweak workflow resolves an assignee through Linear before Slack, and Workload tweak comments call the Linear workflow: index.html:18989-19039. The explicit n8n owner gate is required by the house constraint. |
| Before retiring legacy webhooks, make fallback callers fail closed and prove zero callers. | WRONG for client actions | Refusing an approval, tweak, comment, or intake during a flag fault violates the client invariant. The correct replacement is a provider-independent compatibility route that durably accepts the action and alerts on downstream projection trouble. A zero-caller proof is still required before endpoint deletion. |
| Linear history, attachments, user mappings, and outbox state must be exported before destructive switch-off. | CONFIRMED in category; UNPROVEN in completeness | Protected tables blocked anonymous reads, so queue age, comment completeness, archive coverage, and attachment rescue are unknown. The export list must be broader than the prior plan and receive private reconciliation receipts before credential revocation. |

### Action-history-plan claims

The action-history document is relevant because its proposed database and writer changes would touch the same client-visible tables. It is not a substitute for an exit plan.

| Prior substantive claim | Verdict | Independent judgment and evidence |
| --- | --- | --- |
| Three ledgers contain the stated row totals/rates and are insufficient for recovery. | UNPROVEN | Phase 1 did not remeasure protected or historical ledger populations. The qualitative recovery concern is plausible, but the exact counts, date ranges, and rates were not independently established. |
| Calendar/Sample events do not retain comment bodies/edits or generic business-field diffs. | CONFIRMED as source behavior; UNPROVEN as deployed behavior | Current event builders emit comment identifiers and selected lifecycle/link events rather than a body/history or generic field-diff record: supabase/functions/calendar-upsert/index.ts:456-474; supabase/functions/sample-review-upsert/index.ts:471-485. Both writers lack a CI deploy path, so this does not certify production: docs/ops/EF_DEPLOY_MANIFEST.md:26, :50. |
| Calendar/Sample event emission is best-effort, and direct/integration writers can bypass it. | CONFIRMED as source behavior; UNPROVEN as deployed behavior | Current source calls waitUntil with swallowed event-insert rejection after the row write: supabase/functions/calendar-upsert/index.ts:128-133, :521-547; supabase/functions/sample-review-upsert/index.ts:124-129, :534-560. Direct inbound/reconciler effects and the serving writer revisions remain deployment-dependent. |
| Tokenless Calendar/Sample writers cannot truthfully verify a browser-asserted person. | CONFIRMED | AGENTS.md:3-14 freezes the open/tokenless contract, while the checked-in helper demands a credential: supabase/functions/_shared/browser-write-auth.ts:46-103. Treating an open-endpoint name as verified would manufacture false attribution. The asserted live event-row shapes remain UNPROVEN without a privileged re-read. |
| _prodActivity is implemented but unused, so no complete activity record is rendered. | CONFIRMED as source behavior; UNPROVEN as served-frontend behavior | The renderer exists at index.html:59323-59332 and no second invocation was found in the source pass. The exact served frontend revision remains unproven. |
| Calendar/Sample tables and events are absent from the verified backup corpus. | CONFIRMED as current repository inventory; UNPROVEN as live backup proof | The backup allowlist source can be inspected, but an execution/restore receipt is required before declaring production recoverability or non-recoverability. |
| A copied app.event_written trigger guard would double-record because card row/event writes are separate requests. | CONFIRMED as source-design warning; UNPROVEN as deployed writer fact | The current source performs the row write and deferred event insert separately. This is a valid reason not to copy the guard blindly. It does not authorize a migration or establish the historical live implementation. |
| A reconciler flag failure should skip work and alert. | WRONG as the client-facing recovery behavior | Alerting is necessary, but a skipped projection cannot be the only outcome for a client-visible status surface. The replacement must preserve a native projection or durable action receipt/readback path, not leave a client-facing card stale behind an alert. |
| A public, unrestricted body-history reader and a 30-day retention rule are settled owner decisions. | UNPROVEN | Neither decision is authorized by this request, and no independently verifiable owner record was presented. In a public repository, comment-body exposure must remain privacy-reviewed; it cannot be inferred from an old strategy document. |
| The action-history steps can proceed independently of the Linear exit. | WRONG | Any writer/migration/reconciliation change must preserve the frozen client writers and the provider-independent action route first. The plan omitted the client fault-lane and cached-browser compatibility conditions. |

### Open Repairs 130–134

| Item and substantive claim | Verdict | Independent judgment |
| --- | --- | --- |
| 130: the action-history diagnosis and its seven gaps are measured and ready for the proposed plan. | UNPROVEN | It repeats the unremeasured ledger/backup assertions above. Its valuable frozen-writer warning is CONFIRMED; its production counts and owner decisions are not. |
| 131: the native status projection was a safe no-op and made Calendar status independent of Linear. | WRONG as an exit conclusion | The change was reverted with PR 1250 and no scheduled run executed the branch SHA. Even in the branch, it resolved Linear statuses before selecting the native branch and aborts if that resolver fails: PR 1248 scripts/linear-sync-reconcile.js:327-343, :151-189, :404-445. The workflow did not expose the documented NATIVE_PROJECTION environment toggle, so the alleged no-deploy rollback path was not operational: .github/workflows/linear-sync-reconcile.yml:45-51. |
| 132: zero Linear-only work means no Calendar/Sample migration is needed for exit. | UNPROVEN and insufficient | It uses a card-component classifier, while Phase 1 independently found broad linkage debt and could not inspect protected outbox/history. It also does not prove every current share-link action has a durable native recipient. |
| 133: exactly five live Linear dependencies exist, with client/Kasper/Sample surfaces clean. | WRONG | The Phase 1 surface map found conditional client Calendar, Sample, and Kasper write paths, live n8n providers, asynchronous mirror work, and dynamic fallback routes missing from the five-item inventory. |
| 134: the deep-link repair's two causes and browser proof. | WRONG as a complete fix, and out of provider-exit scope | It was bundled with a Linear strategy but is a separate browser behavior claim. Later current source contains a follow-up organizer/filter recovery path at index.html:35385-35400, so the branch claim was not the complete live resolution. It must not be used as evidence that Linear dependencies were understood or removed. |

### Tooling judgment

The prior tooling is useful as a narrow static hint, but it does not compute the thing its documents claim.

| Tool | What it really computes | What it silently misses or misclassifies | Verdict |
| --- | --- | --- | --- |
| PR 1248 scripts/linear-dependency-map.js | Textual reachability among top-level function declarations matching its parser, from a literal or simple constant alias containing the Linear host. Its explicit sink/parser rules are at :48-50, :61-90, :103-118, and it chooses report entries only by the handle[A-Z] naming convention at :148-168. | Real HTTP operation dispatch; functions called through properties, callbacks, imports, variables, arrows, methods, or computed names; endpoint construction/env URLs; n8n; browser code; database triggers; provider calls hidden behind a generic HTTP helper; feature flags; authorization; deployment revision; and live-data contradictions. It can also add false edges from raw text/name collisions and treats an indentation pattern as an unconditional terminal throw. | WRONG if used as a complete reachability map. It is only a source-local lint aid. |
| PR 1248 test/linear-dependency-map.js | Fixtures for its own three parser rules and three hand-selected source facts: :40-139, :141-169. | The tests prove the parser behaves as designed, not that the program's actual request graph is complete. They do not exercise a browser, Edge Function request, n8n path, flag failure, deployment, or live data. | CONFIRMED as unit coverage for a narrow parser; WRONG as validation of the exit inventory. |
| PR 1248 scripts/calendar-native-projection-dry-run.js | A read-only, public-table tally of the branch script's extracted decision over visible card/deliverable rows: :70-118. | Protected state, archived/deleted work, action reachability, deployed writers, cached pages, old n8n routes, outbox, and whether a classification actually produces a client-safe action. It does not deduplicate as the reconciler does, read authority/write-safe/native-projection flags, read legacy links/component-use fields, paginate beyond 5,000 rows, or include legacy corrections in the safety cap. It reports counts, not an export or cutover proof. | UNPROVEN as a migration-completeness gate. |
| PR 1248 test/calendar-native-status-projection.js | A pure decision-function test plus source-string assertions; the test itself says the network wiring cannot run: :11-18, :105-124. | The live reconciliation, deployed source, native writer availability, flag faults, Linear outage, and client UI action paths. | CONFIRMED as limited unit coverage; WRONG if represented as post-ship client safety proof. |

Two further omissions are material. The branch's reconciliation logging included record-level identifiers in workflow output, including new native/foreign paths: PR 1248 scripts/linear-sync-reconcile.js:598-607. Any replacement must emit aggregates only, because the repository and CI are public-facing. And no branch tool tested the primary invariant: a client action must persist and remain visible when routing configuration or Linear is unavailable.

### Phase 2 decision

The prior work correctly rediscovered several important source chains, especially the intake project validation, the closed Production create route, the Workload identity problem, and the flag-failure fallback. It is not a safe authorization to switch Linear off. Its central inventory is incomplete, it repeatedly promoted source/static evidence to live conclusions, and its proposed client-fault answer was refusal rather than durable continuity. Phase 3 starts from the frozen Phase 1 map, not from the prior branch's numerical gates.

## Phase 3 — executable replacement plan

### Cutover invariant

For every client action, the first successful response must mean all of the following are true:

1. The client-visible source record has durably accepted the action.
2. A SyncView-owned, queryable receipt exists for the intended SyncLinear work or for a staffed native exception inbox.
3. A refresh of the same share link can show the saved result.
4. A delayed downstream projection is visible as pending and alerting, never silently treated as complete.
5. Neither a failed routing-flag read, a stale browser, Linear unavailability, nor an n8n failure can change the route into a provider-dependent lane.

The plan never re-gates calendar-upsert or sample-review-upsert. AGENTS.md:3-14 is a release-blocking constraint, not a suggestion. A client action may not be rejected merely because an internal provider route is unavailable. The only acceptable degraded state is a durable, source-visible action with an explicit pending indication and an immediate operational alert.

No step authorizes a current production mutation. Each future mutation remains subject to its stated owner, deployment, migration, and n8n gates.

### Preconditions that remain unproven

Do not advance past Step 0 until these are evidenced privately:

1. The exact deployed revisions and auth configuration of calendar-upsert, sample-review-upsert, client-token-verify, production-write, production-comments, workload-linear, workload-plan, linear-inbound, and linear-outbound. The source manifest alone cannot answer this: docs/ops/EF_DEPLOY_MANIFEST.md:3-7, :25-30, :38-45, :49-57.
2. Privileged counts and age distribution for mirror_outbox, production_comments, workload_plan, archive/rescue rows, and any failed native receipts.
3. The published versions and reachable active edges of every n8n workflow named in the Phase 1 map, including the complex production automation branches.
4. The real served frontend revision and a safe cache/old-browser compatibility horizon.
5. A controlled, authorized test-client journey for every client capability. The test fixture must be the one named by the owner, and neither its identifier nor any share link may enter source, logs, PR text, or this document.

### Ordered steps

#### Step 0 — establish a deployable, private baseline

- What changes: no behavior changes. Capture a private release record containing deployed function revision or deploy receipt, JWT/auth mode, runtime-flag value and failure default, active workflow version/export, aggregate native-link coverage, outbox age/counts, and current scheduled-job execution result. Capture a private, redacted browser trace for client Calendar and Sample reads only.
- Why it sits first: source and current flags cannot prove a manual Edge Function or n8n version. Every later gate needs a known serving baseline; otherwise a rollback can restore the wrong thing.
- Gate: a reviewer can match each named serving function to an exact deploy receipt, each active workflow to an exported version, and every baseline query to a timestamp. The frozen writers are affirmatively shown tokenless/open without changing them.
- Post-ship test: staff opens each named staff route and the test-client share links load Calendar/Samples content; a private request fingerprint proves the observed endpoint revision. This step performs no approval, comment, tweak, or creation write.
- Client sees mid-flight: nothing changes. This step is read-only and creates no route, flag, row, or writer change.
- Who acts: the Edge Function deploy owner supplies deployment receipts; the n8n owner supplies read-only exports; a database operator runs privileged read-only queries. A merge alone does not complete this step.
- Undo: none is needed; it changes no production behavior.

#### Step 1 — install the cutover safety net before moving traffic

- What changes: add aggregate-only monitors and a test-client synthetic journey. Instrument action acceptance, source persistence, native projection, retry/terminal failure, and age of the oldest pending receipt. Add a deployed-revision check for manual functions and a scheduled check for active n8n provider nodes. Never log a client identifier, card title, share token, comment body, or URL.
- Why it sits here: a dual route is only safer if it becomes observable. Existing red E2E workflows and a dead-man heartbeat are not a green client guarantee; docs/ops/MONITORING.md:33-35 says the heartbeat does not prove pass.
- Gate: the synthetic journey proves, on the named test client only, content load, approval, tweak, plain note, component comment, refresh/reopen, and staff readback for Calendar and Sample Reviews. It runs through normal, delayed-flag, missing-flag, malformed-flag, and provider-unavailable test conditions. A failed run creates a GitHub Actions failure notification to repository owners; if that notification has no accountable recipient, the gate is not met.
- Post-ship test: deliberately fail the test-only projection after the source commit and confirm a visible pending state, a durable receipt, an alert, and eventual retry/readback. Confirm the test is aggregate-only in public CI output.
- Client sees mid-flight: nothing changes on real client links. The only writes are controlled test-fixture actions, and the monitor is separate from ordinary routing.
- Who acts: code merge creates the checks; the database owner applies any receipt/metric migration; the owner approves any alerting workflow edit. n8n remains read-only until separately authorized.
- Undo: disable the new monitor or remove its additive instrumentation. Do not remove historical receipts while any cutover step depends on them.

#### Step 2 — make every client action provider-independent, including old browser URLs

- What changes: introduce one canonical SyncView-owned action receipt/outbox transaction for Calendar and Sample approval, status, tweak, component comment, generic composer comment, and Kasper actions. It must first persist the source-visible change and receipt, then project to SyncLinear or a native staffed exception inbox. Keep the existing legacy status/comment URLs alive as compatibility adapters for cached pages, but make their terminal behavior use this native receipt path rather than Linear. Do not use a failed flag read to select Linear.
- Why it sits here: index.html deliberately falls back to linear-set-status and linear-add-comment when routing flags fail: index.html:25073-25138, :32134-32400, :64948-65123. A client may hold an older page after the new frontend deploy. Removing the endpoint or changing a flag before making both versions provider-independent creates the forbidden outage window.
- Gate: controlled failure tests of flag read, native capability lookup, provider request, and n8n adapter prove that every action remains source-visible and receipt-backed. No successful client response may lack a receipt; no trace may contain a reachable Linear request. The linked Sample canonical-comment fail-closed path at index.html:65087-65091 must either persist to the native receipt route or return an explicit retry state without losing typed text.
- Post-ship test: run each client and staff action through a fresh page and a deliberately stale cached page; refresh the share link and verify its saved state and the matching native receipt. Trigger a projection failure after persistence and verify staff receives the alert rather than a client-only success.
- Client sees mid-flight: the same controls and saved result. If a native projection is delayed after the durable commit, the client sees a truthful saved/pending indication, not a missing button, silent success, or a provider error.
- Who acts: frontend and gateway code land by merge; any manual Edge Function deployment requires the deploy owner; changing the legacy n8n URLs or their internals requires the owner's explicit same-request n8n approval. Without that approval, stop before any Linear cutover.
- Undo: while Linear remains available, restore the prior adapter implementation only after confirming the source/receipt remains durable. Do not use a provider-dependent route as emergency rollback after credentials are revoked.

#### Step 3 — remove Linear from native creation and option prerequisites

- What changes: add a native client-to-team/project mapping, native label vocabulary, and native assignee eligibility source. Backfill and dual-read those values before eliminating projectForIntake's readLinearProject call. Route intake_create, component fill, Create Post, Submit, label read/write, and assignee options through the native catalog. Keep SyncLinear Production creation closed; only Calendar/Samples may create work, as current closure behavior shows at index.html:52200-52256 and supabase/functions/production-write/index.ts:3417-3486.
- Why it sits here: public intake presently reads/validates the Linear project before its first native write: supabase/functions/production-write/index.ts:5953-6009, :2398-2423, :2176-2226. Turning Linear off first would return a pre-write failure to a client or staff creator.
- Gate: every active creation-capable mapping has a native value or a durable native exception disposition before native-first is enabled. In a controlled provider-unavailable environment, test-client Submit, Calendar Create Post, Samples Create Post, and component fill commit once, appear in the appropriate client/staff view, and never produce a Production-tab subissue.
- Post-ship test: execute those journeys after the manual production-write deployment and read back the native batch/deliverable, source card, action receipt, label, and assignment. Attempt Production-board create and prove it remains closed.
- Client sees mid-flight: no control moves or disappears. During dual-read, the old provider remains available only as rollback evidence; no real client sees an unmapped-error because promotion is blocked until coverage is complete.
- Who acts: a database owner applies additive mapping/backfill migrations; code lands by merge; the production-write deploy owner deploys and fingerprints the serving revision. This does not require changing the frozen Calendar/Sample writers.
- Undo: select the prior mapping reader while Linear remains intact; retain native mappings and crosswalks. Additive schema is reversible by disabling use, not by deleting rows.

#### Step 4 — close action-target and linkage debt without deleting client-visible work

- What changes: run a private record-level classifier over every interactive current card, legacy current card, archived/deleted history needed for export, and native deliverable. Each interactive component receives one of: canonical native target, intentionally noninteractive/history disposition, or a durable native exception inbox. Repair only proven crosswalk defects with an idempotent migration; retain legacy IDs/URLs as historical data.
- Why it sits here: the narrow actionable sample has zero missing native IDs, while the broader non-archived measurement still has 197 Calendar legacy-link-without-native slots. The provider-independent action adapter cannot safely decide where to project every action until those cases have a durable destination.
- Gate: zero interactive component lacks both a native target and an exception receipt route; each exception is counted and owner-reviewed. Bidirectional link checks, card/deliverable kind checks, and native source readback pass. No migration deletes a card, component, native record, legacy mapping, or comment.
- Post-ship test: use the synthetic client routes against representative native, legacy-linked, no-work-item, and exception cases; verify card visibility and action persistence after refresh. Staff verifies link/display behavior without a Linear link.
- Client sees mid-flight: every existing card remains visible, and no control is removed before its replacement route is live. A migrated card has both identifiers during the soak; it never has neither.
- Who acts: database owner runs the private migration and readback; code merge adds the classifier/guard; no n8n edit is needed here.
- Undo: roll back the reader/adapter to the retained prior crosswalk. Do not delete the old crosswalk until after the final post-cutover soak and export verification.

#### Step 5 — re-source all user-facing projections and workflow dependencies

- What changes: replace provider-backed Calendar parent metadata, status projection, comment/status adapters, urgent tweak assignee lookup, Submit picker/telemetry, and direct active n8n providers with native equivalents. A native Calendar status projection must choose the native path before any Linear-status request; the prior branch did the opposite by awaiting provider resolution before the native branch. Re-source Workload comment reads later in Step 6. Preserve old webhook URLs as native compatibility adapters until the cache horizon is proven.
- Why it sits here: Steps 2–4 establish a durable action and native target. Re-sourcing a display/projector before that can leave a client action saved on a source card but no native work to display or alert. Retiring n8n before compatibility exists breaks cached browsers.
- Gate: for every workflow in the Phase 1 published-graph map, an exported replacement has an active-trigger-to-native-sink trace with no reachable Linear node. Test Calendar metadata, status, comments, tweaks, Kasper, urgent notification, Submit picker, and the complex production automation branches individually; do not accept a renamed workflow as proof.
- Post-ship test: staff and client journeys run with a controlled provider outage while the native adapter remains available. The test asserts no direct provider request, source/readback success, and an alert on any terminal receipt failure.
- Client sees mid-flight: no change to share-link controls or URLs. Metadata may update from native records rather than Linear, but missing optional metadata is never allowed to remove content or block an action.
- Who acts: code/scripts merge; owner deploys manual functions; n8n modifications require explicit owner go-ahead in that same change window. Before that go-ahead, do not edit a production n8n workflow.
- Undo: restore the exported published workflow version while the provider remains available and keep the compatibility adapter live. Never delete an old workflow on this step.

#### Step 6 — migrate Workload as a separate, staff-only source change

- What changes: move the rendered Workload reader, forced refresh, metadata, due-date writes, plan-day identity, and tweak-comment reader to a native projection. Migrate workload_plan from Linear issue identity to an explicit native identity/crosswalk, or retain an immutable legacy key behind a native lookup; choose and document one. Remove the query/local-storage route that can revive the Linear reader only after native behavior is proven.
- Why it sits here: Workload is not client-reachable, so it must not delay client continuity, but it cannot be switched by a reader flag. Current source falls back to linear-issues on forced/empty/failure paths: index.html:13915-13951, :14407-14446; due and tweak paths retain legacy handling: :17025-17160, :18989-19039.
- Gate: workload-native-visibility-check exits zero for real rows after documented fixture exclusions; native rendered population, plan-day writes, due edits, and comment reads pass a staff click-through; no force/failure path has a provider endpoint.
- Post-ship test: staff refreshes, edits a due date, moves a plan day, opens tweak context, reloads, and reads back native state with the provider unavailable in a controlled test. Alert on any nonzero visibility check.
- Client sees mid-flight: nothing, because the route is staff-only. Staff sees the existing board until the native projection passes its soak; no blank or partial board is exposed as the default.
- Who acts: database owner executes the key migration; code and workflow changes merge; workload manual Edge Function deployment needs its owner; an n8n tweak-comment replacement requires the explicit owner gate.
- Undo: return staff to the retained Linear-derived source during the soak only. After final provider retirement, rollback requires the private export/crosswalk and is not an operational toggle.

#### Step 7 — export and reconcile all provider-only history while it is still readable

- What changes: create a private, access-controlled export and reconciliation receipt outside the public repository. Export active, archived, and deleted issues; projects/teams; statuses; labels; assignees/users; full issue trees; comments/replies/reactions; attachments and inline assets; activity/audit history; external IDs/crosswalks; workflow/webhook configuration; and all pending/failed outbound state. Hash/count manifests must contain aggregates and private opaque references, not client names, share tokens, or secrets.
- Why it sits here: credential revocation and workspace cancellation can make recovery impossible. Anonymous Phase 1 reads were denied for production_comments, workload_plan, and mirror_outbox, so absence cannot be inferred. Imports such as B1 must remain available until the final export/import decision is complete.
- Gate: a privileged reconciliation shows each export class has an expected count, a retrieval drill can locate representative content, attachment rescue is verified, outbox intents have a decided disposition, and a second export after the final observed provider write has no unexplained delta.
- Post-ship test: an authorized operator retrieves an issue, comment, attachment, hierarchy relation, historical status, and crosswalk from the private archive without using Linear. No test data is committed to this repository.
- Client sees mid-flight: nothing changes; export is read-only against client routes and does not alter writers, flags, or cards.
- Who acts: Linear/workspace administrator and database owner execute/export privately; n8n owner exports workflow versions. This is not a merge-only task.
- Undo: exports are additive recovery artifacts. They do not make deletion reversible, but they are the prerequisite for any recovery attempt.

#### Step 8 — prove zero reachable provider traffic, then perform the switch-off in safe order

- What changes: first stop new Linear outbox intent creation and preserve the receipt route; then adjudicate or drain every existing intent; replace scheduled GitHub/n8n provider jobs with native jobs or disable them only after their native replacement is green; leave compatibility URLs live but provider-independent; disable inbound only after the final export/freeze; revoke provider webhooks and credentials; cancel the workspace/subscription only after a sustained soak.
- Why it sits here: turning outbound off today leaves native commits intact but can freeze the current Calendar relay, and deleting a legacy webhook before cached browsers are protected can reject client actions. The current outbound queue is protected/unmeasured, so it cannot be assumed empty.
- Gate: a sustained zero-call window covers scheduled jobs, manual staff flows, test-client fresh and stale page journeys, native gateway logs, active n8n graph scans, and outbox enqueue/drain metrics. All client synthetic journeys are green for the agreed soak period; Workload is green; no active workflow has a reachable provider node; all final export receipts are signed off.
- Post-ship test: after each cutover substep, rerun staff and client journeys plus a controlled provider-unavailable test. After credential revocation, observe the same checks at least once per scheduled cycle and alert on every provider call attempt, 4xx/5xx client action, pending-age breach, or missing readback.
- Client sees mid-flight: nothing changes because fresh and cached pages use the native compatibility route before a credential is touched. A client action remains available even if an internal projection is delayed; it never becomes a Linear error.
- Who acts: code/workflow changes land by merge; manual function deploy owners deploy; n8n owner approves and publishes workflow changes; database owner adjudicates outbox; Linear administrator revokes webhooks/credentials and later the subscription. The final two actions require explicit owner authorization.
- Undo: before credential revocation, restore the retained adapters, flags, and exported n8n workflow versions while Linear remains available. After revocation or workspace cancellation, rollback is not a flag flip; it requires provider restoration if possible plus private-export recovery. Do not represent it as reversible.

#### Step 9 — remove cosmetic traces and dead ends only after the soak

- What changes: remove or replace user-facing provider labels, links, tooltips, empty states, help text, success/error copy, and stale remedies after all routes are native. Preserve technical historical identifiers only in private exports and internal migration documentation, not in client-facing UI.
- Why it sits last: removing an old control or URL early can strand a cached page or a legacy card. Cosmetic removal is proof of completed replacement, not a substitute for it.
- Gate: a reachable-DOM crawl, handler trace, and repository scan find no client-facing Linear string/control and no staff dead end. The scan is a supplement, not proof; every matched reachable UI state receives a browser check.
- Post-ship test: client share links exercise Calendar/Sample load, approve, tweak, notes/comments, pending/error/retry, and refresh without a provider name or dead remedy. Staff exercises Submit, Calendar, Samples, Workload, Production, Filming, and Kasper routes without a broken Linear control.
- Client sees mid-flight: no missing control. Copy changes are released only after the native replacement and old-browser adapter are already demonstrated.
- Who acts: frontend/code merge; documentation/workflow cleanup by their owners; no n8n deletion without the owner. Retain provider-specific implementation/config privately for the recovery period.
- Undo: restore copy or hidden compatibility affordances during the soak. Do not restore an external provider link after credential revocation; offer the native equivalent or an explicit staffed recovery path instead.

### Watchers and alarms

| Watcher | What it proves | Alert and owner | New infrastructure? |
| --- | --- | --- | --- |
| Anonymous synthetic client journey, using only the named test fixture | A real share-link can load content, approve, request a tweak, leave notes/comments, refresh, and show the same result. It also proves stale-page compatibility during the planned cache horizon. | Scheduled GitHub Actions failure notification to repository owners immediately; a failing run blocks the next cutover gate. | No: use the existing Actions estate, but make the test result authoritative rather than a dead-man heartbeat. |
| Receipt lifecycle monitor | Every accepted action has source persistence, native projection state, retry count, terminal disposition, and oldest-pending age. | Alert on any missing receipt, terminal loss, projection failure, or agreed age breach to the on-call owner. | Requires additive receipt metrics; no client identifiers in output. |
| Provider-call census | No browser, Edge Function, GitHub job, or published n8n workflow makes a reachable provider request after its cutover date. | Alert on the first call attempt and attach only route/category/time, never row identity. | Mostly no: scheduled source/graph scan plus aggregate request telemetry. |
| Deployed-revision verifier | Manual/no-CI functions serving the expected revision and auth contract. | Alert on unknown/mismatched revision; no cutover proceeds. | No, if deployment receipts or a protected version endpoint exist; otherwise it is a prerequisite implementation. |
| Native-link/exception monitor | Interactive components never regress into a state with no native target and no durable exception receipt. | Alert on any positive count after the linkage gate. | Add aggregate query/job. |
| Workload visibility gate | Native Workload has no real invisible rows and its writes/readbacks work. | Nonzero script exit is a direct failure alert, not merely a heartbeat. | No: promote the existing read-only checker to an enforced scheduled gate. |
| n8n published-graph audit | Active trigger-to-sink paths have no reachable provider node and match the exported version. | Alert on changed version, reactivated provider node, or failed native execution. | No new platform, but requires owner-authorized read/export access. |
| Client error-rate/readback monitor | A share-link action is not silently refusing or saving only locally. | Alert on new 4xx/5xx, explicit pending that exceeds age, or source/receipt mismatch. | Add aggregate dashboard/query; do not collect bodies or client identity. |

Existing Calendar/Sample E2E and write-shadow jobs must be repaired or explicitly replaced before any gate uses them. Their recent red status means they cannot be cited as protection. A dead-man success proves execution/heartbeat only, not product pass.

### Cosmetic and dead-end sweep

Client-visible sweep:

1. Share-link entry, Calendar, Sample Reviews, public Submit, all client success/pending/retry/error text, tooltips, empty states, help copy, and keyboard/deep-link states.
2. Every approval, tweak, plain note, component comment, generic composer, and linked comment failure branch. The result must name a native remedy or a durable pending state, never Linear or a removed URL.
3. No client-facing call to action may refer to a provider issue, provider status, provider mirror, provider link, or a staff-only workaround.

Staff-visible sweep:

1. Replace the active Workload Refresh from Linear button and its Open Linear fallback: index.html:16087, :19256-19271.
2. Replace Calendar/Samples link and sealing language, tooltips, empty-state instructions, open/remove controls, and the stale no-work remedy: index.html:25494-25499, :26558-26564, :26626-26629.
3. Replace native Submit/Create Post messages that say a provider mirror is draining and legacy success copy that says provider issues were created: index.html:40936-40950, :46679, :46871-46895.
4. Remove dormant Production create labels/catalog messages only after confirming the normal Production create closure remains intact; do not reopen creation to make the cleanup easier.
5. Sweep n8n/GitHub workflow names and operator runbooks separately. They are not client-visible, but provider-named schedules can become silent failing jobs after shutdown.

The verification must combine a string inventory, a reachable-handler map, and DOM/browser state crawl. A text search alone misses dynamic rendering; an interaction test alone misses dormant cached-page text.

### Irreversible boundaries

Before provider switch-off, privately export and verify all work that may exist only there: issue/project/team hierarchy; active/archived/deleted records; statuses and labels; users/assignees; comments, replies, reactions, and edit history; binary attachments and inline assets; webhook/workflow configuration; all external/native crosswalks; Linear archive/rescue rows; and pending/failed mirror intents.

These actions are not equivalent:

| Action | Reversible before final cutover? | Requirement |
| --- | --- | --- |
| Add native tables, mappings, receipts, and adapters | Yes, by disabling use while retaining data | Additive migration and readback. |
| Redirect a legacy URL to a native compatibility adapter | Yes, while Linear remains available | Fresh/stale client journey and receipt proof. |
| Disable/archive an n8n workflow | Usually, by restoring its exported published version | Export first; owner approval is required. |
| Stop enqueueing/draining provider mirrors | Conditionally | Every intent has a private replay/discard/export disposition. |
| Drop legacy columns/crosswalks or delete history | No practical rollback | Do not do this during the first cutover or soak. |
| Revoke provider credentials/webhooks | Operationally hard to reverse | Complete export, zero-call window, native compatibility, and owner authorization first. |
| Cancel/delete the provider workspace/subscription | Irreversible for practical recovery | Do it last, after the post-revocation soak and private retrieval drill. |

The Supabase publishable key is not rotated in this plan; that option is explicitly out of scope. No secret, client identifier, display name, share token, attachment URL, or comment body belongs in the public repository, PR, fixture, commit, or CI output.
