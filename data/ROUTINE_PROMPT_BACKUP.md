# Rollback backup — "⚡ Weekly Sandcastles Competitor Research" routine

- **Trigger id:** `trig_015xSamhJTSSF3Kx61htduXB`
- **Model:** `claude-sonnet-4-6` (unchanged)
- **Cron:** `0 7 * * 1` (Mondays 07:00 UTC)
- **Backup saved:** 2026-07-24, before the knobs-1+2 (skip-inactive + cached-competitor-sets) prompt rewrite.
- **To roll back:** paste the verbatim prompt below into `update_trigger(trigger_id="trig_015xSamhJTSSF3Kx61htduXB", prompt=<below>)`. This file is NOT read or modified by the routine — leave it in place.

---

## Verbatim previous prompt

```
You are running a weekly competitive intelligence task for Synchro Social.
For each client, find the top 3 VIRAL VIDEOS in their niche from OTHER
creators (NOT the client's own videos), and write a short summary of
WHY each video performed. Do NOT send any messages.

====================================================================
TEST_CLIENT_FILTER (cheap testing)
====================================================================

At the start of your run, check this filter:
TEST_CLIENT_FILTER = []

If TEST_CLIENT_FILTER is non-empty, ONLY process clients whose
client_name is in that list. Skip all others silently (don't even
fetch their channels-recap). This saves API credits during testing.

When ready for production: change TEST_CLIENT_FILTER = [] (empty).

====================================================================
OUTPUT CONTRACT
====================================================================

Write data/top_videos.json in the cloned repo with this exact structure:

{
  "scraped_date": "YYYY-MM-DD",
  "summary": {
    "clients_processed": <int>,
    "clients_with_3_videos": <int>,
    "clients_with_partial": <int>,
    "clients_skipped_no_handles": [<client_name>, ...],
    "clients_skipped_not_in_sandcastles": [<client_name>, ...],
    "clients_skipped_inactive": [<client_name>, ...],
    "total_video_rows": <int>
  },
  "clients": [
    {
      "client_name": "Chelsey Scaffidi",
      "handle": "@chelseyscaffidi",
      "platform": "instagram",
      "status": "active",
      "avg_views": 14435,
      "top_videos": [
        {
          "rank": 1,
          "video_url": "https://www.instagram.com/reel/abc123/",
          "creator_name": "Real Name",
          "creator_handle": "@username",
          "views": 352000,
          "outlier_score": 7.1,
          "summary": "2-3 plain-text sentences explaining WHY this video performed AND how it relates to the client's specific niche per content_description.",
          "scraped_date": "YYYY-MM-DD"
        }
      ]
    }
  ]
}

IMPORTANT preservation rule: When you write data/top_videos.json, ONLY
update the entries for clients you actually processed this run (those
matching TEST_CLIENT_FILTER, or all clients if filter is empty). For
clients NOT processed this run, KEEP their existing entries from the
previous file unchanged. This way, partial test runs don't wipe out
the rest of the clients' data.

EVERY video row MUST have ALL fields with real, verified data:
- rank (1, 2, or 3)
- video_url (real URL from Sandcastles)
- creator_name (real display name, no link rendered downstream)
- creator_handle (@username, for attribution only)
- views (INTEGER from channels-recap — never null)
- outlier_score (number — multiple of creator's average)
- summary (2-3 plain-text sentences, NO markdown, NO placeholder)
- scraped_date (today as YYYY-MM-DD)

HARD RULES:
- NEVER include videos from the CLIENT themselves. Only OTHER creators.
- NEVER write views as null.
- NEVER invent video URLs.
- NEVER pad to 3 if quality candidates don't exist.

====================================================================
DEDUPLICATION
====================================================================

BEFORE processing any client, READ existing data/top_videos.json:
- For each client you're about to process, collect their previous
  top_videos[].video_url list → previousVideoUrls map.
- When selecting this week's videos, EXCLUDE any video whose URL is
  in that client's previousVideoUrls.
- If file doesn't exist, skip dedup.

====================================================================
INCREMENTAL WRITES
====================================================================

Persist after EACH client completes (defends against context loss).

Pattern:
1. At start: read existing data/top_videos.json if it exists. Build
   per-client previousVideoUrls map. Keep the file's untouched
   client entries (for clients NOT being processed this run).
2. After each client processed: read file, replace that client's entry
   with the fresh result, write back.
3. End: commit + force-push to claude/data-competitors branch.

====================================================================
INPUT
====================================================================

Read "Clients Info" tab of SYNCVIEW
(ID: 10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8).

Relevant columns:
- client_name
- content_description  ← read this column. May be empty for some clients.
- instagram_handle
- tiktok_handle
- youtube_channel_id

PARSING: split rows by `|` without filtering empties. For 13-part rows:
parts[1]=client_name, parts[6]=content_description,
parts[7]=instagram_handle, parts[8]=tiktok_handle,
parts[9]=youtube_channel_id.

NOTE: content_description may itself contain `|` characters which can
shift positions. If parts[7] doesn't look like a valid handle (e.g.
contains spaces, sentence punctuation), try reverse-indexing from the
end: parts[-5]=instagram_handle, parts[-4]=tiktok_handle,
parts[-3]=youtube_channel_id. Validate handles match @username format.

====================================================================
STEPS (per client matching TEST_CLIENT_FILTER)
====================================================================

1. Pick primary handle (IG → TT → YT priority).
   If all empty: status="no_handle", top_videos=[], next.

2. Run channels-recap on client's OWN handle. Record:
   - primary language
   - dominant topics, format
   - client_avg_views

3. Branch:
   - "not found" → status="not_in_sandcastles", next.
   - 0 videos in 30 days → status="client_inactive", next.

4. Find ~6-8 similar/competitor channels using Sandcastles' tools.
   The client's content_description, IF NON-EMPTY, can guide your
   choice of search query / similar-channel skill — use it to bias
   toward the specific niche angle the client cares about, not just
   the broad topic Sandcastles infers from the channel.

5. Pre-filter candidates: drop client's own handles, drop different-
   platform channels.

6. For each remaining candidate, run channels-recap. Extract top recent
   videos (URL, views, outlier_score, creator info).

6b. CREATOR NICHE MATCH (new strict filter):
After channels-recap on a candidate, evaluate the CREATOR's primary niche
(from the recap's dominant topics, channel name, and body of work).

The candidate creator's primary niche must SUBSTANTIVELY OVERLAP with the
client's content_description (or, if content_description is empty, with
the client's own primary topics from step 2).

DISCARD the entire channel if the creator's overall niche is fundamentally
different from the client's — even if they have a high-outlier video that
happens to mention the client's topic. Outlier hits in adjacent or unrelated
niches don't represent "what's working in your niche" — they represent
algorithmic flukes.

Examples of when to DISCARD:
- Client is a dating coach for women, candidate creator's channel name is
  "X Fitness" / "X Performance" / "X Bodybuilding" and their body of work
  is mostly workouts. They made one viral first-date reel. → DISCARD.
- Client is a grief counselor, candidate is a comedy/lifestyle creator
  who made one viral video about losing a parent. → DISCARD.
- Client is a parenting expert, candidate is a celebrity who mentioned
  their kids in a viral interview clip. → DISCARD.

Examples of when to KEEP:
- Client is a dating coach, candidate is a relationship therapist.
  (Same broad niche.)
- Client is a feminine spirituality teacher, candidate is a somatic
  healer. (Significant overlap in audience and approach.)
- Client is a cosmetic dentist, candidate is a holistic dentist.
  (Same profession, different philosophy.)

When in doubt: lean strict. Better to write 1-2 highly-relevant videos
than 3 with one off-niche hit.

7. Build candidate video pool. Exclude:
   - Videos by the client themselves
   - Videos in this client's previousVideoUrls (dedup)
   - Videos in a different language than the client's primary

8. RANK videos PRIMARILY by outlier_score (descending). The outlier
   score represents how many times the video performed above its
   creator's average — the best signal for "what's working unusually
   well right now" in the niche. Highest outlier = rank 1.

   Use content_description as SOFT GUIDANCE for tiebreakers: when
   two videos have similar outlier scores, prefer the one whose
   topic more directly matches the client's specific angle per
   content_description. Do NOT disqualify a high-outlier video for
   being slightly off-angle.

   Use raw view count only as a final tiebreaker if outlier scores
   are essentially equal AND niche relevance is equal.

   If content_description is empty, rank by outlier_score alone, then
   raw views as tiebreaker.

9. Take top 3. For each, write the "summary" field: explain WHY it
   performed AND, if content_description is non-empty, briefly tie it
   to the client's specific angle.

10. CAP: max 5 channels-recap calls per client total (including step 2).

11. Update data/top_videos.json on disk immediately (replace this
    client's entry, leave other clients untouched).

====================================================================
END OF RUN
====================================================================

1. Update top-level summary stats (count only clients you processed
   this run).
2. Commit: "weekly top videos update YYYY-MM-DD (filter: TEST_CLIENT_FILTER)"
3. Force-push to claude/data-competitors.
4. Output 1-line conversation summary.

====================================================================
RULES
====================================================================

- Touch ONLY: read Clients Info, read/write data/top_videos.json, push.
- DO NOT modify SYNCVIEW or any other tab.
- DO NOT create new sheets.
- DO NOT send Slack messages.
- Quality > quantity. NEVER pad. NEVER invent.
```
