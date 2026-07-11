# B3 inbound mirror scenario harness - 2026-07-11

## Scope

`scripts/b3-mirror-scenario-harness.js` exercises the live Linear -> Supabase
inbound mirror against the `Sidney Laruel` TEST project only. It fails closed
unless all configured issues are VID-/GRA- issues in that exact project and
`B3_CONFIRM_TEST_MUTATIONS=1` is present.

Supabase observations use the public anon key. Linear mutations use
`LINEAR_API_KEY`. The service-role key is restricted to `deliverable_write` and
`batch_write` snapshot restoration after each verdict. The harness does not
read or write runtime flags or `mirror_outbox`.

Required configuration:

```text
B3_CONFIRM_TEST_MUTATIONS=1
B3_TEST_PROJECT_ID=<TEST project UUID>
B3_TEST_PROJECT_NAME=Sidney Laruel
B3_TEST_CLIENT_SLUG=sidneylaruel
B3_TEST_PRIMARY_ISSUE=<disposable hidden/canceled TEST issue>
B3_TEST_PARENT_ISSUE=<TEST parent issue>
B3_TEST_CROSS_VIDEO_ISSUE=<TEST VID issue>
B3_TEST_CROSS_GRAPHIC_ISSUE=<TEST GRA issue in the same batch>
LINEAR_API_KEY=<private environment value>
SUPABASE_SERVICE_ROLE_KEY=<private environment value>
```

The optional `--report-json` and `--report-md` arguments write the detailed
TEST-only evidence to a private local path. No detailed report is committed.

## Live result

Final run marker: `b3-mirror-mrgss67d`

| Scenario | Result | Duration | Evidence |
|---|---:|---:|---|
| Create parent + sub-issue | FAIL | 33.4 s | Neither deliverable nor batch was created. The current inbound handler ignores an issue with no existing deliverable. |
| Full status ladder + backward regression | PASS | 26.1 s | All nine steps reflected, including Approved -> Tweak Needed and final Posted. Per-step latency was 2.0-3.8 s. |
| Title change | PASS | 3.8 s | Title reflected and targeted reconciliation stayed at zero. |
| Due date set -> change -> clear | FAIL | 67.5 s | Set and change reflected; clear remained at the previous date after 60 s. |
| Priority change | PASS | 8.6 s | Priority 1 -> 4 -> 0 reflected. |
| Assignee set -> change -> clear | FAIL | 65.9 s | Both mapped assignees reflected; clear did not reflect within 60 s. A prior run reflected the clear after 12.5 s, so this lane is intermittent and remains red. |
| Unknown assignee repair lane | PASS | 3.7 s | Repair list was 1 and real diff count was 0. |
| Unmapped state tolerated lane | FAIL (blocked safely) | 0 s | Every active VID/GRA state currently maps. Creating a workspace state solely for the probe would exceed the TEST mutation rails. |
| Re-parent and preserve parent | FAIL | 62.9 s | The parent did not reflect within 60 s. A prior run reflected after 40.1 s, so this lane is intermittent and remains red. |
| Archive hides mirror row | PASS | 5.5 s | Row became hidden; Linear's removal delivery was recorded as `mirror_in_delete`. |
| Cancel hides mirror row | PASS | 6.4 s | Canceled status reflected and the row became hidden. |
| Reopen reappears | FAIL | 68.3 s | Unarchive completed in Linear, but the mirror row retained its hidden marker after 60 s. |
| Rapid successive edits | PASS | 4.1 s | The final title won and targeted reconciliation stayed at zero. |
| Duplicate webhook within 60 seconds | PASS | 8.2 s | Two same-value TEST updates produced one material mirror event and the correct final state. |
| Cross-team batch | PASS | 6.8 s | TEST VID and GRA rows both reflected and retained the same batch. |
| Comment add + echo filter + tweak pinning | PASS | 14.3 s | One genuine entry, one mirror event, explicit pinned shape, and zero imported legacy-echo copies/events. |

Totals: **10 PASS / 6 FAIL / 16 scenarios**. Failures are preserved as red
evidence; the harness does not heal or suppress them.

Linear query polling retries only idempotent reads on HTTP 429/5xx. Linear
mutations are never retried automatically. This removed transport noise from
the final result without replaying writes.

## Cleanup and final gate

- Existing TEST fixtures were restored to their exact pre-scenario Linear and
  Supabase snapshots after every scenario.
- All eight disposable issues created across development and final runs
  (`VID-12856` through `VID-12863`) read back in the TEST project with
  `archivedAt` set.
- The final detect-only reconciler run was GitHub Actions run `29166705953`.
  It wrote summary event `8105` with `diff_count=0`, `repair_list_size=0`, and
  `linkage_actionable=0`.
- A redundant detect-only run (`29166722530`) was canceled after event `8105`
  satisfied the gate.
- No runtime flag, real-client row, n8n workflow, Linear webhook, app code,
  schema, or `mirror_outbox` row changed.

Detailed JSON, Markdown, and console evidence is retained in the private local
evidence folder outside the repository.
