# Frozen writer urgent-marker deployment — 2026-09-10

The urgent-marker backend is fixed and live. The feature remains hidden: `kasper_urgent_ping_enabled` was absent before deployment and was not changed.

| Writer | Before | Live | Deployment bundle SHA-256 |
| --- | --- | --- | --- |
| calendar-upsert | 48 | 49 | cf63300186da44d0ea545a93a8318dd88b18dbcd8fa7e379e3c93cef41d04c91 |
| sample-review-upsert | 49 | 50 | 21cdd6361ae99ebcaf48e8c565fbca3541dcb8fe579edcdfdd5cf5e1dc854a67 |

Calendar deployed at 16:34:51 UTC; Samples at 16:36:53 UTC. Both were deployed through the connected Supabase deployment API, on the owner's explicit instruction, from downloaded live source plus the reviewed additions. Neither was deployed from the repository writer copy. Fresh downloads immediately before deployment exactly matched the saved Calendar v48 / Samples v49 rollback source.

## What changed

Both writers now retain and validate the four `kasper_urgent_*` fields. Calendar supports video, graphic, caption and title; Samples supports video and graphic. Samples also needed the fields in `MIRROR_COLS`, the final list that decides which fields reach the database. Calendar removes caption/title status timestamps from updates so a stale read cannot overwrite a newer status clock. Optional event logging was not added.

The patches remove no original source lines. Shared thumbnail code is byte-identical. Auth and CORS were unchanged. Fresh post-deployment reads confirmed exact candidate bytes, zero `authorizeBrowserWrite` occurrences and `verify_jwt=false` for both writers. This deliberately preserves existing tokenless review links.

## What was verified

- Twenty offline behavior cases pass against the extracted source. Negative controls reproduce marker loss in both original writers.
- Before each deploy, a real HTTP request with no authorization token created a dedicated test card.
- After each deploy, tokenless name and comment saves returned HTTP 200 with `ok:true`; separate database reads confirmed both persisted.
- Tokenless marker writes were checked independently for all four Calendar components and both Samples components. Each returned HTTP 200 with `ok:true`. Database readback confirmed the component, ping timestamp, actor and marker round clock. A deliberately wrong browser round clock was replaced by the component's server timestamp.
- Calendar verification finished before Samples deployment.
- Only the authorized test client was mutated. Test cards `qa_urgent_20260910_calendar` and `qa_urgent_20260910_sample` were removed using their exact last-write timestamps as concurrent-edit guards; six Calendar and four Samples fixture events were removed with them.

These checks exercised the real HTTP writers and database, not an interactive browser or a real notification send. The flag stayed off. Offline timestamp filtering was tested; an actual concurrent status change was not induced.

## Rollback and next action

Exact pre-deploy source is retained in the owner's saved `frozen-writers-urgent-marker-handoff.zip`, in `frozen-writers-before-kasper-marker.json`. Redeploy the corresponding original two files with `verify_jwt=false`; never use the repository writer source as rollback. A rollback creates a new version number.

No additional deployment is required for this marker fix. The next product step is the owner's separate decision to enable the feature and verify the visible ping flow. Until then it remains dormant. This deployment does not fix or assess the separate approval-recovery items 189–191.

The repository writer copies remain intentionally different from live. The old F35 v43/v44 live claim is superseded by the versions above.
