# Round 3 tester prompt — paste this to the tester

Copy everything below the line. It is self-contained; the full checklist is
`docs/ops/FLIP_TEST_ROUND3.md` in the repo if they have it.

Do **not** paste the client share-link token into this message, into any report,
or into a screenshot filename.

---

Hey — round 3 on SyncView. Round 2 checked whether panels told the truth; this
round checks the **asset spec**, which went live yesterday morning and has never
been touched by a human. It's also the first round where you can actually break
something by writing to it, so read the ground rules first.

**Ground rules, non-negotiable:**

1. Mutate **only the test client**. Never touch a real client's rows. If you are
   not certain a row belongs to the test client, don't write to it.
2. Never paste the client share-link token into a report, a screenshot, a
   filename, or an issue title.
3. Report in this order: **what you SAW**, then **what you EXPECTED**, then the
   **exact steps**. A screenshot without steps is half a report.
4. If something looks wrong but you're not sure — report it. Six of the ten
   round-2 findings were things the previous tester almost didn't mention.

**Test each area from the seat that uses it.** The same screen lies differently
to different people: video editor (a video sub-issue in SyncLinear `?prod=1`),
graphics designer (a graphics sub-issue), SMM (the content calendar), and
client/Kasper (the approval surfaces and the share link).

---

## 0. Before you start — check the test data, or §1 and §2 will lie to you

Two of the checks below can only pass if the test client's batch actually HAS
the values they look for. Confirm this first, or you will file real-looking bugs
that are just empty fields.

- Pick a **parent with more than one sub-issue** on the test client. There are
  22 of them, and 11 carry both a video and a graphics sub-issue — use one of
  those 11 for §3, since you need both.
- **Filming plan is the one to check first.** It is deliberately editable by
  nobody — no button, no paste, no admin override — and it is only ever written
  by the batch-creation pipeline. So if the test batch has no filming plan set,
  §1 can never pass and there is nothing you can do about it from the app. If it
  reads "Unavailable" or "Not provided", **tell Sidney before continuing**; he
  has a one-line SQL to seed it.
- **Raw footage and Frame folder** you can set yourself — that is §2 — so those
  two being empty at the start is fine and is in fact a good starting state.

The distinction that matters everywhere in §1: **"the batch has no plan" and
"this reader cannot see the plan" are different bugs.** If the parent says
Unavailable, always open one of its sub-issues and look at the same three rows.
Both showing nothing means the data is empty (not a bug — tell Sidney). The
sub-issue showing links while the parent does not IS the bug, and it is the
exact one round 3 exists to confirm is gone.

---

## 1. The asset panel on a batch parent

Open a **parent issue** — the row that has sub-issues under it.

- The Assets panel should show **Filming plan**, **Raw footage**, **Frame
  folder**, each with a **real clickable link** — not "Not provided", not
  "Unavailable", not "Missing". Click each one; it should open the actual Drive
  or Frame destination.
- **Deliverable file must NOT appear on the parent.** A parent has no file.
- If a parent shows "Unavailable" on all three: tell me the parent's identifier
  and whether its sub-issues show the same three links. That combination is the
  exact thing this round exists to confirm.

## 2. What is editable, and what is not

On a parent AND on a sub-issue:

- **Raw footage** and **Frame folder** each have an **Edit** button.
- **Filming plan has NO Edit button at all.** Not greyed out — absent. If you
  find one anywhere, that's a P1, tell me immediately.
- Edit Raw footage on ONE sub-issue, save, then open a **different sub-issue of
  the same post**. The new link must be there too — it's one shared folder. Open
  the parent: same link.
- Clear the field and save. It should accept the clear (deliberate — a wrong
  link had to be fixable).
- Paste something invalid (a Google Doc link, or a plain word). It should refuse
  with a sentence that says what IS accepted.
- A brand-new, not-yet-shared Drive folder should be **accepted**, and may then
  report that it couldn't be reached. That is correct — the link is saved, the
  reachability is only reported. The message should mention Frame.io or
  "most providers", not only Drive.

## 3. The deliverable file, in both directions

**Editor → calendar.** On a **video** sub-issue, attach a Frame.io or Drive link
as the Deliverable file. Open the content calendar, find that card: the **Video
URL** should now hold the same link. Do the same on a **graphics** sub-issue →
it should land on the card's **Thumbnail**.

**Calendar → editor.** Take a *different* card whose video sub-issue has NO
deliverable file yet. As the SMM, paste a video URL into the card. Open that
sub-issue: **Deliverable file** should show that link with a small **"from the
content calendar"** beside it. Press Edit on that row and save it unchanged —
the note should disappear (it has become the issue's own file) and the calendar
should still hold it.

## 4. The file pill on the sub-issue list

Open a parent with sub-issues.

- Sub-issues that HAVE a file show a small **link pill** on their row, beside the
  project and due-date pills.
- Clicking the pill opens the file in a new tab and **must not** also open the
  sub-issue.
- Sub-issues with no file show **no pill** — not a dead one. (Correct. Don't
  file it.)

## 5. Controls that must refuse honestly — the theme of this round

A control that cannot act must say so **before** it is pressed, and must say
**why it actually** cannot act.

- **Project row**, right-hand panel of any issue. It must NOT open a picker. It
  should state the project and explain that a deliverable can't be moved between
  clients. Check the same in the right-click menu and in the bulk Actions
  palette — "Move to project…" should be visibly disabled in both, with the same
  reason.
- **Delete**, in the right-click menu and in the bulk Actions palette. Both
  should be greyed out and both should say deleting isn't available **for
  anyone**, and point at archiving on the content calendar. If either one looks
  live, or says "Preview - read-only", that's a finding.
- In the bulk **Actions** palette: type in its search box. The disabled rows
  should filter away with everything else, not sit there alone. Arrow up and
  down: the highlight should skip the disabled rows, and pressing Enter should
  never fire one.
- **Labels on a batch parent** should read **"No labels"** and, when opened,
  explain that a batch parent has no Linear issue of its own. There must be **no
  Retry button**. Labels on a real sub-issue must still work normally.
- Anything that toasts **"Preview - read-only"** *after the page has loaded* is a
  finding. Note exactly which control, and what you clicked. (The brief flash of
  that state in the first second of load is honest — don't file it.)

## 6. The SMM review queue

- Open the Review tab. If it says nothing is waiting, cross-check against the
  calendar: are there cards at "For SMM Approval"? If any exist that the queue
  isn't showing, there should now be a **line saying how many and naming them**.
  A silent empty queue over real waiting work is a finding.

## 7. Workload

Open the Workload board and filter to a few different clients.

- If a client shows an **empty board**, there should be a **line explaining why**
  — either rows with no assignee and no date, or rows assigned to someone not on
  that issue's team. A silent empty board is a finding.
- Tell me any client where that line appears, and the number it gives.

## 8. Regression — round 2 items that must still hold

- Batch parent shows three asset rows, not four.
- No Refresh button on the Description panel; no "Refresh access" on a parent.
- A video deliverable's Assets panel offers real controls.
- A Frame.io link and a Drive folder are both accepted as a deliverable; a Google
  Doc is refused with the real rule.
- Removing a link from a calendar card: the confirmation must match what actually
  happens after the next reload. Same on the Samples surface.
- Deep links: `#calendar/<client>` and `#kasper` survive a fresh load and a paste
  into an already-open tab.

## 9. Client and Kasper seats

- Open the client share link. Every refusal must be in plain words — no error
  codes, no role names, nothing about gateways, teams or authority.
- Approve and request-changes must both work, and must explain themselves when
  unavailable.
- Kasper's queue: a hand-off with no file attached must not disappear from either
  side.
- Anywhere a client is told to do something, check it's something they CAN do.

## What NOT to file

- Sub-issues with no file showing no pill — correct.
- A folder link saved but reported as unreachable — correct; sharing is a
  separate step.
- The brief "Preview - read-only" in the first second of load, before the page
  has checked permissions — that one is honest.
