# Native client provisioning

`production_native_client_provision(text, text, text)` is dormant infrastructure. Applying `2026-09-09-native-client-provisioning.sql` creates no client and changes no runtime flag. There is no UI, workflow, deploy hook, or scheduled caller for this RPC.

Use it only in a deliberate, service-role onboarding change after the migration has been applied and read back. It refuses unless both native intake epochs are enabled, both `prod_authority` teams are `syncview`, and all four routing flags use the valid `{ "clients": [] }` shape. One successful call atomically creates a new active `syncview_native` client, its two opaque native project IDs, a non-rotated review-token row, the four routing entries, and an immutable receipt.

The request id is idempotent only with the same canonical slug and display name. A replay verifies the active client, mapping, token presence, and all routing entries. It never recreates an offboarded client, repairs a changed mapping, or re-enrolls a removed routing entry. Resolve that drift through an approved operator process before attempting a new onboarding.

Do not log the display name or review token. The RPC response intentionally omits both. The receipt table is service-inaccessible and immutable; use approved, protected SQL inspection for operator diagnosis.

This migration does not activate native intake completion monitoring. The completion runner remains a manual dry-run/apply tool. Before any operational use, an owner must install and verify the recovery SQL, establish an alert consumer for the runner’s bounded debt report, and document the authorized apply path. No automatic mutation schedule is included here.
