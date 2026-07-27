# Client Footage Submission — design spec

> **Status:** Not built. Spec only, written 2026-07-27 from a real client's recorded feedback.
> Prerequisite (the regression that motivated it) is fixed and live — see
> `docs/ops/LINEAR_INTAKE_RECOVERY.md` and the intake fallback merged at `8ea9ab5`.

## Why this exists

A client recorded herself trying to hand over a month of filmed content and failing. Two distinct
problems surfaced in ninety seconds, and only the first was a bug.

**The bug (fixed).** `?intake=1#linear` refused to submit because the browser could not resolve a
filming plan: the plan reader had moved behind a staff-only Edge Function, while the submit gate
still required a browser-resolved plan URL, and intake mode *hides* that field. The client was
blocked by an invisible field and told to fix a document she has no access to. Reloading re-ran the
same failing request. Fixed — the plan is now resolved server-side, and a missing plan can never
refuse a submission.

**The design problem (this document).** Even working perfectly, the form asks for more effort than
the client thinks the task is worth. Her words, verbatim:

> "It said video one, and then it just had a place for notes — because I'm going to put them into
> folders in the Google Drive anyways. And I would love to just be able to write some notes about
> it, but I don't want to copy and paste each folder individually. I don't feel like it's actually
> worth the five minutes that it takes me, when you can just look at the Google Drive, that'll be
> like this all organized."

She is describing a per-video Drive-link field that duplicates organisation she has *already done*
in Drive. When a form is more work than the workaround, clients use the workaround — and the
workaround (drop it in Drive, message us) is invisible to SyncView, so nothing is tracked.

## What the client actually asked for

One batch-level Drive folder, plus a notes box per video. No per-video link pasting.

| Field | Today | Proposed |
|---|---|---|
| General Drive | one link for the batch | unchanged — this is the one link she already has |
| Per video: Drive link | required-feeling, one paste per video | **removed as the primary input** |
| Per video: notes | not present | **free text, the primary per-video input** |
| Per video: side camera / audio | separate link fields | keep, but clearly optional |

The ordering matters as much as the fields: the notes box should be what the client sees first for
each video, with link fields collapsed behind an optional disclosure. The current form leads with
links, which is what makes it read as "paste eight URLs."

## Open questions for the owner

1. **Does production need the per-video folder link at all?** If an editor can find video 3 by
   opening the batch folder and reading a note that names it, the per-video link is bookkeeping the
   client is doing on the team's behalf. If the link genuinely drives an automation, say which one.
2. **Does the note need any structure**, or is free text right? Free text is what she asked for.
3. **Is this surface client-facing by intent?** `?intake=1` is described in source as a "client
   intake link" and its submit path has no staff gate for non-rerouted clients, so in practice yes —
   but it has never been designed as a client-facing product. Decide that explicitly rather than
   inheriting it.

## Constraints any implementation must respect

- **Never refuse the submission.** The fallback rule established by the regression above: if
  anything internal is missing or unresolvable, create the work, mark it internally, alert the SMM.
  A client's filmed work must never be rejected over a bookkeeping field.
- **No staff-only read on a client path.** The regression's root cause. Any lookup the client's
  browser needs must be resolvable without a staff identity, or resolved server-side.
- **Test as a client.** Fresh profile, no staff identity in `localStorage`, a client that is not in
  `write_ui_reroute_clients`. A staff-signed-in test proves nothing on this surface — that is
  precisely why the regression shipped.
- **Make the human fallback explicit.** One line on the page: if anything goes wrong, upload to the
  Drive folder and message us. The client invented that fallback herself; it costs one sentence to
  make it official, and it is the only path that works when the page is broken.

## Sequencing

Not urgent, and deliberately not scheduled against the Linear→SyncView flip work. The immediate
client-facing failure is fixed; this is an effort-reduction change, best picked up after the flip
when the intake path is no longer split between a legacy and a native writer. Doing it before then
would mean building the same form twice.
