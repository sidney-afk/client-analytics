# Client Lifecycle Map — pointer

The **master map of the entire client lifecycle** (traffic → booking →
nurture → sales close → contract/invoice → onboarding → provisioning →
samples → production → ongoing automations) lives in the website repo:

**`synchrosocial/docs/CLIENT_LIFECYCLE_MAP.md`**
<https://github.com/sidney-afk/synchrosocial/blob/main/docs/CLIENT_LIFECYCLE_MAP.md>

It was mapped 2026-07-10 from the live n8n instance (all 92 workflows),
both repos, Linear, and HubSpot. It includes:

- the full booking + nurture + sales-close automation chain (n8n),
- the HubSpot property/deal-stage state machine,
- the onboarding form pipeline and its fallback layers (this repo),
- the automated provisioning vs. **manual per-client setup checklist**
  (every system a new client must exist in, and what's automated),
- the samples + production loop (calendar, Linear sync, filming plans),
- the complete n8n workflow inventory and cross-system relationship map,
- in-flight migrations (Track A / Track B / off-Sheets) and a dated list
  of drift/gaps/risks found during mapping.

Docs in THIS repo that it builds on: `NEW_CLIENT_ONBOARDING.md`,
`ONBOARDING_FORM.md`, `ONBOARDING_FALLBACK.md`, `SALES_INTAKE_DESIGN.md`,
`FILMING_PLANS_DESIGN.md`, the `SAMPLES_*` docs, `LINEAR_SYNC_RECONCILE.md`,
`TRACK_A_EDGE_FUNCTIONS_SPEC.md`, `TRACK_B_LINEAR_REPLACEMENT_SPEC.md`.

> Known doc drift as of 2026-07-10: `SALES_INTAKE_DESIGN.md` still says the
> `sales-intake-submit` n8n workflow is pending — it is live and active
> since 2026-07-09.
