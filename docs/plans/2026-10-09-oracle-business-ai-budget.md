# What I would do with a large AI budget: the whole business, not just the software

Session Oracle, 2026-10-09. Read only: nothing live was changed, no message was
sent, n8n was only listed. Client names and slugs are left out on purpose (this
repo is public); numbers are counts.

This sits beside Scout's list from the same day,
[`2026-10-09-token-budget-opportunities.md`](2026-10-09-token-budget-opportunities.md),
which looks only at the software. Scout's top three (alarms you can believe,
ship what is already built, re-prove the client links) are right and cheap, and
I would let them run. This document answers the bigger question: **where does
extra AI work make the agency more money, keep more clients, or give people
their time back?**

---

## The short answer

Almost all of the AI budget so far has gone into SyncView, the internal app:
about 500 merged changes in three weeks, more than half of them bookkeeping,
tests and restructuring. That work made the app solid. But the business is not
held back by the app any more. It is held back by four things, and AI can help
with all four:

1. **Kasper's hours.** He sells every deal, writes every monthly filming plan,
   approves every video and does all hiring. On 2026-09-01 he said filming
   plans take most of his time and stop him selling. The AI filming-plan
   pipeline exists but covers **3 of 32 clients**, and its first real batch for
   him went badly (2 of 7 ideas sounded like the client).
2. **Turning ad money into clients.** About **$5,000 of Meta ads in 90 days
   brought 1 new client.** Your own write-up ("what we did and what we
   learned") already found the real leak: it is after the click (the form,
   the money question, follow-ups that recovered 0 of 14), not the ads.
   Nobody measures close rate or cost per client won. No sales call is recorded.
3. **Keeping clients.** One client left for their own AI editing tool. The team
   agreed basic editing is becoming cheap and that the answer is relationship
   and advanced creative work. Yet nothing measures client health, the weekly
   "top reel" message is off, the analytics are paused, and Kasper's idea of a
   "client relationship agent" was never built.
4. **Proof that it works.** The website rests on about 6 to 9 case studies,
   some with numbers the repos cannot back up. The data to prove results
   (59,603 top-video rows, 5,420 daily metric rows, 19,000 review events a
   month) sits in the database unused, and nothing connects "which idea we
   filmed" to "how many views it got".

So my advice is: **keep the software spend steady, and point the new budget at
Kasper's time, sales, retention and proof.** Each client is worth about $3,000
a month (about $36,000 a year), so one extra client won or one client saved per
quarter pays for an enormous amount of AI.

One thing more money does not fix: **your and Kasper's attention.** About 20
finished software fixes are already waiting on an owner step. So every idea
below is designed to work unattended and hand you short drafts to approve, not
more things to supervise.

---

## How I got here

- Read all four repos: SyncView (`client-analytics`), the filming-plan
  pipeline, the Brain (client knowledge), the website and its ad docs.
- Read, without changing anything: HubSpot (deals and stages), Slack (a sample
  of client and team channels), Fathom (the 15 recordings on your account),
  Meta ads (90 days), Drive (recent files), Sandcastles and Higgsfield usage,
  and the n8n workflow list.
- Used four research helpers in parallel and checked their numbers against
  each other.

Limits: Fathom on your account has no sales calls (the Brain reads Kasper's
account, which holds 431 call files); HubSpot is partly imported by hand and
stale, so its win rate (roughly 25 to 30 percent of new deals) is a guess; I
sampled Slack and Drive lightly.

---

## What I found, in plain English

### Kasper is the business's narrowest pipe

- Company notes in the Brain say Kasper does all the selling, writes every
  filming plan, approves every deliverable and does all hiring.
- The idea pipeline is good engineering (37 AI steps per batch, a hook
  playbook learned from 1,820 of his hooks), about 10 minutes and roughly
  $3 to $4 of research credits per batch. It is set up for 3 clients.
- What Kasper keeps correcting is consistent, which means it can be learned:
  ideas that borrow the reference creator's claim instead of the client's;
  hooks that are long or describe the video; scripts in the wrong shape;
  too many "check with the client" questions ("create the plan based on the
  database"); direction he already gave that never reached the Brain.
- His accept, reject and rewrite history already exists in the ideas Sheets
  and in `kasper-feedback/`. Nothing yet learns from it automatically.
- Every video also goes through his review. The Brain already turned 3,154 of
  his Frame.io review comments into 149 rules (safe zone, music, colour,
  empty first frame, filler words). Nothing checks a video against them
  before it reaches him.

### Sales: the leak is after the click

- 90 days, agency ad account: about $5,080 over 5 campaigns. Booked calls cost
  $226 to $663 each depending on campaign. Your own doc puts it at about $416
  per booked call and 1 client won.
- The booking tool's own "qualified" signal has not reached Meta for 28 days,
  so the campaign may be learning from nothing. Meta is never told who became
  a client.
- HubSpot: 42 deals, 9 stuck at "Call Scheduled" for months, "Closed Lost"
  unused, every contact's source "offline". So close rate and cost per client
  cannot be computed today.
- Follow up after a call, after a no-show, or for "not now" leads does not
  exist. Event and investor bookings never reach the CRM.
- No sales call is recorded or reviewed, so nobody knows which objections lose
  deals.
- The doctor offer (guaranteed followers, cold ads) is new and has 4 booked
  calls. It is the right place to learn fast because it is narrow.

### Retention: no early warning

- One client lost to an in-house AI editor; another reported as "in
  transition". Collections friction (an invoice outstanding, a contract
  unsigned for three months) came up in a team meeting.
- Signals that would warn early already exist but nobody joins them: how many
  times a client sends a video back, how long approvals take, the tone of the
  client's Slack channel, call notes, missed filming days, view trends.
- What clients see of their results is thin: analytics paused since
  2026-10-06, the weekly top reel off since 2026-09-03, the monthly check-in
  reaching 5 people.

### Proof and the performance loop

- The pipeline cannot learn what works because a posted video is never
  labelled with the idea, format and hook it came from (the Brain's own
  `formats` file says this on purpose). A weekly Sandcastles report exists that
  nothing reads.
- So the agency cannot yet say, with its own numbers, "this kind of hook gets
  3 times the views for coaches", which is exactly the sentence that sells.

### Tools you pay for and barely use

- Higgsfield: $15 of a $200 monthly team budget used this month, almost all
  by you. Sandcastles: 225 credits left, 2 of 4 research projects empty.
- Editors say the Claude editing agent already saves hours (a teaser 3 hours
  faster, a day of graphics in 5 minutes). Staff asked you for "the text to
  paste" to set up their own Claude. That is cheap, fast leverage.

---

## The ranked list

"Session" means one long working day of an AI worker, roughly 1 to 3 million
tokens. Value is my rough guess at what it is worth if it works.

### 1. Kasper's double: filming plans and ideas for every client (start first)

- **What:** turn the pipeline from 3 clients to all 32, and make its output
  good enough that Kasper edits instead of writes. Teach it from his history:
  a "would Kasper accept this?" judge trained on his accepted, rejected and
  rewritten rows; generate many more candidates and keep only the best; run
  the fit and fact checks several times and take the majority, so results stop
  changing between runs; fill each client's "this month's focus" from calls
  and Slack so plans stop needing questions back to the client.
- **Why:** this is the single biggest unlock. Every hour Kasper does not
  write is an hour he can sell or look after clients.
- **Size:** 4 to 8 sessions over a few weeks, then about 1 session a month
  per few clients to run. Research credits rise (budget for a bigger
  Sandcastles plan). **Risk:** low; output is drafts in Docs and Sheets.
- **Worked when:** Kasper accepts most ideas with light edits for 3 batches
  in a row; 10 more clients set up within a month; his own estimate of hours
  per week on plans halves.

### 2. Sales after the click (start first)

- **What:** four pieces, all drafts for Kasper, never sent automatically:
  (a) a pre-call brief for every booked lead (their public profiles, niche,
  audience, what our past clients like them achieved); (b) a clean, honest
  sales scoreboard: bookings, show rate, close rate, cost per client won, by
  campaign and offer, with HubSpot tidied so it can be computed; (c) follow
  up drafts after calls, no-shows and "not now"; (d) once Kasper records his
  sales calls (his choice, with the lead's consent), a monthly objection and
  close-rate review.
- **Why:** doubling the close rate halves what a client costs. The leak is
  already diagnosed in your own doc; this turns the diagnosis into a routine.
- **Size:** 3 to 5 sessions to build, then light weekly runs. **Risk:**
  medium only because sales automation lives in n8n: this plan reads it and
  never edits it without your go.
- **Worked when:** every booking has a brief before the call; you can read
  cost per client won for last month in one place; follow up exists for every
  no-show.

### 3. Client health radar, the "client relationship agent" Kasper proposed (start first)

- **What:** every Monday, one private page for you and Kasper: each client
  scored green, amber or red, with the reason in one line and a suggested
  next step (call them, send a win, fix an approval delay, chase an invoice,
  offer an upsell). Inputs: send-backs per video, approval delays, Slack tone,
  call notes, filming gaps, view trends, contract and payment state.
- **Why:** losing one client costs about $36,000 a year. Most clients who
  leave give signals weeks before; nobody is watching them together.
- **Size:** 2 to 3 sessions to build, then a small weekly run. **Risk:** low;
  read only, private output.
- **Worked when:** the first run flags clients you agree are at risk (a gut
  check); over a quarter, no client leaves without having been flagged amber
  or red first.

### 4. Results engine: label every video, learn what works, prove it (start first)

- **What:** tag each posted video with the idea, format and hook it came from;
  join that to views; write a per-client "what worked" file the pipeline reads;
  produce a monthly results summary per client (draft for the account manager
  to send) and, with the client's permission, case studies built only from
  numbers the database can show.
- **Why:** it makes ideas better (the pipeline learns), keeps clients (they
  see results), and sells (proof on the website and in sales calls).
- **Size:** 3 to 4 sessions. Needs your decision to turn the paused analytics
  back on for at least the views data. **Risk:** low.
- **Worked when:** 80 percent of new posts carry a label; the pipeline cites
  "what worked" for each client; 3 new verified case studies exist.

### 5. Kasper's eyes: a pre-review check on every video

- **What:** before a video reaches Kasper, an AI check against his 149 learned
  rules and the client's editing notes (safe zone, music, first frame, filler
  words, caption length, brand look), posting a short checklist on the card for
  the editor to fix first.
- **Why:** fewer send-backs, fewer review rounds for Kasper, faster delivery.
  The 14,000 past review comments are a ready-made teacher.
- **Size:** 3 to 4 sessions (watching video costs more tokens; this is where a
  big budget is genuinely needed). **Risk:** low if it only advises.
- **Worked when:** send-backs per video fall by a third over a month.

### 6. Everyone on the team gets a well set up AI

- **What:** a short, role-specific Claude setup for editors, account managers
  and the designer (house instructions, the right connectors, the client's
  Brain brief), plus a one-page "how to use Higgsfield and Sandcastles" so the
  paid tools get used.
- **Why:** staff asked for it; editors already save hours. Cheapest win here.
- **Size:** 1 session plus a 30 minute team walkthrough. **Risk:** low.

### 7. Ad creative and the doctor niche

- **What:** the 3 to 5 hook test your doc plans, at scale: many hook scripts
  per offer written from real client wins, ranked by the hook playbook; niche
  landing page drafts per specialty (dentist, chiropractor, surgeon); real
  videos for the two placeholder sales pages.
- **Why:** 75 percent of viewers leave by second 3; the hook is the ad.
- **Size:** 2 sessions. **Risk:** low as drafts; spend stays your decision.

### 8. Ideas nobody has had yet

- **A yearly industry report as a lead magnet.** The agency has views data on
  dozens of creators. An anonymised "what grew coaches and experts on short
  video in 2026" report is content no competitor can copy. 2 sessions.
- **Editor academy.** Turn the 14,000 review comments and 149 rules into a
  training course and a practical test, so new editors reach Kasper's standard
  in weeks and hiring stops depending on him. 2 sessions.
- **A premium "strategy" tier.** The client strategy call (positioning, visual
  standard, hook tests, lead magnet) is high value work AI can prepare in
  advance. Sell it as an add-on for clients who want more than editing; it is
  the team's own answer to editing becoming cheap.
- **Practice sales calls.** An AI that plays a sceptical doctor or coach using
  the real objections, so Kasper (and a future second closer) can rehearse.
- **The agency's own channel.** Use the pipeline on Synchro Social itself: the
  agency that grows creators should visibly grow its own account.

### 9. Software: keep it steady, not growing

Let Scout's top three run (alarms, ship the waiting fixes, re-prove client
links). Pause new software projects that no client or staff member feels,
until 1 to 4 above are moving. Two money decisions need you, not tokens:
downgrading the n8n plan (most of its runs are two hiring robots), and the
text-message consent question on the sales funnel.

---

## What I would not do

- **A bigger SyncView rebuild.** It works; more polish has the lowest return.
- **Fully automatic messages to clients or leads.** Every idea above produces
  drafts a person sends. Trust is the agency's product.
- **Write client results into this repo.** It is public. Client specific
  outputs belong in the private `synchro-brain` repo or in Drive.

---

## Decisions only you can make

1. Turn analytics back on (at least views) so idea 4 has data.
2. Ask Kasper whether he will record sales calls, and how leads are told.
3. A bigger Sandcastles plan for idea 1 (a few hundred dollars a year).
4. Which clients may appear in case studies (their written yes first).

---

## Ready-to-paste prompts

Each one is for a fresh session. They can run in parallel: they touch
different repos and different files.

### Prompt 1: Ghostwriter (filming plans and ideas for every client)

```
You are the session named Ghostwriter.

Goal: the idea and filming-plan pipeline produces work Kasper edits instead of
writes, for every client, so his hours go to selling and clients.

Repos: sidney-afk/synchro-pipelines (your workspace) and sidney-afk/synchro-brain
(client knowledge), checked out side by side. Start with git pull in both, then
read synchro-pipelines/CLAUDE.md, KASPER.md, STATE.md (newest sections),
RUNBOOK.md, PIPELINE.md, kasper-feedback/ and synchro-brain/README.md and
POLICY/. Background: sidney-afk/client-analytics
docs/plans/2026-10-09-oracle-business-ai-budget.md, idea 1.

Rules: never write ideas or plans by hand when a step cannot run; never use
--dev-ignore-shipped-collisions or --allow-test-doc on a real client; Google
only through google_relay.py; spend research credits deliberately and report
every spend; do not edit n8n; send no messages to anyone. Pipeline code
changes go in their own pull request for Sidney and are not merged by you.
Trial output goes to test Docs and test Sheet tabs until Sidney says
otherwise.

Do, in order, measuring before changing:
1. Build a labelled set from Kasper's history: every accepted, rejected and
   rewritten idea row in the clients' ideas Sheets, plus kasper-feedback/
   notes. Count them. Write what separates accepted from rejected, in plain
   English, with examples (in the private repo only).
2. Build a "would Kasper accept this?" judge from that set. Prove it: hold
   back 20 percent of his past decisions and report how often the judge
   agrees with him.
3. Make the generator write several times more candidates per slot and let the
   judge keep the best. Run the fit and fact checks three times each and take
   the majority so results stop changing between runs. Make check.py fail on
   any row still marked "revise".
4. For each set-up client, fill the month's focus file from recent calls and
   Slack notes in the Brain, with sources, so plans stop asking questions back.
5. Run one full batch for one set-up client into a test tab and grade it with
   the judge and against Kasper's last real edits. Then set up 3 more clients
   (report credits used).

Report in plain English: judge agreement rate, before and after quality on the
test batch, clients set up, credits and tokens used, and the pull request link.
```

### Prompt 2: Closer (sales after the click)

```
You are the session named Closer.

Goal: Kasper walks into every sales call prepared, every lead gets follow up,
and the owners can read cost per client won, so the ad money turns into
clients.

Read first: sidney-afk/synchrosocial CLAUDE.md and docs/meta-ads/ (README,
SETUP_RUNBOOK, booking-recovery notes); sidney-afk/client-analytics CLAUDE.md,
docs/STATE_OF_THINGS.md, docs/CLIENT_LIFECYCLE_MAP.md (traffic to sales
close), docs/features/KASPER_AD_PERFORMANCE.md, and
docs/plans/2026-10-09-oracle-business-ai-budget.md (idea 2). In Drive, read
the owner's doc on what the ads taught us.

Hard rules: READ ONLY on HubSpot, Meta ads, iClosed and n8n. Never edit an n8n
workflow, never send an email, text or Slack message, never change an ad or a
budget, never create or change a CRM record. Everything you make is a draft or
a proposal. client-analytics is a PUBLIC repo: no client names, lead names,
emails, phone numbers or slugs there; anything about a named person goes only
to the owner privately (a private Drive doc or the private synchro-brain repo).

Do:
1. Scoreboard: from HubSpot, iClosed data in SyncView, and Meta, compute for
   the last 90 days by campaign and offer: bookings, shows, closes, cost per
   booked call, cost per client won. List every gap that stops a clean number
   (stale stages, unused Closed Lost, missing sources, test contacts) and the
   exact cleanup, as a proposal for the owner to approve.
2. Pre-call brief: design and prototype a one-page brief for a booked lead
   from public information only (profile, niche, audience size, content
   style, what similar past clients achieved, likely objections). Produce
   briefs for 3 recent bookings as samples, privately.
3. Follow up: write the drafts that should exist for no-show, after-call
   "thinking about it", and "not now, maybe later", in Kasper's voice
   (use the message-drafter style in the Brain). Propose where they would plug
   in, without building anything in n8n.
4. Write a short proposal for recording and reviewing sales calls (consent
   wording, where recordings go, a monthly objection review), as a decision
   for Kasper.

Put the non-identifying plan and scoreboard method in ONE pull request on
client-analytics (docs/plans/), do not merge it, and run
node scripts/repo-identity-exposure-check.js --diff="origin/main" after
committing. Report in plain English with the numbers, the decisions needed,
and your token usage.
```

### Prompt 3: Radar (client health, the relationship agent)

```
You are the session named Radar.

Goal: every Monday the owners see which clients are healthy, which are
slipping and why, with one suggested next step each, so no client leaves
without warning.

Read first: sidney-afk/client-analytics CLAUDE.md, AGENTS.md,
docs/STATE_OF_THINGS.md, docs/CLIENT_LIFECYCLE_MAP.md and
docs/plans/2026-10-09-oracle-business-ai-budget.md (idea 3);
sidney-afk/synchro-brain README.md, POLICY/ and company/.

Hard rules: READ ONLY everywhere (SELECT queries, Slack and Fathom reads,
HubSpot reads). Send no messages, post nothing, edit no n8n workflow, write
nothing to the live database. client-analytics is PUBLIC: the method and code
may go there, but no client names, slugs or per-client scores. Per-client
output goes only to the private synchro-brain repo (or a private Drive doc for
the owner).

Do:
1. List the signals that exist per client and measure each for the last 90
   days: send-backs per video and per thumbnail, days from "ready" to client
   approval, filming gaps, posting volume, view trend, Slack channel tone and
   unanswered client messages, call notes in the Brain, contract and payment
   state. Say which are reliable.
2. Back-test: for the client(s) who left in 2026, did the signals turn bad
   before they left, and how early? Use that to set the scoring.
3. Produce the first weekly page: each client green, amber or red, the reason
   in one line, one suggested next step (call, share a win, fix a delay, chase
   an invoice, offer more). Private repo only.
4. Write how it would run every week by itself (read only, private output)
   and what it would cost in tokens per run.

Put the method (no client data) in ONE pull request on client-analytics, do
not merge it, run node scripts/repo-identity-exposure-check.js
--diff="origin/main" after committing. Report in plain English: how well the
back-test predicted, how many clients are amber or red today (counts only in
the PR, details privately), and your token usage.
```

### Prompt 4: Scorekeeper (results engine and proof)

```
You are the session named Scorekeeper.

Goal: every posted video is linked to the idea, format and hook it came from
and to its views, so the pipeline learns what works for each client, clients
see their results, and the agency has proof it can show.

Read first: sidney-afk/client-analytics CLAUDE.md, AGENTS.md,
docs/STATE_OF_THINGS.md (analytics are paused by owner decision: do NOT turn
them on), docs/plans/2026-10-09-oracle-business-ai-budget.md (idea 4);
sidney-afk/synchro-brain company/formats.md and PROPOSALS/enrich-performance.md;
sidney-afk/synchro-pipelines PIPELINE.md and own_performance_ingest.py.

Hard rules: read only on live systems (SELECT queries, Sandcastles reads that
cost no credits unless you report each one). No live writes, no switches, no
n8n edits, no messages. client-analytics is PUBLIC: no client names, slugs,
handles or per-client numbers there. Per-client output goes to the private
synchro-brain repo.

Do:
1. Measure how well posts can be joined today: calendar cards to posted
   videos to view rows (analytics_top_videos, analytics_post_tracking) to
   ideas Sheet rows. Report the match rate and why rows fail to join.
2. Design the label every new card should carry (idea id, format, hook
   family) and where it is set with the least work for account managers;
   write it as a proposal with the exact SyncView change, not built.
3. Back-fill labels for the past 90 days for the 3 pipeline clients using the
   Brain and the Docs, and write each one's "what worked" file (formats and
   hook families ranked by views relative to that client's normal), in the
   private repo.
4. Draft one monthly results summary per pipeline client and a case study
   template that only uses numbers the database shows, plus a list of the
   strongest verified results across all clients (private).
5. State what turning views collection back on would need, as a decision for
   the owner.

Method and proposal in ONE pull request on client-analytics, not merged; run
node scripts/repo-identity-exposure-check.js --diff="origin/main" after
committing. Report in plain English: match rate, what the data says works,
decisions needed, and your token usage.
```
