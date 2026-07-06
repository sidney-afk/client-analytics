# Data-assumption sweep — unverified data-reality assumptions in the Track B spec (2026-07-06)

Triggered by the B1 clients-FK near-miss (85 operational issues under client slugs absent from
`clients`; caught by preflight, zero cost). This sweep asks the general question: **where else
does the plan assume a property of the real data that has not been verified against live data?**
Each item: the assumption → the real-world dirt that violates it → the phase it bites → the
one-line verification. Items 1/2/5/6/7/8 are covered mechanically by the §5.6 constraint
preflight; items 3/9/10/11/12 are semantic and need their own checks at the phase gates noted.

1. **Every operational issue is a "video" or "thumbnail"** (§2.2 `kind` CHECK). Dirt: GRA
   banners/carousels/brand-kit tasks, VID scripts/admin chores fit neither → CHECK violation or
   forced mislabel corrupting review-kind logic. Bites **B1**. Verify: classify in-window issue
   titles by work type; count neither-kind.
2. **Every live-card Linear link resolves to an open, in-window, VID/GRA issue** (§5.4, §1.5.3).
   Dirt: links to closed / hard-deleted / CON-team issues → no deliverable minted; the "zero
   links without deliverable_id" flip gate becomes unreachable; pill locks die post-flip. Bites
   **B1 + B4**. Verify: resolve every live-card link; count closed/deleted/out-of-window/out-of-team.
3. **Open issues outside the cutoff are inert** (§5.1). Dirt: long-running open work still being
   edited → inbound webhooks fire for issues with no deliverable row (inbound create-on-unknown
   is undefined); editors lose that work at flip. Bites **B3/B4**. Verify: count out-of-window
   open issues with a human state-change/comment in the last 30 days (issue history, not updatedAt).
4. **Live card client slugs equal canonical `clients.slug`** (§3 vs the (client_slug, card_id)
   join). Dirt: `terrinamar` variants; cards under quarantined clients → joins/roster cutover
   silently orphan them. Bites **B1/B2, B4→B5**. Verify: distinct card client values NOT IN
   merged-registry active slugs.
5. **Operational assignees resolve to planned `team_members`** (§5.1/§5.3). Dirt: departed
   editors, self-assignments, ghosts → null-assignee flood; empty "My issues". Bites **B1+**.
   Verify: group in-window issues by assignee id; diff against planned `linear_user_id` set.
6. **Mirrored batch pairs are byte-identical; parents pullable and live** (§5.1). Dirt:
   near-identical mirrors split; same-titled non-mirrors fused; completed/out-of-window parents
   have no batch outcome; B4 outbound may write a completed Linear parent. Bites **B1/B4**.
   Verify: group parents by (client,title,description); count exact vs near dupes; count
   in-window children with closed/out-of-window parents.
7. **Each issue is linked from ≤1 card, in its own client** (§5.4; single-valued `card_id`).
   Dirt: one sub-issue pasted on two cards; cross-client pastes. Bites **B1; B4 repoint**.
   Verify: count link URLs on >1 card; count links whose project-client ≠ card client.
8. **`wlNormalizeClient` never fuses two distinct clients** (§3). Dirt: accent/"dr."/punctuation
   stripping collides two people onto one slug → one review token sees both clients' work. Bites
   **B1 (token risk from B0)**. Verify: run the normalizer over all four sources; list slugs
   with >1 distinct display name not already on D-16.
9. **Real-client rows pass the EF guard gauntlet like TEST rows** (§6.2, B0.5). Dirt: legacy
   live rows with fields the EF ALLOWED lists reject, or missing `comments_base_at` → false-fail
   at the earliest real-client phase. Bites **B0.5 (NOW)**. Verify: validation-only replay of
   live posts/samples through the EF gauntlet (start with the current canary client's rows).
10. **Nothing is deleted/archived between B1 and B3** (§4.3.4 has no delete lane). Dirt:
    measured hard deletes leave zombie deliverables that block the 7-day zero-diff gate. Bites
    **B3**. Verify: weekly archived/deleted counts; confirm re-pull removes absent uuids.
11. **The trailing drive/f.io comment is the delivery link** (§5.1). Dirt: footage/reference
    links posted later → wrong `file_url` shown to reviewers. Bites **B1**. Verify: count
    in-window issues with ≥2 distinct drive/f.io comment links.
12. **The n8n Slack fallback map covers the whole roster** (§5.3/§9.8). Dirt: Rocío/new hires
    absent → URGENT pings silently unrouted after repoint. Bites **B4**. Verify: diff map keys
    against active `team_members`.
