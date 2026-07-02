# Sales Intake Form — Design Spec

Source: two calls between Sidney and Kasper on 2026-07-02 ("Client Onboarding and
Contract Automation Workflow" + "Client Onboarding, Payment Links and Email Sequence
Review"). This doc is the implementation contract for the new **Sales Intake** tab.

## What it is

After Kasper closes a client on a sales call, he opens SyncView and fills out a short
internal form. Submitting it kicks off the whole paperwork chain automatically:

1. A **Sales & Service Agreement** is created on **eSignatures.com** from the existing
   template, with the template's placeholder fields filled from the form (client name,
   contract start date, deliverables, invoice amount, billing-period wording,
   termination clause).
2. The client receives an **email with the agreement to sign and the invoice** — the
   Stripe payment link matching the billing option Kasper picked.

Today this is all manual (Kasper closes → someone manually triggers a Stripe-link
email). The form replaces the manual trigger. Kasper explicitly OK'd hosting this
inside SyncView.

## Placement & gating

- New top-nav tab in `index.html`, **hidden by default and Kasper-gated**, exactly like
  the existing Kasper tab: nav `<a>` ships with `style="display:none"` and is revealed
  by the same session unlock (`?Kasper=1` → `KASPER_UNLOCK_KEY` sessionStorage flag).
  Guard the `navTo` branch too, so the page can't be reached by hash alone.
- **Naming: do NOT call the page `intake`.** `?intake=1` / `body.intake-mode` already
  mean the client Linear-submission link. Use `sales-intake` (page id
  `'sales-intake'`, nav id `navSalesIntake`).

## Form fields

| # | Field | Type | Required | Notes |
|---|-------|------|----------|-------|
| 1 | Client name | text | yes | Fills the agreement's client-name placeholder. |
| 2 | Client email | email | yes | Where the agreement + invoice email goes. |
| 3 | Instagram handle | text | no | Kasper said it's probably not needed — keep optional. |
| 4 | Contract start date | date | yes | The day the deal closed. Default to today. |
| 5 | Deliverables | textarea | yes | Kasper writes these himself, free text. Fills the deliverables placeholder. |
| 6 | Billing type | radio | yes | Three options — see pricing below. Drives the invoice amount AND the agreement's billing-period wording. |
| 7 | Invoice amount | number (USD) | yes | Auto-filled from billing type ($2,997 monthly / $7,991 quarterly), editable; free entry when One-time is picked. |
| 8 | Payment method | radio | yes | **ACH** or **Credit card**. Added in call 2. Card payers do NOT share links with ACH payers — the card links carry a "Credit card processing fee" recurring product Kasper created in Stripe. |
| 9 | Payment link | radio + url | yes | **Monthly** → fixed Stripe link ("payment every four weeks"), **Quarterly** → fixed 12-week link, **Custom** → a url input appears and Kasper pastes the link he created in Stripe (always the case for one-time fees). |
| 10 | Termination clause | radio | yes | **Regular** → the standard clause (text pending from Kasper — he's drafting it; it will be hosted on synchrosocial.com, not Notion). **Custom** → a textarea appears and Kasper pastes the clause. |

### Pricing (current package)

- **Monthly subscription** — **$2,997 per 4-week period**, renews every 4 weeks.
- **Quarterly** — **$7,991 per 12-week period**, renews every 12 weeks. Kasper: "most
  of our clients sign quarterly commitments."
- **One-time project fee** — custom amount, fixed set of deliverables, no renewal
  (e.g. the client Kasper closed the day of the call).

### Stripe links (inputs to collect — not in the repo yet)

Kasper created these during/around the calls and sent them to Sidney directly:

- 4-week ("payment every four weeks") link — exists, sent in chat.
- 12-week link — created live on call 2.
- "Credit card processing fee" product — recurring, custom every-12-weeks, added while
  building the card variant of the link.

**Before wiring the form, get the final link matrix from Sidney/Kasper** — it should
be up to four fixed links (monthly-ACH, monthly-card, quarterly-ACH, quarterly-card)
plus the always-custom one-time case. The exact set Kasper landed on needs confirming;
only the 4-week link and a 12-week card-fee link are confirmed from the transcript.

## Submit flow

Follow the app's standard write path (browser never calls third parties directly):

```
Sales Intake tab ─POST {submission}─▶ n8n `sales-intake-submit`
    ├─▶ Supabase `sales_intakes` insert  (audit log / status)
    ├─▶ eSignatures.com API — create contract from the Sales & Service
    │    Agreement template, placeholder_fields from the form,
    │    signer = client email  (eSignatures emails the signing request)
    ├─▶ Invoice email to the client with the Stripe payment link
    └─▶ Slack DM confirmation (mirror the onboarding-submit pattern)
```

- Autosave a draft to localStorage while typing; clear on successful submit; on webhook
  failure keep the draft and show retry (same behaviour as the onboarding form).
- Success state should show what was created (client, amount, which link was sent) so
  Kasper can eyeball it.

### Supabase table

New migration file (root, `sales-intake-migration.sql`), **manually applied in the
Supabase SQL editor** like all others — there is no auto-runner. Model on
`onboarding-supabase-migration.sql`: RLS enabled, **no anon policies at all** (this
table holds billing data; service-role/n8n only — the tab itself doesn't need to read
it back for v1).

Suggested columns: `id`, `created_at`, `client_name`, `client_email`, `instagram`,
`contract_start_date`, `deliverables`, `billing_type`
(`monthly|quarterly|one_time`), `invoice_amount`, `payment_method` (`ach|card`),
`payment_link`, `termination_clause_type` (`regular|custom`),
`termination_clause_text`, `esign_contract_id`, `status`, `raw jsonb`.

### n8n workflow

New workflow `sales-intake-submit` (webhook POST), built like `onboarding-submit`
(webhook → build row → Supabase insert → Slack), plus two HTTP Request nodes:

- **eSignatures.com** — create contract from template. Secrets stay in n8n
  (credential / env), never in `index.html`. Sidney has an eSignatures account invite
  (Kasper sent it by email). Template ID + API token must be collected before this
  node can be finished — build it with a placeholder credential if needed and flag it.
- **Invoice email** — whatever mailer the existing n8n flows use (see the
  `content-ready` workflow behind `crSend()` for the email-via-n8n model). Open
  question below on one email vs two.

## eSignatures template work (separate task, same feature)

In the eSignatures.com template ("Sales & Service Agreement"):

1. Confirm/create placeholder fields for: client name, contract start date,
   deliverables, invoice amount.
2. **The hardcoded "per four week period" text must become a placeholder** — it has to
   read "per twelve (12) week period" for quarterly and appropriate one-time wording
   for project fees. Kasper called this out explicitly.
3. Termination clause placeholder: filled with the regular clause text or Kasper's
   custom text per the form.

## Front-end integration points

Mapped 2026-07-02 (line numbers will drift — re-grep before editing):

| Concern | Where |
|---|---|
| Nav buttons (copy `navKasper`, incl. hidden-by-default) | `index.html` ~4177–4220 |
| `navTo` router — active-class toggle + page branch | `index.html` ~11717, ~11741, ~11783–11839 |
| Kasper unlock block (reveal hidden nav buttons) | `index.html` ~25047–25068 (`KASPER_UNLOCK_KEY` ~24840) |
| `FAST_TABS` + refresh/deep-link restore | `index.html` ~24809, ~25285 |
| Form field helpers to model on (`_obField`, `_obSerialize`, `_obValidate`, `_obSubmit`) | `index.html` ~11919 / ~12432 / ~12446 / ~12462 |
| Webhook-URL constant pattern | `index.html` ~11848 (`ONBOARDING_SUBMIT_URL`) |
| Email-via-n8n model (`crSend` → `content-ready`) | `index.html` ~10519 / ~8289 |
| Read-back inbox pattern, if a submissions log view is wanted later | `renderOnboardingInbox` ~7464 |

Note the onboarding form is a standalone public page; this tab is the opposite — an
authenticated, Kasper-gated in-app tab. Model the *form mechanics* on onboarding and
the *tab registration/gating* on the Kasper tab.

## Prerequisites checklist (gather before/while implementing)

- [ ] Stripe payment links (final matrix incl. ACH vs card variants) — from Kasper's messages to Sidney.
- [ ] eSignatures.com API token + Sales & Service Agreement template ID — Sidney's invite is in his email.
- [ ] Standard termination clause text — Kasper is drafting it; will live on synchrosocial.com.
- [ ] Confirm with Kasper: does the card processing fee apply to monthly too, or only quarterly? (He only built the 12-week fee product on the call.)
- [ ] Confirm: one combined email (agreement + invoice) or two (eSignatures sends its own signing email; invoice mail separate)?

## Out of scope for this feature (tracked from the same calls)

- Nurture-email sequence rewrite (Kasper's comments: real numbers — Danny 500M+ views,
  Bea 200M+ total views, drop Morgan Birch; team emphasis; quarterly commitments;
  month 1 experiment / month 2 analysis / month 3 scaling narrative).
- Client credentials vault (all client usernames/passwords in one updatable place;
  SMMs only see clients assigned to them; Kasper sees all).
- Apply-page iClosed disqualification (<$250k/yr or "just exploring" can't book) —
  Kasper approved, already being handled.
- Monthly checkup emails: current client list is fine for now, don't add more yet.
