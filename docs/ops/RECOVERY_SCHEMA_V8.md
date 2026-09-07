# Native label and cutoff recovery: explicit history-v8

Implementation evidence under the single G0-G10 plan in [draft PR1268](https://github.com/sidney-afk/client-analytics/pull/1268). Nothing is installed or activated. Decision A remains NOT READY; product watchers remain inactive.

## Contract and retained formats

`history-v8` adds `production_label_catalog_versions` (`version_id` UUID primary key) and `linear_outbound_cutoff_control` (`lane` text primary key) to the unchanged37 owners of v7. Corpus sizes remain14/21/33/35/37/39 with distinct authenticated identities. The scheduled backup default stays `legacy-v3`. The schema rehearsal default stays `history-v7`; only explicit `TRACK_B_RECOVERY_TEST_CORPUS=history-v8` includes the new label, assignment and cutoff migrations. CI retains v7 and adds a separate v8 disposable step.

An older format refuses a source or target containing either new owner, even if empty. Foreign keys alone cannot discover these obligations. Before future owner installation, configure and verify compatible v8 capture/readers, private custody, independent freshness observation and restoration. The unchanged default schedule cannot protect the new owners. Never bypass older-format refusal, use CASCADE, or drop retained evidence to make an older package usable.

The [schema engine contract](RECOVERY_SCHEMA_V7.md) still applies. Its ordinary-view callable class accepts reviewed STABLE SECURITY INVOKER read-only closures; load-time expressions retain immutable-only rules. This supports the correctly declared debt view without misdeclaring a table-reading function immutable. It is a conservative lexical/catalog contract, not general SQL purity or installed-schema proof.

## Actual evidence

At `6343d0ea3903b09e602d47fc7960e091c48cbb1c`, **20 actual disposable schema/data/replay groups pass across39 tables**. Named independent source and receipt review closed. [Sanitized evidence](../audits/2026-09-06-native-recovery-v8-evidence.json) records hashes and checks. The default path separately passed16/37 at `f023f553341e93563116789d6cc64380c69a6122`.

The proof reconstructs an empty target from authenticated schema/data, then compares exact PostgreSQL JSON-text images for every selected owner. It preserves accepted card input, later edits, comments, catalog, label receipts, cutoff generation and queue debt. Under held label admission, an accepted request returns the later human-edited current row without changing any corpus row; a fresh request refuses. A real queued comment receipt can be claimed before cutoff in a rolled-back transaction, then the identical valid lease request cannot claim after cutoff or restoration. No external worker executes.

The data-only route is separately exercised: actual v8 backup/scratch prerequisites grant distinct restricted roles; the v8 trigger helper restores all39 images with trigger states intact. Label replay and cutoff refusal still hold. Anonymous/authenticated reads of new private owners refuse, catalog mutation guards survive, a late COPY error rolls back, and a committed-but-unverified schema target stays quarantined. Old v7 preflight refuses the expanded corpus.

Earlier failures remain historical. The classifier first refused a volatile/definer debt helper and early label fixtures refused before capture. Later16-group v8 runs passed, but an interim handoff reread older failure logs. Review then found an image comparator limited to37 owners, an invalid-timeout claim that proved no cutoff, missing postrestore label/cutoff assertions, and a grant artifact checking the catalog's nonexistent `id`. The final20-group run corrects and exercises these boundaries; earlier passes do not inherit them.

Separate offline controls pass:25 corpus/format,52 ordinary-view callable,33 original lexer,18 package and8 default-v7 configuration/process checks. Hosted evidence belongs to the final integration PR, separately from these local results.

## Release and recovery limits

Clients keep the deployed behavior during draft preparation. No writer authentication, live data, deployment, flag, installed grant, n8n, provider, billing or alert action occurred. The compatible frozen anonymous serving composition requires its separate review.

Synthetic migration-shaped proof does not cover production schema, full provider history, omitted-table data, media bytes, credentials or external configuration. The synthetic attestation does not prove live catalog completeness. No scheduler, backup selection or product watcher is enabled. Installed equivalence, TEST/staff journeys, private recovery custody and independent acknowledged alerts remain release gates.

Before installation, reverting preparation affects no saved work. After accepted native use, hold new admission and retain all39 owners, compatible schema/packages and original receipts; do not restore an old provider writer or requeue terminal native work. Reuse a failed target only after empty rollback is proven. Preserve and quarantine committed or unknown targets. Abort progression on missing evidence, lost/duplicated work, altered later edits, unexpected provider attempts, broken client saves or an unobserved backup failure.
