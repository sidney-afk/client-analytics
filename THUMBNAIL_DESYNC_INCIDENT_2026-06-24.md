# Incident: Linear ⇄ SyncView thumbnail/status drift — the *real* root cause (2026-06-24)

**Reported:** `daniellerobin/p_lin_vid12670` ("Video 1") — the **graphic/thumbnail**
showed **"Tweaks Needed"** on the website while the linked Linear issue **GRA-6386**
was **"For SMM approval"**. "We've done a ton of things to fix this and it still
happens — and there's more cards."

**Status:** root-caused with live evidence. This is the same *symptom* as the Oprah-2
incident (`LINEAR_DRIFT_INCIDENT_2026-06-19.md`), but a **different, deeper cause**.
Every prior fix addressed cadence/direction/timing; none of them touch the actual
failure, which sits one step **upstream** of all of them: the reconciler is **silently
blind** to a large rotating subset of cards.

---

## TL;DR

The Linear ⇄ SyncView reconciler resolves each card's Linear status by POSTing batches
of up to 50 issue links to the n8n **`linear-issue-statuses`** webhook, which packs them
into **one aliased GraphQL query** (`a0: issue(id:"GRA-6386"){…} a1: issue(id:"…"){…} …`).

**Linear returns a top-level error with `data: null` for the WHOLE query if *any single*
aliased id does not exist.** The webhook swallows that (`const data = resp.data || {}`)
and returns `{ ok: true, statuses: {} }` — looks successful, resolves nothing. The
reconciler accepts the empty batch, marks all 50 issues in it **"missing"**, and
`continue`s — so **none of those cards are ever reconciled.**

There are **289 dead Linear references** sitting on **archived** cards (deleted issues +
synthetic QA/test identifiers like `SIDV-*`, `SAV-*`, `VID-55555`, `DUPE-*`, `LCAPP-*`).
The reconciler resolves links for **all** cards — including the 1724 archived ones — so a
dead ref lands in the same 50-link batch as live cards (batches are built in
`client.asc` order) and **poisons the whole batch**, taking the healthy live cards down
with it.

**Net:** every 10 minutes the production reconciler logs, verbatim:

```
1972 cards · 765 linked issues · 265 Linear states · ledger 389 keys
IN SYNC 245 · archived 1724 · unmapped 6 · missing 132 · corrections 0
applied ok=0 fail=0
```

It resolves only **265 of 765** links, declares **132 live components "missing"**, makes
**0 corrections**, and reports **success**. `daniellerobin/p_lin_vid12670` (GRA-6386) is
one of the 132. The reconciler is healthy, runs on time, and heals nothing for these
cards.

---

## Evidence

1. **The card drifted for ~21 h.** GRA-6386 `stateHistory`: `Tweak Needed` (06-23
   17:59:05 → 06-24 00:27:02) then `For SMM approval` (06-24 00:27:02 → …). The card's
   `graphic_status_at` is **06-23 17:59:04** — i.e. it captured the *tweak* but **never**
   the 06-24 00:27 advance. The Linear→card fast-path webhook for that 00:27 event was
   dropped (best-effort), and the reconciler — the guarantee — never caught it.
   *(The card incidentally went back in sync at 21:54 when the SMM advanced GRA-6386
   again and that later webhook happened to deliver — not because the safety net fired.)*

2. **Poison proof (Linear GraphQL, the webhook's exact query shape):**
   ```
   50 healthy ids           -> resolved 50/50  data!=null  errors=0
   49 healthy + 1 dead id   -> resolved  0/50  data==null  errors=1   "Entity not found: Issue"
   ```
   One dead alias nulls the entire `data` for all 50.

3. **The webhook reports success on a poisoned batch.** `linear-issue-statuses`
   (`GP8CSZDNcy5sGdFr`) → `const data = (resp && resp.data) || {}` → builds an empty
   `statuses` → returns `{ ok: true, statuses: {} }`. The reconciler's `resolveLinear`
   only checks `j.ok && j.statuses` (truthy even when empty), so it accepts it and never
   retries.

4. **Blast radius.** A scan of all 749 referenced identifiers found **289 dead** — every
   one on an **archived** card. They are why 132 *live* components drop each run; which
   live cards get hit rotates as cards are added/archived (batch boundaries shift), which
   is why it looks random and "comes back".

5. **The reconciler is genuinely running.** n8n trigger `AkiFmromoDkmsh39` fires every
   10 min (682 runs, all success); the GitHub Action runs every 10 min via
   `workflow_dispatch`, all success. Cadence is fine. It just runs blind.

6. **Proof of the fix.** Resolving links for **live cards only** (382 identifiers, no
   archived dead refs in the mix) returns **382/382, 0 missing** — and the true,
   currently-drifted set collapses to **3 benign** components (brand-new cards whose
   status is still blank vs Linear "Todo/In Progress").

---

## Why every prior fix missed it

Exact `*_status_at` timestamps, the n8n 10-min trigger (Oprah-2), dedup-by-issue, the
Tweaks-Needed tie-break — **all operate *after* resolution.** If an issue never resolves,
the card is dropped before any of that logic runs. The resolver is a **silent single
point of failure upstream of every safety net.** The Oprah-2 fix made the reconciler
*run* reliably; this incident is why a reliably-running reconciler still heals nothing
for these cards.

**The website is not independently buggy.** Under the v2 realtime calendar the on-load
Linear pull is intentionally OFF, so the site faithfully mirrors Supabase; Supabase stays
stale because the reconciler can't write the correction. (Side effect worth noting: that
same v2 change removed the last client-side net that used to mask these dropped events.)

---

## The fix

**Primary (shipped on the fix branch — `scripts/linear-sync-reconcile.js`):**
1. **Resolve Linear for LIVE (non-archived) cards only.** The reconciler already *acts*
   on live cards exclusively; resolving archived links was pure waste and the entire
   source of poison. This alone removes all 289 dead refs from the batches (proven:
   382/382, 0 missing).
2. **Make `resolveLinear` poison-resilient.** If a batch comes back with fewer
   identifiers than requested, re-resolve the missing ones **individually** so a future
   dead ref *on a live card* can only ever drop itself — never its batch-mates.

**Recommended follow-ups (touch production — pending go-ahead):**
3. **Harden the `linear-issue-statuses` n8n webhook** so it can't silently swallow a
   Linear error: skip only the missing aliases (or resolve so a bad id can't null the
   batch), and **stop returning `ok:true` when Linear actually errored**. This is the
   shared resolver; hardening it protects every caller, not just the reconciler.
4. **Data hygiene:** scrub the 289 dead Linear links off archived cards, and stop the QA
   probes from leaving synthetic `SIDV-*/SAV-*/…` links behind. Lower priority once
   live-only resolution lands, but it removes the latent hazard entirely.
5. **Watch the safety cap.** With resolution fixed, a future backlog of genuine drift
   could exceed `CAP=15` and abort a run. Today only 3 (benign) components drift, so it's
   fine — but worth an alert if `missing`/`corrections` ever spike.

## Investigation note

All findings above are from **read-only** investigation (Supabase GETs, the public
`linear-issue-statuses` webhook, the Linear GraphQL read API, n8n execution metadata,
and GitHub Actions logs). No production workflow, database row, or Linear issue was
modified during diagnosis.
