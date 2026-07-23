# Production tab (Linear clone) — Graphics full-day gap audit

**Status:** FINAL AUDIT — findings and design options only; no implementation authorized.
**Owner decisions applied:** 2026-07-23. Labels, description writes, native issue/sub-issue
creation, roster-owned client identity, and the client-attribution gap are settled scope and are
not questions in this report.
**Audit boundary:** read-only source/docs, aggregate-only Supabase and Linear reads, and existing
synthetic/hermetic checks. No product code, live row, deployment, runtime flag, migration, n8n
workflow, authority value, or writer changed. No new test harness was built.

## Verdict

The Graphics lead cannot yet spend a complete workday in the Production tab without returning to
Linear or an out-of-band tool. Four capabilities now have their own register owners:

- F200: roster-safe client attribution and hierarchy consistency;
- F201: real label display/set, including exact Workload labels;
- F202: issue and sub-issue description writes; and
- F203: issue and sub-issue creation inside Production, with no implicit Calendar linkage.

F204 records the unresolved saved-view/board-ordering parity boundary. F205 records a current
wrong-data split between project cards and project detail. The rest of the blocking
work was already registered and is extended here rather than renumbered: comments, assets,
Calendar/Samples projection and links, Workload authority, queue identity/assignment/transitions,
foreground freshness, due-date correctness, mobile access, and Activity.

## One ranked punch list

`Write path` means the fix needs a new or expanded durable mutation contract, not merely a browser
control. Estimates are relative audit sizes, not delivery commitments.

| Rank | Class | Register owner | Full-day gap / required outcome | Effort | Isolated / shared code | Write path |
|---:|---|---|---|:---:|:---:|:---:|
| 1 | **BLOCKER** | **F200** | Every current Production row resolves through the SyncView roster or an explicit internal/TEST designation. The current 72-row cohort is fully classified; any future unknown enters a visible repair state, not a client. Parent and sub-issue attribution is consistent and conflicts fail visibly. | L | Shared | Yes |
| 2 | **BLOCKER** | **F201** + F40 | Production reads the real label catalog and offers Linear-parity search, colors, checkboxes, selected state, and description tooltips. Guarded changes include exact `2× Workload` / `3× Workload`, survive refresh/second device, and reach Workload capacity without requiring a foreign round-trip after a team flips. | L | Shared | Yes |
| 3 | **BLOCKER** | **F202** | Parent issues and sub-issues expose guarded Markdown-preserving description edit, conflict handling, audit event, refresh, and mirror behavior. | M | Shared | Yes |
| 4 | **BLOCKER** | **F203** | The team can create a parent issue or a sub-issue in Production with a roster client, team, title, description, status, due date, assignee, and labels. Creation never creates, chooses, or links a Calendar/Samples card implicitly. | L | Shared | Yes |
| 5 | **BLOCKER** | F53 + F137 + F34 | Graphics can attach or select the canonical deliverable, see typed source/delivery assets, replace a revision safely, and preserve/rescue historical attachment references. SMM Approval is impossible without a resolvable artifact. | L | Shared | Yes |
| 6 | **BLOCKER** | F39 + F42 + F43 | One canonical thread supports internal/client visibility, reply, edit, delete, resolve/reopen, attachment display, paging, retry, and exact team/client authorization. “Client-visible” is offered only when the client surface reads the same thread. | L | Shared | Yes |
| 7 | **BLOCKER** | F50 + F112 + F126 | Calendar and Samples consume canonical status/assignee/linkage, keep explicit issue links healthy, deep-link to Production, and fail closed on partial legacy imports. No accepted Production status can leave review surfaces stale. | L | Shared | Yes |
| 8 | **BLOCKER** | F37 + F94 + F136 | “My issues” binds to the verified member; assignment candidates are eligible and mirrorable; and one server-owned role × current state × next state × team × assignee policy prevents unauthorized peer or reviewer-state changes. | L | Shared | Yes |
| 9 | **BLOCKER** | F95 | A continuously open queue and issue detail receive bounded operational refresh/realtime catch-up, show last-success age and degradation, preserve drafts/position, and offer manual Retry. | M | Shared | No |
| 10 | **BLOCKER** | F40 + F46 + F99 + F100 | Native due dates feed Workload authoritatively, and every due picker path preserves the chosen year and one ratified timezone/day contract. The result converges across tabs without depending on the inactive fast bridge. | L | Shared | Yes |
| 11 | **IMPORTANT** | F138 | Production visibly renders protected, paged Activity with loading, confirmed-empty, stale, failure, and retry states instead of requesting events and collapsing them to invisible empty data. | M | Shared | No |
| 12 | **IMPORTANT** | **F205** | Project board card, project detail, and project property pickers must read one status/lead/target object; today detail silently substitutes In Progress / No lead / No target for real board values. | S | Isolated | No |
| 13 | **IMPORTANT** | **F204** | Decide and implement the required view contract: current personal Due/Updated/Created preferences versus shared named views, persisted filters/grouping, board moves, and manual order. | L | Shared | Yes |
| 14 | **IMPORTANT** | F96 | Touch-mobile users can discover and switch between team issues and their verified personal queue without a hardware keyboard or crafted URL. | S | Isolated | No |
| 15 | **IMPORTANT** | F112 | Replace pasted Linear URLs with an explicit card↔Production issue flow, canonical native ID, conflict/replace confirmation, and two-way deep links. | M–L | Shared | Yes |
| 16 | **IMPORTANT** | F187 | Back/Forward must reset absent Production scope parameters instead of carrying team/tab/project-detail state from the page being left. | S | Isolated | No |
| 17 | **IMPORTANT** | F154 | When refresh proves an open issue/batch/project no longer exists, clear both the rendered detail and its URL so reload does not repeat a stale deep link. | S | Isolated | No |
| 18 | **NICE-TO-HAVE** | F204 | After the shared-view decision, add personal favorites and palette shortcuts only where they preserve the same view/filter truth; do not create a second local-only persistence model. | M | Shared | Yes |

## Lens 1 — the Graphics lead's actual workday

### Recent read-only activity

A read-only aggregate of non-archived issues created since 2026-07-01 found the following. No
issue body, client name, user identity, or private URL was retained in this report.

| Team cohort | Created | Due date | Assignee | Project | Sub-issue | Has comments | Has description | Linear attachment | Any label |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Graphics | 217 | 202 | 196 | 199 | 194 | 139 | 144 (23 parents, 121 sub-issues) | 0 | 0 |
| Video, bridge comparison | 190 | 175 | 183 | 190 | 169 | 59 | 136 (21 parents, 115 sub-issues) | 0 | 0 |

This makes status, due date, assignee, project/client, parent/sub-issue structure, comments, and
descriptions demonstrated daily fields. Zero recent Linear attachment/label rows is not a removal
decision: Graphics delivery is carried through SyncView file/folder fields, and the owner has
separately ratified real labels plus exact Workload labels as required parity.

### Current Production capability diff

| Capability | Current Production behavior | Evidence | Audit result |
|---|---|---|---|
| Status, due date, assignee | Guarded gateway controls exist; Creative is currently limited to same-team status/comment, while Admin/SMM can use all supported operations. | `index.html:41303-41317`, `:41422-41449`; `supabase/functions/production-write/policy.mjs:109-117` | Keep, but F37/F94/F99/F100/F136 block safe full-day use. |
| Labels | Bootstrap, adapter, pickers, and gateway operation list contain no label contract. | `index.html:40331-40363`, `:41997-42050`, `:42724-42729`; `supabase/functions/production-write/policy.mjs:5-11` | **F201 new blocker.** |
| Description | `brief` is projected and rendered with Markdown/link handling, but no edit action or gateway operation exists. | `index.html:40332-40356`, `:43574-43593`; `docs/syncview-design/WIRED-PARITY.md:159` | **F202 new blocker.** |
| Parent/sub-issue creation | Production has no create control. `intake_create` is restricted to Submit/Calendar lanes and creates their paired intake shape, not a Production issue command. | `supabase/functions/production-write/policy.mjs:127-134`; `index.html:33970-33978`, `:39334-39340` | **F203 new blocker.** |
| Comments | Top-level create with internal/client audience exists. The composer sends no `parent_id`; UI has no reply/edit/delete/resolve/reopen or attachment surface. | `index.html:41484-41520`, `:41647-41730` | Extend F39/F42/F43. |
| Assets/attachments | Four possible resource fields collapse to one priority winner shown as “Delivered file”; comment attachment fields are not normalized/rendered. | `index.html:40335`, `:41647-41687`, `:43582-43592` | Extend F53/F137/F34. |
| Display/board | Show-sub-issues, group, and Due/Updated/Created order persist locally and in URL state. Board drag chrome is guarded; named/shared views and real favorites are absent. | `index.html:40064-40082`, `:40867-40892`, `:41527-41563`; `docs/syncview-design/WIRED-PARITY.md:354-356` | **F204 new decision row.** |
| Project properties | Board cards read status/lead/target from `CLIENTS`; project detail and its pickers call `_prodClient()`, which returns the slimmer `PROJECTS` object without those fields. | `index.html:40314-40328`, `:40378-40410`, `:42240-42250`, `:43595-43615` | **F205 new wrong-data row.** |
| Workload labels | Workload recognizes only the exact two label names, but reads them from Linear metadata; Production cannot set them. Weight currently applies only to Video rows. | `supabase/functions/workload-linear/policy.mjs:13-15`, `:89-105`; `index.html:13338-13356`, `:13708-13717` | F201 supplies label authority; extend F40 for the native consumer. |
| Activity | Events are requested, failure becomes `[]`, and the Activity renderer is not called from detail. | `index.html:42768-42778`, `:43574-43593`, `:43649-43662` | Extend F138. |

## Lens 2 — bridge verification

### Client mapping: 72 of 4,600

Read-only PostgREST count proof returned 4,600 mirror rows and 72 with
`client_slug=unattributed`. All 72 remain render-eligible and nonterminal. The cohort is 71
Graphics/thumbnail rows and one Video row.

Every row received a deterministic public alias after sorting by its private native ID. The alias
is only an audit enumeration; it is not a stored ID and cannot be reversed from this report.

| Public aliases | Team / shape | Classification |
|---|---|---|
| U012 | Graphics parent | Hierarchy-attribution failure: projectless parent has mapped TEST child work. |
| U035 | Video parent | Hierarchy-attribution failure: projectless parent has mapped TEST/internal child work. |
| U001, U003, U016, U020, U028, U042, U048, U058, U060, U063, U066 | Graphics parents | Missing-project ambiguous; no explicit internal/TEST designation. |
| U002, U004–U011, U013–U015, U017–U019, U021–U027, U029–U034, U036–U041, U043–U047, U049–U057, U059, U061–U062, U064–U065, U067–U072 | Graphics sub-issues | Missing-project ambiguous; neither the issue nor its current parent carries a project. |

Classification totals are therefore:

- 70 missing-project ambiguous;
- 0 unmapped project-name;
- 2 hierarchy-attribution failures;
- 0 provably deliberate internal/TEST; and
- 0 other.

The 72-row topology is 13 roots and 59 sub-issues. Read-only Linear verification found no direct
project and no parent project on any of the 72. That means the 70 ambiguous rows cannot be safely
called accidental or internal from current data. The two hierarchy failures are projectless roots
whose child family resolves to one mapped TEST/internal project.

This is not an active-roster mapping-table miss: the current aggregate mapping inventory remains
62/62 for the active real-client roster. It is a missing-project/explicit-classification problem
plus absent hierarchy consistency.

#### Owner-reproduced entry point

> in a sub-issue of the TEST project (e.g. VID-12612, sub-issue of VID-12569, project
> "Sidney Laruel"), navigating to the PARENT shows project "unattributed" — the child resolves the
> project, the parent does not.

The bug reproduces read-only in both systems:

- the child carries the mapped TEST project and its persisted Linear parent;
- the parent has no project and is mirrored as `unattributed`; and
- `_prodResolveParentLinks()` correctly connects the two native rows, while `_prodAdapter()` renders
  each row's own `client_slug`/batch slug (`index.html:40256-40292`, `:40330-40355`).

Diagnosis: **upstream data gap plus missing hierarchy-attribution policy**, not the F145 parent-link
resolver. The backfill uses only the issue project or its parent's project, then falls back to
`unattributed` (`scripts/b1-linear-backfill.js:74-76`, `:177-186`). It never derives or flags a
projectless parent from a unanimous mapped child family. Inbound updates mirror description,
due, priority, team, status, assignee, and parent, but do not re-resolve project/client attribution
(`supabase/functions/linear-inbound/index.ts:544-635`). The reconciler also omits project/client from
its drift contract (`scripts/linear-deliverables-reconcile-lib.js:205-317`).

#### F200 target contract

1. The active SyncView roster is the only client catalog. Linear project names never insert clients.
2. A durable mapping binds every allowed Linear project ID to exactly one roster client or an
   explicit `internal`/`test` owner classification.
3. Resolution order is direct mapped project → nearest mapped ancestor → explicit classification.
   No match becomes `needs_attribution`, never a normal “Unattributed” client project.
4. A projectless parent with one unanimous mapped child client may display a clearly provisional
   family attribution and must enter the repair queue; conflicting child clients fail visibly.
5. Inbound and scheduled reconciliation compare project, mapping revision, client slug, and
   hierarchy consistency; changes cannot preserve stale attribution silently.
6. A later owner-approved repair classifies all 72, records before/after counts, and changes no
   unrelated row. This audit performs none of those writes.

The scheduled incremental B1 workflow is also an ownership risk: it runs
`b1-linear-backfill.js --incremental --apply`
(`.github/workflows/b1-linear-incremental-refresh.yml:51-64`), and that script can plan and insert
inactive `source=linear_backfill` client rows from issue/project names
(`scripts/b1-linear-backfill.js:745-782`, `:1061-1119`, `:1136-1146`). Production loads all client
rows rather than `active=true` (`index.html:42724-42729`). F69 must forbid B1-created clients and
route unknown projects to mapping repair; F54 must keep inactive/recovery clients out of ordinary
queues. The aggregate current roster table contains 39 rows: 33 active and six inactive historical
`linear_backfill` rows. This is capability/current-state evidence, not a claim that a new row was
recently created.

### Calendar and Samples

The native IDs already exist beside legacy Linear links, but cards still present Linear-first
linking and do not use the native ID for a staff-facing Production deep link/owner projection.
Production status writes do not transactionally update the linked card. F50 owns status projection;
F112 owns native card↔issue navigation/link identity; F126 owns partial legacy sub-issue imports.
F42/F43 own the split comment truth used by Samples/review flows.

Required bridge result:

- a flipped component reads canonical deliverable status/assignee/thread;
- its card opens `?prod=1&d=<native-id>` and retains a temporary Linear fallback only during the
  ratified grace epoch;
- link creation/replacement is explicit, authorized, idempotent, and conflict-visible; and
- no Production issue creation produces a card or Calendar appearance by itself.

### Workload

The current Production due writer commits native `due_date` and queues the Linear mirror. Workload
still reads Linear-derived issues and a separate Linear metadata response, so the path is:

`Production native due → outbound Linear → Workload Linear refresh → capacity`.

Exact `2× Workload` / `3× Workload` interpretation is correct in the current Workload path, but a
Production label cannot enter that path because Production has no label model or write. F201 owns
the native label catalog/assignment operation. F40 must then consume native due/label authority for
flipped teams; F46 owns the inactive fast-path/latency choice, and F99/F100 own wrong-date risks.

## Card↔issue linking options — design only

| Option | UX | Effort | Fit / constraint |
|---|---|:---:|---|
| **A — card-side “Link Production issue” picker** | From a Video/Graphics card slot, search open same-client issues, filtered to the component/team. Show identifier, title, status, assignee, and due date. Selection stores the native deliverable ID and shows a Production deep link. | M | Best first step; extends F112 and today's explicit conflict/move behavior. Requires a protected issue projection and card write. |
| **B — “Create and link” from an existing card** | An empty card slot opens native create with client/component fixed, then commits issue + explicit link as one recoverable operation. | L | Respects “creation never auto-appears”: the user starts from the chosen card and confirms the link. Depends on F203 and intake recovery/title correctness. |
| **C — Production-side “Link to card”** | Issue detail searches eligible same-client cards/slots, confirms replacement conflicts, and then shows “View card” / “View issue” backlinks. | M–L | Useful reverse flow; needs protected card projection, card authorization, and the same canonical native ID contract as A. |

## Lens 3 — systematic bug/repro pass

No live mutation was used. Rows below either reproduce from read-only TEST/aggregate data or from
the existing synthetic/source contract.

| Repro | Observation | Register disposition |
|---|---|---|
| Open the allowed TEST child, then navigate to its displayed parent. | Child shows the TEST project; parent shows `unattributed`. Parent resolver is correct; attribution is not. | **F200 new. F145 stays DONE.** |
| Inspect Production bootstrap and adapter with an inactive roster client fixture. | All clients load; ordinary queue/write predicates do not consistently enforce client activity. | Extend F54. |
| Open any issue detail and inspect available field controls. | Description renders but has no edit action; labels have no render/picker; Add sub-issue remains guarded. | **F201/F202/F203 new.** |
| Submit a synthetic comment draft and inspect the request shape. | It carries body + audience only; no reply parent or attachment. Lifecycle actions are absent, while “Client-visible” is offered before the client reader is canonical. | Extend F39/F42/F43. |
| Give a synthetic Video row all source/delivery URLs. | Only the priority winner appears and is always labelled “Delivered file.” | Extend F137/F53. |
| Keep a synthetic Production tab foreground while a second context changes a row. | No operational poll/realtime owner refreshes the queue/detail; only authority repeats on a timer. | Extend F95. |
| Seed one synthetic event, then render issue detail; separately fail the event read. | Activity is never rendered; read failure is indistinguishable from empty. | Extend F138. |
| Use a touch-width viewport from a fresh Production route. | Sidebar/My issues disappears and no touch-visible personal/team switch replaces it. | Extend F96. |
| Exercise due quick option or mouse calendar across a year boundary. | Visible month/year and stored value can disagree; long-open tabs also use a frozen “today.” | Extend F99/F100. |
| Attempt project-board drag or shared view persistence in the synthetic surface. | Drag presents affordance then hits the read-only guard; display order is local only and no shared named-view model exists. | **F204 new decision row.** |
| Navigate from `?prod=1&team=graphics` Back to plain `?prod=1`. | `_prodPrimeFromUrl()` overwrites only present query keys, so the URL says all teams while the prior Graphics scope can remain rendered; the same omission affects issue-tab/project-details state. | F187 now owns this exact defect. |
| Refresh while the open issue, batch, or project is absent from the returned fixture. | Production falls back to list state but leaves the stale `d`, `batch`, or project URL in place; reload replays the invalid deep link. | Extend F154. |
| Seed a fictional project card with Paused status, a lead, and a target date; open its project detail and each property picker. | The board card shows the seeded values, while project detail/pickers read a different adapter object and fall back to In Progress / No lead / No target. | **F205 new.** |
| Load an old description, refresh the light row projection, then hold or fail the authoritative brief read. | The preserved old brief is marked loaded and can remain indefinitely with no stale/error state. | Extend F95/F162 and include recovery in F202. |

One candidate was refuted rather than registered: when Show sub-issues is off, a child whose parent
is outside the current team/client scope remains visible. That matches the owner-ratified rule that
only children with a parent present in the current view are hidden, so cross-boundary in-flight work
does not disappear (`docs/syncview-design/WIRED-PARITY.md:354-356`).

## Register updates

### New IDs

- **F200:** roster-owned client attribution, explicit internal/TEST classification, and hierarchy
  consistency.
- **F201:** Production label catalog/display/write plus native Workload round-trip.
- **F202:** guarded description writes for parent issues and sub-issues.
- **F203:** native Production parent/sub-issue creation with explicit-only Calendar linkage.
- **F204:** saved views, favorites, project-board mutation, and manual/shared ordering parity.
- **F205:** project board/detail/picker status, lead, and target read-model disagreement.

### Existing rows extended, not duplicated

- **F40/F46/F99/F100:** native due/label authority, convergence, and date correctness for Workload.
- **F39/F42/F43:** comment authorization, migration, audience, reply/lifecycle, and attachments.
- **F34/F53/F137:** attachment rescue plus typed/canonical Graphics and Video asset handling.
- **F50/F112/F126:** Calendar/Samples status projection, native deep links, explicit linking, and
  complete import.
- **F37/F94/F136:** verified personal queue, eligible assignment, and transition/peer-work policy.
- **F54/F69:** active-roster display enforcement and prohibition on B1 inventing clients.
- **F95/F96/F138:** foreground freshness, touch-mobile personal navigation, and visible Activity.
- **F187/F154:** complete Back/Forward scope reset and URL/render agreement when a deep-linked entity
  disappears.

## One-line owner questions

These questions tune implementation; none reopens the five ratified scope decisions.

1. **F200:** Should explicitly internal work appear under an “Internal” project in staff views, or be excluded from client-grouped views?
2. **F200:** Should a projectless parent with one unanimous mapped child family show a provisional client, or stay in Needs attribution until explicit repair?
3. **F201:** May same-team Creative staff change all labels, or are Workload-label changes Admin/SMM-only while Creative is read-only?
4. **F201/F40:** Should exact 2×/3× labels also weight Graphics capacity, or retain today's Video-only capacity behavior?
5. **F202:** Should description editing use Markdown source + preview, or one plain editor that preserves Markdown?
6. **F203:** Which create fields inherit from current team/client/parent context, and which must always be chosen explicitly?
7. **F53:** Should the first Graphics artifact control be Drive-link-only, or upload plus Drive picker?
8. **F137:** Which typed resources—filming plan, raw footage, thumbnail folder, and final delivery—must remain separately visible and editable?
9. **F43:** Should new staff comments default to Internal, with Client-visible enabled only after the canonical client reader ships?
10. **F37/F94/F136:** Which assignment, due-date, and current→next status actions stay Admin/SMM-only, and which may an eligible Graphics Creative perform?
11. **F204:** Are shared named views and manual board order first-day requirements, or are current personal Due/Updated/Created modes sufficient for the first Graphics move?
12. **F112:** Which linking option ships first: A card-side picker, B create-and-link, or C Production-side link?
13. **F112:** Should the first explicit linker ship in Calendar only, or Calendar and Samples together?
14. **F112:** When a card slot or issue is already linked, must replacement always use the existing explicit “Move it here” confirmation?
15. **F112:** What exact cutover condition ends the temporary Linear-link fallback after native Production deep links ship?
16. **F40/F46:** Should Workload consume native Production changes directly or only after reconciliation, and what maximum convergence delay is acceptable?
17. **F95:** What maximum foreground data age should trigger visible stale state and automatic/manual recovery?
18. **F99/F100:** Is the due-date day boundary the business IANA timezone or each viewer's local timezone?
19. **F138:** Is visible Activity a first-Graphics-flip gate or a later Linear-retirement gate?
20. **F138:** Which event types must Activity retain and display, and for how long?
21. **F205:** Should project status/lead/target remain read-only for the first Graphics move, or become guarded-writable at the same milestone?

## Verification completed

- `npm test`: all 160 unit suites passed after the register/truth/checklist reconciliation.
- `npm run test:prod-polish`: all ten existing Production suites passed in 490.4 seconds—boot,
  structure, zero-mutation read-only smoke, comment thread, fully intercepted write gateway,
  interaction inventory, accessibility/focus, responsive layout, 168/168 wired guard behaviors,
  and light/dark pixel parity.
- Focused source/hermetic checks also passed for true parent links, Production preview/comments/write
  policy, authority, exact Workload-label math, native intake, and the 74-case Calendar link-move
  contract.
- `truth-sync` passed 452/452 and `repo-map-sync` passed 149/149.
- Generated browser screenshots stayed under ignored `.codex-tmp`; no evidence artifact, row body,
  client identity, token, or private URL entered this change.

The green baseline does not cover or negate the findings. Existing suites have no complete contract
for label writes, description writes/read-failure recovery, arbitrary Production creation,
attribution repair, malformed-success comment envelopes/attachments, absent-query Back reset, or a
non-default project status/lead/target card→detail comparison. Per the anti-balloon rule, those are
recorded as findings rather than filled with new audit harness machinery.

## Exit gate for a future implementation program

This audit can be considered implemented only when a later owner-approved program proves, with
TEST/synthetic evidence and authoritative readback:

1. all 4,600 current mirror rows have a roster client or explicit internal/TEST classification;
   zero current unresolved or accidental `unattributed`, while future unknowns fail visibly into
   repair rather than becoming clients;
2. the TEST parent/child family shows one consistent project without changing F145 hierarchy;
3. label, description, issue create, and sub-issue create survive refresh, retry, conflict, and
   second-device paths under the guarded gateway;
4. Production-set due dates and exact Workload labels affect the same Workload calculation without a
   Linear-authority round trip for flipped teams;
5. issue creation alone produces zero Calendar/Samples card or link writes;
6. explicit card linking, status, assignee, assets, and canonical comments converge on Calendar and
   Samples; and
7. a Graphics lead completes an intercepted full-day walk without opening Linear.
