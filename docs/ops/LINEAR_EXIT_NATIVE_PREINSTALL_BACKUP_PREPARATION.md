# Native preinstallation public-database backup preparation

This separate adapter supports an explicitly reviewed 67-table public schema. It does not widen the fixed 86/90-table complete-application formats. No live capture, upload or operational recovery key has been created by this preparation.

`scripts/linear-exit-native-preinstall-backup.js` exports async `capture(options)` and `restore(options)`. Supply an absolute `pgBin`, explicit `connection` (`host`, `port`, `user`, `password`, `database`, `sslmode`), and explicit existing custody inputs (`hmacInput`, distinct 32-byte `encryptionKey`, 32-character hexadecimal `keyId`). No environment credential fallback is used. Non-loopback capture requires `verify-full` TLS and the operator's configured trusted PostgreSQL CA certificate.

For capture, additionally supply `expectedCatalogSha256` from the independently reviewed full public catalog, a `sourceIdentity` label, and a new absolute encrypted `target` directory. The identity label is operator supplied, not proof that database and Storage credentials belong to the same project. A persistent read-only repeatable-read transaction exports the snapshot imported by native `pg_dump`. The custom archive retains public schema/data, owners, grants and sequence state. The encrypted manifest binds its actual SHA-256, catalog digest, row multiset fingerprints and sequence observations. Sequence observations before and after capture detect changes but do not create an atomic sequence fence.

For restore, supply the encrypted `packageDirectory`, a new absolute `outputDirectory`, and a literal loopback connection. The adapter creates a uniquely named database, never restores into an existing database, and retains that database for inspection. It uses `pg_restore --single-transaction --exit-on-error`, then compares catalog, rows and sequence state. Failed scratch databases remain local for diagnosis; no automatic database deletion occurs. The temporary decrypted directory is removed on success or failure.

The default scratch template is `template0`. Actual Supabase public definitions can depend on platform schemas, extensions and roles. For those, provide an explicitly prepared local `scratchTemplate` with those prerequisites and no public relations. The adapter checks that public is empty before cloning. This does not independently prove that the prerequisite platform is equivalent to hosted Supabase; the final public catalog comparison must still pass.

Coverage excludes non-public schemas/data, cluster roles/passwords, Supabase Auth/platform configuration, Storage bytes and external assets. Capture those separately where required. Existing Storage inventory/export modules provide encrypted current-object bytes and metadata; they require fresh capability checks and refuse unsupported version history. Database and Storage captures are not one atomic snapshot. Plaintext scratch exists locally, so use a private encrypted disk with adequate free space. The final package is encrypted; Windows directory modes alone are not an ACL guarantee.

The user can be the sole keyholder. Keep both independent secrets and `keyId` in one recovery record in the user's password manager, accessible from their phone; never put that record in the backup folder. No second person is required. After an authorized capture and successful scratch restore, the later operator steps are to upload only the encrypted package to the user's private Drive, download it to a fresh local directory, and reopen it using that separate recovery record. No Drive automation is installed by this component.

The opt-in `native-preinstall-backup` PostgreSQL test uses only a synthetic 67-table source and fixed test keys. An isolated pass is not live backup, off-device custody or full-platform recovery proof.

## Reproduce locally

From the repository, run the portable runner with a PostgreSQL 17 binary directory and an existing private output root:

```powershell
./qa/linear-exit-rehearsal/run-portable.ps1 -PgBin '<absolute PG17 bin>' -Lane native-preinstall-backup -OutputRoot '<existing private output root>'
```

Add `-ObservedInputDirectory '<private observed capture directory>'` for the exact observed schema mode. This mode uses the four original captured catalog/definition/ownership files, verifies the published certificate, and uses the same ICU en-US locale as the observed reconstruction proof. It contains no hosted row data. Neither command contacts hosted Supabase.

## Later authorized capture invocation

Create a user-private JSON configuration file outside the repository containing the options above, with the encryption secret encoded as `encryptionKeyBase64`. Its filename may be passed on the command line; secret values must not be. The following adapter invocation needs no source edits and prints only the bounded success receipt or a fixed failure label:

```powershell
node -e "const fs=require('node:fs'),api=require('./scripts/linear-exit-native-preinstall-backup');const c=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));c.encryptionKey=Buffer.from(c.encryptionKeyBase64,'base64');delete c.encryptionKeyBase64;api.capture(c).then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('BACKUP_FAILED; inspect private diagnostics');process.exitCode=1;});" '<absolute private config file>'
```

For the local restore check, use a separate private configuration with a literal loopback `connection`, `packageDirectory`, new `outputDirectory` and the same key record; change `api.capture(c)` to `api.restore(c)`. The returned scratch database name identifies the retained verification database. `diagnosticsDirectory`, if supplied, must be an existing private directory; tool errors can contain schema details and are never suitable for public logs. Do not execute this capture invocation until the owner authorizes the live read window and the source identity/catalog and coverage exclusions have been reviewed.
