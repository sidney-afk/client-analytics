# Sales Intake Form — Design Spec

This is the design and deployed-state record for the **Sales Intake** surface, originally
specified from owner calls and the former manual reference form on 2026-07-02.

> **Current status (verified 2026-07-14): the UI, schema, and active n8n workflow are deployed.**
> PR #652 and its old branch are historical; do not implement or push there. The route is **not
> go-live ready**: the active webhook authenticates no caller (F106), and its send branches return
> success before email while trusting browser-round-tripped preview state with no durable replay key
> (F107). The downstream contract/payment callbacks also trust unverified caller events (F115), and
> their mirrored stale-snapshot gate can lose or duplicate the onboarding email (F116). Canonical
> evidence is `index.html`, `migrations/live-schema-baseline-2026-07-03.sql`,
> current sanitized n8n workflow detail, and `test/sales-intake-form.js`.
>
> **Amended 2026-08-20:** the payment link is no longer Stripe-only. Kasper now picks a
> **payment processor** (Stripe or Commas) as a second axis alongside billing type, and the
> combined email carries the link for the processor he picked. The safety gates below are
> unchanged by this — F106/F107/F115/F116 all still stand, and Commas adds a third provider
> callback to the F115 surface rather than replacing one.

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
   payment link matching the **processor and billing option** Kasper picked.

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
| 7 | Billing type | radio | yes | Four options: Monthly standard, Quarterly standard, Custom recurring, One-time project fee. Drives the invoice amount, payment-link behavior, and agreement billing-period wording. |
| 8 | Recurring cadence | radio | conditional | Only shown/required for Custom recurring. Kasper picks every 4 weeks or every 12 weeks so the agreement and email use the right recurring wording. |
| 9 | Invoice amount | text currency (USD) | yes | Monthly standard ($2,997) and Quarterly standard ($7,991) show a fixed summary only. Free entry appears only for Custom recurring and One-time project fee. |
| 10 | Payment processor | radio | yes | **Stripe** or **Commas**. Added 2026-08-20. Deliberately has **no default** — it decides which account the money lands in, so Kasper must pick it explicitly rather than inherit a silent one. |
| 11 | Payment link | fixed summary or url | yes | Resolved from **processor × billing type**: Monthly standard shows that processor's fixed 4-week link, Quarterly standard its fixed 12-week link. Custom recurring and One-time show only a pasted custom link field, which must belong to the processor picked in field 10. The internal link-choice value remains hidden so the n8n payload stays compatible. |
| 12 | Termination clause | radio | yes | **Regular** → the standard clause (verbatim text below; also to be hosted on synchrosocial.com, not Notion). **Custom** → a textarea appears and Kasper pastes the clause. Both options show for every billing type. |
| 13 | Referred by | text | no | From the reference form; the only optional field on it. |

**Dropped:** the ACH-vs-credit-card payment-method option from call 2 — Kasper said
to forget it (follow-up, 2026-07-02). No payment-method field, no card-fee link
variants.

**Superseded 2026-08-20:** "the two Stripe links are final" held only while Stripe was the
only processor. There are now **two standard links per processor** — four fixed links total —
and the pair in play is chosen by field 10. Adding a processor means adding a row to that map,
not re-deciding this.

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
- **Custom recurring** — custom amount and a custom link **created on the selected
  processor**, with Kasper selecting either every 4 weeks or every 12 weeks for the
  agreement/email wording. Use this for discounted or premium recurring packages.
- **One-time project fee** — custom amount, fixed set of deliverables, no renewal
  (e.g. the client Kasper closed the day of the call).

### Payment-link contract

The link is a function of **two** inputs, not one:

| | Stripe | Commas |
|---|---|---|
| **Monthly (4-week)** | owner-approved four-week link | owner-approved four-week link |
| **Quarterly (12-week)** | owner-approved twelve-week link | owner-approved twelve-week link |
| **Custom recurring** | Kasper pastes a Stripe link for that exact amount | Kasper pastes a Commas link for that exact amount |
| **One-time project fee** | Kasper pastes a Stripe link for that exact amount | Kasper pastes a Commas link for that exact amount |

The exact links live in current application/runtime configuration and are not duplicated in this
public design record. Before a release, an authorized owner verifies product, amount, cadence, and
destination through the provider—not merely an HTTP 200 response. The Commas standard links were
matched to their Stripe counterparts **by price and cadence**, which is a claim about provider
state and therefore belongs to that same owner verification — a 200 from the checkout page proves
the page exists, not that it charges the right amount on the right schedule.

Four rules the implementation enforces. Each one closes a path where a wrong link reaches a
paying client and nothing visibly breaks — the browser shows a plausible preview, n8n returns
`ok`, and the mistake surfaces only when the money lands in the wrong place or at the wrong
amount:

1. **A standard billing type may not carry an arbitrary link.** Monthly and Quarterly resolve
   from the map; a submission whose link is not the mapped one is rejected server-side.
2. **A custom billing type may not carry a standard link.** Pasting one of the four fixed links
   into a custom deal is rejected — it would bill the package price, not the negotiated one.
3. **A pasted link must belong to the processor that was picked.** Selecting Commas and pasting a
   Stripe URL (or the reverse) is rejected in the browser. Without this the preview and the n8n
   payload would both say "Commas" while the money went to Stripe.
4. **The resolved URL is what gets validated**, not the inputs that feed it. A missing processor
   or a gap in the link map yields an empty string that would otherwise pass field-level checks
   and fail in n8n after Kasper has already hit send.

(On call 2 Kasper floated separate ACH vs credit-card links plus a card-processing-fee
product, but he has since dropped the idea — no payment-method axis exists. Processor is a
separate axis from payment method and does not revive that idea.)

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
    │   │    URL + the resolved payment link (Stripe or Commas)
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
- Show a live email preview before submit. The payment button opens the actual resolved
  link in a new tab and is **labelled with the processor that was picked** — a preview that
  always says "Stripe" is the only manual check standing between a wrong link and a client,
  so it must not lie. The agreement button is disabled-looking until Kasper clicks
  **Generate agreement preview**.
- **Generate agreement preview** creates the eSignatures agreement but does not
  send the client email. The returned signing URL turns the preview agreement
  button into a real link. If Kasper edits any form value afterward, the preview
  is invalidated so the final send cannot reuse stale agreement content.
- **Create agreement & send** reuses the generated preview agreement when it still
  matches the current form. If Kasper skips preview, the old one-click path still
  creates the agreement and sends the combined email.
- Success state should show what was created (client, amount, which processor and which
  link was sent) so Kasper can eyeball it.

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

`payment_processor` (`stripe|commas`) follows the same rule — it rides in `raw` and is **not**
a top-level column. This is load-bearing, not incidental: the workflow's ledger insert
auto-maps the submission onto table columns, so the field had to be added to that node's
ignore list at the same time as the UI. Sending a field the table does not have would have
failed **every** submission, Stripe ones included, not just Commas ones. Any future field added
to the submission payload needs the same treatment before it ships.

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
| Processor × billing link resolution | `SI_PAYMENT_LINKS` (`{stripe, commas}`), `SI_STRIPE_LINKS`, `SI_COMMAS_LINKS`, `SI_PROCESSOR_LABELS`, `_siResolvePaymentLink` |
| Preview and final submit | `_siGenerateAgreementPreview`, `_siSubmit`, `_siShowDone` |
| Request helper | `_obPost`, `SALES_INTAKE_SUBMIT_URL` |
| Authorization gap | staff capability checks cover Credentials/Onboarding, not Sales Intake (F106) |

The onboarding form is public and is only a form-mechanics reference. Sales Intake must become an
individually authenticated privileged staff surface; a hidden subtab/query flag is not that gate.

## Deployed dependencies and open safety gates

- [x] Stripe payment links — 4-week and 12-week links received (see above).
- [x] Commas payment links — 4-week and 12-week counterparts identified from the live Commas
      product list by price and cadence (2026-08-20). Owner/provider verification of product,
      amount, cadence, and destination is still the release gate, same as for Stripe.
- [x] Standard termination clause text — received verbatim (see above); still to be
      published on synchrosocial.com.
- [x] Agreement provider credential + template are configured through managed n8n state. Never
      copy their values into an implementation session, browser source, repository, or audit output.
- [x] Email shape confirmed: **one combined email** (agreement + payment link together).
- [ ] F106: active individual caller authorization, role decision, bounds/audit/idempotency, and
      deployed negative proof.
- [ ] F107: server-owned receipt/state, truthful completion UX, and partial-failure/retry proof.
- [ ] F115: provider-native raw-body signature, timestamp/replay/type/mode/account validation,
      server-owned payment/agreement correlation, and durable inbox before 2xx for both callbacks.
- [ ] F116: one atomic, unique onboarding-email gate/job with resumable step receipts, reconciliation,
      and synchronized two-callback/duplicate/failure proof.

## Downstream contract/payment gate — current blockers

Agreement creation is not proof that the expected agreement was signed, and a payment-link email is
not proof that the expected first invoice was paid. The two active provider callbacks currently
derive those facts from unverified incoming fields. One route has no gate; the other compares a
static caller-body token rather than the provider's native raw-body signature. Neither correlates
the event to server-owned Sales Intake agreement/payment state, and both acknowledge before
downstream completion (F115).

**Commas adds a third provider callback (2026-08-20).** A payment made on Commas notifies a
separate receiver from the Stripe one, so the payment half of the two-of-two gate now has two
possible sources feeding the same contact flag. Three things about it differ from Stripe and are
easy to get wrong: Commas signals a renewal as its own event **type**, not via Stripe's
`billing_reason` field, so a renewal gate written against Stripe does not port and a renewal for
an existing client can otherwise re-run onboarding; Commas delivers **at-most-once and never
retries**, so a missed delivery is missed permanently and makes a reconciler more necessary here
than on Stripe, not less; and it signs with an HMAC over the **raw** body, which means the
receiver has to read raw bytes before any JSON parsing and fail closed. Two Commas receivers
were briefly live and subscribed at the same time on 2026-08-20; because each reads the contact
before either writes, a single payment could have produced two onboarding emails. The duplicate
was archived. Anyone adding a receiver should check the provider's existing webhook
subscriptions first — a second subscription is invisible from inside n8n.

They also implement the two-of-two gate as two mirrored workflows. Each reads the contact, updates
its own flag, and evaluates the other flag plus `onboarding_sent` from the older read. A simultaneous
valid pair can therefore leave both flags true without an email; retries can dispatch more than one
asynchronous email child. There is no durable unique gate job or reconciler (F116). The replacement
must be one idempotent state transition and resumable communication job, not two reordered variants
of the current graph.

## Out of scope for this feature (tracked from the same calls)

- Client credentials vault (all client usernames/passwords in one updatable place;
  SMMs only see clients assigned to them; Kasper sees all).
- Apply-page iClosed disqualification (<$250k/yr or "just exploring" can't book) —
  Kasper approved, already being handled.
- Monthly checkup emails: current client list is fine for now, don't add more yet.
- Nurture-email sequence rewrite — dropped; Sidney confirmed 2026-07-02 it's not a
  priority.
