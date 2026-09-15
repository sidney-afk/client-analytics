# Linear exit: execution map

One flat, numbered list of every step from here to a website that no longer
depends on Linear. This is the map an execution session follows and reports
against. It does not replace the detailed instructions; each step links to
them.

**Read first:** [living checkpoint](LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md) ·
[step detail](LINEAR_EXIT_INSTALLATION_DAY_20260914.md) ·
[recovery](LINEAR_EXIT_RECOVERY_PROCEDURE.md) ·
[owner before/after](LINEAR_EXIT_OWNER_BEFORE_AFTER_20260914.md)

Preparation only. Publishing this map authorizes nothing. Every step marked
**GATE** requires the owner's explicit go-ahead in the session where it happens.

---

## How to report progress

Count completed steps out of 28. Report it like this at the start of every
execution session and after every completed step:

```
Phase 3 of 7 · step 14 of 28 · 46% complete · next: 15 (verify installed catalog)
```

A step is complete only when its **Done when** column is satisfied and its
evidence is recorded. A step that was started and stopped is not complete;
report it as in progress with what remains. Never report a GATE as complete
because the preceding work is done; it is complete when the owner said yes.

---

## Phase 0 — Before the day (no freeze needed)

| # | Step | Who | Done when |
|---|---|---|---|
| 1 | Storage custody: capture, encrypt, upload privately, owner downloads, hash matches, isolated restore of the downloaded copy | Session + owner | Restore of the downloaded copy verifies, scratch server stopped, receipt recorded |
| 2 | Capture the currently deployed version of every Edge function and record its source pins | Session | Every deployed function has a recorded previous version; state whether one single older main commit matches all of them |

Step 2 answers the one open unknown in the recovery procedure. If no single
commit matches all functions, say so and stop to decide before the day, because
route C1 in the recovery procedure will not be available.

## Phase 1 — Freeze and go green

| # | Step | Who | Done when |
|---|---|---|---|
| 3 | Owner freezes main; no further merges until the day is finished | Owner | Owner states main is frozen and records the frozen SHA |
| 4 | Run the main catch-up rehearsal against the frozen SHA | Session | Rehearsal receipt written; conflicts are exactly the three reviewed files; any new main SQL is classified |
| 5 | **GATE** approve the actual branch catch-up | Owner | Explicit go-ahead recorded |
| 6 | Merge frozen main, stage the rehearsed resolution, regenerate the production-write fingerprint, run the deploy-lane test and identity-exposure check | Session | Every command exits zero; fingerprint, entrypoint hash and file count agree with the deploy lane |
| 7 | Push and wait for GitHub checks on that exact head | Session | 12 checks pass on the pushed head. Not green means stop |

## Phase 2 — Recoverable pre-state

| # | Step | Who | Done when |
|---|---|---|---|
| 8 | Fresh read-only catalog and identity check against the published baseline | Session | Exact supported baseline matched, project identity confirmed, TLS verified |
| 9 | Refresh the database backup: capture, encrypt, upload to the private Drive folder | Session + owner | Encrypted package uploaded, hash recorded |
| 10 | Owner downloads it on another device; restore the downloaded copy into an isolated database | Session + owner | Hash matches and the isolated restore verifies tables, rows and sequences |
| 11 | Record the pre-state: current authority, capability settings, Linear inbound/outbound settings, worker state | Session | Written snapshot exists, to compare against at step 25 |

If Storage custody was not completed in step 1, it is done here, before the
freeze holds any longer. Do not start it while files are being changed.

## Phase 3 — Install the SQL, dormant

| # | Step | Who | Done when |
|---|---|---|---|
| 12 | Run the install operator in its default read-only observation mode | Session | Identity, TLS and catalog observed; existing installation state reported |
| 13 | **GATE** approve APPLY for the exact plan, with the window evidence hash | Owner | Explicit go-ahead recorded; evidence hash supplied |
| 14 | Execute the 48-source, 55-chunk installation | Session | All 55 chunks journaled |
| 15 | Verify the installed result | Session | Exact catalog, routine and ACL comparison passes; retirement dependency check unchanged; finalizer removed only registered guards |

If step 14 stops partway: do not restart from zero and do not mark a chunk
complete by hand. Classify the committed prefix and resume the same plan with
the same identity. Nothing is activated by this phase.

## Phase 4 — Release the website and functions

| # | Step | Who | Done when |
|---|---|---|---|
| 16 | **GATE** approve the merge, accepting that it publishes the live browser and may auto-deploy staff functions | Owner | Explicit go-ahead recorded, ordering interval accepted |
| 17 | Merge the PR; Pages publishes | Session + owner | Merge complete |
| 18 | Verify the served browser | Session | Served browser SHA matches the merged commit; safe existing reads work |
| 19 | Run the 13-function Edge release lane and verify fingerprints | Session + owner | Every deployed function matches its expected fingerprint |

## Phase 5 — The one n8n change

| # | Step | Who | Done when |
|---|---|---|---|
| 20 | Capture the current published legacy editor workflow version and full graph privately | Session | Exact restorable capture recorded |
| 21 | **GATE** separate go-ahead for the one-line edit | Owner | Explicit go-ahead recorded in this same session |
| 22 | Remove only the displayed Linear link; read back the published version | Session | Exactly the reviewed text-only difference; every other field unchanged; no message sent |

This is the only n8n change in the entire migration. Every other workflow stays
untouched.

## Phase 6 — Observe, everything still dormant

| # | Step | Who | Done when |
|---|---|---|---|
| 23 | Verify safe existing reads across Calendar, Samples and Production | Session | Reads succeed; no page errors |
| 24 | **GATE** approve TEST saves, then run them | Owner + session | Status, stored row, receipt and event all verified. An HTTP 200 alone is not enough. No client Slack delivery |
| 25 | Confirm every new control is still dormant and pre-state settings are unchanged | Session | Compared against step 11 snapshot; notification sender, wake, follow-up supervisor, reconcile apply and census gates all still off |

At the end of phase 6 the install is live and inert. Existing behavior is
unchanged. This is a safe place to stop for days.

## Phase 7 — Turn on capabilities, one at a time

Repeat steps 26 to 28 per capability. Enable one, watch real work, then the
next. Linear stays running underneath the whole time.

| # | Step | Who | Done when |
|---|---|---|---|
| 26 | For the chosen capability: complete its deployment and configuration, then **GATE** approve enabling it | Owner + session | Configuration in place; explicit go-ahead for this one capability |
| 27 | Enable the single flag and watch real work flow through it | Session + owner | Its own acceptance checks pass against real usage |
| 28 | Record the website dependency it closes: the exact gate, the accepted replacement, and evidence the legacy route is unreachable | Session | Recorded for that capability in the checkpoint dependency table |

Stop on any required path with no accepted replacement. If a capability
misbehaves, turn that one flag back off; Linear is still underneath.

Website independence is complete when every row of the dependency table in the
checkpoint has an accepted replacement and an unreachable legacy route.

---

## Out of scope

Actual Linear retirement is not in this map and is not a later step of it.
Retiring, cancelling or disconnecting Linear, its credentials, billing, data or
its own integrations would need a new, separate owner decision and its own plan.
Verified native receipts are kept, never deleted.

## Stop conditions

Stop and report, at any step:

- GitHub checks are not green on the exact head
- The fresh catalog does not match the supported baseline
- New main schema changes appear that are not classified
- The installation stops partway
- A deployed function does not match its expected fingerprint
- A TEST save returns success but leaves no stored row or receipt
- Any approval is missing for the step in front of you

Then open the [recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md) and use
its stop-or-continue table before doing anything else.
