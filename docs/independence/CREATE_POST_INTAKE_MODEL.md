# Create-Post & Batch Intake Model (LOCKED)

**Status:** Locked decision — owner-confirmed 2026-07-13; partially implemented in the
#850 merged dark cohort and pinned gateway deployment. Submit's single-team Advanced actions remain
open under F101; no real-client enrollment is authorized.
**Applies to:** how new work (batches + deliverables) is created once SyncView is the
authority for a team. This is the target model the write-UI intake path (merged through PR #850 and
its calendar card-materialization) must implement.

_Last reconciled: 2026-07-20._

---

## The decision, in plain terms

New work is created through **two structured entry points only** — "Create Post" (on a
client's calendar) and "Submit" (the intake tab). There is **no free-form "create issue"
button** in the SyncView Linear tab; every issue therefore always traces back to a client
and a batch.

### 1. Entry point — Create Post lives on the client's calendar
- An SMM clicks **"Create Post" from within a specific client's content calendar.**
- The **client is implicit from that calendar** — the SMM does **not** pick a client. (This
  is how it works today and does not change.)

### 2. Batch choice at creation time
When creating a post, the SMM chooses one of:
- **Add to the client's latest / current batch** (the common case — a new post joins the
  cycle already in progress), **or**
- **Create a new batch** for that client.

The "create a new batch" path should **behave like Submit's batch creation** — it reuses
the same native intake mechanism (a new parent batch in the client's mapped Linear
project, plus its deliverables). So an SMM can start a fresh batch from the calendar
without being sent to the Submit tab.

### 3. What one post creates
Each post creates a **paired set of sub-issues in the chosen batch:**
- **one Video sub-issue**, and
- **one Graphics sub-issue.**

Both land under the same parent batch — matching today's model where a post is a
video + its thumbnail/graphic.

### 4. Where the sub-issues file
Sub-issues file into the client's **mapped Linear project** (the team-tagged
`clients.linear_project_ids` populated 2026-07-13):
- the Video sub-issue → the client's **video** project mapping,
- the Graphics sub-issue → the client's **graphics** project mapping.

(For the 28 shared-project clients both map to the same project; for the 3 split clients
they map to their separate per-team projects.)

### 5. Two batch-creation surfaces coexist — both allowed
- **Submit** — the primary path, used mainly by videographers when a whole new batch of
  content arrives. Creates a parent batch + its deliverables.
- **Create Post → new batch** — the SMM's ad-hoc path for spinning up a new batch directly
  from a client's calendar.

Both create batches; both file into the same mapped project. Create Post's "new batch"
option reuses Submit's intake logic so there is one creation mechanism, two doorways.

---

## Why this shape

- **Keeps the SMM's habit intact** — they still just "create a post" on the client's
  calendar; the batch choice is one extra pick, defaulting to the current cycle.
- **Covers both real needs** — adding to an in-progress cycle (latest batch) *and* starting
  a fresh cycle (new batch) — without forcing SMMs into the Submit tab.
- **Preserves the structured chain** — client -> batch -> deliverables -> calendar ->
  approvals. Because creation only happens through Create Post and Submit, nothing
  orphaned ever appears on a project's calendar.
- **No free-form creation in the Linear tab** — that tab is for viewing and acting on
  existing issues (status, comment, due, assignee), never for spawning new ones.

---

## Before-go-live implementation gap check

The #850 merged dark cohort records source/test changes for most of the seven locked points,
but does not close F101. These checks are shipped source evidence only; they are not real-client
enrollment or cutover approval, and current `main` remains governed by the F101 release gate below.

### #850 merged dark-cohort evidence
- [x] **Per-client calendar entry:** staff Create Post derives the client from the
  open calendar; there is no client picker in the dialog.
- [x] **Batch choice:** the latest active client batch is selected by default, with
  an explicit create-new-batch alternative (and new batch is the safe fallback when
  no active batch exists).
- [ ] **Paired work (partial):** Calendar Create Post emits exactly one Video and one Graphics
  deliverable with the same calendar-card identity. Enrolled Submit still permits Advanced
  Video-only or Thumbnail-only intake, so the shared candidate does not yet satisfy F101.
- [x] **Per-team filing:** the gateway resolves and validates Video and Graphics
  project mappings independently and fails closed on a missing or ambiguous mapping.
- [x] **One new-batch engine:** calendar new-batch and Submit both use the same
  authenticated `intake_create` operation, durable intake job, and card materializer.
- [x] **Two batch-creation doorways:** Submit and calendar Create Post can both create
  a batch; calendar Create Post can also append to an existing batch with CAS.
- [x] **No free-form Linear-tab create:** the Linear mirror remains limited to actions
  on existing work; no issue or sub-issue creation control was added there.

### Dormant rollout stance

This remains an additive, authority-gated draft. No Edge Function or browser bundle
was deployed for this gap closure, no Linear write was used as evidence, and no runtime
flag changed. With production authority still Linear/Linear and the independent legacy
parity allowance disabled, an enrolled real client's native intake fails closed; unlisted
real clients remain on MAIN's F44 durable-receipt legacy path. The existing service-only TEST
override remains the only pre-flip bypass; browser staff/client credentials cannot self-enter
TEST scope. The owner controls deployment and any later authority/outbound change separately.

### Current-main release gate â€” F101

Until the candidate is merged and reverified, the later `main` audit remains authoritative:

- [ ] Create Post is invoked per-client from the calendar (client implicit).
- [ ] Create Post offers **latest-batch (default)** vs **new-batch**.
- [ ] Each post creates **both** a Video and a Graphics sub-issue under the chosen batch.
- [ ] Sub-issues file into the correct **per-team mapped project** (video vs graphics).
- [ ] The **new-batch** path reuses Submit's native intake (parent + deliverables).
- [ ] Batch creation works from **both** Submit and Create Post.
- [ ] No free-form issue/sub-issue creation surface exists in the Linear tab.

### Current implementation correction — F101

The shipped Submit form still exposes Advanced **Video issue only** and **Thumbnail issue only**
actions. Current card materialization and #850's merged dark-cohort path create only the selected deliverable but
initialize the absent sibling as `In Progress`. Calendar then counts that nonexistent leg in overall
and client-ready state while disabling the control that could advance it.

The locked paired decision above therefore requires those single-team actions to be removed and
rejected server-side before any real-client native-intake enrollment. Existing single-link cards must be classified as
missing-link repairs versus deliberate exceptions. **Owner question:** are any deliberate
single-team posts still supported? If yes, ratify that exception and require explicit active/N/A
component semantics across every review, readiness, queue, comment, alert, artifact, and migration
path; do not represent absence as approval or unfinished work.
