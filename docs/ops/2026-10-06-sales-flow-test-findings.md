# Sales email and text flows: simulated test findings (2026-10-06)

Session Relay. Method: n8n test runs with every email, text, Slack, Telegram,
HubSpot and Meta step simulated (and every "start another workflow" step
simulated), made-up `@example.invalid` addresses only, plus read-only counts of
past runs. Nothing was edited, published, deactivated or run for real. No code
changed. Each fix below is one sentence; the owner decides.

Past runs are counted by date only. Lead details are deliberately absent.

## Today's three changes (Lighthouse): confirmed

| Change | Result |
|---|---|
| Normal handler no longer starts the sequence twice on a same-day booking | Confirmed. 6 simulated runs (new/returning, today/tomorrow/next week, with and without phone): exactly one confirmation, one sequence start, one text. Before the fix, real runs on 2026-10-02 and 2026-10-06 each started the sequence twice for one booking. |
| Normal nurture stops if it started for that email in the last 24h | Works, case-insensitive. But it is too broad, see finding 2. |
| Normal nurture sends nothing for calls on today's date | Confirmed (incl. a near-midnight time zone where UTC says tomorrow but the lead's local date is today). Calls "tomorrow" still get the full six emails. |
| AI funnel copies unchanged | Confirmed unchanged, and still duplicating, see finding 1. |

## Findings, worst first

1. **AI funnel: a new lead booking today or tomorrow gets the nurture started twice (confirmed by simulated run).** The router starts it directly and again after the confirmation email. Today's call: nurture email #1 twice. Tomorrow's call: all six emails twice. The AI nurture has no 24h guard. Fix: remove the direct start from the "AI New Booking Today?" branch and add the same guard to the AI nurture.
2. **A rebook within 24h gets no nurture at all (confirmed).** The guard is keyed on email only, so a new, different-time booking is blocked, and the old sequence stops at its cancellation check. A cancel then rebook of the same slot is also silent forever, because a cancellation row has no date test. Fix: key the guard on email plus start time, and ignore a cancellation older than the booking it is checked against.
3. **A lead who books twice minutes apart is treated as "returning" the second time (real case, 2026-10-06, 7 minutes apart, before the guard).** Result: 3 sequence starts and a second confirmation that says "reconnecting with you". Fix: treat a booking made within the last day by the same email as the same lead, and use the new-lead copy.
4. **"Returning" is decided by "contact exists in HubSpot", and booking capture also creates contacts.** If capture writes the contact a moment before the handler looks, a brand-new lead gets the short "reconnecting" email, no deal, and (future calls) no nurture sequence. 0 of 3 recent new-lead runs lost this race, by well under a second. Fix: decide "new" by "no deal id on the contact", not "no contact".
5. **Returning lead with a future call gets a confirmation and no nurture sequence.** Only a returning lead booking tomorrow or today starts one. Question for the owner: intended?
6. **Doctors: a lead who submits and never books gets two emails about 30 minutes apart** (instant link, then the "didn't finish" follow-up), and the instant email and text also go to people who then book within minutes. A lead who submits in the text quiet window never gets the instant text, only a later recovery text. Question for the owner: intended? Fix if not: wait about 3 minutes and re-check for a booking before the instant send.
7. **Two events in the same second:** the guard and the new-lead check are read-then-write with roughly a 100 ms gap, so true simultaneous events can both pass (two sequences, or two confirmations). Not provable here because test runs start one at a time. The Meta event is safe (Meta de-duplicates on its own event id). Fix: write the guard row first, then read it back.
8. **Bad or empty time zone or start time:** the nurture silently sends nothing, and the confirmation email and text would error (no confirmation to the lead; the error alert fires). 0 of 7 recent bookings had this. Fix: fall back to the default zone before any date maths.
9. **Cancellation with no email in the payload is dropped**, so that lead's nurture keeps going. Cancellation matching is exact-string on start time (31 of 32 stored rows match the booking format). Low.
10. **"Tomorrow" calls get all six emails squeezed into the hours before the call** (interval = time left / 7, minimum 30 min), so a late-evening booking gets emails overnight. Low.
11. **Descriptions are stale:** the router, Normal handler and Normal nurture descriptions still describe the old same-day behaviour. The dispatcher's Slack text says a text window of 8am to 9pm; the code uses 8am to 6pm.
12. **Meta event workflow has no error workflow set**, so a failed send is silent. A booking that is later cancelled still counts as a Schedule event. Low.
13. **Shared secrets are written inside several workflow definitions** (the same value in capture and the Meta event). Not repeated here.

## Situations: what the lead receives

See the table in the session reply; it is the source for this list. Everything else
tested behaved correctly: capital letters and spaces in emails (router, cancel and
guard all lowercase), no phone (no text, email still sent), cancellation stops the
sequence, booking after partial capture suppresses the recovery email and text,
booked-by-phone-only and booked-with-different-capitals are never chased, opt-outs
and old rows expire, quiet hours defer only the text, under-$2,000 doctors leads get
nothing, unknown event types are ignored, a repeat "still interested" ping after a
booking does not re-arm.

## Past runs (counts only)

| Flow | Window | Runs |
|---|---|---|
| Call-booked router | since 2026-09-20 | 7 (09-29 x2, 09-30 x2, 10-02 x1, 10-06 x2), all succeeded |
| Normal handler | same | 4, all succeeded |
| Normal nurture starts | same | 6 real, of which 2 were duplicates (10-02, 10-06) |
| AI nurture | same | 0 |
| Call cancelled | since 2026-09-01 | 5 (two pairs arriving within 2 seconds) |

## Rows written by the tests

`Pre-Call Nurture Started` (3 rows, ids 3 to 5): three made-up addresses starting `relay-`.
Rows 1 and 2 pre-date the tests (Lighthouse). `iClosed Cancelled Calls` (1 row, id 33):
one made-up address starting `relay-cancel`. No other table was written. There is no
tool to delete data-table rows, so these four need removing by hand in n8n.
