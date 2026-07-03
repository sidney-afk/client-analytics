# SyncView Independence Plan — n8n off the interactive path, Linear replaced in-app

**Date:** 2026-07-03 · **Status:** approved strategy, ready for execution
**Prepared from:** a full read-only audit of the codebase, the live n8n instance (87 workflows),
the live Linear workspace, the Supabase schema, and the Google Sheets — see
`docs/audits/2026-07-03-*.md` for the five detailed audit reports.
**Executor:** this plan is written to be executed by a coding agent (Codex) with no memory of
the conversation that produced it. **Appendix A contains the owner's original request verbatim —
read it first and sanity-check this plan against it. If any part of this plan seems to contradict
the owner's intent or the code you find, stop and ask the owner rather than following the plan
blindly.**

> **MANDATORY FIRST STEP — RE-AUDIT.** The audit reports in `docs/audits/2026-07-03-*.md` and
> every fact in this plan are a snapshot of **2026-07-03**. This system changes daily (live n8n
> workflows, Linear state, Supabase schema, `index.html`, Sheets). Before executing anything,
> re-run the full audit — repo code, live n8n workflow inventory + the specific workflows named
> in the Track A spec, live Linear workspace, Supabase schema, and the Google Sheets — and diff
> the findings against the 2026-07-03 reports. Anything that changed invalidates the
> corresponding assumptions here (endpoint payloads, ALLOWED column lists, workflow ids,
> active/inactive states, call-site line numbers, table shapes). Update this plan and the track
> specs to match reality before touching anything, and flag material changes to the owner.
> Line numbers cited anywhere in these docs are 2026-07-03 positions — always re-locate by
> symbol/string, never trust the number.

---

## 1. The two goals (owner's words, condensed)

1. **SyncView writes must stop going through n8n.** Reads are already Supabase-direct; writes
   go through unauthenticated n8n webhooks with documented 5–16 s cold-start stalls. Replace the
   interactive write path with Supabase Edge Functions so saves are immediate, robust, and never
   need reconciling.
2. **Stop depending on Linear.** The graphic/video teams work in Linear (projects = clients,
   parent issues = batches, sub-issues = deliverables with status/assignee/due-date). Build
   editor/designer views inside SyncView, connected to the existing content calendar and samples,
   then retire Linear and its whole sync apparatus.

**Sequencing (owner-confirmed):** Track A (Edge Functions) first, Track B (Linear replacement)
after. Both tracks are detailed in their own spec files:

- `TRACK_A_EDGE_FUNCTIONS_SPEC.md` — endpoint-by-endpoint port plan.
- `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` — schema, auth, UI, parallel run, cutover.

## 2. Owner decisions log (2026-07-03)

These are settled — do not re-litigate them without new information:

| # | Decision |
|---|---|
| D1 | Scope of "less n8n" = the **interactive SyncView path only**. The sales/onboarding funnel, scrapers/analytics jobs, weekly backups, and TikTok pipelines stay in n8n. |
| D2 | The Sheets-fed analytics/home tab is **out of scope** entirely. |
| D3 | Track A first, Track B after. Not together. |
| D4 | **Samples Old is NOT retired yet.** SXR (Samples New) has not been announced to the team and old→new data migration hasn't happened. Samples Old keeps its n8n endpoints untouched until a separate, later retirement step. Do not port `samples-upsert`/`samples-reorder` to Edge Functions. |
| D5 | Templates and caption prompts **move from Google Sheets into Supabase tables** as part of Track A. |
| D6 | Auth is **role-based, not per-person**: three tiers — **admin** (Sidney + Kasper), **smm** (social media managers), **creative** (video editors + graphic designers together). Owner explicitly wants zero per-account maintenance when people join/leave. No auth changes in Track A; role auth lands at the start of Track B. Clients keep tokenized links. |
| D7 | **Debuggability is a hard requirement**: every write must be attributable (actor, role, timestamp) and land in an append-only event ledger, so future bugs can be reconstructed after the fact. |
| D8 | Notifications stay on **Slack** for now (creative channels per client). A ro.am migration exists as a separate effort (`SLACK_ROAM_MIGRATION_AUDIT.md`) — design the notifier as a swappable module but implement Slack. |
| D9 | The hardcoded Linear API key in n8n is **accepted as-is** (owner explicitly doesn't care); no rotation work in this plan. It becomes moot when Linear is retired. |
| D10 | The `filming-plan-tabs` traffic (~12.7k calls/day) must be fixed — root cause is the QA harness cold-cache loop, see §5.3. |
| D11 | No editor interviews; the owner answered the workflow questions directly — see Track B spec §2 ("How the creative team actually works"). |

## 3. Current architecture in one paragraph (details in the audits)

SyncView is a single-file SPA (`index.html`, ~36k lines) on GitHub Pages
(syncview.synchrosocial.com). Reads: Supabase REST + realtime (project `uzltbbrjidmjwwfakwve`),
anon key is read-only (`using(true)` SELECT policies on 6 tables; anon can write nothing). Writes:
unauthenticated n8n webhooks (`synchrosocial.app.n8n.cloud/webhook/*`) that write Supabase as
primary and mirror Google Sheets best-effort. Linear inbound sync arrives via a Linear org webhook
→ n8n → minimal patch through the same upsert webhooks; a GitHub-Actions reconciler heals drift
every ~10 min (cadence driven by an n8n schedule trigger). Two Edge Functions already exist and
are the pattern precedents: `client-credentials` (staff-key-gated writes) and `onboarding-capture`
(public fallback capture). The comment-merge logic — the hardest write guard — already lives in
Postgres as service-role RPCs (`calendar_merge_comments`, `sample_review_merge_comments`).
An earlier, narrower plan (`EDGE_FUNCTIONS_MIGRATION.md`, 2026-06-29, never executed) designed the
`linear-status-sync` and `calendar-upsert-post` ports in depth — Track A absorbs and extends it;
where the two documents disagree, **this plan and the Track A spec win**, but the older doc's
guard-by-guard analysis remains the reference for port fidelity.

## 4. End state

- Every interactive SyncView write goes browser → Edge Function → Postgres (guards ported;
  merges/stamps already in the DB), with realtime fan-out to all open screens. Sub-second saves.
- Production management lives in SyncView: batches, deliverables, assignees, due dates, statuses,
  delivery links, and an activity ledger. Editors/designers work from a Production tab that
  mirrors their current Linear mental model. The SMM sees who's editing each card on the calendar.
- Linear, its 6 bridge webhooks, both reconcile scripts + GitHub Actions + n8n triggers, the
  workload mirror job, and the 3 lock-step status-mapping copies are all **deleted**.
- n8n remains for back-office only (D1). The Google Sheet remains for analytics only (D2) plus
  weekly backups.

## 5. Immediate actions (Phase 0 — some already done on 2026-07-03)

1. **[DONE] Re-enable the inbound Linear sync in n8n.** `SyncView Calendar — Linear Status Sync`
   (`MJbMZ789B5ExZz9x`) was found inactive since 2026-06-28 23:14 UTC with **no content change and
   no documented reason** — an accidental unpublish. It was re-published on 2026-07-03 with the
   known-good post-embed version `2fc824c2-…` (the version documented as live+wiring-tested in
   `SAMPLES_PARITY_LOG.md` 2026-06-26).
2. **[DONE 2026-07-03] Reset the Linear webhook delivery state.** The owner toggled the
   "Workload" webhook (id `a4482382-6d44-4c59-89f9-809220f559cb`) disable→enable in Linear
   settings at 19:57 UTC; delivery verified end-to-end at 20:02 with a VID probe issue
   (n8n executions 190909/190910 on workflow `MJbMZ789B5ExZz9x`, ~1 s latency). Realtime
   Linear→SyncView sync is live again **for the Video team**.
2b. **[DONE 2026-07-03] Extended webhook coverage to the Graphics team.** Discovery during
   verification: the original webhook was scoped `allPublicTeams: false, team: VID` and had been
   that way since 2026-05-19 — **Graphics issues had NEVER had realtime sync**; every GRA status
   change had always waited for the 10-minute reconciler. This explains why both documented
   drift incidents (`LINEAR_DRIFT_INCIDENT_2026-06-19.md` — GRA-6373; `docs/archive/`
   `THUMBNAIL_DESYNC_INCIDENT_2026-06-24.md`) involved thumbnail/graphics cards. Linear's UI
   confirms **team selection cannot be modified after creation**, so the owner created a NEW
   Graphics-scoped webhook (Label "Workload — Graphics", same URL
   `…/webhook/linear-status-sync`, Issues only, Team: Graphics) alongside the untouched VID
   webhook. Verified end-to-end at 20:13 UTC: a GRA probe (state change on GRA-6578 in the
   "Sidney Laruel" TEST project) produced n8n execution 190952 on `MJbMZ789B5ExZz9x` at ~1 s
   latency. **Realtime Linear→SyncView sync is now live for BOTH teams for the first time.**
   Note: the new webhook's signing secret is currently inert (n8n does not verify signatures);
   the Track A EF port introduces its own HMAC-verified webhook + secret.
3. **[DONE 2026-07-03] Recover the live schema.** Dump the live DDL (tables, policies,
   triggers, publication membership) into `migrations/live-schema-baseline-YYYY-MM-DD.sql`.
   The owner ran the Supabase catalog query in SQL editor; the schema-only output is committed as
   `migrations/live-schema-baseline-2026-07-03.sql`. Do not reconstruct live DDL from stale
   migrations or row-shaped REST responses.
4. **[DONE 2026-07-03] Snapshot all 87 live n8n workflows.** Raw workflow JSON can contain
   credentials, tokens, webhook secrets, and private business payloads, while this repo is public.
   The required full unredacted export therefore stays private in the weekly-backup Drive folder,
   and the public repo carries only status evidence under `n8n-backups/`. The MCP execution tool
   rejected a manual run despite owner approval, so the owner ran the backup manually in n8n.
   Execution `191240` succeeded and produced the private Drive evidence recorded in
   `n8n-backups/2026-07-03-phase0-snapshot-status.md`.
5. **[Codex] Stop the QA harness from hammering `filming-plan-tabs`** (D10): the frontend has a
   correct 30-min localStorage cache (`KASPER_FILMING_CACHE_MAX_AGE_MS`, index.html:31548), but
   every fresh headless QA context starts cold and a full pass fires ~1 call per client-with-doc.
   Fix in the QA/overnight harness: stub or block `filming-plan-tabs` (and other n8n GETs it
   doesn't assert on) at the Playwright route layer. The server-side fix (per-doc cache) comes
   with the Track A port of this endpoint.

## 6. Sequencing and gates

```
Phase 0  (above) ──────────────────────────────► no gate, start immediately
TRACK A
  A1 calendar-upsert EF (canary → all clients)   GATE: 48h canary, zero conflicts/regressions,
                                                       p95 save < 1s, qa/master.js green
  A2 reorder + SXR upsert/reorder EFs            GATE: same bar, SXR parity probes green
  A3 Linear bridge EFs (inbound HMAC + outbound) GATE: reconciler reports zero corrections
                                                       for 72h with realtime sync live
  A4 templates/caption-prompts tables + EFs,     GATE: Sheets tabs read-only for 1 week with
     filming-plan-tabs EF with cache                   no complaints; then mirrors retired
TRACK B (starts only after A3 gate passes)
  B0 role auth + clients/team_members tables
  B1 batches/deliverables/deliverable_events + backfill from Linear
  B2 Production tab UI + batch intake (behind flag, staff-only)
  B3 Graphics-team pilot (mirror to Linear ON)   GATE: 2 full batch cycles with zero
                                                       lost/wrong statuses; designer OK
  B4 Video team joins                            GATE: same, 2 cycles
  B5 Cutover: stop Linear creation, retire       GATE: owner sign-off; Linear export archived
     bridges/reconcilers/workload job/mapping
```

Rules that keep this safe:

- **One writer family moves at a time.** Never flip calendar and samples in the same deploy.
- **Old n8n endpoint stays live as the fallback URL** during each canary; rollback = flip one
  frontend constant back (the fan-in list is in the Track A spec — 6 call sites + reconciler +
  inbound sync; a single missed site silently splits the write path).
- **The reconciler is the last thing to die.** It stays running (and quiet) through all of
  Track A and only retires in B5. A quiet reconciler is the proof the new path is correct;
  during Track A, add a Slack alert when it corrects anything (it should never fire).
- **The repo is public.** No secrets in code, docs, or commits — Edge Function secrets go in
  Supabase function env, QA secrets in GitHub Actions secrets.

## 7. Rollback & backup doctrine — NON-NEGOTIABLE

The owner's hard requirement: **at any moment, one step must return the business to a fully
working website**, with backups of everything and a written trail of every action. The complete
doctrine and the always-current Live State table live in **`ROLLBACK.md`** — read it before
executing anything, keep its table updated in the same PR as every change, and treat its 8
standing rules (one-step rollback, old path stays alive, additive-only DB changes, snapshot
before every phase, log everything in `EXECUTION_LOG.md`, hard gates, rehearse the rollback,
no secrets) as blocking requirements. A phase that cannot articulate its one-step rollback in
`ROLLBACK.md` does not ship.

## 8. Risk register (top items)

| Risk | Mitigation |
|---|---|
| Upsert URL fan-in missed at cutover (6 FE sites + reconciler + inbound sync) → silent split writes | Single shared constant + grep-based CI check specified in Track A §4.1; canary by client slug first |
| A 4th copy of the Linear status mapping drifts during Track A | Hardcode in the EF + CI drift-check against `index.html` (`_calMapLinearStatusStrict` / `CAL_PRIORITY`), per `EDGE_FUNCTIONS_MIGRATION.md` "option (a)" |
| Edge Functions have no durable retry (n8n retried via runner queue) | Frontend already has per-card retry + localStorage outboxes; upserts are idempotent; reconciler backstop stays until B5 |
| Renaming load-bearing symbols breaks reconciler/tests silently (`grabFunc` extracts FE functions **by name**: `computeOverallStatus`, `_calMapLinearStatusStrict`, `CAL_PRIORITY`, …) | Do not rename; CI unit suite (`npm test`) plus `qa/master.js` must pass on every PR |
| Supabase free-tier limits (500 MB DB is the documented forcing function; EF invocation quota) | Fix D10 first (QA traffic is the only heavy consumer); monitor usage after A1; upgrading the plan is an accepted cost if needed |
| Track B pilot drifts from Linear during parallel run | New system is the single source of truth from pilot start; mirror-to-Linear is one-way display-only; weekly diff script during pilot |
| Client links fail open when the Sheet token column is empty (existing bug) | Fixed in B0 when tokens move to the `clients` table — enforcement becomes deny-by-default |

## 9. Verification

- Unit: `npm test` (30+ offline suites; they extract functions from `index.html` by name).
- E2E: `qa/master.js` lanes + the calendar/samples nightly probes (see
  `docs/HEADLESS-TESTING-GUIDE.md`); run the relevant lane after every phase.
- Each Track A endpoint spec includes a byte-parity test plan (same request → same response
  envelope, same DB effect) against a QA client slug before any canary.
- Track B ships its own probe set (spec §8) following the SXR probe pattern.

## Appendix A — The owner's original request (verbatim, 2026-07-03)

> Okay, so I have a very complicated task. It's a noble goal, but this will require a lot of
> planning and thinking thoroughly. And so let's get to work. Let me just first tell you my end
> goal, what I want to see when everything is finished. what I want is to rely less on n8n okay
> and I'm pretty sure we can do that with edge function because our website sync view if I'm not
> mistaken reads super base directly but to write it's passing through anything which I think can
> be replaced by edge functions now I am not sure about that this is just my idea or at least what
> I know but I do know that my end goal is for our sync view web page to be faster to be to not
> depend on and I want it to be immediate to be fast to be robust to never have something like
> never having to reconcile I don't want things to break you know what I mean I wanted to feel
> really robust I don't want to have to deal with problems with anything anymore and to have an
> internment like a middleman that's not necessary so this is my first goal
>
> Now, this implies also the need to not depend on linear. And that's the whole of the story, and
> I don't know if we should do that now or before or after or the two together, but I would like
> to not depend on linear anymore. Now linear is used by our graphic and our video team and we use
> it because we have clients which are projects in linear and each project has parent issues which
> are like batches and then sub issues which are videos or thumbnails and so usually we have
> statuses for the sub issues we have a due date we have a signee which is the editor and that's
> pretty much it now if we remove linear we will need to do a few things.
>
> We will need to create a new part of the website for our graphic designer and for our video
> editor. And of course it should be connected to the already existing content calendar that we
> have and samples that we have that read from linear. So they're connected to linear through this
> linear sub-issue link for every card. card and same as the workload and there's a ton of stuff
> that that depends on that and I should probably do a like ask the other editors what they
> actually like how they actually use it how they use linear to make sure that we we we use every
> correct thing that we need on our new website. But that's probably a huge thing to do because,
> well, because yeah, so it's going to be pretty complicated.
>
> And the fact that if we do this, it would open up a lot of options, so we should think about it,
> because we can make a dedicated editor and graphic tab, but I'm not sure what's the best way to
> implement it into our existing pipeline. We should probably make the graphic and video tabs
> similar to linear in terms of aesthetic and logic, that's why it's not too different from what
> they're used to but I would love it if the social media manager could use just one single source
> of truth would be there which would be the content calendar to view everything but I think there
> would be too much info because then we would have the due date we would have... I mean each
> subissue is a card so but I guess we should also show who's editing it which I guess now that I
> think about it it's not that hard so maybe we could do that so for the social media manager he
> would now have his content calendar but he he should probably see the who's working on it so the
> editor and I guess there would be no need for The parent issue logic because sub issues are just
> the things we need and I guess we could use the color tag for the batches but we would need some
> kind of ID for each card. I don't know. There's a lot to think about here
>
> And also because this is such a huge process, I think we should probably do it in a new, like in
> an isolated area of the code until everything works and then we make it available for everyone.
> But maybe, I'm not sure, this is such a huge task and there's so much to do that I'm not really
> sure what's the best way to do this.
>
> So I guess what I'm asking you to do is maybe audit everything, audit the full code, audit the
> N8N workflows, audit the Google Sheets, audit the SuperBase, and then think thoroughly about the
> plan. Like, we need to have a very, very good plan on the overall strategy of how we would go
> about this and then go from bigger to smaller and once we have the overall strategy we can think
> about the details and the last step I guess would be the the exact details of how things would
> look like so this is a whole planning process and I want you to stop at each step and confirm
> with me so we're going to the right direction.

**Follow-up decisions came in two later messages from the owner (2026-07-03); they are captured
in §2 above and in the Track B spec §2.** Notable direct constraints: role-based (3-tier) auth
rather than per-person accounts; keep Samples Old; Slack (not ro.am) notifications for now;
analytics stays on Sheets; back-office n8n stays; everything must be traceable with timestamps
for future debugging.
