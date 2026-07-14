# Create-Post & Batch Intake Model (LOCKED)

**Status:** Locked decision — owner-confirmed 2026-07-13; implemented in the
draft #813 stack, not deployed.
**Applies to:** how new work (batches + deliverables) is created once SyncView is the
authority for a team. This is the target model the write-UI intake path (PR #813 and
its calendar card-materialization) must implement.

_Last updated: 2026-07-13._

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

The draft #813 intake path now covers all seven locked points. These checks record
source/test evidence; they are not a deployment or cutover approval:

- [x] **Per-client calendar entry:** staff Create Post derives the client from the
  open calendar; there is no client picker in the dialog.
- [x] **Batch choice:** the latest active client batch is selected by default, with
  an explicit create-new-batch alternative (and new batch is the safe fallback when
  no active batch exists).
- [x] **Paired work:** one shared item builder emits exactly one Video and one Graphics
  deliverable with the same calendar-card identity.
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
parity allowance disabled, real-client intake fails closed. The existing service-only
TEST override remains the only pre-flip bypass; browser staff/client credentials cannot
self-enter TEST scope. The owner controls deployment and any later authority/outbound
change separately.
