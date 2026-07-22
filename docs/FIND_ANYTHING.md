# FIND ANYTHING — the one-hop retrieval router

> **The rule this doc keeps: any documented fact in ≤2 opens from here.**
> Draft shipped by the 2026-07-19 vault audit (P4 proposal — owner ratifies by
> merging). If this router ever fails to route you, add the missing row in the
> same session: that is the router's maintenance covenant.
>
> Cross-repo citation convention (always): `` `path` `` in the `` `repo` ``
> repo — never a bare cross-repo path. Both repos are **public**: patterns,
> not particulars, in everything you write back.

## I want to know… → open exactly this

### The company (business level)

| Question | Open |
|---|---|
| What IS this company — offerings, clients, team, tools, how it all connects | **The Enterprise Atlas** — `docs/ATLAS.md` in the `synchrosocial` repo (11 floors; start at its floors table) |
| Why are we doing the atlas / step-back work; owner pins P1–P4 | `docs/vision/STEP_BACK_2026-07-18.md` (this repo) |
| Open owner/Kasper questions and their answers | Atlas — OQ ledger + Kasper-questions appendix |
| The full client journey, stage by stage (traffic → booking → sales → onboarding → production) | `docs/CLIENT_LIFECYCLE_MAP.md` (mirrored in both repos — check its drift banner) |

### The website & marketing (`synchrosocial` repo)

| Question | Open |
|---|---|
| Which page uses which funnel/booking calendar; why the funnels are shaped this way | `docs/ECOSYSTEM_MAP.md` in the `synchrosocial` repo |
| Ads, pixel, tracking, CAPI, HubSpot — state, IDs, decisions | `docs/meta-ads/README.md` in the `synchrosocial` repo (runbook + research sit beside it) |
| How to edit site pages, colors, images; deploy | `README.md` in the `synchrosocial` repo |

### SyncView (this repo)

| Question | Open |
|---|---|
| I'm a new session — what is this system? | `docs/truth/BRIEFING.md` (**always first**) |
| Where does file/folder X live? | `REPO_MAP.md` |
| Which n8n webhooks / Edge Functions does the app call? | `docs/truth/ENDPOINTS.md` |
| Supabase tables, flags, write contracts | `docs/truth/SUPABASE.md` |
| n8n workflow inventory & state | `docs/truth/N8N.md` |
| Google Sheets tabs, roster truth | `docs/truth/SHEETS.md` |
| Linear teams/states/what syncs | `docs/truth/LINEAR.md` |
| How surface X behaves in `index.html` | `docs/truth/APP.md`, then `docs/independence/SYSTEM_MAP.md` §4 for the full surface catalog |
| Feature X's contract/spec | `docs/features/<FEATURE>.md` (each carries a status header — believe it) |
| Operational runbooks (new client, monitoring, flip, backups) | `docs/ops/` — new-client setup is `docs/ops/NEW_CLIENT_ONBOARDING.md` |
| How is the corrective F27 safety net prepared, installed, or source-exactly rolled back? | `docs/ops/F27_INSTALL_RUNBOOK.md` + generated `docs/ops/F27_INSTALL_CHECKLIST.md` — future owner-gated only; start from PR #901's no-install boundary |
| The n8n→EF / Linear-replacement programs | `docs/independence/INDEPENDENCE_PLAN.md` (entry), specs beside it |
| How to test; which suite gates what | `docs/testing/README.md` |
| What each surface *promises* (quality tiers) | `docs/QUALITY_TIERS.md` |
| Live state, kill switches, one-step rollback | `ROLLBACK.md` (the law + Live State table) |
| What happened on date X (deploys, flags, incidents) | `EXECUTION_LOG.md` |
| Is surface X freshly proven to work? | `docs/testing/ASSURANCE_LEDGER.md` |
| Production-tab design kit & gates | `docs/syncview-design/` (start at its README) |
| The house skills (QA fleet, skill-forge, night-shift) | `.claude/skills/` — when-to-use map in `docs/testing/README.md` |

### The registers (numbered things people cite)

| You saw… | It lives in | Grep |
|---|---|---|
| `F123` (system finding) | `docs/independence/CUTOVER_AUDIT_2026-07-13.md` + `docs/truth/BRIEFING.md` (current boundary) | `rg '\bF123\b'` |
| `D-36` (owner decision) | `ROLLBACK.md` Live State + `EXECUTION_LOG.md` | `rg '\bD-36\b'` |
| `OQ-12` / `KQ-2` (owner/Kasper question) | Atlas — `docs/ATLAS.md` in the `synchrosocial` repo | `rg 'OQ-12'` there |
| `VA-3` (vault-audit finding) | `docs/audits/2026-07-19-vault-audit.md` | `rg '\bVA-3\b'` |
| `P3` (owner pin) | `docs/vision/STEP_BACK_2026-07-18.md` | — |
| A dated audit | `docs/audits/` (immutable evidence; conclusions live in `docs/truth/`) | — |
| F27 corrective source proof | `docs/audits/2026-07-21-f27-corrective-source-proof.md` | `rg 'P1-1|P1-2|Safe drill contract'` |
| F27 install operator toolkit proof | `docs/audits/2026-07-22-f27-install-operator-toolkit.md` | `rg 'Preparatory|private round-trip|source-exact|nothing live'` |

## For the owner (no session running)

Bookmark two GitHub pages: **the Atlas** (`docs/ATLAS.md` in `synchrosocial`)
and **this router**. On any GitHub repo page, press `t` and type a filename to
fuzzy-find it; press `/` to search text across the repo. Atlas floor → linked
doc is the intended two-hop path for every company-level question; this
router is the same thing for system-level questions.

## When the answer isn't documented

1. Check `docs/archive/` last, never first (it's superseded history).
2. If it's a business fact only a human knows: it becomes an OQ (owner) or KQ
   (Kasper) in the atlas — don't guess, don't invent.
3. When you learn the answer anywhere else (live system, owner message), ship
   it into the owning doc **in the same session** — sessions feed the vault.
