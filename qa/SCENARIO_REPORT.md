# Samples (Review) — end-to-end scenario suite

A data-driven suite that plays out **51 multi-actor stories** across the three
surfaces (SMM / Kasper / Client) through the **real UI against the live n8n +
Supabase backend**, verifying the live `sample_reviews` row after **every step**.
This is the automated stand-in for "open the page and click through every
interaction and combination yourself."

- **Engine:** `qa/scenario_engine.js` — interaction verbs (`smm.status/approve/
  request/note/markDone`, `kasper.approve/request/aat`, `client.approve/request`,
  `expect`, `expectComment`) driven through the actual DOM across three browser
  tabs, each step asserted against the live DB.
- **Library:** `qa/scenarios.js` — 51 stories. **Runner:** `qa/probes/run_scenarios.js`.
- **Filmstrips:** the main flows capture a screenshot at every beat (`/tmp/qa/scn/`).

## Result

**51 / 51 scenarios green · ~234 / 234 assertions · 0 app defects.**

The first full run was 42/51; the 9 failures were all in the *test harness or my
expectations*, never the app:
- **5 stale-tab** cases — a tab that another actor had changed underneath needed a
  forced reload before acting (engine fix: `clientAct` / `smmStatus` refresh + retry).
- **3 wrong expectations** — see OBS-S1 (the app's routing was correct).
- **1 transient curl** blip on a Supabase read (engine fix: resilient `row()`).
None indicated a bug in the feature.

## What the 51 scenarios cover

| Group | Scenarios |
|---|---|
| Clean paths | both-component SMM→Kasper→Client→Approved; single-component; SMM alt-route straight to Client |
| Request-change (per actor × per component) | SMM / Kasper / Client request on video and thumbnail |
| Approve-after-tweaks | Kasper AAT per component; full AAT→Client→Approved path; AAT continuation routing |
| Request→fix→re-approve loops | SMM / Kasper / Client, per component, incl. two-round repeats |
| Mixed-stage & mixed-routing | video at one stage while thumbnail at another; approve one + request the other; SMM video→Kasper while thumbnail→Client |
| Worst-of overall | In-Progress / For-SMM / Kasper / Client boundary cases |
| Notes / comments / mark-done | internal vs client audience matrix (2×2); plain note leaves status unchanged; note-then-request; mark a change-request done |
| Both-component round-trips | bounce both, fix both, approve both; client rejects both then approves both |
| The messy real-world round-trip | `full_bounce` — 22 steps: SMM approve→request→fix→approve, Kasper bounce→fix, Kasper approve, client bounce→fix, client approve, both components → Approved |

## OBSERVATIONS (behaviour to confirm — not bugs)

- **OBS-S1 — once Kasper has SEEN a component, an SMM re-approve goes straight to
  Client (Kasper is not re-bugged).** Concretely: Kasper requests a change → the
  editor fixes it → SMM re-approves → it routes to **Client Approval**, not back to
  Kasper for a second review. This is consistent, deliberate routing (the
  "seen-by-Kasper" flag), and matches the calendar's behaviour. Flagging only in
  case the intent for *Kasper-requested* changes is that Kasper should re-verify
  the fix — if so, that's a product tweak, not a bug. The app never errored.
