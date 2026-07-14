# Sales Intake Form — Design Spec

This is the design and deployed-state record for the **Sales Intake** surface, originally
specified from owner calls and the former manual reference form on 2026-07-02.

> **Current status (verified 2026-07-14): the UI, schema, and active n8n workflow are deployed.**
> PR #652 and its old branch are historical; do not implement or push there. The route is **not
> go-live ready**: the active webhook authenticates no caller (F106), and its send branches return
> success before email while trusting browser-round-tripped preview state with no durable replay key
> (F107). Canonical evidence is `index.html`, `migrations/live-schema-baseline-2026-07-03.sql`,
> current sanitized n8n workflow detail, and `test/sales-intake-form.js`.

The private reference-form URL is intentionally not retained in this public repository. The field
contract below is self-contained.

## What it is

After Kasper closes a client on a sales call, he opens SyncView and fills out a short
internal form. Submitting it kicks off the whole paperwork chain automatically:

1. A **Sales & Service Agreement** is created on **eSignatures.com** from the existing
   template, with the template's placeholder fields filled from the form (client name,
   contract start date, deliverables, invoice amount, billing-period wording,
   termination clause).
2. The client receives an **email with the agreement to sign and the invoice** — the
   Stripe payment link matching the billing option Kasper picked.

Before this feature, the process was manual. The deployed form now starts the automation, subject
to F106/F107's containment and truthful-completion gates.

## Placement & gating

- Current placement is the **Sales Intake subtab inside the hidden Kasper page**, not a separate
  top-level tab. `?Kasper=1` sets a per-tab UI unlock only; it is not caller authentication.
  F106 requires an active individual Kasper/Admin principal before the subtab or webhook can perform
  privileged work.
- **Naming: do NOT call the page `intake`.** `?intake=1` / `body.intake-mode` already
  mean the client Linear-submission link. The deployed subtab key is `sales-intake`.

## Form fields

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 1 | Client name | text | yes | Fills the agreement's client-name placeholder. |
| 2 | Who closed the deal? | radio | yes | From the reference form. Only option today: **Kasper**. Keep it a radio so more closers can be added later. |
| 3 | Client Instagram | text | yes | Required in the reference form (on the call Kasper waffled — "maybe we don't need it" — but his form marks it required; match the form). |
| 4 | Client email | email | yes | Where the agreement + invoice email goes. |
| 5 | Contract start date | date | yes | The day the deal closed. Default to today. |
| 6 | Deliverables for client | textarea | yes | Kasper writes these himself, free text. Fills the deliverables placeholder. |
| 7 | Billing type | radio | yes | Four options: Monthly standard, Quarterly standard, Custom recurring, One-time project fee. Drives the invoice amount, Stripe link behavior, and agreement billing-period wording. |
| 8 | Recurring cadence | radio | conditional | Only shown/required for Custom recurring. Kasper picks every 4 weeks or every 12 weeks so the agreement and email use the right recurring wording. |
| 9 | Invoice amount | text currency (USD) | yes | Monthly standard ($2,997) and Quarterly standard ($7,991) show a fixed summary only. Free entry appears only for Custom recurring and One-time project fee. |
| 10 | Payment link | fixed summary or url | yes | Monthly standard shows the fixed 4-week Stripe link, Quarterly standard shows the fixed 12-week Stripe link. Custom recurring and One-time show only a pasted custom Stripe link field. The internal link-choice value remains hidden so the n8n payload stays compatible. |
| 11 | Termination clause | radio | yes | **Regular** → the standard clause (verbatim text below; also to be hosted on synchrosocial.com, not Notion). **Custom** → a textarea appears and Kasper pastes the clause. Both options show for every billing type. |
| 12 | Referred by | text | no | From the reference form; the only optional field on it. |

**Dropped:** the ACH-vs-credit-card payment-method option from call 2 — Kasper said
to forget it (follow-up, 2026-07-02). No payment-method field, no card-fee link
variants; the two Stripe links below are final.

### Regular termination clause (verbatim, from Kasper 2026-07-02)

> This Agreement may not be terminated during any active Quarterly Term. Upon
> acceptance, the Client is committed to completing the full three (3) consecutive
> four-week terms and shall remain responsible for all fees associated with that
> Quarterly Term, whether billed in advance or outstanding, regardless of whether the
> Client continues to use the services.

The wording is quarterly-specific ("full three (3) consecutive four-week terms").
That's fine by design: per call 1 the form simply offers Regular/Custom on every
deal and Kasper chooses — for non-quarterly deals he'll paste a Custom clause. Do
not auto-couple the clause to the billing type.

### Pricing (current package)

- **Monthly subscription** — **$2,997 per 4-week period**, renews every 4 weeks.
- **Quarterly** — **$7,991 per 12-week period**, renews every 12 weeks. Kasper: "most
  of our clients sign quarterly commitments."
- **Custom recurring** — custom amount and custom Stripe link, with Kasper selecting
  either every 4 weeks or every 12 weeks for the agreement/email wording. Use this
  for discounted or premium recurring packages.
- **One-time project fee** — custom amount, fixed set of deliverables, no renewal
  (e.g. the client Kasper closed the day of the call).

### Payment-link contract

- **Monthly:** the owner-approved four-week payment link.
- **Quarterly:** the owner-approved twelve-week payment link.

The exact links live in current application/runtime configuration and are not duplicated in this
public design record. Before a release, an authorized owner verifies product, amount, cadence, and
destination through the provider—not merely an HTTP 200 response.

(On call 2 Kasper floated separate ACH vs credit-card links plus a card-processing-fee
product, but he has since dropped the idea — these two links are final. Monthly →
4-week link, Quarterly → 12-week link. Custom recurring and one-time both require
Kasper to paste the custom Stripe link he created for that exact amount.)

## Submit flow

Follow the app's standard write path (browser never calls third parties directly):

```
Sales Intake tab ─POST {action, submission}─▶ n8n `sales-intake-submit`
    ├─▶ action `preview_contract`
    │   ├─▶ Supabase `sales_intakes` insert  (status: preview_requested)
    │   ├─▶ eSignatures.com API — create contract from the Sales & Service
    │   │    Agreement template, placeholder_fields from the form,
    │   │    signer = client email
    │   ├─▶ Supabase update (status: preview_created, contract id)
    │   └─▶ respond with signing URL; no client email is sent
    ├─▶ action `send_existing_contract`
    │   ├─▶ Supabase update existing preview row (status: contract_created)
    │   ├─▶ respond with the same preview signing URL
    │   ├─▶ Gmail sends ONE combined email to the client with that signing
    │   │    URL + the Stripe payment link
    │   └─▶ Slack DM confirmation
    └─▶ default submit
        ├─▶ Supabase `sales_intakes` insert  (audit log / status)
        ├─▶ eSignatures.com API create contract
        ├─▶ respond with signing URL
        ├─▶ Gmail sends ONE combined email to the client
        └─▶ Slack DM confirmation (mirror the onboarding-submit pattern)

**Deployed combined-email choice:** provider-owned email is suppressed; n8n sends one Gmail
message containing the signing and payment links.
```

> **F107 current failure contract:** the graph responds before Gmail in both send branches. The
> browser therefore sees `ok` and clears its draft before delivery is known. The preview-send path
> also trusts returned preview ID, contract ID, and signing URL without a server-side row/state
> lookup. This ordering is documented here as a blocker, not endorsed behavior.

- Autosave a draft to localStorage while typing; clear on successful submit; on webhook
  failure keep the draft and show retry (same behaviour as the onboarding form).
- Show a live email preview before submit. The Stripe button opens the actual
  Stripe link in a new tab. The agreement button is disabled-looking until Kasper
  clicks **Generate agreement preview**.
- **Generate agreement preview** creates the eSignatures agreement but does not
  send the client email. The returned signing URL turns the preview agreement
  button into a real link. If Kasper edits any form value afterward, the preview
  is invalidated so the final send cannot reuse stale agreement content.
- **Create agreement & send** reuses the generated preview agreement when it still
  matches the current form. If Kasper skips preview, the old one-click path still
  creates the agreement and sends the combined email.
- Success state should show what was created (client, amount, which link was sent) so
  Kasper can eyeball it.

### Supabase table — deployed

`sales_intakes` exists in the committed live-schema baseline with RLS enabled and no anon policy;
the browser does not read it directly. `migrations/sales-intake-migration.sql` is historical source
evidence, not a command to rerun. Future schema changes use the release manifest, TEST proof,
fingerprint/readback, and rollback controls.

Suggested columns: `id`, `created_at`, `closed_by`, `client_name`, `client_email`,
`instagram`, `contract_start_date`, `deliverables`, `billing_type`
(`monthly|quarterly|custom_recurring|one_time`), `invoice_amount`,
`payment_link`, `termination_clause_type` (`regular|custom`),
`termination_clause_text`, `referred_by`, `esign_contract_id`, `status`, `raw jsonb`.
Custom recurring cadence (`four_week|twelve_week`) is carried in `raw.billing_cadence`
and in the n8n/email helper fields; the live table does not need a new top-level
column because `sales_intakes.billing_type` is plain text and `raw` stores the full
submission payload.

### n8n workflow

Action modes:

- omitted/default: create the agreement and send the client email in one run.
- `preview_contract`: create the agreement and return the signing URL without
  sending Gmail.
- `send_existing_contract`: send the combined email using the previously returned
  preview signing URL and contract id.

The active `sales-intake-submit` POST workflow contains the deployed ledger, agreement, Gmail,
staff-notification, preview, and failure branches. Sanitized live graph review on 2026-07-14 found
19 nodes. Do not rebuild it from this design description.

- **eSignatures.com** — create contract from the managed n8n credential/template. Secret or
  template values never belong in `index.html`, this repository, screenshots, or audit output.
- **Combined email** — one email with the signing link + payment link (see the
  submit-flow note). The deployed graph uses Gmail after the webhook response; F107 requires a
  durable completion receipt and retry state before this is operationally truthful.

## Agreement-template contract — deployed; verify privately

The managed agreement template must preserve these rules:

1. Confirm/create placeholder fields for: client name, contract start date,
   deliverables, invoice amount.
2. **The hardcoded "per four week period" text must become a placeholder** — it has to
   read "per twelve (12) week period" for quarterly and appropriate one-time wording
   for project fees. Kasper called this out explicitly.
3. Termination clause placeholder: filled with the regular clause text or Kasper's
   custom text per the form.

## Current front-end integration points

Use symbols, never dated line numbers:

| Concern | Current source |
|---|---|
| Subtab registration and routing | `KASPER_SUBTABS`, `_kasperGotoTab`, `_kasperRenderTab` |
| UI unlock (visibility only) | `KASPER_UNLOCK_KEY`, `_kasperUnlocked` |
| Form render/validation/draft | `renderSalesIntakeView`, `_siValidate`, `_siBuildSubmission`, `SI_DRAFT_KEY` |
| Preview and final submit | `_siGenerateAgreementPreview`, `_siSubmit`, `_siShowDone` |
| Request helper | `_obPost`, `SALES_INTAKE_SUBMIT_URL` |
| Authorization gap | staff capability checks cover Credentials/Onboarding, not Sales Intake (F106) |

The onboarding form is public and is only a form-mechanics reference. Sales Intake must become an
individually authenticated privileged staff surface; a hidden subtab/query flag is not that gate.

## Deployed dependencies and open safety gates

- [x] Stripe payment links — 4-week and 12-week links received (see above).
- [x] Standard termination clause text — received verbatim (see above); still to be
      published on synchrosocial.com.
- [x] Agreement provider credential + template are configured through managed n8n state. Never
      copy their values into an implementation session, browser source, repository, or audit output.
- [x] Email shape confirmed: **one combined email** (agreement + payment link together).
- [ ] F106: active individual caller authorization, role decision, bounds/audit/idempotency, and
      deployed negative proof.
- [ ] F107: server-owned receipt/state, truthful completion UX, and partial-failure/retry proof.

## Out of scope for this feature (tracked from the same calls)

- Client credentials vault (all client usernames/passwords in one updatable place;
  SMMs only see clients assigned to them; Kasper sees all).
- Apply-page iClosed disqualification (<$250k/yr or "just exploring" can't book) —
  Kasper approved, already being handled.
- Monthly checkup emails: current client list is fine for now, don't add more yet.
- Nurture-email sequence rewrite — dropped; Sidney confirmed 2026-07-02 it's not a
  priority.
