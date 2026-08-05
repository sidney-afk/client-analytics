# Mapping the TEST client's Graphics project (owner, ~3 minutes)

**What this is for.** SyncView works out which client a Linear issue belongs to
by looking at the issue's Linear *project* and finding which client owns that
project. The TEST client has its **Video** project registered but not its
**Graphics** one. So every Graphics test item comes back as "I don't know whose
this is", and the nightly self-test can never come out clean on the Graphics
side.

This is a missing entry in a list, not a bug. Adding it is the whole fix.

You do this once.

---

## What it looks like today

The nightly test reports this for its Graphics item:

```
client_attribution:direct_project_unmapped
```

In plain terms: *"this issue names a Linear project, and that project is not on
any client's list."*

Video reports no such thing, which is how we know the mechanism works and only
this one entry is missing.

## Step 1 — Get the Graphics project ID from Linear

1. Open Linear and go to the **Graphics** project used by the TEST client —
   the same project the nightly test's `GRA-…` items appear in.
2. With that project open, look at the browser address bar. It looks like:

   ```
   https://linear.app/<workspace>/project/<name>-<ID>
   ```

3. The **ID** is the long string at the very end, after the last `-`. Copy it.

> If you are unsure you have the right project: open any recent `GRA-…` issue
> created by the nightly test and look at which project it says it belongs to.
> That is the one.

## Step 2 — Add it to the TEST client's project list

The list lives in the Supabase `clients` table, in the `linear_project_ids`
column, on the row whose `kind` is `test`.

1. Open the Supabase dashboard → **Table Editor** → **clients**.
2. Find the row where **kind** is `test`.
3. Open its **linear_project_ids** cell. It currently holds something like:

   ```json
   { "video": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }
   ```

4. Add a `graphics` entry alongside it, pasting the ID from Step 1:

   ```json
   {
     "video": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
     "graphics": "PASTE-THE-GRAPHICS-PROJECT-ID-HERE"
   }
   ```

5. Save the cell.

**Do not remove or edit the existing `video` entry.** You are adding one line.

### Accepted shapes

The reader accepts `video`, `vid`, `graphics`, `graphic`, `gra` and `thumbnail`
as keys, and each value may be either the ID string directly or an object
containing `id`, `project_id` or `linear_project_id`. The simple form above is
the clearest — use it unless the existing cell already uses another shape, in
which case match whatever is already there.

## What you should see afterwards

On the next run of the nightly test, the Graphics line changes:

- `client_attribution:direct_project_unmapped` **disappears**
- the `client_slug:attribution_repair_sentinel_mismatch` diff **disappears**
  too — it was a knock-on effect of the same missing entry

One diff will remain on both Video and Graphics
(`client_attribution:attribution_state_or_revision_mismatch`). **That one is
expected and is not your problem** — it is a separate defect in how the write
gateway stamps new rows, written up in
`docs/audits/2026-08-05-attribution-stamp-soak-signal.md`. Adding this mapping
is not supposed to fix it.

## Why this matters beyond the test

The same lookup decides ownership for real clients. A client whose project is
missing from this list would have its work land as "unattributed" rather than
against them. It is worth a glance down the `clients` table to check every
active client has an entry for **each** team it actually has work in — the TEST
client is unlikely to be the only row where a second team was added later and
the list was not updated.
