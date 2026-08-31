# Flip test — round 3 (2026-08-31)

Round 2 verified panel *truth*. Round 3 verifies the **asset spec**, which went
live this morning, and it is the first round where a tester can actually break
something by writing to it.

Everything in §2 is new since round 2 and has never been touched by a human.
Everything in §5 passed in round 2 and must still pass.

**Ground rules, unchanged and non-negotiable.**

- Mutate **only** the test client. Never touch a real client's rows.
- Do not paste the client share-link token into any report, screenshot, file
  name, or issue title.
- Report what you SAW, then what you EXPECTED, then the exact steps. A
  screenshot without steps is half a report.
- If something looks wrong but you are not sure, report it. Six of the ten
  round-2 findings were things the previous tester almost did not mention.

---

## 1. Four seats, and why the seat matters

Test each area from the seat that actually uses it. The same screen lies
differently to different people.

| Seat | Where they live | What they must be able to do |
|---|---|---|
| **Video editor** | SyncLinear (`?prod=1`), a video sub-issue | See the plan and footage, attach the finished video, get it onto the calendar |
| **Graphics designer** | SyncLinear, a graphics sub-issue | Same, for the thumbnail |
| **SMM** | Content calendar | Paste a video URL / thumbnail and have SyncLinear agree with it |
| **Kasper / client** | Approval surfaces + share link | Never see staff jargon, never see a control that cannot act |

---

## 2. THE ASSET SPEC — the new surface, tested hardest

### 2a. The batch parent shows real links

Open a **parent issue** (the row with sub-issues under it) in SyncLinear.

- The Assets panel should show **Filming plan**, **Raw footage**, **Frame
  folder** with **real, clickable links** — not "Not provided", not
  "Unavailable", not "Missing".
- Click each. They should open the actual Drive / Frame destination.
- **Deliverable file must NOT appear** on the parent. A parent has no file.

If a parent shows "Unavailable" on all three: report the parent's identifier and
whether its sub-issues show the same three links. That combination is the exact
thing round 2 fixed and round 3 is meant to confirm.

### 2b. Raw footage and the frame folder are editable — the filming plan is not

On a parent AND on a sub-issue:

- **Raw footage** and **Frame folder** each have an **Edit** button.
- **Filming plan has NO Edit button at all.** Not a greyed-out one. None.
  If you find one anywhere, that is a P1 — report it immediately.
- Edit Raw footage on ONE sub-issue, save, then open a **different sub-issue of
  the same post**. The new link must be there too. It is one shared folder.
- Open the parent. Same link.
- Clear the field and save. It should accept the clear (that is deliberate — a
  wrong link had to be fixable).
- Paste something invalid (a Google Doc link, a plain word). It should refuse
  with a sentence that says what IS accepted.
- A brand-new, not-yet-shared Drive folder should be **accepted**, and may show
  a state that says it could not be reached. That is correct: the link is saved,
  the reachability is only reported.

### 2c. The deliverable file, in both directions

**Editor → calendar.** On a **video** sub-issue, attach a Frame.io or Drive link
as the Deliverable file. Then open the content calendar and find that card.

- The **Video URL** field should now hold the same link.
- Do the same on a **graphics** sub-issue → it should land on the card's
  **Thumbnail**.

**Calendar → editor.** Take a *different* card whose video sub-issue has NO
deliverable file yet. As the SMM, paste a video URL into the card.

- Open that sub-issue in SyncLinear. The **Deliverable file** row should show
  that link, with a small **"from the content calendar"** next to it.
- Now press Edit on that row and save it unchanged. The note should disappear
  (it has become the issue's own file) and the calendar should still hold it.

### 2d. The file pill on the sub-issue list

Open a parent with sub-issues.

- Sub-issues that HAVE a file should show a small **link pill** on their row,
  next to the project and due-date pills.
- Clicking the pill opens the file in a new tab and **must not** also open the
  sub-issue.
- Sub-issues with NO file should show **no pill** — not a dead one.

---

## 3. Controls that must refuse honestly

Round 2's theme, re-tested on new ground. A control that cannot act must say so
BEFORE it is pressed.

- **Project row** (right-hand panel of any issue). It must NOT open a picker.
  It should state the project and, on hover, explain that a deliverable cannot
  be moved between clients. Check the same in the right-click menu and in the
  bulk-actions menu — "Move to project…" should be visibly disabled in both,
  with the same reason.
- **Labels on a batch parent.** Should read **"No labels"** and, when opened,
  explain that a batch parent has no Linear issue of its own. There must be
  **no Retry button** — that Retry could never have succeeded.
  Labels on a real sub-issue must still work normally.
- Anything that toasts **"Preview - read-only"** *after* the page has loaded is
  a finding. Note exactly which control and what you clicked.

---

## 4. Workload

Open the Workload board and filter to a few different clients.

- If a client shows an **empty board**, there should now be a **line explaining
  why** — either that rows have no assignee and no date, or that rows are
  assigned to someone not on that issue's team. A silent empty board is a
  finding.
- Report any client where that line appears, and the number it gives.

---

## 5. Regression — round 2 items that must still hold

- Batch parent shows three asset rows, not four.
- No Refresh button on the Description panel; no "Refresh access" on a parent.
- A video deliverable's Assets panel offers real controls (it used to explain a
  refusal that no longer exists).
- A Frame.io link and a Drive folder are both accepted as a deliverable; a
  Google Doc is refused with the real rule.
- Removing a link from a calendar card: the confirmation must match what
  actually happens after the next reload.
- Deep links: `#calendar/<client>` and `#kasper` survive a fresh load and a
  paste into an already-open tab.

---

## 6. Client and Kasper seats

- Open the client share link. Every refusal must be in plain words: no error
  codes, no role names, no mention of gateways, teams or authority.
- Approve and request-changes must both work, and the buttons must explain
  themselves when they are unavailable.
- Kasper's queue: a hand-off with no file attached must not disappear from
  either side.
- Anywhere a client is told to do something, check it is something they CAN do.

---

## 7. What NOT to file

- Sub-issues with no file showing no pill — that is correct.
- A folder link saved but reported as unreachable — correct; sharing is a
  separate step.
- The brief "Preview - read-only" state in the first second of load, before the
  page has checked permissions — that one is honest.
