# Slack → Roam Migration Audit

> **Date:** 2026-06-29 · **Status:** Audit only — *no code or workflows were changed.*
> **Scope:** every place the SyncView system depends on Slack, and exactly what must change to run on Roam.
> Covers the n8n workflows, the SyncView SPA (`index.html`), the Google Sheets identity maps, the
> Supabase data model, edge functions, CI, and tests — across `client-analytics` and `synchrosocial`.
>
> **Decisions confirmed (2026-06-29):** (1) "Roam" = **ro.am**, the virtual-office product. (2) Every
> notification that is a DM today will be delivered as a **channel/group post** on Roam's **stable** API — we
> deliberately avoid the Alpha DM/user-lookup endpoints. See §Feasibility and §Migration plan.

---

## Executive summary

Slack is wired into **three surfaces**: n8n workflows (the bulk of it), the SyncView SPA, and the Google
Sheets identity maps that feed both. After triaging all **72 n8n workflows**, the live Slack footprint is:

- **8 Slack-touching n8n workflows** — 6 obvious from their descriptions + **2 hidden** in null-description
  workflows (`VIDEO PRODUCTION AUTOMATION`, `AI WORKFLOW`) — spanning **~13 Slack-coupled nodes** (DM sends,
  channel posts, channel create/invite, one `views.open` modal call) plus Code nodes holding hardcoded Slack-ID maps.
- **3 SPA touchpoints** in `index.html`: the per-client "Send Slack Update" button, the "URGENT TWEAKS NEEDED"
  editor ping (3 entry points → 1 dispatch), and the per-card "Slack" DM deep link.
- **Google Sheets identity columns** that store Slack identifiers: `Clients Info.slack_channel_id` (populated)
  and the SMM map's `slack_profile_url` (populated — it actually holds a Slack **user** ID), plus `slack_team_id` /
  `slack_user_id` that the SPA reads *defensively* and may not physically exist yet (see §3). Sidney's DM ID
  `U0ACW93FS30` is also hardcoded directly into workflow nodes.
- **Zero** Slack dependencies in the Astro marketing site (`synchrosocial`), in Supabase columns, in edge
  functions, and in CI. **No inbound Slack triggers** — every touchpoint is outbound, with one Slack-modal
  *input* flow (the "Content Ready" slash command in `AI WORKFLOW`).

**Can we send messages to Roam? Yes.** The platform is confirmed as **ro.am** (the Roam virtual office), which has
a documented REST API (`https://api.ro.am/v1`, Bearer auth) reachable from n8n's generic **HTTP Request** node.
**There is no native n8n Roam node and no community node**, so every Slack node must be rebuilt as an HTTP Request
call — but all of it targets Roam's **stable** endpoint.

- **Channel / group posts are stable and production-safe today** via `POST /v1/chat.sendMessage`.
- DMs + user lookup exist only in Roam's *Alpha* Chat API — **so every notification, including the 5 that are DMs
  today, is being routed through channels instead** (decision below). This keeps the whole migration on the stable API.

**Single biggest risk (now that DMs are off the table):** the weekly-report messages are **Slack Block Kit**, which
does not port and must be re-authored as Roam blocks/markdown. Two smaller open items: confirming that an
`@mention` of a specific person renders inside a **stable** channel post (needed so the SMM / editor still gets
pinged), and whether Roam supports programmatic channel **member invite** for the `AI WORKFLOW` onboarding flow.

---

## Feasibility: can Roam even do this?

### Which "Roam"?

Three products carry the name; only one fits a Slack replacement.

| Candidate | What it is | Channels + DMs? | Messaging API? | Verdict |
|---|---|---|---|---|
| **ro.am** (Roam virtual office / "Roam HQ") | Virtual-office collaboration platform; chat layer has channel-style groups + DMs | Yes | Yes — REST `api.ro.am/v1` | **Confirmed target** |
| Roam Research (roamresearch.com) | Networked note-taking / PKM tool | No | Graph-blocks API only; no message-send | Ruled out |
| Any other "Roam" chat product | — | — | — | None found |

> ✅ **Confirmed (2026-06-29):** "Roam" = **ro.am**.

### The API (ro.am)

- Docs at `https://developer.ro.am/`; base `https://api.ro.am/v1`; auth `Authorization: Bearer <API_KEY>`,
  created in **Roam Administration → Developer**. Maps cleanly to a single n8n **HTTP Header Auth** credential.
- **No native n8n node and no community node** — the generic **HTTP Request** node is the only path.

### Two surfaces, different maturity — this is the crux

| Capability | Stable (v1) `chat.sendMessage` | Alpha Chat API (`chat.post`, `user.*`) |
|---|---|---|
| Post to a channel/group | **Yes** — recipient = group UUID; `text` (+ optional markdown/`sender`) | Yes |
| **DM a single user** | **No** — docs: "only support sending to a single group recipient" | **Yes** |
| User lookup (email → ID) | **None** | Yes (`user.list` / lookup) |
| Channel/group creation | not in v1 | `group.create` appears in the Alpha endpoint list |
| Stability | **Stable** | **Alpha — "may change"** |

**Identifier translation:** Slack channel `C…` → Roam **group UUID** (enumerate via the groups list); Slack
user `U…` / DM target → Roam **user ID** (Alpha user lookup, ideally by email). The bot identity ("SyncView
Bot" / "Slack account 2") is replaced by Roam's `sender` object / an Organization-mode bot.

### Honest caveats (verified-vs-assumed)

- **Confirmed:** v1 `chat.sendMessage` is group-only; DMs + user lookup are Alpha; an Alpha `chat.post` exists
  that can post to users/bots; `group.create` is listed in the Alpha surface; no native/community n8n node.
- **Assumed — confirm against the live OpenAPI at access time:** the exact Alpha field names, an email-based
  user-lookup endpoint, the mention syntax (`<@U-…>`), and any block/size limits. **The editor/SMM email→ID
  resolution depends entirely on a user-lookup endpoint existing — this is the single most fragile assumption.**
- Programmatic **member invite** (needed by onboarding channel provisioning) is unconfirmed even though
  `group.create` exists.
- No documented rate limits for bulk sends (only payload size limits). Any "n8n integration" Roam advertises is
  marketing (MCP/Zapier-style), **not** a verified node. Line breaks may require double newlines.

**Bottom line:** Channel posts — feasible and stable today. DMs — feasible but only on an unstable API. Channel
*provisioning* (create + invite) — creation likely possible; **invite is the open risk.**

> **Decision (2026-06-29):** because the team communicates primarily in channels, **every notification that is a DM
> today will be re-routed to a channel/group post.** This keeps the entire migration on Roam's **stable**
> `chat.sendMessage` API and eliminates any dependency on the Alpha DM/user-lookup endpoints. The only Alpha-ish
> residual is confirming that an `@mention` of a specific user renders inside a stable channel post (so the right
> person is still pinged); the handful of user IDs needed for those mentions will be collected **once, manually**,
> into the sheet rather than via the Alpha `user.lookup` API.

---

## Complete inventory of Slack touchpoints

### Surface 1 — n8n workflows (8 workflows, ~13 Slack-coupled nodes)

All Slack nodes are native `n8n-nodes-base.slack` (one exception: an `AI WORKFLOW` HTTP call to
`slack.com/api/views.open`). None use HTTP Request for Slack, so **all break when Slack is decommissioned** and
all must be rebuilt as HTTP Request calls to Roam.

> **Credential caveat (verified limitation):** `get_workflow_details` strips the per-node `credentials` object,
> so **no node→credential binding is retrievable via the API**. Every credential attribution below is *inferred*
> from each node's `authentication` parameter and must be confirmed in the n8n UI.

| WF ID | Name | Active | Slack node(s) | What it does | How it uses Slack today | Change for Roam |
|---|---|---|---|---|---|---|
| `hxLFIdKG9hUIzukO` | AI Onboarding — Submit | ✅ | 1× DM `Notify Sidney` | DMs Sidney on AI-avatar form submit | `select:user`, **hardcoded `U0ACW93FS30`**; text/mrkdwn; `onError:continueRegularOutput`; cred (inferred) SyncView Bot `qUlAcjdhd6EpKOTL` | HTTP → Alpha DM; remap `U0ACW93FS30` → Sidney's Roam ID; re-author text; Roam cred |
| `ljNY7CKYLKzMOACZ` | Onboarding — Submit | ✅ | 1× DM `Notify Sidney` | DMs Sidney on standard form submit | Same pattern; hardcoded `U0ACW93FS30` (backup JSON notes a *wrong* cred `7ARFU5TY2KplygNI`, should be `qUlAcjdhd6EpKOTL`) | Same as above |
| `y1bEpXLggfR5HqYV` | New Client → Slack DM (Notion) | ✅ * | 1× DM `DM Me via SyncView Bot` | DMs Sidney on a new Notion onboarding row | Notion poll trigger; hardcoded `U0ACW93FS30`; Slack `<url\|label>` link markup | Same; convert link markup. **\* Notion trigger is unconfigured → this path is currently dead** |
| `BrJSe8zCKUccfmIq` | **VIDEO PRODUCTION AUTOMATION** ⚠️ null desc | ✅ | 2× DM `Send a message` / `…1` | DMs the responsible SMM after creating a Linear issue | `user = {{Lookup SMM Key.smmSlackUserId}}` from a **hardcoded SMM-name→Slack-ID map** in a Code node; msg "New Linear issue created for …" + URL | HTTP → Alpha DM ×2; rewrite SMM map to Roam IDs; Roam cred |
| `TJVMyfwl85qrFGeK` | Urgent Tweak → Slack | ✅ | 1× post `Post to #video-editing` | Posts "URGENT TWEAKS NEEDED", @-mentioning the assigned editor | `channelId="C09QTMZST5J"` **hardcoded in the node AND again inside the Code node**; `<@id>` mention; editor ID resolved email→`slack_user_id` from the Video Editors sheet (column expected) **+ a hardcoded FALLBACK map** | HTTP → stable `chat.sendMessage` (channel); remap channel → Roam group; mention via Alpha user lookup; **fix both hardcoded copies** |
| `BTxic5NSaCMtZMh6` | **Weekly Slack – Top Reel (PROD)** | ✅ | 1× post `Send Slack Message` | Weekly Top-Reel report to each client's channel | Schedule (Mon 07:00) + webhook; `channelId={{$json.slack_channel_id}}` from **Clients Info**; `messageType:block`, **Block Kit** + `watch_reel` link button | **Highest impact.** New `roam_channel_id` column; **rewrite Block Kit**; HTTP → `chat.sendMessage`; Roam cred |
| `ukLGHr6uDJIEP1pM` | Weekly Slack – Top Reel + Niche (TEST) | ⚠️ ✅ | 1× post (TEST CHANNEL) | Test version of the weekly report | Same pipeline; **hardcoded test channel `C0B7D49KCD6`** (overrides the sheet value) | Same Block-Kit rewrite → a Roam test group. **Active despite a "DO NOT ACTIVATE" sticky — see Silent breaks** |
| `VAqlVLk8wczPq6DQ` | **AI WORKFLOW** ⚠️ null desc | ✅ | 4× channel ops + 1× HTTP `views.open` | (a) Creates per-client Slack channels + invites staff on Jotform onboarding; (b) "Content Ready" slash-command modal | Channel create `<first>-<last>-creative` (public) + `<first>-<last>` (private), `authentication:oAuth2`; invites `U0ACW93FS30` + `U02RBFE3BK8`; modal via `POST views.open` (Block Kit) | Rebuild create/invite vs Roam (`group.create` likely; **invite at risk**); replace slash-command/modal with a Roam command or a web form; **downstream action is a Gmail send — unchanged** |

The other **64 workflows are Slack-free** (Google Sheets / Supabase / Linear / TikTok CRUD). Only `BACKUPS`
(`vb3O0wkTK6Q7Rtro`, inactive, `availableInMCP:false`) is uninspectable — low risk; `SyncView — Weekly Backup`
was confirmed to have no Slack node.

### Surface 2 — SyncView SPA (`/home/user/client-analytics/index.html`)

There is **no hardcoded Slack incoming webhook or token in the SPA** (the `SLACK_WEBHOOK` seed term does not
exist; the real constant is `WEEKLY_SLACK_WEBHOOK`, which points at n8n). The SPA reaches Slack either via n8n
webhooks (server-side) or via client-side deep links built from Sheet identity fields.

| Location (index.html) | Touchpoint | What it does | How it uses Slack today | Change for Roam |
|---|---|---|---|---|
| `WEEKLY_SLACK_WEBHOOK` const + button (~4402, 6672–6773, 233–234) | "Send Slack Update" button | Per-client weekly top-reel push from the analytics detail view; shown only if the client has `slack_channel_id` | `fetch()` POST to `…/webhook/weekly-slack-top-reel` with `slack_channel_id` + video fields; n8n posts to Slack | Repoint const to the Roam-posting workflow; **rename payload key `slack_channel_id` → Roam target (atomic with sheet + n8n)**; gate on `roam_channel_id`; relabel/recolor |
| `URGENT_SLACK_URL` const + 3 entry points (~12748, 14995–15044, 26228–26248, 31802–31868) | "URGENT TWEAKS NEEDED" ping | Red URGENT button on calendar, samples, and Kasper cards → one dispatch | `fetch()` POST to `…/webhook/send-urgent-slack`, body `{issue,client,name}`; n8n resolves the editor + posts to #video-editing | Repoint const; **SPA payload unchanged**; rewrite "#video-editing"/"SyncView Bot" copy in confirms/toasts/tooltips |
| `_kasperResolveSlackTarget` / `_kasperOpenSlack` (~30113–30116, 31192–31218, 31760–31770, 32680–32715) | Per-card "Slack" DM deep link (Kasper cards) | Opens a DM/profile to the client's SMM | **Direct client-side** `slack.com/app_redirect?channel=…&team=…` or `slack://`, built from SMM-map fields `slack_profile_url` / `slack_user_id` / `slack_team_id` | Rewrite the resolver to build a Roam deep link (no confirmed Roam `app_redirect` equivalent); parse Roam columns; relabel |

**Notes / corrections:**
- `KASPER_SLACK_TEAM_DOMAIN` (line 30116) is **empty and unreferenced** → dead config. The nearby code comment
  claims a "fall back to opening Slack and searching the SMM's name" path, **but that fallback is not actually
  wired** — when no ID/URL resolves, the resolver returns `null` and the button shows a "Slack link not set up
  yet" notice. **The comment is stale/misleading**; don't try to preserve a fallback that doesn't exist.
- The editor identity fields (`slack_user_id` / `slack_team_id` / `slack_profile_url`) are used only to build the
  Kasper deep link; they are **never POSTed** to n8n.

### Surface 3 — Google Sheets identity maps

Live sheet **`SYNCVIEW`** = `10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8`. **No Slack tokens/webhooks are stored
in any sheet.**

| Tab | Column | Holds | Consumed by | Change for Roam |
|---|---|---|---|---|
| `Clients Info` | `slack_channel_id` (col J) | Slack channel `C…` per client (**26/28 populated** — blank for Lauren Taus, Alayna Bellquist) | Weekly PROD/TEST report; SPA "Send Slack Update" | Add `roam_channel_id` (group UUID); **backfill all rows incl. the 2 blanks**; repoint consumers; retire later |
| Social-Media-Manager map (header ~line 836; `client_name, social_media_manager, linear_api_key, slack_profile_url`) | `slack_profile_url` (**misnamed — holds a Slack user `U…`**) | **7 distinct SMM IDs** (Analia `U08SLQ4GT39`, Sebastian `U09KMKAK4UX`, Ludmila `U0AJKSL3JHW`, Molly `U07E30JN6KD`, Laura `U0A73TB2ZEF`, Sidney `U0ACW93FS30`, Raha `U0APYPKTLJH`), **repeated across ~35 client rows** | SMM DM/mention; SPA Kasper deep link | Add `roam_user_id`; **backfill is 7 distinct values but must be written to every client row** (or normalize the tab) or some rows silently keep Slack IDs. (`linear_api_key` holds live secrets — out of scope, **flagged**) |
| `Video Editors` (`video_editor, email` **only**) | *(none today)* | — | — | **No Slack column exists here** (corrects an earlier assumption). The urgent-tweak workflow *expects* a `slack_user_id` column that is **absent**, so it resolves only via its hardcoded fallback map — see §"What must change → identity". Add `roam_user_id`, or rely on Roam email lookup |

- **`slack_team_id` is a real, referenced identifier.** The SPA reads it (around line 31210, used ~32689) to
  build `…app_redirect?channel=U…&team=…`. It is read **if present**; whether the column physically exists in the
  live sheet must be verified. Migration backfill differs by case: **rename an existing column vs. add a new one**.
- Dated "SyncView Main Sheet — …" snapshots (`1F3t…`, `1D4Q…`, `1iOu…`) replicate the same Slack columns and need
  the same treatment. `SyncView Calendar` (`1Gsn5xLImJyMhBMCNjK_tigpoUfcSFnvxTQLkk-A9Yps`) has no Slack columns.

### Surface 4 — Data model, edge functions, CI, tests, docs

| Artifact | Slack dependency? | Detail / change for Roam |
|---|---|---|
| Supabase tables / migrations (`migrations/onboarding-supabase-migration.sql`, `migrations/ai-onboarding-supabase-migration.sql`) | **No column** | Slack appears only in header comments; `client_onboarding` / `ai_client_onboarding` have **no Slack column**. No DB change needed |
| Supabase edge functions | **None** | `EDGE_FUNCTIONS_MIGRATION.md` is a *future* plan that explicitly **keeps Slack on n8n**. Nothing to migrate |
| CI (`.github/workflows/*`, 4 files) | **None today** | No Slack/notify step exists. `docs/archive/HEADLESS_TESTING_EVAL_2026-06-26.md` *recommends* adding failure alerting — if built, target **Roam**, not a Slack action. The README's `DISCORD_WEBHOOK_URL` is **defunct/unrelated** (dead IG scraper) — **decision item:** remove it during cutover so no one wires alerts to a dead endpoint |
| `test/kasper-urgent-ping.js` | Coupled by **name/path** | Hardcodes `URGENT_SLACK_URL='…/webhook/send-urgent-slack'`, asserts POST `{issue,client,name}` against a **mocked** n8n response. Update the URL/path + any renamed functions. **The test logic is platform-agnostic and will pass even against a broken Roam integration** — it is necessary but **not sufficient**; add a live Roam smoke test |
| `n8n-backups/*` | Mirror the live workflows | `onboarding-submit.2026-06-25.created.json` (`ljNY7CKYLKzMOACZ`), `ai-onboarding-submit.2026-06-28.created.json` (`hxLFIdKG9hUIzukO`). Edit live workflows, then re-snapshot |
| Docs (`docs/ops/NEW_CLIENT_ONBOARDING.md`, `docs/features/ONBOARDING_FORM.md`, `docs/ops/LINEAR_SYNC_RECONCILE.md`, `docs/archive/SAMPLES_V2_PLAN.md`, `docs/archive/qa/PARITY_LEDGER.md`, `docs/archive/qa/DIVERGENCE_REPORT.md`) | Describe flows | Update Slack→Roam references; planned/future routes (`_sxrSendUrgentSlack` samples ping, post-call Fathom→Slack post, reconciler Slack alert) should target Roam |
| `/home/user/synchrosocial` (Astro marketing site) | **None** | Verified clean. No change |

---

## What must change, by category

### 1) Outbound notifications

> All of these become **HTTP → stable `chat.sendMessage`** (channel/group). No Alpha endpoints.

- **Onboarding notifications to Sidney** (`hxLFIdKG9hUIzukO`, `ljNY7CKYLKzMOACZ`, `y1bEpXLggfR5HqYV`): **were DMs →
  now post to an internal notifications channel** (Sidney watches it). Drop the hardcoded `U0ACW93FS30`; keep
  fail-soft `onError:continueRegularOutput`.
- **Linear-submission SMM notification** (`BrJSe8zCKUccfmIq`, 2 nodes): **was a DM → now a channel post that
  `@mentions` the responsible SMM.** Replace the hardcoded SMM-name→Slack-ID Code map with the SMM's Roam user ID
  (for the mention) + the destination channel.
- **Weekly client reports** (`BTxic5NSaCMtZMh6` PROD, `ukLGHr6uDJIEP1pM` TEST): per-client channel post; **rewrite
  Block Kit** (header/section/fields/divider/`watch_reel` button) into Roam blocks or markdown + a plain link;
  drive the channel from the new Roam column.
- **Urgent editor ping** (`TJVMyfwl85qrFGeK`): channel post to the Roam "#video-editing" group, `@mention`-ing the
  assigned editor (editor Roam IDs collected into the sheet — no Alpha lookup).

### 2) Identity mapping

| Slack value | Where it lives | Roam replacement |
|---|---|---|
| Sidney DM `U0ACW93FS30` | Hardcoded in 3 onboarding nodes + AI WF invite + the VPA "sidney" map entry | **Destination channel** for onboarding notifications (DM dropped). Sidney's Roam user ID still needed only for the AI-WF channel *invite* |
| Per-client channels | `Clients Info.slack_channel_id` | New `roam_channel_id` (group UUID) |
| #video-editing `C09QTMZST5J`; test `C0B7D49KCD6` | Hardcoded in workflows (`C09QTMZST5J` in **two** places) | Roam group UUIDs |
| Private-invite `U02RBFE3BK8` | Hardcoded in AI WF | Roam user ID — **but who is this? identify first** |
| SMM IDs (7 distinct) | SMM-map `slack_profile_url` + hardcoded VPA Code map | New `roam_user_id` (write to every row) — used to `@mention` the SMM in a channel post |
| Editor IDs | Hardcoded FALLBACK in `TJVMyfwl85qrFGeK` + an **expected-but-absent** `slack_user_id` column in Video Editors | New `roam_user_id` column (collected manually — no Alpha lookup). The expected sheet column is **currently missing → fix this latent bug while migrating** |
| `slack_team_id` | SPA-referenced (verify column exists) | Roam deep-link equivalent (if any) |

The editor mention path has **three sources that must stay in sync**: (a) the hardcoded fallback map in the
workflow, (b) the expected `slack_user_id` column in the Video Editors sheet (**absent today**), and (c) the join
key `assignee.email` from Linear. Today, mentions resolve **only via the fallback map**; anyone not in it gets a
name-only message.

### 3) The SPA's embedded webhooks/buttons

No embedded Slack webhook exists. Repoint the two n8n-webhook consts (`WEEKLY_SLACK_WEBHOOK`, `URGENT_SLACK_URL`)
to Roam-posting workflows; rewrite the client-side `_kasperResolveSlackTarget` deep-link builder
(`slack.com/app_redirect` / `slack://` → a Roam deep link, if one exists); relabel/recolor buttons; update copy
referencing "#video-editing" / "SyncView Bot".

### 4) n8n credentials & the missing Roam node

There is **no native Roam node**; every Slack node becomes an **HTTP Request** node to `https://api.ro.am/v1/…`
with **one** new **HTTP Header Auth** credential (`Authorization: Bearer …`). The existing **5 Slack credentials**
returned by `list_credentials` — **3 `slackApi` + 2 `slackOAuth2Api`**: `qUlAcjdhd6EpKOTL`, `7ARFU5TY2KplygNI`,
`xxDCPJrkkxOGky4Y`, `61dRIKAw9P5hFPdN`, `Jg4GO1VpyZQF8Iey` — are retired once nothing references them. **Build one
reusable "Roam send message" sub-workflow / HTTP pattern** (channel via stable `chat.sendMessage`; DM via Alpha)
so every notifier calls a single tested implementation.

### 5) Inbound Slack triggers

**None exist** — no `slackTrigger` nodes, no `hooks.slack.com` incoming webhooks. The one Slack *input* is the
"Content Ready" slash command + Block Kit modal (`views.open`) in `AI WORKFLOW`. Roam has no confirmed
slash-command/modal equivalent; replace it with a Roam command (if available) or a small web form POSTing to the
existing `content-ready-submit` webhook. The downstream action is a Gmail send (Slack-independent, unchanged).

---

## Recommended migration plan

**Dependency rule:** you must (a) confirm the platform + obtain API access, (b) build a reusable Roam "send
message" pattern, and (c) build the Slack→Roam user/channel ID map **before** rewiring any individual notifier.
Do not migrate notifiers piecemeal first.

**Phase 0 — Access *(blocking)*.** ✅ Platform confirmed (ro.am) and ✅ delivery model decided (channels, not DMs —
no Alpha needed). Remaining: create the API client under Roam Admin → Developer; grant scopes (chat send + groups
read; user read only if needed to obtain mention IDs); store as one n8n HTTP Header Auth credential.

**Phase 1 — Foundations.** Build the reusable Roam-send sub-workflow (**channel = stable `chat.sendMessage`** — the
only path now). Build the ID map: enumerate Roam groups, map every Slack channel → group UUID, and decide
destination channels for the notifications that used to be DMs (an internal "notifications" channel for onboarding;
a channel for Linear-submission SMM pings). Collect Roam **user IDs** (manually) for the 7 SMMs and the editors —
needed only for `@mentions`. Add `roam_channel_id` (Clients Info) and `roam_user_id` (SMM map + Video Editors) and
**backfill every row**; keep Slack columns for a parallel run.

**Phase 2 — Existing channel posts (stable API).** Migrate `ukLGHr6uDJIEP1pM` (TEST) first; validate
Block-Kit→Roam rendering; then `BTxic5NSaCMtZMh6` (PROD weekly) and `TJVMyfwl85qrFGeK` (urgent ping, with the
editor `@mention`). **Confirm mention rendering on the first send.**
**Sequencing:** create each Roam-posting n8n workflow at its new path and verify it **before** repointing the SPA
consts — repointing first breaks the buttons. Update `test/kasper-urgent-ping.js` and add a live Roam smoke test.

**Phase 3 — Notifications that were DMs (now channel posts).** Re-route the 3 onboarding notifications + the 2 VPA
SMM notifications to their destination channels (with `@mentions` where a specific person must be pinged). Keep
fail-soft error handling. Migrate the SPA Kasper deep-link resolver.

**Phase 4 — Channel provisioning + modal (highest uncertainty).** Rebuild `AI WORKFLOW` channel create/invite
against Roam (`group.create` likely exists; **invite is the open risk** — fall back to manual provisioning if
unsupported); replace the slash-command modal with a Roam command or a web form.

**Phase 5 — Cutover & cleanup.** Verify; retire the Slack columns and the 5 Slack credentials; re-snapshot the
n8n backups; update docs; remove the defunct README Discord webhook.

---

## Things that will silently break — explicit callouts

1. **`C09QTMZST5J` is hardcoded in two places** in `TJVMyfwl85qrFGeK` (the Slack node param *and* the Code node).
   Changing only the node leaves the Code copy pointing at a dead channel.
2. **Atomic tri-party change:** the SPA POST key `slack_channel_id`, the Sheet column, and the n8n read must all
   change together — otherwise the "Send Slack Update" post silently targets nothing.
3. **`ukLGHr6uDJIEP1pM` (TEST weekly) is `active:true` despite a "DO NOT ACTIVATE" note** → can double-post or
   post to a stale `C0B7D49KCD6` during parallel-run. Clean up before migrating.
4. **`y1bEpXLggfR5HqYV` (Notion DM) is `active:true` but its Notion trigger is unconfigured** → it does nothing
   today. Decide whether it should be live *before* spending effort migrating a dead path.
5. **The 2 blank `slack_channel_id` rows** (Lauren Taus, Alayna Bellquist) will produce no Roam target unless
   backfilled.
6. **`test/kasper-urgent-ping.js` will pass against a misconfigured Roam call** (it mocks n8n). Add a real smoke test.

---

## Open questions for Sidney

1. ✅ **Platform identity:** confirmed **ro.am**.
2. ✅ **Delivery model:** confirmed **channels, not DMs** — DM notifications become channel posts; no Alpha
   dependency. *(Follow-up: which channel should the onboarding notifications and the Linear-submission SMM pings
   land in? — needed for Phase 1.)*
3. **Channel provisioning:** Does Roam support programmatic channel **create + invite** (needed by `AI WORKFLOW`)?
   `group.create` appears to exist; **invite** is unconfirmed.
4. **Slash-command/modal:** Does Roam offer a slash-command / interactive-form for the "Content Ready" flow, or
   should it become a web form?
5. **Deep links:** Does Roam expose an `app_redirect`/`slack://`-style deep link for the SPA's per-card "Open DM"?
6. **Credential bindings:** Confirm in the n8n UI which of the 5 Slack creds each node uses (the API hides this).
7. **Bot identity:** What should the Roam `sender` / bot be (the "SyncView Bot" replacement)?
8. **Who is `U02RBFE3BK8`?** (the private-channel invitee in `AI WORKFLOW`) — identify before mapping.
9. **Sheet columns:** confirm whether `slack_team_id` / `slack_user_id` physically exist in the live sheet
   (rename) or must be added (new), and whether `y1bEpXLggfR5HqYV` is meant to be live.

---

## Effort / risk estimate per workstream

| Workstream | Effort | Risk | Notes |
|---|---|---|---|
| Phase 0 — API access (platform + model already decided) | **S** | Low | Create API client + credential; no more unknowns gating start |
| Reusable Roam-send sub-workflow/pattern | **M** | Low | Single stable channel path (no Alpha) |
| ID map + Sheet columns + backfill | **M** | Low | 1 channel/client + ~12 user IDs collected manually |
| Weekly report (PROD+TEST) — Block-Kit rewrite | **L** | Med | Block Kit doesn't port; per-client dynamic channel |
| Urgent ping + SPA wire | **M** | Med | Channel post stable; confirm mention rendering |
| Onboarding + SMM notifications (5) → channel posts | **M** | Low | Now stable channel posts; pick destination channels |
| SPA changes (2 consts + deep-link resolver + labels) | **M** | Med | Roam deep-link format unconfirmed |
| Channel provisioning + slash-command modal (`AI WORKFLOW`) | **L** | **High** | Create likely; invite + modal unconfirmed; may need manual/web-form fallback |
| Credentials retire + docs + test + backups | **S** | Low | Cleanup after cutover |

---

*Generated as an audit. No workflows, SPA code, sheets, or credentials were modified.*
