# PTO lifecycle simulation

This suite tests the PTO experience as a person experiences it: perform an
action, wait for the visible result, assert both screen and state, then capture
a screenshot. It is separate from the component-focused
`docs/syncview-design/tests/pto-ui-polish.js` suite.

## Lane A — stateful synthetic browser run

```bash
npm run test:pto-lifecycle
```

The default run:

- loads the real `index.html` in Chromium;
- intercepts every external request;
- uses three synthetic TEST personas, including two people who share the same
  creative-role key;
- derives balances and business-day counts from the production
  `supabase/functions/pto/policy.js` module;
- exercises the complete request/decision/cancellation, error/retry, multi-tab,
  sign-in, and time-travel state matrix on desktop;
- repeats a real touch-emulated happy path at 390px, including separately
  captured dropdown, calendar, stepper, note, submit, admin, and result states;
- runs a keyboard-only path from page entry through the staff menu, branded
  controls, submit, Kasper navigation, decision controls, and result refresh,
  with intermediate focus/open-control screenshots;
- writes screenshots, a manifest, a gallery, and a visual-review checklist to
  `.codex-tmp/pto-lifecycle/latest/`.

No live API, roster, runtime flag, migration, n8n workflow, Linear project, or
Production surface is read or changed.

Maintainers may deliberately refresh the curated, synthetic-only evidence:

```bash
node qa/pto-lifecycle/run.js --update-public
```

That command first builds the complete candidate packet under
`.codex-tmp/pto-lifecycle/public-stage/`. It replaces the generated
screenshots, manifest, gallery, and checklist inside
`docs/audits/2026-07-17-pto-lifecycle-simulation/` only after the browser run
passes and every current screenshot has a complete, hash-matching visual
review with no `broken` verdict. If either gate fails, the command exits
non-zero, leaves the staged candidate available for inspection, and preserves
the prior public packet and authored `FINDINGS.md`.

After a successful refresh, run the no-browser integrity gate:

```bash
node qa/pto-lifecycle/run.js --validate-public-evidence
```

It verifies the current source fingerprint, every committed screenshot hash,
the exact manifest/gallery/checklist inventory, the raw review file's public
safety, and a complete review with no pending or broken frame. The purple
banner in each frame must say `SYNTHETIC PTO TEST · NO REAL DATA`.

## Lane B — opt-in disposable production drill

```bash
npm run test:pto-live-drill
```

Lane B fails closed unless all private variables below are present:

- `PTO_LIVE_CONFIRM=DISPOSABLE_UNPAID_ONLY`
- `PTO_LIVE_BASE_URL=https://syncview.synchrosocial.com`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PTO_LIVE_TEST_ROLE_KEY`
- `PTO_LIVE_ADMIN_ROLE_KEY`
- `PTO_LIVE_TEST_MEMBER_ID`
- `PTO_LIVE_TEST_MEMBER_NAME`
- `PTO_LIVE_TEST_MEMBER_ROLE`
- `PTO_LIVE_ADMIN_MEMBER_ID`
- `PTO_LIVE_ADMIN_MEMBER_NAME`

Both identities must be existing active roster rows whose names begin with
`TEST`; the staff row must already have PTO enabled. The lane will not provision
or use a real staff profile.

The browser receives a synthetic overview projection so no live roster,
balance, hire date, history, or note is displayed. Only the production
`quote`, `request`, and `decide` calls are allowed. The runner records the
returned request identifier in memory, deletes that exact TEST row with
service-role credentials in `finally`, verifies zero matching request-row
residue, and confirms `pto_v1` is byte-equal before/after without writing the
flag. The insert, approval, and cleanup legitimately advance the dedicated
TEST member's monotonic PTO state version; the lane does not claim that counter
is restored.

Live screenshots stay under `.codex-tmp/pto-lifecycle-live/`; they must never be
committed. Standard output is aggregate and value-free.

## Visual review rule

A green automation result does not make a screenshot visually correct. The
suite captures every lifecycle transition plus the transient branded-control,
confirmation, touch, and keyboard-focus actions above. Open the generated
`gallery.html`, then mark every row in `VISUAL_REVIEW.md` on both axes:

1. the screen looks intentional (layout, hierarchy, clipping, contrast);
2. the screen visibly reflects the action that just happened.

Record confusing or broken states in the audit findings even when the
underlying state assertion passed.

Store the completed machine-readable verdicts in
`qa/pto-lifecycle/visual-review.json`, keyed by screenshot filename. Each value
must be an object with exactly:

```json
{
  "sha256": "the 64-character hash from the candidate manifest",
  "verdict": "ok",
  "note": ""
}
```

`verdict` is `ok`, `warning`, or `broken`; `warning` and `broken` require a
non-empty note. Bare-string verdicts, extra fields, unsafe text, stale hashes,
and entries for screenshots outside the current run fail closed. A changed
image invalidates its prior verdict even when the filename stays the same.

Review the private candidate, update the hash-bound verdict file, then rerun
`node qa/pto-lifecycle/run.js --update-public`. The committed manifest must
report a complete review with no pending or broken frame, and
`--validate-public-evidence` must pass before the packet is committed.
