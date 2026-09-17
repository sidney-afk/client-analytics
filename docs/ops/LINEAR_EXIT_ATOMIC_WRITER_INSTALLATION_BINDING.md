# Atomic writer package installation binding

Use `scripts/linear-exit-atomic-writer-bound-bundle.js` for the final preparation package. It wraps the unchanged pinned writer bundler and adds `installation-plan-binding.json` plus an explicit installation warning. It neither executes SQL nor deploys a function.

Supply an explicit observed catalog JSON object, its exact SHA-256 and an absolute new output directory:

```text
node scripts/linear-exit-atomic-writer-bound-bundle.js ABSOLUTE_NEW_DIRECTORY OBSERVED_CATALOG_JSON SHA256
```

The input must be the plain catalog object, with exactly these top-level keys: `default_acls`, `dependencies`, `functions`, `indexes`, `internal_constraint_triggers`, `policies`, `publications`, `rules`, `schema`, `sequences`, `server_major`, `tables`, `triggers`, `types`, `views`. It must match the reviewed observed-catalog contract; arbitrary catalogs refuse.

The read-only capture uses an envelope with `classification`, `observed_date` and `catalog`. Do not pass that raw capture file directly. Extract only its `catalog` property into a separate private JSON file, serialize that object without changing any values, then compute SHA-256 over the exact resulting file bytes. Pass that extracted file and its hash. This extraction removes the envelope only; it does not normalize, repair or weaken the catalog comparison.

For example, an offline extraction from an explicitly named private capture is:

```text
node -e "const fs=require('fs');const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,''));if(!x.catalog)throw Error('catalog missing');fs.writeFileSync(process.argv[2],JSON.stringify(x.catalog),{flag:'wx'});" PRIVATE_CAPTURE_JSON NEW_PRIVATE_CATALOG_JSON
```

Keep both files private. The wrapper does not infer the envelope shape or fetch a live catalog. The existing observed-plan builder verifies its complete reviewed catalog identity and all baseline, admission and appended owner sources. The wrapper additionally pins the final 48-source builder bytes. Its separate binding records the exact derived plan hash, initial catalog hash, ordered source hashes, builder/dependency hashes and baseline preserve/no-replay decisions. No raw catalog or SQL bodies are copied into the public-facing binding.

The older `manifest.json` prerequisite list is informational source provenance, never SQL replay instructions. Only the reviewed observed plan supplies installation order. Final target review and separate installation/deployment authorization remain required; the package does not manufacture a target catalog or authorize execution.

Offline verification against the captured observed catalog passed: `LINEAR_EXIT_ATOMIC_WRITER_BOUND_BUNDLE_OK`, 48 sources, plan SHA-256 `3c000b76db5cf6dc31a90b61ad7dc7751d6ce02c74b6d40939dbbcccbe6acbfb`. The test confirms all four generated writer/dependency files retain their previous exact hashes, refuses incorrect catalog hashes and changed catalog contents, checks binding readback, and preserves an existing destination. The original writer-bundle test also passes. No database or network call occurs. Run the new test with the explicit catalog fixture path as its only argument.

The original bundler, admission extension and final installation-plan sources remain byte-for-byte unchanged. A first attempted in-place bundler edit correctly caused the existing extension source check to refuse; those edits were restored before this separate wrapper was implemented.

The final binding includes the additive private-helper ACL owner 20260913190840. The earlier 47-source binding was superseded; the frozen builder SHA-256 is `1312cdf339c1f71db0cead3619975b2eb9e199192a5dc800de5dd79c04406b63`.
