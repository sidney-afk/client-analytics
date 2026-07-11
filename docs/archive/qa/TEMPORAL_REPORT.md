# Samples (Review) — Temporal / responsiveness report

How the feature *behaves over time*: UI responsiveness, persist latency, and
whether anything flickers or reverts. Every interaction below was driven through
a real headless Chromium against the LIVE n8n + Supabase backend, instrumented
with a MutationObserver that timestamps every DOM change (so sub-frame flicker is
caught). Each state-changing action was then bombarded with **5 background reloads
+ a realtime echo** during the persist window — the exact conditions that could
cause a snap-back — to prove the order/state holds.

- **UI** = optimistic, in-page latency from click to the visible change (synchronous render).
- **DB** = round-trip until the change is readable in Supabase (includes test-harness
  courier overhead; a direct browser connection is faster). This latency is invisible to
  the user because the UI is optimistic.
- **Flicker / Revert** = did the state oscillate or snap back under reload+echo stress.

## SMM Sheet — `ot_temporal_smm.js`

| Action | UI | DB | Flicker | Revert |
|---|---|---|---|---|
| video → For SMM Approval | 5.4ms | 4.1s | none | no |
| video → Kasper Approval | 3.4ms | 2.2s | none | no |
| video → Client Approval | 3.7ms | 2.8s | none | no |
| video → Approved | 3.7ms | 3.1s | none | no |
| graphic → Kasper Approval | 3.4ms | 2.2s | none | no |
| add note | optimistic | 1.7s | no disappear | no |
| mark change-request done | 3.8ms | 1.8s | stays resolved | no |

## Kasper samples queue — `ot_temporal_kasper.js`

| Action | UI | DB | Card reappears? |
|---|---|---|---|
| approve → Client | 1.6ms | 4.3s | no |
| request change → Tweaks Needed | 1.3ms | 1.7s | no |
| approve-after-tweaks → For SMM | 1.4ms | 2.8s | no (AAT flag set) |

## Client share + multi-actor — `ot_temporal_client_combo.js`

| Action | UI | DB | Notes |
|---|---|---|---|
| client approve → Approved | 2.7ms | 4.0s | card removed optimistically |
| client request-change → Tweaks Needed | 1.6ms | 2.3s | client comment persisted |
| **SMM video + Kasper graphic at the same time** | — | — | **both persist (field-level merge, no clobber)** |

## Reorder (drag) — `ot_temporal_flicker.js`

- DOM reorder latency: **0.2ms** (synchronous on drag)
- Persist: ~5s; order timeline = exactly one transition (`ABC → CAB`)
- **No revert** across 5 background reloads + a realtime echo (optimistic guard holds); flips = 1

## Verdict

Across SMM, Kasper, Client, and concurrent multi-actor use: every interaction is
**optimistic and instant (1–5ms)** in the UI, persists in **~2–4s invisibly**, and
shows **zero flicker and zero revert** even under deliberate reload + realtime-echo
stress. Concurrent edits to different components of the same sample **merge field-
level** with no clobber. 0 app JS errors anywhere.
