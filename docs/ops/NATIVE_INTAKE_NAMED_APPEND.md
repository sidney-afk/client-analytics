# Native append with post names

SOURCE_ONLY, uninstalled. Main's `2026-09-07-production-intake-append-v8.sql` and the native-only intake migration replace the same append function. Installing main v8 last loses native parent routing; installing the old native replacement last refuses named titles and fails to count named ordinals. The additive `2026-09-07-native-intake-named-append.sql` retains the native function with exactly three title-predicate changes matching main's naming contract. Original migrations remain unchanged. Native component fill already accepts and preserves the composed title; it needs no replacement here.

## Installation preparation

Review the full candidate's prerequisite order separately. Both original migrations are predecessors of the final hybrid. When upgrading a name-capable target to native intake, the native-only migration and final hybrid must become visible **atomically**: do not commit the old native append implementation between them.

`scripts/native-intake-named-append-compose.js` exports `fromRepository()`, returning exact composed SQL and source/composition SHA-256 metadata. It verifies each input has one outer BEGIN/COMMIT, removes only the native file's final COMMIT and the hybrid's initial BEGIN, and prepends `\set ON_ERROR_STOP on`. The result retains one outer transaction and the hybrid's final COMMIT. Unexpected transaction statements or psql directives refuse. Review and privately retain both returned artifacts before any separately authorized installation. This builder never executes SQL.

First installation of that compound artifact into a target without native columns is **UNPROVEN** here: the retained disposable target already contains them. Seven offline composition controls verify its exact source shape. On an already-native target where both predecessor contracts have been installed, the final hybrid alone corrects the function; the actual focused restored-target test covers that case. Never apply either old append replacement after the final hybrid.

## Focused proof and limits

`scripts/native-intake-named-append-lane.mjs` uses the actual restored v9 target, native SQL and a privately pinned main naming policy from `0f97a7f40`. The older gateway seam supplies trusted native routing arguments; the test binds the original named body to the event fingerprint and uses the merged policy's rows/titles/ordinals. It does **not** prove the final merged named gateway or its original-request whitelist.

Eight actual SQL groups pass: both predecessor failures, named paired append with terminal native receipts, exact retry and changed-identity refusal, subsequent named ordinal, unchanged unnamed title, malformed/wrong-kind/wrong-ordinal atomic refusal, and named component fill with retry. No provider attempt occurred. [Sanitized proof](../audits/2026-09-07-native-named-append-evidence.json) binds exact migration/policy hashes. The first attempt committed the named pair before a cross-realm array assertion failed; its failure remains private. Before the corrected focused run, only the disposable target's selected data was reset through the existing restricted role from the authenticated package. The retained source was unchanged.

This is a separate subsequent schema/append proof. The older v9 package does not contain this hybrid, later accepted rows or later merged runtime code. Final candidate capture/recovery remains a distinct required proof. No live migration, workflow, flag or credential was changed; media object recovery is outside this lane.

Before activation, withdraw unused source normally. After native named acceptance, hold admission and repair forward while preserving receipt identities, names, ordinals and current work. Restoring an old bare-title or provider-only function is not a safe data rollback.
