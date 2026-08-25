# Hiring Process — delivery-disabled contract

> **Current status (2026-08-25): private review base deployed; delivery disabled.** The public
> iClosed application event exists outside this repository. The private database sidecar and the
> staff-only `hiring-applications` function are deployed with `hiring_invites_enabled=false`. The
> separate `hiring-automation` bridge remains source-only. No iClosed capture, Slack/Telegram
> notification, interview-invite dispatcher, or candidate email has been enabled.

## Purpose

An applicant completes the external Client Success & Content Manager application. Kasper then reviews
the completed application privately and decides whether to invite that person to a call. An interview
calendar link is never public on the SyncView page and is never sent directly from the browser.

## Placement and access

- **Kasper → More → Pipeline & Admin → Hiring Process** (`#kasper/hiring-process`).
- The route, list, detail, and actions require a verified **Admin** staff identity. A URL parameter
  or the legacy Kasper unlock is not authorization.
- The list contains a compact projection only. Full answers, video, and the email preview appear only
  after selecting an application.
- Application state is memory-only and is purged on sign-out or identity revocation. It adds no
  localStorage cache, public route, browser table access, or background notification poll.

## Server boundary

The browser calls only `functions/v1/hiring-applications` with the existing verified staff headers.
It may list and inspect applications, set a review state, and request an invite job. It never calls
iClosed, Gmail, n8n, or Supabase PostgREST directly. The isolated capture path accepts only a
complete, current iClosed source snapshot; a partial, stale, or uncorrelated delivery must not create
or refresh an application. Every accepted fresh snapshot increments the server-side state version so
a stale review action cannot overwrite newer source truth.

The private `hiring-automation` function is the only intended server-to-server boundary for the
isolated n8n workflows. It requires a distinct `x-hiring-automation-key`, accepts only bounded
capture/claim/authorization/receipt/booking actions, and never makes an email, Slack, Telegram, or
iClosed provider call itself. It is source-only until a representative payload and credential setup
are tested.

The proposed database sidecar is deliberately separate from sales:

- `hiring_applications` stores the private mirrored application, its stable iClosed contact ID, and
  a server-side state version. The contact ID, not the applicant email, is the later interview-booking
  binding key.
- `hiring_invite_jobs` permits one durable job per application, so a double click or retry cannot
  create a second email. A job moves from `queued` to `dispatching` to `sent`, confirmed pre-send
  `failed`, or `delivery_uncertain`.
- `hiring_application_events` stores minimal audit events without copying full answers, video URLs,
  email bodies, or scheduling URLs.

`hiring_invites_enabled` defaults to `false`. The migration must abort rather than adopt or overwrite
an existing flag row, a malformed value, or an enabled (`true`) value. Until a separately approved
release changes the explicitly verified server-side value, asking to send an invite fails closed and
queues no email.

## Delivery certainty and retry policy

- The future dispatcher obtains a one-shot, claim-scoped authorization immediately before it sends.
  That gate treats only the exact JSON value `{"enabled": true}` as enabled. Missing, malformed,
  false, or changed flag state returns the job to the queue without releasing an email envelope.
- An application becomes `invited` only after the dispatcher has recorded an actual provider receipt.
  Queuing, claiming, and a network request alone are never evidence of delivery.
- A stale or abandoned `dispatching` claim becomes `delivery_uncertain`. It is never automatically
  requeued or resent, because the provider may already have accepted the message.
- Only a verified Admin may explicitly retry a **confirmed pre-send failure**. That retry must reuse
  the durable job/audit trail; it is not an automatic timeout recovery and is unavailable for
  `delivery_uncertain`.
- The interview-booking capture accepts the dedicated interview event only and binds it by the
  stable iClosed contact ID plus booking ID. Email remains a delivery field, never the booking join.

## Isolation and release gate

This workflow must not reuse `sales_intakes`, sales iClosed routing, sales n8n workflows, or public
browser write paths. A later live release requires all of the following before the flag can be enabled:

1. A representative iClosed application-status payload has been captured and mapped privately.
2. The additive private migration, the corrective pre-send authorization migration, and exact Edge
   Function sources have been applied/deployed and read back.
3. The approved sender/reply-to mailbox (`hello@synchrosocial.com`) and a dedicated isolated dispatcher are confirmed.
4. A synthetic end-to-end test proves complete/fresh source capture, state-version conflict handling,
   flag checks immediately before claim/send, provider-receipt-only invitation state, stale-dispatch
   containment, and one email/job outcome without contacting a real applicant.

The interview scheduler remains a separate direct iClosed event. Its link is server-owned and is
released only inside an approved applicant's invitation, never in the public application flow.
