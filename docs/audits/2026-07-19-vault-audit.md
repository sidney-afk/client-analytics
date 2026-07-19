# Vault audit — 2026-07-19 (owner pins P2 + P3, atlas session 3)

**Scope:** the documentation system itself — the truth layer, `REPO_MAP.md`,
the lifecycle/ecosystem maps, the Enterprise Atlas, and how any of it is found
(retrieval). Both repos. Read-only; all findings verified inline by direct
inspection (agent-spend limits prevented fleet verification — every claim
below was checked by hand against disk/git/GitHub state on 2026-07-19).

**Verdict up front:** the vault's *intra-repo* machinery is genuinely strong —
CI-enforced repo map, freshness-stamped drift-checked truth docs, status-headed
feature contracts, quarantined archives. The defects cluster at the **seams**:
everything cross-repo is unguarded (the mirror drifted silently, cross-repo
references are unverifiable, the vault root has no stamp checker), the entry
points don't point to the root, and the whole vault is **public** while
carrying operational-hazard detail. Retrieval works for sessions that already
know the map; it fails at the front door.

---

## 1. The enforcement map (what actually guards each doc class)

| Doc class | Guard | State |
|---|---|---|
| `REPO_MAP.md` | `test/repo-map-sync.js` — offline, every push | ✅ strong |
| `docs/truth/*` | `test/truth-sync.js` — stamp grammar + age, path/symbol existence, endpoint-count drift, F-boundary sync | ✅ strong (best-in-class; 0 stale stamps found) |
| `docs/features/*` | status-header convention (human) | ✅ working — e.g. `PTO_TRACKER_HANDOFF.md` correctly self-labels HISTORICAL |
| `docs/audits/`, `docs/archive/` | immutability convention | ✅ working (dead paths inside them are expected history, not defects) |
| `docs/CLIENT_LIFECYCLE_MAP.md` (mirrored) | prose contract only (`CLAUDE.md` + `AGENTS.md` instruction) | ❌ **failed** — drifted 2026-07-17, caught by accident 2026-07-18, still drifted at this audit |
| `docs/ATLAS.md` (vault root, `synchrosocial`) | prose covenant; stamp not machine-readable | ❌ unguarded |
| All `synchrosocial` docs | nothing (that repo's only CI is deploy) | ❌ unguarded |
| Any cross-repo reference | nothing | ❌ unguarded |

## 2. Findings

**VA-1 — the vault is public while carrying hazard detail (high).**
Verified via the session tooling's repo listing: `sidney-afk/client-analytics`
and `sidney-afk/synchrosocial` are both `visibility: public`. Parts of the
corpus assume otherwise — the atlas (session 2) even refers to "the private
truth layer." Several current-truth docs describe live operational hazards at
a level of detail appropriate only for a private repo (e.g. the standing-hazards
paragraph of `docs/truth/BRIEFING.md`; §15 of the lifecycle map — pointers
deliberately left generic here). Owner decision required: flip the repo
private, or relocate hazard specifics to private storage and keep only bare
finding numbers publicly. *(The atlas's two "private truth layer" phrases are
corrected on the open PR #68 branch as part of this session.)*

**VA-2 — the mirror contract is structurally unenforceable (high).**
Post-mortem of the 2026-07-17 silent drift: the contract lives only in prose;
the offline unit suites cannot see the sibling repo, so no machine ever
compares the copies; and a session scoped to one repo **physically cannot
comply** even if it reads the instruction. Failure was inevitable, not
negligent. The 07-17 email-consolidation session edited only the
`synchrosocial` copy; nothing noticed until an unrelated verification agent
diffed the files a day later. Guard options in §5 (recommendation: retire the
byte-mirror rather than guard it).

**VA-3 — the vault root has one door, and it's in the basement (high).**
`docs/ATLAS.md` is reachable from exactly one entry document: the truth-layer
README in the *other* repo. Neither `synchrosocial/CLAUDE.md`, nor its
`README.md`, nor `client-analytics/AGENTS.md`, nor its `README.md`, nor
`BRIEFING.md` mentions the atlas. A session (or the owner) starting at any
normal entry point cannot discover the root of the single source of truth.

**VA-4 — the master map's runbook pointer is dead in both copies (medium).**
`docs/CLIENT_LIFECYCLE_MAP.md` (twice: companion table + §7) cites
`client-analytics/NEW_CLIENT_ONBOARDING.md`; the runbook actually lives at
`docs/ops/NEW_CLIENT_ONBOARDING.md`. A cold reader following the most-cited
map to "how do I set up a client" hits a 404. Fix belongs in the in-flight
mirror re-sync (one pass, both copies).

**VA-5 — the atlas is outside every freshness mechanism (medium).**
Its stamp reads `**Last verified:** 2026-07-18 (…)` — bold-wrapped, no commit
anchor — so it fails even the truth layer's regex, and no checker runs in that
repo anyway. The maintenance covenant is prose with no teeth.

**VA-6 — cross-repo references are unverifiable and unconventioned (medium).**
~20 references in each direction. The atlas's prose form — `` `path` `` in
`` `repo` `` — is good and grep-able but nothing enforces it, and no tool can
detect when a cross-repo target moves (VA-4 is exactly this class).

**VA-7 — Track-A spec cites a file that never materialized (low).**
`docs/independence/TRACK_A_EDGE_FUNCTIONS_SPEC.md` references
`supabase/functions/_shared/status-map.ts`; the real shared modules are
`b4-write.ts`, `browser-write-auth.ts`, `staff-role-auth.ts`,
`thumbnail-revisions.ts`. Spec-vs-implementation drift in an active program
doc.

**VA-8 — placeholder filename in a "binding decision record" (low).**
`PTO_TRACKER_HANDOFF.md` cites `migrations/2026-07-XX-pto-tracker.sql`; the
applied file is `2026-07-15-pto-tracker.sql`. Tolerable under its HISTORICAL
header, but the doc also calls itself binding.

**VA-9 — five unmapped public repos exist under the account (medium).**
The atlas claims two repos carry the vault; the account also publicly holds
`synchro-crm` (pushed 2026-07-08 — recent), `project-central`, `letitbe`, and
archived `ai-invite`, `claude`. Whatever they are, they're outside every map;
if any is dead it's still publicly visible. Needs one owner voice message
(§5-P8).

**VA-10 — otherwise healthy (info).**
Machine sweep of all 172 markdown files across both repos: **zero** broken
intra-repo markdown links in either repo; zero stale freshness stamps; archive
and audit dirs properly quarantined from current truth; the features
status-header convention held everywhere sampled. The intra-repo machinery
deserves to be called excellent.

## 3. Retrieval hop-tests (does following the docs get you there?)

Method: simulate a cold reader starting from the documented entry point,
count document-opens to a correct answer.

| Question | Path followed | Hops | Result |
|---|---|---|---|
| Which calendar does the site's floating booking widget use? | CLAUDE.md → ECOSYSTEM_MAP | 2 | ✅ (honest "dashboard-only, confirm there") |
| How do I set up a brand-new client? | CLAUDE.md → lifecycle map §7 → cited runbook path | 3 | ❌ **404** (VA-4) |
| What's the PTO kill switch? | AGENTS.md → BRIEFING → ROLLBACK live-state row | 3 | ✅ exact flag + readback |
| Did we decide anything about cookie-consent banners? | CLAUDE.md → meta-ads README §6 | 2 | ✅ dated decision + why |
| What do clients roughly pay? (owner-style question) | *no entry doc leads to the atlas* → Floor 10 | — | ❌ unreachable without prior knowledge (VA-3) |
| Where are the n8n workflow backups? | REPO_MAP | 1 | ✅ |

Pattern: **once inside the right repo's map system, retrieval is 1–3 hops and
reliable. The failures are at entry (VA-3) and at cross-repo seams (VA-4).**
This matches the owner's lived report ("ask the reviewer session, it greps —
works but slow"): grep substitutes for the missing front door.

## 4. P3 — the under-a-minute retrieval architecture

Evidence-driven design, smallest set of changes that closes the gaps:

1. **One router, one hop:** `docs/FIND_ANYTHING.md` (ships beside this audit,
   draft) — a question-indexed table: "I want X → open exactly Y," covering
   both repos, the registers (F-/D-/OQ-/KQ-numbers), and grep patterns for
   each. Rule it must keep: **any documented fact reachable in ≤2 opens from
   the router.**
2. **Doors on every entry:** one pointer line in each entry doc
   (`CLAUDE.md`, `AGENTS.md`, both READMEs, BRIEFING read-order step 0) to the
   router + atlas. (`client-analytics` line ships now; `synchrosocial` lines
   are proposals until PR #68 merges.)
3. **Convention:** cross-repo citations always as `` `path` `` in the
   `` `repo` `` repo — never a bare path (VA-4's class becomes grep-fixable).
4. **Teeth (proposal):** a small scheduled CI job in this repo — the only repo
   with CI habits — that raw-fetches the sibling repo's doc targets (mirror
   copy while it exists, atlas stamp, router targets) and alerts on drift/404.
   This is the only mechanism that can guard cross-repo seams, because offline
   tests structurally cannot.

## 5. Proposals — owner one-liners (nothing below shipped without a yes)

| # | One-liner |
|---|---|
| P1 | **Retire the lifecycle-map byte-mirror**: canonical copy lives in `synchrosocial`; this repo's path keeps a 5-line pointer stub (ends the drift class forever). *Alternative if you want two full copies: the P5 cross-repo CI diff-guard.* **Recommended: retire.** |
| P2 | Confirm repo-visibility intent: `client-analytics` is public today — keep public and move hazard specifics to private storage, or flip the repo private? (VA-1) |
| P3 | After PR #68 merges: add the atlas+router pointer line to `synchrosocial` `CLAUDE.md` + `README.md`. |
| P4 | Ratify `docs/FIND_ANYTHING.md` (in this PR as a draft) and its ≤2-opens rule as the standing retrieval contract. |
| P5 | Add the cross-repo docs guard: scheduled CI in this repo raw-fetching sibling doc targets (atlas stamp, cross-repo citations, mirror-or-stub) with a drift alert. |
| P6 | Fold the VA-4 dead-runbook-pointer fix into the in-flight mirror re-sync (both copies, one pass). |
| P7 | Correct `TRACK_A_EDGE_FUNCTIONS_SPEC.md`'s `status-map.ts` reference to the real `_shared` modules (VA-7). |
| P8 | One voice message: what are `synchro-crm`, `project-central`, and `letitbe` — should the atlas map them, and should any be archived/made private? (VA-9) |
| P9 | Give `ATLAS.md` a machine-grammar freshness stamp (`Last verified: YYYY-MM-DD @ commit`) so the P5 guard can parse it. |

---

*Audit method note: corpus = 172 markdown files (11 `synchrosocial`, 161 this
repo), swept by script for stamps/links/paths, findings triaged and verified
individually by hand; false-positive classes (dir-relative paths, generated
artifacts, archived history, cross-repo prose citations) excluded before
anything was called a defect. Per the audit convention this file is immutable
dated evidence; conclusions that survive belong in the truth layer and the
atlas.*
