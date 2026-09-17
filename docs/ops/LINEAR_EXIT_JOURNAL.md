# Linear exit: running journal

Why this file exists: the checkpoint records **where we are**. Nothing recorded
**how we got here or why**. Chat sessions end. Without this, the next session
inherits the state but not the reasoning, and will either relitigate settled
arguments or quietly contradict them.

Written for someone who was not here. Plain English. This is a record of
judgment, not a changelog of commits.

## How to keep it

- **Append, never rewrite.** When something turns out to be wrong, add the
  correction *below* the original. Do not edit the original away. The wrong
  turn is part of the record and is often the useful part.
- **Entries are events, not commands.** One entry per meaningful thing that
  happened, not one per command run.
- **Newest at the top** within the progress log.
- **Blockers come off with a date and a note**, never by silent deletion.
- **Nothing private.** No secrets, no tokens, no client display names, no client
  slugs, no share links. Say "one active client" and cite ids, not names. The
  repository is public and a gate fails the merge on any identity a change adds.
- **Update it as part of finishing a step**, not as a separate chore at the end
  of the day. A journal written later is a journal written from memory.

Dates are the date of the event. Where something could not be verified from the
record it is marked as such rather than stated flatly.

---

## 1. Progress log

### 2026-09-17 — Steps 9 and 10: METHOD RECORDED BEFORE RUNNING. Packaging command, verification commands and names, fixed by the owner, so the next drill does not have to rediscover them

Written before the clock starts, at 2026-09-17T01:06Z (2026-09-16 19:06 on the
owner's machine), by the storage session. **Nothing below has run yet.** The
results follow as their own entry.

**Authorised by the owner:** steps 9 and 10, after the backup-path fix
`1eb6eaf8` passed re-review at `e4eb40b`. That is the first live use of the new
backup code. Step 11 is **not** authorised.

**Found while preparing, recorded because it cost a round of questions.** The
2026-09-14 database drill's zip,
`SyncView-Preinstall-Database-20260914.encrypted.zip`, was made **ad hoc**. The
private handoff and custody-confirmation files record its hash, Drive location
and download path, but no command. A search of the private evidence
directories, the repository and the 09-14 working directories found none. The
archive's own metadata (44 flat members, Deflate, "made by" system 0 version 2.0)
is consistent with Windows' built-in zip, which is inference only.
`storage-ciphertext-transport.private.py` cannot be reused: its `pack` refuses
anything that is not a Storage export. **The owner fixed the method below. No
new script is written for it.**

#### Names, all under `D:/Sidney/Codex/2026-09-13-final-review-repairs`, local date 2026-09-16

| Use | Name |
|---|---|
| Fresh catalog read (a **refresh**, not a re-close of step 8) | `day-catalog-20260916-6` |
| Step 9 capture | `day-database-20260916-1` (package in `…/encrypted`) |
| Step 9 local restore | `day-database-restore-20260916-1` |
| Upload archive | `day-database-20260916-1.encrypted.zip` |
| Step 10 fresh Windows download, unpacked | `day-database-downloaded-20260916-1` |
| Step 10 restore of that download | `day-database-downloaded-restore-20260916-1` |

#### The sequence, with every command, all from a Windows PowerShell 5.1 host

1. **Catalog read, then the capture immediately after it, with nothing between.**
   The refresh wrapper refuses a receipt older than one hour.
   ```powershell
   node D:/Sidney/Codex/2026-09-13-final-review-repairs/read-install-day-catalog.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-20260916-6
   node D:/Sidney/Codex/2026-09-13-final-review-repairs/refresh-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-20260916-6 D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-20260916-1
   ```
   If the capture refuses `SOURCE_CHANGED`, that is the concurrent-write check
   working. It is reported as such and retried **once**, in a quieter moment,
   with a fresh catalog read and new names (`-7`, `-2`).
2. **Local restore before any upload** (sitting page, step 9):
   ```powershell
   node D:/Sidney/Codex/2026-09-13-final-review-repairs/restore-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-20260916-1/encrypted D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-restore-20260916-1
   ```
3. **Manifest confirmation, by the owner's ruling.** The manifest stays sealed;
   it is **not** decrypted outside the wrappers. It is confirmed through the
   restore:
   - the restore receipt's `public_tables`, which `restore()` takes from the
     decrypted manifest;
   - **independently**, the restored database's catalog canonical hash and
     table count, computed on the scratch cluster (read-only, then stopped).

   68 and `ddfa4c4f…` there mean the sealed manifest says the same, because
   `restore()` refuses unless the manifest's count equals its own evidence and
   the restored evidence equals the manifest's exactly.
4. **Packaging, the owner's fixed method:**
   ```powershell
   Compress-Archive -Path 'D:\Sidney\Codex\2026-09-13-final-review-repairs\day-database-20260916-1\encrypted\*' -DestinationPath 'D:\Sidney\Codex\2026-09-13-final-review-repairs\day-database-20260916-1.encrypted.zip'
   (Get-FileHash -LiteralPath 'D:\Sidney\Codex\2026-09-13-final-review-repairs\day-database-20260916-1.encrypted.zip' -Algorithm SHA256).Hash.ToLower()
   ```
   Hashed **once, when made. That is the upload hash.** Without `-Force`,
   `Compress-Archive` refuses an existing destination.
5. **The owner uploads** that zip to the private Drive backup folder.
6. **Two downloads**, both hashed against the upload hash:
   - **the owner downloads on another device** and reports the SHA-256 from
     there;
   - **separately, a fresh download from Drive on this machine, into the
     evidence directory.** It is never a copy of the original zip. This is the
     same mechanism as 2026-09-14's `drive-downloaded-database-encrypted`.
7. **Verify the Windows download, no new script:**
   ```powershell
   (Get-FileHash -LiteralPath '<downloaded zip in the evidence directory>' -Algorithm SHA256).Hash.ToLower()   # must equal the upload hash
   Expand-Archive -LiteralPath '<downloaded zip in the evidence directory>' -DestinationPath 'D:\Sidney\Codex\2026-09-13-final-review-repairs\day-database-downloaded-20260916-1'
   ```
   Then **every extracted member** is compared by SHA-256 and size with the file
   of the same name in `day-database-20260916-1\encrypted`. The member sets must
   be identical in both directions: every chunk plus `encrypted.json` and
   `encrypted.mac`.
   > **Correction to a count used while planning.** "All 44 plus encrypted.json
   > and encrypted.mac" double-counts. The 2026-09-14 package's 44 files
   > *include* those two: 42 chunks plus two. Tonight's count is whatever the
   > capture produces, and every member is compared.
8. **Step 10 restore of the Windows download:**
   ```powershell
   node D:/Sidney/Codex/2026-09-13-final-review-repairs/restore-install-day-database.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-downloaded-20260916-1 D:/Sidney/Codex/2026-09-13-final-review-repairs/day-database-downloaded-restore-20260916-1
   ```
   Then the same independent catalog hash and table count check on the scratch
   cluster.

**Stop conditions:**
- any refusal other than one `SOURCE_CHANGED`;
- any hash or member mismatch;
- any restore that does not pass, or a scratch-cluster check that is not 68 and
  `ddfa4c4f…`.

**On any of these, stop, preserve everything and report. Nothing is deleted.**

### 2026-09-17 — PROPOSAL, not implemented: what `install-profiles.js` should hold for the two profiles that will never install

**What reads those fields, checked before proposing.** `profiles.get(name)`
asserts **both** `plan` and `target` are non-empty and is called from three
places: the install operator's preflight and its `execute()`, its `consent()`
token, and the operator test's non-calibrate assertion. Calibration does not
call it — `test/linear-exit-install-operator-postgres.js` skips the target
comparison when `INSTALL_OPERATOR_CALIBRATE==='1'`. **The trap is elsewhere:**
`profiles.build()` calls `get(name)` for `observed67` and `observed67_optout`
(not for `settled68`, which returns before that line), so simply setting their
targets to `null` breaks **plan building** for those two profiles, not just
installing — and plan building is still wanted, by the neutrality checks and by
any future comparison across worlds. So the proposal is: keep both measured
plans as they are, replace each dead target with an explicit **refusal value
rather than a hash or a null** — a `retired` marker carrying D18, the date and
the reason — and move the `get()` call out of `build()`'s path so that building
a plan no longer demands an install-only field; `get()` then refuses a retired
profile by name, with a message saying the profile cannot install after B10 and
pointing at D18, instead of the current generic "is not pinned yet: derive its
plan and target". That keeps the two plans honest and useful, makes the dead
targets say **why** they are dead instead of being a plausible-looking number
describing a run that will never happen, and turns an attempt to install a
retired profile into a named refusal rather than a hash mismatch. **Not
implemented, and one thing is deliberately left to the owner:** whether the two
profiles are retired in place like this or removed outright, which the D18 entry
explicitly did not decide.

### 2026-09-17 — D19 carried out: the pipeline proof lane now builds the SETTLED world, its three restated counts derive, and the refusal on a wrong target is proven by mutation

The storage session was idle on this. The lane can now be run against the
private inputs.

#### What changed, and why each site

`test/linear-exit-observed-full-pipeline.js`

1. **The world.** The reconstruction rebuilds `observed67`; the owner's hiring
   migration is what makes it `settled68`. It is now applied in the lane,
   **the same way `scripts/linear-exit-b9-catalog-derive.js` applies it** —
   `HIRING_MIGRATION` read from that module's own export and executed — so there
   is one way this world is built and not two. A second hand-rolled
   reconstruction would be a new thing to be wrong about.
2. **The plan.** `full.build(initial)` with no options took the default
   contract, which is why this lane could only ever be `observed67`. It now
   builds through `profiles.build(initial,'settled68')`.
3. **The post-install count.** `assert.equal(after.tables.length,90)` now
   derives from `postInstallPublicTables(plan.initial_catalog_sha256)`.
4. **The marker.** `tables:90` now reports `after.tables.length`.

`test/helpers/observed-full-pipeline-worker.mjs`

5. `assert.equal(guards.length,90)` derives from the same resolver.
6. The report's `tables:90` reports `catalog.tables.length`.

Sites 3 to 6 are **survey sites #4 and #5 of
[`LINEAR_EXIT_GUARD_COUNT_SITES.md`](LINEAR_EXIT_GUARD_COUNT_SITES.md)** plus two
marker literals beside them. The sweep predicted this exactly: those sites are
"correct today but bound to a single world" and "wrong **by the act of carrying
out D19**". They were.

#### A consequence of D24 that I did not foresee, and that made this urgent

The worker asserts the post-install catalog's table names equal the **V2 custody
corpus** exactly. D24 moved V2 from 90 names to 91.

| | count |
|---|---|
| V2 corpus, after D24 | **91** |
| post-install `observed67` | 90 |
| post-install `settled68` | **91** |

**So D24 had already made this lane unable to pass in the `observed67` world**,
before D19 was carried out. Re-basing it is not only the owner's preference; it
is now the only world in which the lane's own V2 comparison can hold. I did not
see that when landing D24, and it went unnoticed for the usual reason: the lane
is one of the 61 the unit lane defers.

#### The mutation proof

The lane itself cannot run here — it refuses without `OBSERVED_INPUT_DIRECTORY`
and reconstructs from four private capture files. **So the mutation was run
against the mechanism the lane relies on for the refusal**, `targetApi`
`create`/`compare`, which is the same code the worker calls, driven by a **real
`settled68` plan**. The only stub is the starting-catalog gate, applied
identically to every case so it cancels.

The plan built was `508e63699a0f7d8fde2a4a3abf3f13c84780ced95d4b5c2702da4a54cc06f2bd`,
stage `OBSERVED_PUBLIC_20260916_SETTLED_FULL_PREPARATION_V1`, post-install
derived as **91** — the measured settled68 plan, so the probe is exercising the
world the lane will now build.

| Case | Result |
|---|---|
| CONTROL, correct target | **PASSED** `MATCHED_SOURCE_DERIVED_TARGET` |
| M1 wrong target SHA-256 | REFUSED `target bytes drift` |
| M2 tampered bytes, SHA recomputed | REFUSED `full target mismatch` |
| M3 target from a different plan | REFUSED `INSTALL_JOURNAL_PLAN_HASH` |
| M4 wrong-size post-install catalog | REFUSED `post-install public table count` |
| M5 different private catalog | REFUSED `full target mismatch` |

**What this proof does NOT cover, stated so it is not read as more than it is.**
It does not prove the re-based lane runs end to end; that needs the private
inputs and is the storage session's. It proves the refusal path the lane depends
on bites five ways, and that it bites on the settled plan specifically. The
first real run is the test of the re-base itself, and **`--calibrate` takes no
target and can go first**.

#### Result, with its denominator

**14 of 548 unit suites failed**, all 14 the known sandbox failures that fail
identically on a clean control; none new. The pipeline lane is deferred and was
not run: that is what this change hands to the storage session. The 61 deferred
suites were not run as a set; that remains D22, before the exit merge.

**Not changed:** `test/linear-exit-observed-full-install.js` (survey site #6)
still builds through the unprofiled builder with a synthetic 90-table catalog.
It is a different lane, it is internally consistent, and D19 named the pipeline
proof. Left deliberately rather than swept along.

### 2026-09-17 — STEP 8 CLOSED on the owner's authorisation: live catalog `ddfa4c4f…`, 68 tables, resolved to `settled68`, TLS verified, identity unchanged. 8 of 28. Step 9 NOT started

**Date.** 2026-09-17T00:10:37Z UTC, which was 2026-09-16 18:10 on the owner's
machine. The private directory is named by the machine's local date.

**Authorised by the owner** for step 8 only, with the instruction not to proceed
to step 9. Performed by the storage session. It used the same wrapper and the
same host arrangement as the proof read `day-catalog-20260916-4`.

#### What ran

- **Command**, from a **Windows PowerShell 5.1** host (5.1.26100.9444), the
  reviewed command from the handover section 4.2:
  `node D:/Sidney/Codex/2026-09-13-final-review-repairs/read-install-day-catalog.private.cjs D:/Sidney/Codex/2026-09-13-final-review-repairs/day-catalog-20260916-5`
- **Wrapper SHA-256**, hashed in the same process immediately before the run:
  `6b6e2fe7248d08f627dbf91319211ed11a9a5e1743a66b2fd327f9d595e9bb56`. That is the
  version recorded in the entry "Storage session: the private catalog wrapper now
  names `settled68`". Its last write is that edit; nothing has touched it since.
- **CA file** `%APPDATA%\postgresql\root.crt`: present, SHA-256
  `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`, unchanged
  since the owner re-supplied it on 2026-09-15.
- **Read-only:** a single `begin read only` transaction, rolled back. Started
  00:10:34.5Z, ended 00:10:37.3Z, exit 0.
- **Directory name:** `-5`, not `-2` or `-3`. Those names were used today by
  attempts that created no directory, and names are never reused.

#### Evidence, read back from the files on disk, not from the console

| Item | Value |
|---|---|
| **Receipt file** | `day-catalog-20260916-5/receipt.private.json`, 291 bytes |
| **Receipt SHA-256** | **`685482e88f490d3e81235cbf2126b539d112c8d352bd27b3eaf073fbca45ec41`** |
| `classification` | `LIVE_READ` |
| `observed_at` | `2026-09-17T00:10:37.196Z` |
| `catalog_sha256` | `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c` |
| **`profile`** | **`settled68`** |
| `matches_reviewed_baseline` | `true` |
| `tls_verified` | `true` |
| `installation_authorized` | `false` |
| **Public table count** | **68**, all ordinary tables; 14 sequences (counted from `catalog.private.json`) |

**Cross-checks, each independent of the receipt's own claims:**

1. **The catalog file's canonical hash was recomputed** with
   `linear-exit-install-journal`'s `sha(canonical(...))`: `ddfa4c4f…`, equal to
   the receipt.
2. **The public resolver names the same world without the wrapper's map:**
   `startingPublicTables('ddfa4c4f…')` returns `{"contract":"settled68","count":68}`,
   and the hash equals the `settled68` contract's own `catalog_sha256`. So the
   private wrapper and the reviewed public contract agree.
3. **The catalog has not changed since yesterday.** The catalog file's raw bytes,
   SHA-256 `9424cb813caf96d0c9cf1a563caba82dc157e810133d885e8e5c0bf69dfe6b2e`,
   941,913 bytes, are identical to the reads `day-catalog-20260915-2` and
   `day-catalog-20260916-1`.
4. **Project identity confirmed.** `identity.private.json` holds `database`,
   `database_oid`, `session_user` and `system_identifier`. Compared in canonical
   form, it is **identical** to the identity file of each of the three earlier
   reads: `day-catalog-20260916-4`, `-20260916-1` and `-20260915-2`. The values
   are private and are not written here.

#### Step 8's "Done when", item by item

| Execution map says | Evidence |
|---|---|
| Exact supported baseline matched | `matches_reviewed_baseline: true`, profile `settled68`, canonical hash recomputed and equal, public resolver agrees |
| Project identity confirmed | four identity fields identical to three earlier reads of the same project |
| TLS verified | `tls_verified: true`. The wrapper connects with `rejectUnauthorized: true` against the pinned CA and refuses unless `pg_stat_ssl.ssl` is true for its own backend |

**Step 8 is complete. Count: 8 of 28**, Phase 2 of 7, 29%. **Next: step 9, NOT
started, not authorised.**

**The receipt's one-hour window.** The refresh wrapper refuses a receipt older
than one hour, so this receipt stops being usable by step 9 at
2026-09-17T01:10:37Z. That is intended: step 9 was not authorised, and when it
is, it needs a fresh step 8 read immediately before it, per the sitting page's
one clock. This read closes step 8 as a verification of the live world. It is
not a ticket for step 9.

**Not done, by instruction:** no step 9, no pins, no other file. The checkpoint's
"step 7 of 28" line was not edited here and is now one behind; noted, not
changed.

### 2026-09-17 — RE-REVIEW of the loopback fix `1eb6eaf8`, delta only: PASS on all four points, with two refinements to the M7 reasoning

Delta only, against the code. The four points the owner named, each answered
from the line rather than from the account.

**1. Does `localCluster()` actually execute on the CAPTURE path? YES.**
`capture()` carries
`if(o.syntheticPublicTables!==undefined)verifySyntheticServer(o,env,identity);`
and `verifySyntheticServer` ends in `localCluster(o,env)`. So it is on the
capture path, gated on the override, and not only on restore.

**Its position is right, and that matters as much as its presence.** It sits
after the session opens and after the existing `IDENTITY` check, and **before**
`evidence()`, before `pg_dump`, and before anything is written into the package.
The only thing that exists at that point is an empty staging directory, removed
in the `finally`. A forwarded capture therefore refuses before a single row is
read, not after a dump has been taken.

**2. Is the system identifier compared against local files, never a
caller-supplied value? YES, and the two sides are genuinely independent.**

- `observed.system_identifier` comes from **the server**, via
  `(select system_identifier::text from pg_control_system())`.
- `match[1]` comes from **`pg_controldata` run against the directory on disk**,
  `fs.realpathSync(o.localDataDirectory)`.

The caller supplies a **path**, never a value. And the path alone is not enough:
the server must independently report that same path as its own
`data_directory`, or `LOCAL_CLUSTER_IDENTITY` fires before the identifier is
even compared. To defeat both a caller would need a local directory whose path
string equals the remote server's `data_directory` **and** whose `pg_control`
holds the remote cluster's system identifier — which is possession of the remote
cluster's control file. Confirmed sound.

**3. Is the M7 reasoning correct? YES, and it is stronger than the account
claims. Two refinements.**

The account's reason is that the lane's cluster binds `listen_addresses =
'127.0.0.1'`, so every connection reports a loopback server address and no test
in the lane can make the address check fail. **That is correct.**

**Refinement one, in the fix's favour.** The deeper reason M7 is undetectable is
not only that the lane cannot exercise it. `localCluster()` **independently
re-checks the same property**: `if(!['127.0.0.1','::1'].includes(observed.address))fail('LOCAL_CLUSTER_ADDRESS')`.
So in the scenario the address check exists for — a forwarder to a server bound
to a public address — removing it changes nothing, because `localCluster()`
catches it one step later. M7 is redundant coverage, not absent coverage. The
account could have said so and did not.

**Refinement two, against declaring it merely redundant.** It is **not** fully
redundant and should stay. `verifySyntheticServer` checks the **capturing
session's own** `inet_server_addr()`, taken from the `identity` read inside the
open REPEATABLE READ session. `localCluster()` opens a **separate** `psql`
connection. They validate different connections. Keeping the first is what ties
the check to the session that is actually being dumped.

**On "the port and cluster-identity checks are sufficient on their own":
attribute that to cluster-identity, not to the port.** The port check is
defeated by an obvious variant — a forwarder listening on the same port number
as the remote server, `127.0.0.1:5432 → remote:5432`, makes
`inet_server_port()` equal the claimed port. Their M5 result is still correct;
it is correct because *their* forwarder used a different port, which the test
asserts. **The layer that actually holds against a same-port forwarder is
`pg_controldata` on local files**, and nothing else in the chain does. The
account's "M5 and M6 show those layers bite" is true of what was tested and
should not be read as the port check being sufficient.

**A residual assumption, pre-existing and not introduced here**, recorded so it
is not mistaken for a gap this delta opened: the verification reads
`identity` on the capture session, `localCluster()` opens a second connection,
and `pg_dump` opens a third. All three use the same `env`, so the module already
assumes that routing is stable between them. Nothing proves by construction that
the connection verified and the connection dumped are the same server. That was
true before this change and remains true.

**4. Is the original account unedited with the correction below it? YES.**
Measured: this commit makes **zero deletions** in the journal. The correction is
appended beneath the account it corrects, and the account is kept as written,
including its two overstatements. The code comment was corrected in the code
itself, which is right — a source comment is not an append-only record.

**Verdict: PASS on all four.** The finding is fixed, the fix is in the right
place on the right path, and the one mutation that could not be proven is
honestly labelled as unproven rather than quietly claimed. The two refinements
above are additions to the reasoning, not defects in the change.


### 2026-09-16 — D24 and D25 landed together: the three suites re-based onto the settled world, the coupling asserted, and the assertion PROVEN TO BITE before landing

One commit, as ruled. The corpus gains the table, the three suites are re-based,
the guard-to-corpus equality is now a check in the **unit lane**, and that check
was mutated and watched to fail before any of it was pushed.

#### The mutation proof, all three steps, which is now the standard for every new check

| Step | What was done | Result |
|---|---|---|
| **1. Baseline** | run the check unmutated | **PASS**, `guard_tables 87, corpus_tables 87, exceptions 0` |
| **2. Mutate** | remove `hiring_practical_test_jobs` from `LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V1.json`, **and re-pin `INVENTORY_SHA256` to match** | **FAIL, exit 1** |
| **3. Restore** | put the byte-identical file back and restore the pin | **PASS**, and the restored file's SHA-256 equals the pre-mutation value exactly |

**Step 2's second half is the part that makes the proof mean anything.** The
corpus is hash-pinned, so simply deleting a name makes `expectedNames()` throw
`COMPLETE_APPLICATION_INVENTORY_DRIFT` — the drift guard fires first and the
coupling check never runs. That would have looked like a passing mutation test
while proving nothing about the coupling. The pin was moved with the file so
that the **coupling check itself** is what fires. A mutation that is caught by a
different check than the one under test is not a proof of the check under test.

The failure it produced, quoted because the message is the deliverable:

```
D25: these tables are admission-guarded but absent from the custody corpus, so
their data is not backed up while a check makes them look protected. Add them to
docs/independence/LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V1.json, or record a
reviewed exception in EXCEPTIONS.guardOnly with a reason:
["hiring_practical_test_jobs"]
```

It names the table, the side it is missing from, the consequence, and the two
permitted remedies. `87 !== 86` would have named none of those.

#### The check

`test/linear-exit-admission-custody-coupling.js`, **registered in the unit lane**
(`test/suite-classification.json`, unit 547 → 548). It reads two files and
compares two sorted arrays: no cluster, no private input, no network. Placing it
in the deferred 61 would have reproduced the exact failure it exists to prevent.

It parses the guard list out of the migration's own `foreach` array, so it reads
what the database will actually be told rather than a copy, and it checks that
list is sorted and duplicate-free on the way past. Divergence is **not** softened
to a subset check: `EXCEPTIONS.guardOnly` / `EXCEPTIONS.corpusOnly` take a name
with a reason and a date, per D25, and a **stale exception is itself a failure**,
so an exception cannot outlive the divergence it was written for.

#### What moved, and the one thing that deliberately did not

| File | Change |
|---|---|
| `LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V1.json` | 86 → **87** names, sorted position, one line added |
| `LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V2.json` | 90 → **91**, keeping v2 = v1 + the four `card_write_*` |
| `INVENTORY_SHA256` and the v2 hash | re-derived |
| release extension artifact + `PIN` | regenerated with its own `generate()`; `verify()` passes |
| `LINEAR_EXIT_SOURCE_BASELINE_CATALOG_V1.json` `.sources[]` + its `PIN` | re-derived; exactly one entry drifted |

**The three profile plan hashes did NOT move.** Measured before and after
against the same harness:

```
observed67        7043637f90378244f445d588680709d67f16cee7ee43170b2254f0edb78b3f1f
observed67_optout 92a4737ffd13b3634aad76ed8ceded28966a66a4de0b09fb503fdd4a4c5d4021
settled68         508e63699a0f7d8fde2a4a3abf3f13c84780ced95d4b5c2702da4a54cc06f2bd
```

Identical, byte for byte, on both sides of this change. **So the `settled68`
target the storage session derived at `ff9b379f` stays valid and nothing has to
be re-derived on the owner's machine.** That is the property §2.2 of the coupling
proposal predicted for "assert" and is the decisive reason it was not "derive" —
and it is measured here rather than assumed.

#### The suites, re-based, and five more restated numbers found on the way

The three D24 suites now pass, and each reports the settled world:

| Suite | Before | Now |
|---|---|---|
| `linear-exit-application-dml-admission` | `87 !== 86` | PASS, `tables_guarded: 87` |
| `linear-exit-source-phases-postgres` | name list one short | PASS, `pre_tables 68, post_tables 87` |
| `linear-exit-source-baseline-catalog-postgres` | name list one short | PASS, `tables: 87` |

**Five numbers in those suites were success-marker literals, not assertions**,
so they would have printed false evidence while the suite passed:
`pre_tables:67`, `post_tables:86`, `pre_admission_application_tables:86`,
`tables:86` and `tables_guarded:86`. Four are now **derived** from the values
they describe (`pre.length`, `all.length`, `names.length`,
`contract.catalog.tables.length`) so they cannot drift again.
`tables_guarded` is still a literal, because the count it reports is queried
inline and never bound to a variable; it is correct at 87 and is recorded here
as the one that stayed a restatement.

#### Two suites this change broke, and the sweep called them in advance

The full lane went to **16 of 548** before going back to 14.
`linear-exit-complete-application-data` and
`linear-exit-complete-application-custody` both failed `87 !== 86`.

They are §5 of the world-literal sweep, where they are described as asserting
"the pinned corpora against themselves. Correct, and it is the same 86 that §3.2
shows has diverged from the live world — **so this suite will keep passing while
the world is wrong**." The world moved and they fired, exactly on cue. All four
of their counts are now **derived** from `expectedNames()` rather than restated,
and two pass-message labels that printed `offline90` and `synthetic86` were
carrying stale numbers into the evidence and now name the version instead.

`linear-exit-complete-application-recovery.js:111` held `v2?89:86` from the same
corpus. It is deferred and fails in this sandbox for an environment reason on
both sides of the change, **so it could not be run here**. Rather than restate it
as `90:87` on a guess, it now derives from `expectedNames()`, which is correct
whether or not this session can execute it. Flagged as changed-but-unrun.

#### Result, with its denominator, per D21

**14 of 548 unit suites failed.** All 14 are the known sandbox failures that fail
identically on a clean control worktree; none is new. The 61 deferred suites
were **not** run as a set — that is D22, before the exit merge — but the three
D24 suites among them were run individually against PostgreSQL 17 and pass.

**Not done here:** the other three assertions proposed in §3.2 of the coupling
proposal (v1 against the source-baseline set, v2 against v1 plus its four, the
fixture as a subset) stay unimplemented. D25 ruled on the guard-to-corpus
relation, and widening past the ruling is how a proposal becomes an
implementation nobody approved.

### 2026-09-16 — Backup path, review finding fixed: with the synthetic override, the SERVER must now prove it is the caller's own local cluster. Forwarder refusal tested; mutation shows which parts bite and which one cannot here

Storage session. It fixes the one finding in the independent review at
`3dc70acb` and nothing else. The correction to the earlier account is below that
account, in the entry "Backup path: the expected table count now comes from the
world".

#### The change

`scripts/linear-exit-native-preinstall-backup.js`, `e0b27b37…` → `328eb1772222b27a1071469307b82a2bc7886490f24d5e511c7045d437b46ac2`,
17,269 → 18,212 bytes, CRLF kept (65 lines, 65 CR). The owner specified the
change, and it is exactly this:

1. **In `capture()`, immediately after the existing identity check**, which is
   after the session is open and before any evidence is read:
   `if(o.syntheticPublicTables!==undefined)verifySyntheticServer(o,env,identity);`
2. **`verifySyntheticServer(o,env,identity)`** runs three checks in order:
   - the capturing session's **own** `inet_server_addr()` must be `127.0.0.1` or
     `::1`, after stripping the `/32` or `/128` that `inet::text` carries.
     Otherwise it refuses `SYNTHETIC_COUNT_SERVER_NOT_LOOPBACK`.
   - that session's `inet_server_port()` must equal the claimed port, or it
     refuses `SYNTHETIC_COUNT_SERVER_PORT`.
   - then it calls **`localCluster(o,env)`, the same function `restore()` already
     uses, unchanged.** That function asks the server for `host(inet_server_addr())`,
     port, `data_directory` and `pg_control_system().system_identifier`. It
     requires loopback, the claimed port, a `data_directory` resolving to
     `o.localDataDirectory`, and `pg_controldata` of that **local directory**
     reporting the same system identifier. A forwarder can relay the first three
     but cannot supply local files.
3. The pre-connection check on the claimed host stays, as a cheap early refusal.
   It is no longer described as the protection. The code comment now says what
   each stage checks.
4. `identity.server_address` and `server_port` were already fetched and written
   into the manifest as `connection_observation`. The query and the manifest are
   unchanged, so old manifests are unaffected and no manifest bytes change for
   captures without the override.

**Scope unchanged:** captures without the override (every reviewed catalog,
which includes the live path) do not run this verification. It only closes the
door the override opened.

#### The test

`test/linear-exit-native-preinstall-backup.js`, `443fea8f…` → `80c1f39290b7ab58057e7cfaf2a93f624411bbf46ea26b240cad0ce5f5c65859`,
18,368 → 20,818 bytes, CRLF kept (78 lines, 78 CR). Three cases were added. They
run in both the synthetic and observed modes, each with the override and an
unreviewed catalog so the override is honored before connecting:

| # | Setup | Must refuse with | And |
|---|---|---|---|
| 1 | **A real TCP forwarder**: a separate Node process listening on `127.0.0.1` on an ephemeral port and piping to the test cluster. The capture claims `127.0.0.1` and the forwarder's port | `NATIVE_BACKUP_SYNTHETIC_COUNT_SERVER_PORT` | no target created. The forwarder's port is asserted different from the cluster's first. It runs as a separate process because `localCluster()` calls `psql` synchronously and would deadlock on an in-process forwarder |
| 2 | Direct connection, but `localDataDirectory` is the run's output directory, not the cluster's data directory | `NATIVE_BACKUP_LOCAL_CLUSTER_IDENTITY` | no target |
| 3 | Direct connection, no `localDataDirectory` | `NATIVE_BACKUP_LOCAL_DATA_DIRECTORY` | no target |

The forwarder is the attack the review named, not a stand-in for it.

#### What ran, what it produced, what would have made it fail

All on the owner's machine, from a Windows PowerShell 5.1 host, with the
reviewed `run-portable.ps1 -Lane native-preinstall-backup`. Predictions were
stated before the runs.

| Run | Directory (`linear-exit-native-preinstall-backup-…`) | Predicted | Produced |
|---|---|---|---|
| Synthetic | `f7dbcb65…` | 25 → 28 checks | **exit 0, 28 checks**, 67 / 67 tables |
| Observed `settled68` | `145af6d5…` | 15 → 18 checks | **exit 0, 18 checks**, 68 / 68 tables |

Every legitimate capture that uses the override passed the new verification.
That includes the concurrent-writer captures and the changed-catalog refusal
cases, all over direct connections. So the check does not refuse the case it
must allow. *Would have failed on* the `inet::text` mask not being stripped, a
port-type mismatch, or `localCluster()` rejecting the test's own cluster.

**Mutation.** Eight mutants of the module, each run through the synthetic lane.
After each, the original bytes were restored and verified at `328eb177…`, and
again at the end:

| Mutant | Predicted | Lane | What the test saw |
|---|---|---|---|
| M1 claimed-host check removed | detected | exit 1 | `SESSION_FAILED` where `SYNTHETIC_COUNT_LOOPBACK_ONLY` was expected |
| M2 reviewed-catalog guard removed | detected | exit 1 | `CATALOG_MISMATCH` |
| M3 unreviewed refusal removed | detected | exit 1 | `EXPECTED_TABLES_ARGUMENT` |
| M4 manifest-versus-evidence equality removed | detected | exit 1 | `EXPECTED_ORDINARY_TABLES` |
| **M5 server-port check removed** | detected | **exit 1** | the forwarder case got `LOCAL_CLUSTER_PORT`: `localCluster()` caught it one step later |
| **M6 `localCluster()` call removed** | detected | **exit 1** | the wrong-directory case got through to `CATALOG_MISMATCH` |
| **M7 server-address check removed** | **NOT detected** | **exit 0, 28 checks** | nothing |
| **M8 the whole verification call removed** | detected | **exit 1** | the forwarder capture got through to `CATALOG_MISMATCH` |

**M7 is stated plainly, because it is the same kind of guard the review
criticised.** The lane's cluster listens on `127.0.0.1` only (`run-portable.ps1`
line 125 writes `listen_addresses = '127.0.0.1'`), so every connection to it,
direct or forwarded, reports a loopback server address. **No test in this lane
can make the address check fail**, so its presence is not proven by a test.

What does cover that case, by construction rather than by the address check:
a forwarder reaching a remote server makes that server's own port and
`data_directory` visible, and `pg_controldata` on the caller's local directory
cannot report the remote cluster's system identifier. M5 and M6 show those layers
bite. Proving M7 would need a test cluster listening on a non-loopback interface.
That was not done: it means changing the reviewed runner's listen address or
opening a LAN listener on this machine, and neither was asked for.

**Also re-run: nothing else.** The observed `observed67` and opt-out lanes, the
old-package restores and the resolver probe were not repeated, because this
change touches neither the resolver, restore, nor any path without the override.
Main is unchanged.

### 2026-09-16 — INDEPENDENT REVIEW of the backup-path fix `6da60581`: PASS on the change and on authentication; the synthetic override's loopback gate is DECORATIVE by the owner's own criterion

Reviewed by the cloud session, against the code, with the commit's journal
account read alongside rather than trusted. Three things the owner had already
confirmed were not re-proved: no `67` literal remains in the script, `restore()`
takes the count from the manifest and never from the resolver, and line endings
are preserved.

**Overall: PASS.** The change is correct and the reasoning behind it is right —
the count never carried the protection, and removing it loosens nothing that
the catalog-hash bind and the exact evidence comparison do not already hold.
One finding below is a real weakness and it is **not** a reason to withhold the
change; it is a reason to record what the gate actually does.

#### Question 1 — how is "loopback" decided? FROM A CALLER-SUPPLIED STRING. The gate is decorative.

**The line**, `scripts/linear-exit-native-preinstall-backup.js`, in
`captureTableCount(o)`:

```
const local=['127.0.0.1','::1'].includes(o.connection.host);
```

`o.connection.host` is an **option the caller passes in**. It is not the
server's observation of the connection. By the criterion the owner set, that
makes the gate decorative, and this review says so plainly.

**What genuinely narrows it, stated so the finding is not overstated:**

- `config()` strips every inherited `PG*` and `SUPABASE*` variable from the
  environment and then sets `PGHOST` from that same `c.host`. So a caller
  cannot claim loopback and connect somewhere else through the environment.
  The connection really does go to the host named.
- The override additionally requires the catalog to be **unreviewed**
  (`reviewed===null`), so it cannot be used against `observed67`,
  `observed67_optout` or `settled68`.
- `capture()` still refuses unless the live catalog's canonical hash equals
  `o.expectedCatalogSha256`.

**Why it is still decorative rather than merely imperfect.** `PGHOST=127.0.0.1`
being true does not mean the server is an isolated test cluster. Any TCP
forwarder listening on loopback — `ssh -L`, `socat`, `kubectl port-forward` —
makes the claim literally true while the database at the other end is remote and
live. That is not an exotic attack; it is the ordinary way people reach a
managed database. The check cannot distinguish the two cases because it never
asks the server anything.

**The sharpest part of the finding: the server's own observation is already
fetched, in the same function, and is not compared.** Eleven statements after
the gate, `capture()` runs:

```
const identity=await s.json("select jsonb_build_object('database',current_database(),'user',current_user,'server_address',inet_server_addr()::text,'server_port',inet_server_port());");
if(identity.database!==o.connection.database||identity.user!==o.connection.user)fail('IDENTITY');
```

It reads `server_address` and `server_port`, writes them into the manifest as
`connection_observation`, and compares **only** `database` and `user`. The value
that would make the gate real is measured, stored, and never checked against the
claim.

**And the strong version of this check already exists in the same file.**
`localCluster()`, used by `restore()`, asks the server for
`host(inet_server_addr())`, requires it to be loopback, requires the port to
match, requires `data_directory` to resolve to the caller's own local path, and
requires `pg_controldata`'s system identifier to equal the running server's. A
forwarder cannot fake that last one, because `pg_controldata` reads local files.
So the file contains both the weak pattern and the strong one, and the synthetic
override got the weak one.

**The ordering that explains it, which is not an excuse.**
`captureTableCount(o)` is called **before** the `Session` is opened, so at that
point there is no server to ask. The check could be deferred, or re-asserted
after the session opens against `identity.server_address`. Neither was done.

**How much it actually costs, bounded honestly.** To reach the override against
a real world you would need a live catalog that is not any reviewed profile —
which is exactly the state the live database was in this morning — plus a
loopback-looking route, plus a correct `expectedCatalogSha256`, which still has
to match the real catalog exactly. The loss in that case is that
`evidence(s,expectedTables)` degrades to "the world has as many tables as I
said", which checks nothing. The exact catalog-hash bind survives, and restore's
exact evidence comparison survives. **So the blast radius is the crude count
check only, and the commit is right that the count was never the protection.**
That is why this is a finding and not a rejection.

**One wording correction the record should carry.** The code comment says the
override "is refused for any non-loopback connection", and the commit's journal
account says it is "honored only on a loopback connection ... refused
`SYNTHETIC_COUNT_LOOPBACK_ONLY` for any other host". Both say *connection*. The
code tests a *claim*. The difference is the whole of this finding.

#### Question 2 — is the manifest's evidence inside the authenticated part of the package? YES. Confirmed end to end.

The count-equals-evidence check cannot be satisfied from outside the package.
Traced through both modules:

1. `restoreEncrypted()` reads `encrypted.json` and `encrypted.mac` and verifies
   an HMAC-SHA256 over the whole outer file with `crypto.timingSafeEqual`
   **before parsing anything**. A tampered package is rejected before its JSON
   is read.
2. The custody manifest is sealed with AES-256-GCM under AAD
   `{format, manifest_sha256:'encrypted-manifest', key_id, file:'manifest'}`;
   its auth tag is verified on decrypt.
3. Every object chunk — and the backup's `manifest.json` **is** one of the two
   packed objects, alongside `public.dump` — is sealed with AES-256-GCM under
   AAD binding the **custody manifest's digest**, the `key_id` and the chunk's
   **own filename**. A chunk therefore cannot be moved between files or between
   packages.
4. On restore the decrypted custody manifest is re-HMAC'd into a staging
   directory, `readManifest()` verifies that HMAC and requires the bytes to be
   canonical JSON, and `visitChunks()` verifies **each chunk's size and
   SHA-256** and then the **whole object's SHA-256**.
5. Only after all of that does `restore()` read
   `unpacked/database/manifest.json`, after checking the unpacked layout is
   exactly `['manifest.json','public.dump']`.

Two keys are required, and `keys()` refuses if they are the same value
(`KEY_REUSE`). So altering either side of
`m.expected_public_tables === m.evidence.catalog.tables.length` requires both the
AES key and the HMAC key. **The check is sound.**

#### What was NOT reviewed

- The five proof runs themselves. They ran on the owner's machine against
  private inputs; this session read the account and checked the code against it,
  and did not re-run them.
- `scripts/linear-exit-observed-public-catalog.js`'s extracted
  `startingPublicTables()` was read and its call sites checked, but the claim
  that its behavior is unchanged was not independently re-measured by comparing
  outputs.
- The three things the owner had already confirmed, by instruction.

**Nothing was fixed.** No file was changed by this review.

### 2026-09-16 — Backup path: the expected table count now comes from the world, not a literal 67. Steps 9 and 10 no longer refuse the settled world; old 67-table backups measured still restorable. NEEDS INDEPENDENT REVIEW before anything builds on it

Storage session, on the owner's machine. The approach was proposed and approved
by the owner before anything was written. Option A for the synthetic override,
with its two refusals as test cases, and the test extension rather than a
one-off harness. **This is public code that only this machine can run against
the private inputs and the real packages.** So each proof below says what ran,
what it produced, and what would have made it fail, in enough detail to judge
the change without this machine.

#### The observation that makes this safe, stated first because otherwise it reads as a loosened check

**The literal 67 was never the protection.** Two checks already do that work,
and neither is touched by this change:

1. `capture()` refuses unless the live catalog's canonical hash equals
   `o.expectedCatalogSha256`, which the caller takes from a fresh reviewed
   catalog read.
2. `restore()` compares the restored catalog, the per-table row multisets and
   the sequences **exactly** with the evidence in the backup's manifest. That
   manifest is inside the authenticated encrypted package.

The count was a second, cruder statement of the world those two checks already
pin. Deriving it instead of writing it loosens nothing those checks do not
already hold. The owner confirmed this reading when approving.

#### What was wrong, measured

`scripts/linear-exit-native-preinstall-backup.js` had **five** `67` literals,
not four:

| # | Site | Role |
|---|---|---|
| 1 | `evidence()` | refuse unless exactly 67 ordinary tables (`EXPECTED_67_ORDINARY_TABLES`); runs twice in `capture()`, once in `restore()` |
| 2 | `capture()` manifest | writes `expected_public_tables: 67` |
| 3 | `capture()` return | reports `public_tables: 67` |
| 4 | `restore()` | refuses any manifest whose `expected_public_tables` is not 67 |
| 5 | `restore()` return | reports `public_tables: 67` |

Plus `test/linear-exit-native-preinstall-backup.js`'s
`captured.public_tables === 67`. That is the row the world-literal sweep lists at
`:9`, warning that fixing the module without it "moves the failure". The sweep's
§3.3 names site 1 only; **this change covers all five and that test row.**

#### What changed, file by file

| File | Before SHA-256 | After SHA-256 | Bytes | Line endings |
|---|---|---|---|---|
| `scripts/linear-exit-observed-public-catalog.js` | `03c9aabdef22ff28f1b6c6219a52939a253aa58c4f7637a850925b7d6b41b59b` | `b472731b84f39ce839dcbcb0771d6db75f864f7c47e6d58ea88d535fa000a7ec` | 11,662 → 12,391 | LF, 0 CR before and after |
| `scripts/linear-exit-native-preinstall-backup.js` | `cb78569c31b3dd7bda0f2ae943371ff72b924e771fa6e43cdb75fe8bd911528f` | `e0b27b370ac12deb903b011e96f9914fab603558d5cf9b27a7e9387a58e30880` | 14,272 → 17,269 | CRLF, CR count equals line count before (28) and after (57) |
| `test/linear-exit-native-preinstall-backup.js` | `e8affbe798ca43c858ada7b120a83ee346e0e6ca0a665b345cbf59087aaa0eac` | `443fea8f86b0fd1c8a7becadbbe9c05f8916a867a538a8cdfe171db693768aea` | 11,458 → 18,368 | CRLF, 40 → 65, CR equals lines |

The edit was applied by a script. Each replacement had to match its anchor an
exact number of times, and each file had to be at its baseline hash first. Those
hashes were read from the baseline run's own output, not retyped.

1. **Resolver, pure extraction.** The starting-world half of
   `postInstallPublicTables()` becomes an exported
   `startingPublicTables(catalogSha256)` returning `{contract, count}`, with the
   same checks, order and error messages. `postInstallPublicTables()` now calls
   it. No other file's behavior depends on the extraction except the backup
   module.
2. **`capture()`** calls a new `captureTableCount(o)` **before** creating any
   directory or session:
   - A reviewed catalog resolves through `startingPublicTables()`.
   - An unreviewed one is refused `NATIVE_BACKUP_UNREVIEWED_CATALOG`.
   - `o.syntheticPublicTables` is honored only on a loopback connection for an
     unreviewed catalog. It is refused `SYNTHETIC_COUNT_LOOPBACK_ONLY` for any
     other host, `SYNTHETIC_COUNT_FOR_REVIEWED_CATALOG` for any catalog the
     resolver knows, and `SYNTHETIC_COUNT` if it is not a positive integer.
   - Only the resolver's "unknown catalog" error is turned into that decision.
     Any other resolver failure, such as a tampered contract file, propagates.

   `evidence(s, expectedTables)` takes the count and refuses
   `EXPECTED_ORDINARY_TABLES`. The manifest records the resolved count, under the
   same field name and the same `format` strings.
3. **`restore()`** takes the count from the backup's **own** manifest and never
   from the current reviewed set, so a backup stays restorable after the code
   moves on. It requires `expected_public_tables` to be a positive integer equal
   to `m.evidence.catalog.tables.length`. It then asserts the restored database
   has that many tables, and then runs the unchanged exact comparison. Every
   manifest written before today says 67 with a 67-table evidence catalog, so it
   passes as it did.
4. **Test extension.**
   - A per-profile setup table taken from the install runner's recipe, selected
     by `PREINSTALL_BACKUP_PROFILE`. The name was chosen so the runner's
     `NATIVE_` environment refusal does not reject it. The opt-out prerequisite's
     git ref and SHA-256, and the hiring migration path, were copied from
     `test/linear-exit-install-operator-postgres.js` by the edit script, not
     typed.
   - After reconstruction the test asserts the world **resolves**, and by the
     **expected route**: `observed67` and `settled68` through their own contract,
     meaning the catalog hash equals the contract's; opt-out through the reviewed
     mapping. So a setup that silently built the wrong world fails before any
     capture. **No table count or catalog hash for any profile is written in the
     test.** `SYNTHETIC_TABLES = 67` is the synthetic world's own size, used both
     to build it and to declare it.
   - New refusal cases are listed under proof B.
   - The test's pin list gains the settled contract JSON and the hiring
     migration, which the run now depends on.

**Private wrappers: unchanged.** Read, not run: `refresh-install-day-database`
passes `expectedCatalogSha256` from the receipt and no count, so a settled
receipt resolves to 68. `restore-install-day-database` passes a package path
only.

#### The proofs. Each: what ran, what it produced, what would have made it fail

All runs used the reviewed `run-portable.ps1 -Lane native-preinstall-backup` on
PostgreSQL 17 from a Windows PowerShell 5.1 host, with `SUPABASE_*` cleared per
process. **Baselines were taken on the unchanged code at `c234fee8` first**, so
every "after" has a "before". Run directories are under the private evidence
directory, prefix `linear-exit-native-preinstall-backup-`.

**Proof A — the resolver extraction changes no answer.** Ran: one script
calling `postInstallPublicTables()` for the `observed67` and `settled68`
contract hashes, the opt-out mapping key, an all-zero hash and a malformed
string, before and after. Produced: all five outputs byte-identical as JSON:
67/23/90, 68/23/91, 67/23/90, `OBSERVED_CATALOG_UNKNOWN_STARTING_CATALOG`,
`OBSERVED_CATALOG_STARTING_SHA_SHAPE`. `startingPublicTables()` returns counts
67, 68 and 67 and the same two refusals. Exports: one added, none removed.
*Would have failed on* any change to resolution order, contract lookup, mapping
or error text. Also run after, all exit 0:
`test/linear-exit-observed-public-catalog.js` (13 checks),
`test/linear-exit-install-operator.js` (offline pass) and
`test/linear-exit-observed-schema.js` (7 checks).

**Proof B — the synthetic lane, before and after.** Before, `ea2a78e9…`: exit 0,
**20 checks**. After, `0155e76c…`: exit 0, **25 checks**, source and restored
tables 67, 12 pinned files unchanged across the run. The five added checks,
predicted before the run from the edit:

1. a non-loopback connection (`example.invalid`, `verify-full`) with the
   override is refused `SYNTHETIC_COUNT_LOOPBACK_ONLY`, and the target is not
   created;
2. the override with **each** reviewed contract hash is refused
   `SYNTHETIC_COUNT_FOR_REVIEWED_CATALOG`, target not created;
3. an unreviewed catalog with no override is refused `UNREVIEWED_CATALOG`;
4. a declared count one too high is refused `EXPECTED_ORDINARY_TABLES` **by the
   real database**;
5. restore's manifest checks. The first backup is decrypted with the test keys
   and repacked from the same dump. The **unmodified** repack must restore
   exactly: that is the control proving the repack path works. Manifests
   claiming count+1, count−1 and the count as a string must each be refused
   `NATIVE_BACKUP_MANIFEST`, with the output directory removed.

*Would have failed on* any guard missing, a refusal arriving later than
pre-connection, or a repack artifact.

**Proof C — the observed worlds, including the settled forward proof.** Before,
`observed67` `968a3a6e…`: exit 0, **8 checks**, 67 tables. After, predicted
before running as 8 + 7 = 15, since observed mode adds two cases that need a
reviewed world:

| Profile | Run | Exit | Checks | Captured / restored tables | Resolution route asserted |
|---|---|---|---|---|---|
| `observed67` | `ff27689c…` | 0 | 15 | 67 / 67 | own contract |
| `observed67_optout` | `f1d1b978…` | 0 | 15 | 67 / 67 | reviewed mapping |
| **`settled68`** | **`af4f27c8…`** | **0** | **15** | **68 / 68** | **own contract, so the rebuilt catalog equals the `settled68` contract's hash** |

The two observed-only cases: the config's own reviewed hash with the override
is refused `SYNTHETIC_COUNT_FOR_REVIEWED_CATALOG`; and a **reviewed catalog of a
different size** is refused `EXPECTED_ORDINARY_TABLES` by the real database.
For `settled68` that is the 67-table contract against the 68-table world, and
vice versa for the others. *Would have failed on* the setup building the wrong
world, the count not reaching `evidence()`, or a 68-table world failing to
capture, restore or compare exactly. **The settled run is the first time the
backup path has captured and restored a 68-table world.**

**Proof D — backups written before this change still restore, by measurement.**
Ran: the private `restore-install-day-database.private.cjs`, unchanged, into its
owned loopback scratch cluster (stopped before and after). The two real
2026-09-14 packages were restored, `real-preinstall-encrypted` and
`drive-downloaded-database-encrypted`, 44 files each and unmodified, **once on
the old code and once on the new**. Produced: all four
`ISOLATED_DATABASE_RESTORE_PASS`, exit 0. The receipts are identical before and
after apart from the random database name: `public_tables: 67`,
`exact_catalog_and_rows_and_sequences: true`, `hosted_restore_proven: false`.
Output directories are named `restore-compat-before-…` and
`restore-compat-after-…`. *Would have failed on* any manifest-compatibility
break for real custody packages, which is exactly the risk the owner named.

**Proof E — the new guards are load-bearing, by mutation.** Ran: four mutants of
the backup module, each removing one guard, each run through the synthetic
lane. The original bytes were restored after each one and verified at
`e0b27b37…` every time, and at the end.

| Mutation | Lane | What the test saw instead of the expected refusal |
|---|---|---|
| M1 loopback guard removed | exit 1 | `NATIVE_BACKUP_SESSION_FAILED`. The mutant went on and tried to connect to `example.invalid`, a reserved name that cannot resolve |
| M2 reviewed-catalog guard removed | exit 1 | `NATIVE_BACKUP_CATALOG_MISMATCH` |
| M3 unreviewed refusal removed | exit 1 | `NATIVE_BACKUP_EXPECTED_TABLES_ARGUMENT` |
| M4 manifest-versus-evidence equality removed | exit 1 | `NATIVE_BACKUP_EXPECTED_ORDINARY_TABLES` |

M4 also shows the equality is not the only barrier. Without it, restore still
refuses one step later, at the restored table count. The equality makes the
refusal earlier and explicit.

#### Not run, and not claimed

- **No live capture.** Step 9 with the new code is day-of work and was not
  authorised. Its path is established only by reading the refresh wrapper, plus
  proof C's capture of a reconstructed settled world.
- **GitHub CI** on the pushed head has not been looked at by this session.
- **Dated proof manifests now record old hashes.**
  `LINEAR_EXIT_NATIVE_PREINSTALL_BACKUP_PG17_20260913.json` and
  `LINEAR_EXIT_NATIVE_ONLINE_SEQUENCE_PG17_20260914.json` pin the pre-change
  script and test. Both are dated receipts with **no code consumer** (searched),
  so they were left byte-identical per the re-run-never-edit rule. No new dated
  backup proof file was written; the owner can ask for one from these runs.
- **Side effect, pre-existing behavior:** each private restore run leaves its
  `native_restore_…` database inside the owned scratch cluster. Four were added
  today.
- **Mistakes of this session's own, none of which ran anything:** a launcher
  step passed an empty `-Profile` and was refused at parameter binding before
  any cluster started; it was fixed and re-run.

**Independent review asked for before anything builds on this**, per the owner.
No plan or target was pinned, the install operator's proof read was not
repointed, the sweep was not touched, and main is unchanged.

#### CORRECTION, added 2026-09-16 after the independent review at `3dc70acb`. The account above is kept as written.

**The account above overstated what the synthetic override's loopback check
did.** It says the override is "honored only on a loopback connection" and
refused `SYNTHETIC_COUNT_LOOPBACK_ONLY` "for any other host". The code comment
at `6da60581` said it "is refused for any non-loopback connection".

**What the code actually did** was test `o.connection.host`, a string the caller
supplies. It never asked the server. A TCP forwarder listening on loopback makes
that string true while the database is somewhere else. The review called the
gate decorative, and that is correct. The claim was about a *connection*; the
check was of a *claim*.

**Proof B's first case did not prove what the account said.** It sent
`example.invalid` and saw the refusal. That shows a non-loopback **claim** is
refused. It says nothing about a loopback claim routed to a remote server, which
is the case that matters. The M1 mutation showed the claim check is
load-bearing for the claim, and nothing more.

**Unaffected, per the review:** the reason for the change (the count was never
the protection), the catalog-hash bind, restore's exact evidence comparison, the
reviewed-catalog refusal and the manifest authentication. So was the blast radius
the review bounded: the crude count check only.

**Fixed** in the entry "Backup path, review finding fixed" above. The code
comment was corrected in the code itself, since a source comment is not an
append-only record.

### 2026-09-16 — CORRECTION to this session's own B10 report: it was NOT zero regressions. B10 broke three suites the unit lane never runs. Sweep pushed as its own document

**The earlier claim stands above as written, per the append rule, and it is
wrong.** When B10 landed this session reported **zero regressions**, on the
evidence of the full 547-suite run plus the same 14 failures on a clean control
worktree.

**That was true of the 547 and false of the repository.** Measured today by
running the deferred suites by hand against PostgreSQL 17 and controlling
against the pre-B10 commit `9b6990d`:

| Suite | pre-B10 `9b6990d` | post-B10 `8940583` | Cause |
|---|---|---|---|
| `test/linear-exit-application-dml-admission.js` | PASS | **FAIL** | `87 !== 86` |
| `test/linear-exit-source-phases-postgres.js` | PASS | **FAIL** | table-name list is one short |
| `test/linear-exit-source-baseline-catalog-postgres.js` | PASS | **FAIL** | same |

**Why the verification missed them, which matters more than the miss.**
`scripts/test-suite-routing.js` runs 547 suites and defers **61** as
`NOT_RUN_BY_UNIT_LANE`. All three are in the 61. A full run plus a clean control
is the right shape and still reports clean, because the control compares the
same suite set that already excludes the affected suites. Setting
`F63_REQUIRE_POSTGRES=1` does not change this; the routing is static.

**Not fixed.** The sweep was read-only by instruction, and the fix for the
second and third is not a number — see the document.

**The sweep is pushed as its own document**, at the owner's instruction, not as
a journal entry:
[`LINEAR_EXIT_WORLD_LITERAL_SWEEP_20260916.md`](LINEAR_EXIT_WORLD_LITERAL_SWEEP_20260916.md).
43 sites, 27 files, each classified as a deliberate frozen contract, a stale
snapshot, correct-but-bound-to-one-world, or undetermined with what would settle
it. Seven stale. Eleven one world from stale. Eighteen of the 61 deferred suites
carry such a literal.

It **extends** `LINEAR_EXIT_GUARD_COUNT_SITES.md` rather than replacing it, and
records two things about that survey: three of its nine sites are now fixed and
six still hold a literal; and **its site 9 predicted the §3.2 failure exactly**,
naming both the table and the condition. The forecast was right and still did
not prevent anything, because it named the settled *database* and what actually
moved was the test *fixture*. Two of the sweep's eleven single-world sites are
in the record only because that survey had already found them; no search shape
in the sweep would have.

### 2026-09-16 — STOPPED: after B10, `observed67` and `observed67_optout` CANNOT INSTALL; the admission guard refuses a table only `settled68` has. `settled68`'s target re-derived. Pipeline proof NOT re-run

Storage session, second of three jobs. Every value below was read from a run's
own files after that run finished. Nothing was adjusted, re-pinned, or run
twice to get a different answer.

#### What was run

The reviewed `run-portable.ps1 -Lane install-operator` in calibrate mode, once
per profile, one after another. Launched through the handover section 4.6
launcher, taken whole from `git show HEAD:` of the handover, from a Windows
PowerShell 5.1 host.

- Checkout at `8e2b0f36`. **Its code is byte-identical to B10's commit
  `89405832`**: `git diff --stat 89405832 HEAD` outside `docs/`, `REPO_MAP.md`
  and `EXECUTION_LOG.md` is empty.
- PostgreSQL 17 ICU `en-US` on loopback, via the runner's own cluster.
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` were cleared in each
  run's process only (names only).
- Private observed inputs, hashed immediately before the batch:

| File | Bytes | SHA-256 |
|---|---|---|
| `live-full-catalog-20260912.private.json` | 969,383 | `b12defb25d1bde3a59a1680cb7b81084b651e7e84b4c5e243afa1772f6f47da2` |
| `live-routine-definitions-20260912.private.json` | 750,023 | `3728b7b676cfd7971515f03bb90f9204ac7e764a901804f8318571ea496ba6a7` |
| `live-routine-metadata-20260912.private.json` | 53,127 | `aa33b43598500718924be2fb2775f68f126eb9d28ac825d14b4d5929786b375d` |
| `live-routine-source-map-20260912.private.json` | 120,753 | `6399972a96ba7e95fb55c8ddba2ed3de17a124a560badae73d8f943029d35c9b` |
| `live-sequence-ownership-20260912.private.json` | 1,857 | `f861749a4b22337ed1124811cdbac3bd601f4875039de07fee7c7dbb1616c87a` |
| `live-structural-definitions-20260912.private.json` | 141,305 | `e12db373b9e94e9dfb400b75e0b41072096d9ba7c493072af9c4b532e4eec178` |

**Expectations stated before the runs:** post-install public tables 90, 90 and
91; plan hashes measured first and only then compared with the cloud session's
reported prefixes; no expected target values.

Two launches before these never reached the runner, both from the session's
own launch syntax. One was a PowerShell parse error, a `foreach` piped to
`Tee-Object`. The other passed a comma list to the launcher's `ValidateSet` as
one string. Neither cleared the environment, created a directory or started a
cluster: the only directory created in that window was `day-catalog-20260916-4`.

#### Results

| Profile | Run directory (`linear-exit-install-operator-…`) | Exit | Plan SHA-256 (from `operator-plan.private.json`) | Target |
|---|---|---|---|---|
| `observed67` | `957db6c8d50d4b7abb4a1c6b6cc3af9a` | **1** | `7043637f90378244f445d588680709d67f16cee7ee43170b2254f0edb78b3f1f` | **none written** |
| `observed67_optout` | `8f40b44d6a274597af0cfb3ec8ab3209` | **1** | `92a4737ffd13b3634aad76ed8ceded28966a66a4de0b09fb503fdd4a4c5d4021` | **none written** |
| `settled68` | `f215fa6863d6456ca36868280bb5f649` | **0** | `508e63699a0f7d8fde2a4a3abf3f13c84780ced95d4b5c2702da4a54cc06f2bd` | **`24c833c01743cf9d6229e052819ff1d67006b29a962790d750abf84394c22187`** |

All three reconstructions printed `LINEAR_EXIT_OBSERVED_SCHEMA_OK`. All three
clusters logged `server stopped` and left no `postmaster.pid`. Every plan
declares 48 sources and the expected starting catalog: `809c5dc7…`,
`f5ed8a38…`, `ddfa4c4f…`.

**Cross-check against the messenger, done last:** the three measured plans
begin `7043637f`, `92a4737f` and `508e6369`, the prefixes the cloud session
reported in its B10 entry. They agree.

#### `settled68`, the one that completed

| Item | Value |
|---|---|
| Target file | `settled68-target.private.json`, **1,613,689 bytes** |
| **Target SHA-256** | **`24c833c01743cf9d6229e052819ff1d67006b29a962790d750abf84394c22187`** |
| Post-install public tables | **91**, equal to the stated expectation |
| Plan (file, `target.plan_sha256`, `operator-result.plan_sha256`) | all `508e63699a0f7d8fde2a4a3abf3f13c84780ced95d4b5c2702da4a54cc06f2bd` |
| Stage | `OBSERVED_PUBLIC_20260916_SETTLED_FULL_PREPARATION_V1` |
| Installed public catalog | `331aabb2b51067b1b07d444e39e010c1c8ed18349f2f0ab3a0426cab0f5ff84d` (was `0d4eb7dc…` before B10) |
| Installed private catalog | `fccae16ac7200ac82369f73449512d21f762b86b53bdb306fba172388bbc2401`, **unchanged** from the pre-B10 calibration |
| Operator result | `CALIBRATION_ONLY`, `target_sha256` equal to the file's SHA-256, `activation_performed: false` |
| Target flags | `installation_authorized: false`, `hosted_target_verified: false` |
| Markers | `LINEAR_EXIT_OBSERVED_SCHEMA_OK`, `LINEAR_EXIT_INSTALL_OPERATOR_OK` |

**Not pinned.** `profiles.settled68` in `linear-exit-install-profiles.js` still
carries plan `e3dae746…` and target `625430…`, both superseded by B10 as
predicted. Pinning is the owner's reviewed step.

#### THE STOP: why the two older profiles produced no target

Both failed inside the installer's SQL, at the same point, with the same error.
It came from the worker's stderr, `operator-worker.private.json`:

```
PostgresError: application_admission_missing_owner:hiring_practical_test_jobs
```

**Traced, read from code and history:**

- The error is raised in
  `supabase/migrations/20260912183653_application_dml_admission_preparation.sql`
  line 73. The guard loops over its table list and, for each name,
  `if to_regclass('public.'||t) is null then raise exception 'application_admission_missing_owner:%'`.
- `hiring_practical_test_jobs` appears in that file **0 times at `89405832^`
  and once at `89405832`.** B10 put it there.
- The table exists only in a world where the hiring migration ran. In the
  runner's per-profile `SETUP` table only `settled68` has `hiring: true`.
  `observed67` and `observed67_optout` are the pre-hiring worlds by definition.

**So after B10, the plan for any pre-hiring world contains a guard over a table
that world does not have, and the install refuses before finishing.** That is
not a defect in those runs. It is what B10 means for any profile whose starting
catalog predates the hiring migration.

**Why nothing caught it before now.** B10's green lane,
`linear-exit-retirement-switch-postgres.js` with 46 checks, runs on the shared
fixture, and B10 added the hiring migration to that fixture as an OWNERS
entry, so the table existed there. B10's plan-hash measurements stubbed the
starting-catalog gate and never installed anything. Neither could have seen a
pre-hiring world. This is the first real install of either older profile since
B10.

**What this invalidates, stated so nobody has to infer it:**

1. **Job 2 cannot be completed as specified.** There is no post-B10 target for
   `observed67` or `observed67_optout`, and there cannot be one without a
   change to either the profiles or the guard.
2. **The pipeline proof (job 3) was NOT run.** `test/linear-exit-observed-full-pipeline.js`
   builds only the `observed67` world, with `observed-full-install-plan.build()`
   and the same admission migration. **On reading, it will refuse the same way.
   That is a prediction, not a measurement.** No new dated proof file was
   written, and `LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` is untouched
   (SHA-256 `73499b0904278ee8b29250276e4efe42441680703b8b20049e5deca613f037bb`,
   12,660 bytes).
3. **The source-pin gate count was measured independently:**
   `source_pins`, 3 of 26 mismatched, the same three files as the entry below.
   `calibration_source_pins`, 5 of 26. The two extra are the pipeline test and
   its worker, whose 2026-09-13 hashes already differed between that day's
   calibration and replay. That list has no code consumer.

**The decision this needs is the owner's, and none of it was attempted.** In
rough shape, not as recommendations:

- whether the two pre-hiring profiles are still required to install, given
  live is `settled68`;
- whether the pipeline proof should be re-based on the settled world rather
  than the 67-table capture;
- or whether the guard should tolerate an absent table. That changes what a
  security guard admits, and needs its own review.

Each option changes reviewed code or reviewed scope. None is a storage-session
fix.

**Not run, stated plainly:** the pipeline lane in either mode, and any
neutrality comparison against the pre-B10 worktrees. The worktrees
`2026-09-16-runner-before-05bf19f6` (`05bf19f6`) and
`2026-09-16-optout-before-d3cbca7f` (`d3cbca7f`) were confirmed present and
clean at the start of this sitting, and were not used.

### 2026-09-16 — Storage session: the private catalog wrapper now names `settled68`, PROVEN by a live read; plus three findings, one of them a step 9 and 10 refusal nobody had listed

Written by the storage and custody session on the owner's machine, at branch
head `5b93cf57`. Of three jobs, this is the first. The other two follow as
their own entries.

#### What changed in the private file, described so it can be checked without seeing it

`D:/Sidney/Codex/2026-09-13-final-review-repairs/read-install-day-catalog.private.cjs`
maps a live catalog's canonical hash to a profile name. On line 18 it held a
two-entry object literal, `observed67` (`809c5dc7…`) and `observed67_optout`
(`f5ed8a38…`), and nothing else.

**The change is exactly one inserted string, and no other byte.** It was placed
immediately before the `}` that closes that literal:

```
,'ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c':'settled68'
```

| | Before | After |
|---|---|---|
| SHA-256 | `5b44cf99ce601e877f89f249a90d8779d183378865afb3223558fc0904eea937` | `6b6e2fe7248d08f627dbf91319211ed11a9a5e1743a66b2fd327f9d595e9bb56` |
| Bytes | 3,248 | 3,327 |
| Line endings | LF, 0 CR, 21 LF | LF, 0 CR, 21 LF |

A reader can check the accounting: 3,248 plus the 79 bytes of the string above
is 3,327. A comma-split `diff` of the two files showed exactly one changed
token group, the closing entry gaining the new pair. `node --check` passes. The
before-state is kept byte-identical beside it as
`read-install-day-catalog.private.cjs.pre-settled68-20260916.bak` (SHA-256
`5b44cf99…`, the same value as the original). The file also contains the
project host in plain text, so its body is not reproduced here.

**Where the hash came from, so nobody typed it.** The edit ran as a script.
The script read `const SETTLED='…'` from `git show HEAD:scripts/linear-exit-install-profiles.js`
with a pattern bound to that declaration, required it to be unique, and then
asserted it equal to a fresh canonical hash of the private derived catalog
`b9-derive-20260916-2/b9-settled-catalog.private.json`. It refused to write
unless the wrapper was still exactly `5b44cf99…`, the anchor appeared exactly
once, the length accounting held and no CR had been introduced.

**Section 5 of the handover, applied before the edit.** HEAD `5b93cf57`. Pin
commit `03d18fb3` is an ancestor. `SETTLED` read from git at `03d18fb3` and at
HEAD: both `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`,
so the pin has not moved. Fresh canonical hashes from disk, all equal to it:
the B9 derived catalog (941,914 bytes, written 2026-09-16T15:13:40Z, 68
tables), and both earlier live reads, `day-catalog-20260915-2` and
`day-catalog-20260916-1` (941,913 bytes each, 68 tables). No value from chat
entered the comparison.

**Why this is not what D12 forbids.** D12 refused adding `ddfa4c4f…` as a
third profile *until* the hiring migration was on main and the profile had
been derived once against the settled state. Both happened: main `1abdd1fa`,
then B9 and D17. This entry names the already-reviewed `settled68` for the
catalog it starts from. It does not create a profile and it pins nothing.

**What it does NOT mean.** The catalog wrapper now says "this live catalog is
the `settled68` starting catalog". It does not say `settled68` is installable.
After B10 the profile's plan and target pins are stale, and the operator
refuses at `PLAN` until they are re-derived (the next two entries).

#### The proof: the read was run, not reasoned about

| Run | Directory | Result |
|---|---|---|
| Before, 2026-09-15 | `day-catalog-20260915-2` | `ddfa4c4f…`, `profile: null`, `matches_reviewed_baseline: false`, TLS verified (receipt re-read from file today) |
| Before, 2026-09-16 | `day-catalog-20260916-1` | same |
| After, attempt 1, 22:31:28Z | `day-catalog-20260916-2` (never created) | `READ_ONLY_CATALOG_REFUSED`, exit 1. Cause below |
| After, attempt 2, 22:33:01Z, with a watch-only preload | `day-catalog-20260916-3` (never created) | same refusal. The preload named the cause |
| **After, attempt 3, 22:33:34Z** | **`day-catalog-20260916-4`** | **`catalog_sha256` `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`, `profile: "settled68"`, `matches_reviewed_baseline: true`, `tls_verified: true`, `installation_authorized: false`, exit 0** |

The wrapper's SHA-256 was hashed in the same process just before each after-run:
`6b6e2fe7…` all three times. The attempt-3 receipt and catalog were then
re-read from the files, not the console: canonical catalog hash `ddfa4c4f…`,
68 tables, and the receipt fields as in the table. Read-only; step 9 was not
run. That receipt's one-hour window closes at 23:33:37Z today and it will not be
used.

#### Finding 1 — a trap on this machine: private wrappers cannot read their secret when launched from a PowerShell 7 host

This is **why attempts 1 and 2 failed**, and it would fail steps 8, 9 and 10
the same way. **MEASURED.**

- This session's PowerShell tool runs **PowerShell 7.6.6**, installed on
  2026-09-16 for B5. Every earlier successful catalog read ran from Windows
  PowerShell 5.1.
- The wrappers start `powershell.exe` (5.1) from Node to run
  `read-private-secret.private.ps1`, which needs `ConvertTo-SecureString`.
  Node passes pwsh 7's `PSModulePath` to that child unchanged, and 5.1 then
  fails with: *The 'ConvertTo-SecureString' command was found in the module
  'Microsoft.PowerShell.Security', but the module could not be loaded.*
- The watch-only preload recorded that as the only stage reached: the
  `execFileSync` of the secret helper, status 1, 309 ms, no stdout. No
  connection was attempted. The preload recorded stdout **length** only, never
  content.
- Confirmed with a dummy plaintext, no secret involved. Node launched from
  pwsh 7 into a 5.1 child: fails. The same with `PSModulePath` removed:
  works. Node launched from a 5.1 host: works. A 5.1 child launched **directly**
  by pwsh 7 also works, because pwsh 7 cleans that variable itself; that is
  why a direct test misleads.
- **Affected, found by search, not run:** ten scripts in the private evidence
  directory start `powershell.exe` to run `read-private-secret`. They are the
  catalog read, refresh and restore; `run-storage-quiet-window`,
  `verify-downloaded-storage`, `hash-historical-storage-local`,
  `run-real-capture`, `run-real-restore`, `run-real-storage-export` and
  `run-real-storage-export-only`. Only the catalog read was run from a pwsh 7
  host. The others are expected to fail the same way, on reading, not
  measurement.
- **Handling:** the command was not changed. It was run from a Windows
  PowerShell 5.1 host, the host the handover's measurements were taken in,
  which is attempt 3. No workaround was applied to the wrapper.

#### Finding 2 — NOT FIXED, reported: steps 9 and 10 still refuse on the settled world, in PUBLIC code, on a 67 nobody listed

`scripts/linear-exit-native-preinstall-backup.js` line 21, `evidence()`, fails
`EXPECTED_67_ORDINARY_TABLES` unless `catalog.tables.length === 67`.
`capture()` calls `evidence()` before and after the dump, and `restore()` calls
it on the restored copy. The catalog it counts comes from the **same**
`linear-exit-source-baseline-catalog.sql` that attempt 3 just ran, which
returned **68** tables.

- **Evidence class:** the input (68) is MEASURED. The call path and the
  assertion are READ. Nothing was executed against a database.
- **So:** with the wrapper fixed, the step 8 receipt now satisfies the refresh
  wrapper's own gate. But `capture()` would then refuse at its first
  `evidence()`, before any dump. Step 10 cannot get further than step 9 does.
- **Why it was missed:** the 2026-09-16 reachability trace asked whether step 9
  reaches the fixed table-*list* check (`captureRows()`), and correctly
  answered no. This is a different check, a table *count*, in a module that
  trace measured as loaded. The nine-site survey was about the post-install
  90/91, not a pre-install 67. It appears in no journal entry, no ops page
  and no survey row. Searched for `native-preinstall-backup`,
  `EXPECTED_67_ORDINARY_TABLES` and `tables.length!==67` across `docs/`: the
  only mentions of the module are its own preparation page and two proof
  manifests. The recovery procedure does state "the package covers 67 public
  tables" as a limit.
- **Not fixed here**, deliberately. It is public code on the custody and
  recovery path that B4 closed on, and it is the same shape as the nine-site
  count problem. It wants the cloud session and a review, not a storage-session
  patch.

#### Finding 3 — the "same defect fixed in public code this morning" could not be found as described

The instruction to this session said a public fingerprint-to-profile lookup had
never learned the third profile and was fixed this morning. **Searched, two
shapes:** `git grep` for the three catalog hashes outside `docs/`, and a read of
every hit. Public code has exactly two catalog-hash lookups.
`linear-exit-install-profiles.js` `build()` has handled `settled68` since
`03d18fb3`. `STARTING_CATALOG_TABLE_COUNT_SOURCE` in
`linear-exit-observed-public-catalog.js` maps only the opt-out hash, by design.
The nearest public fix is `87611aa2`/`b600a747`, which taught a table-*count*
lookup the *opt-out* world. That is similar in shape, but it is not the third
profile. Recorded as not found rather than as refuted; the chat description may
refer to something this session did not locate.

#### The sweep of the other private wrappers, as asked

**Result: the hash-to-profile map exists in exactly one private file.** Two
search shapes, reconciled:

1. **Names and known hashes** (`809c5dc7`, `f5ed8a38`, `ddfa4c4f`,
   `observed67`, `settled68`, `profile`) over every script at the top level of
   both private evidence directories. Hits: the catalog wrapper, which has the
   map; `profile-edit.private.cjs` and `control-final-edit.private.cjs` in
   `2026-09-12-fast-finish-evidence`, where "profile" means the control
   companion's `core`/`core+diagnostics` variant, not an install profile; and
   `frame-owner-login-launch.private.cjs`, where it means a Chromium profile
   directory.
2. **Every 64-hex literal** in 971 script files under both directories, two
   levels deep, skipping `node_modules`, the PostgreSQL copy and data
   directories. The three catalog hashes occur only in the catalog wrapper. A
   `storage-concurrency-worktree` subdirectory is an old repository copy, not a
   wrapper; none of its literals is a catalog hash.

The two downstream wrappers were read in full. `refresh-install-day-database`
gates on `matches_reviewed_baseline === true`, freshness and the receipt's
catalog hash, and never reads the profile name. `restore-install-day-database`
has no catalog check. So neither needed the same change. The step 9 and 10
blocker is Finding 2, which is in public code.

**Not checked:** private scripts deeper than two levels.

### 2026-09-16 — Pipeline proof: DECIDED re-run, never edit, and the re-run NEEDS the private inputs, so it is the storage session's. Also: it was already stale before B10, on two pins B10 never touched

**The owner's decision, recorded as given.** The 2026-09-13 pipeline proof is
**re-run, not edited**. The re-run writes a **NEW dated proof file** for the day
it runs and leaves
`docs/independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json`
**byte-identical**. The install operator's `source_pins` read is then pointed at
the new file. The owner's addition to the recommendation was exactly this last
point, and it is the part that matters: **overwriting the dated file would be
the same falsification with extra steps.** A dated receipt is evidence of one
run; a second run is a second receipt.

**Does the re-run need the private inputs? YES. It is not close, and nothing
here was stubbed to find out.**

`test/linear-exit-observed-full-pipeline.js` refuses on its fourth line without
`OBSERVED_INPUT_DIRECTORY`, and hands it to
`scripts/linear-exit-observed-schema.js` `applyObservedSchema`, which
reconstructs the observed world from **four private capture files** named in
that script: the live full catalog, the live routine definitions, the live
structural definitions and the live sequence ownership, all the 2026-09-12
capture. They are not in this repository and never will be. The lane then
asserts the reconstruction is exact: 67 tables, 115 functions, 14 sequences, 14
ownership rows, `server_major` 17, and a public schema that was empty before it
started.

**So the re-run joins the storage session's list.** It cannot be done in this
sandbox. Stubbing the reconstruction to get a green would produce a proof of
nothing while looking like a proof of something, which is precisely what the
decision above exists to prevent.

**An ordering constraint the lane imposes, which is separate from the one the
owner ruled out.** The owner is right that `linear-exit-install-profiles.js` is
**not** in the pinned set — confirmed by reading all 26 pins — so profile
re-pinning cannot invalidate this proof, and there is no ordering constraint in
that direction. But the lane's `--verify` mode takes **a private target path and
that target's SHA-256 as arguments**. So the re-run in verify mode is downstream
of the target re-derivation: derive the targets first, then re-run this. The
`--calibrate` mode takes neither and can go first.

**A correction to the count, offered because the record's own rule says a
correction is a hypothesis until it is checked against the code.** The owner's
note says two of the 26 pins are stale, the retirement migration and the full
install plan builder. **Measured: three.** The third is
`scripts/linear-exit-observed-full-target.js`.

| Stale pin | Last changed by | Is it B10's? |
|---|---|---|
| `supabase/migrations/20260913062149_retirement_switch_preparation.sql` | B10, `8940583` | **Yes** |
| `scripts/linear-exit-observed-full-install-plan.js` | `03d18fb` (settled68 wiring), then B10 | **No, B10 was second** |
| `scripts/linear-exit-observed-full-target.js` | `8299108` (the post-install count derivation) | **No** |

**The consequence is the useful part, and it is not a quibble about a number.
Two of the three stale pins predate B10 entirely, and both came from
2026-09-16's own work.** This proof has been failing its own `SOURCE_PIN` gate
since the settled-contract and count-derivation commits landed today, before
B10 began. B10 did not create this deadlock; it added a third pin to one that
already existed and was not noticed. Anyone re-running the proof should expect
to be re-proving today's earlier work as well, not just B10's.

Also confirmed while counting: the admission migration and the shared fixture
are **not** in the pinned set, so of B10's edits only the retirement migration
is. And `calibration_source_pins`, the other 26-entry list in the same file, has
**no code consumer** — the only live read is
`for(const p of proof.source_pins)` in `scripts/linear-exit-install-operator.js`.

**Nothing was changed by this entry.** The 2026-09-13 file is untouched and
stays untouched.

### 2026-09-16 — STRUCTURAL FINDING, deliberately not fixed: a file that is both a dated receipt and a live gate deadlocks every time a pinned file changes

Recorded as an observed problem with a direction, at the owner's instruction.
**This is not B10 work, nothing here is implemented, and B10 is not widened by
it.**

**The problem, stated generally.** A document that serves two roles at once —
a **dated historical receipt** of a run that happened, and a **live source gate**
enforced against the current tree — has no correct state once any file it pins
changes. Editing it falsifies the receipt: the run it records never saw that
hash. Not editing it fails the gate. The two roles want opposite things from the
same bytes, and the conflict is guaranteed, not accidental: the gate's whole
purpose is to notice change, and the receipt's whole purpose is to not.

**This is not hypothetical and not only about this file.** It has now fired
three times on one file in one day, twice from work that had nothing to do with
B10. Every future change to any of those 26 pinned files reproduces it.

**Why it is worth writing down rather than absorbing.** The deadlock is silent
until an install is attempted, it surfaces as `fail('SOURCE_PIN')` with no
indication that the real cause is a role collision, and the tempting fix —
quietly updating the dated file — is the one that destroys the evidence. The
cost of the wrong move is not a failed run, it is a proof record that lies.

**Proposed direction, NOT implemented and not reviewed.** Separate the two
roles into two files:

- a **receipt** per run, dated, immutable once written, never read by any gate;
- a **current-source-pin list**, undated, explicitly a live gate, regenerated
  whenever a pinned file legitimately changes, carrying no claim about any past
  run.

The operator would read the second. The first would accumulate, one per run,
which is what evidence is supposed to do. The owner's decision above already
produces the first half of this shape by hand for one file: a new dated proof
plus a repointed read. The direction is to make that the general arrangement
rather than a per-incident manoeuvre.

**Open questions this direction does not answer, listed so nobody mistakes it
for a plan.** Which of the other dated proof manifests carry live gates as well,
and whether any of them is read by something this session did not find; whether
a repointed `source_pins` read should be pinned itself, and by what; and whether
the undated list wants review on each regeneration or is trusted as derived.
None of these were investigated. **No file was changed.**

### 2026-09-16 — B10 worked as far as this sandbox honestly allows: guard list, fixture, SEVEN pin sites, and the retirement blob regenerated on a real PostgreSQL 17. Lane GREEN, 46 checks

The half that was blocked is done. What remains is named at the bottom, with the
line stated plainly.

**PostgreSQL 17.11 was installed here from PGDG, with the owner's go-ahead
asked for and given before installing rather than after.** An isolated cluster
runs on `127.0.0.1`, ICU `en-US`, which is the collation the B9 derivation
settled on.

**What landed.**

1. `hiring_practical_test_jobs` added to the admission guard list in sorted
   position, 86 names to 87.
2. The shared fixture gained the hiring migration as an OWNERS entry, so the
   table exists. Not a `TABLES` seed entry — that was the wrong half on
   2026-09-15 and stays reverted; the guard needs the table to exist, not to be
   populated.
3. **Seven pin sites re-derived**, not four.
4. The retirement trigger contract blob regenerated from a real PostgreSQL 17.

**The retirement blob, regenerated rather than hand-patched.** The aggregate
query was extracted from the contract function's OWN source rather than
retyped, with `into actual` stripped, so nothing about it is a reimplementation.
The world was stood up by the retirement lane's own setup: the test file copied
with **exactly one line changed** (verified: 2 changed lines in a unified diff,
one removed and one added), replacing the first contract assert with a dump.

Result: **192 entries**, which is the number predicted before the run from
86 × 2 + 18 + 2. Two entries added, **none removed, and no existing entry
altered in any field** — checked by comparing on `(table, name)` both ways.
The two added:

| name | table | definition_md5 |
|---|---|---|
| `aaa_application_dml_admission_row` | `hiring_practical_test_jobs` | `b2e6546d40c6faa0d2503d5e2b546984` |
| `aaa_application_dml_admission_statement` | `hiring_practical_test_jobs` | `2518cbc38bb9ecc46a70c8ec349abd57` |

Both md5s came from the server, read whole from the command's output. Neither
was copied from a sibling, guessed, or adjusted until something stopped
objecting. The other five fields came out exactly as the 2026-09-16 entry
predicted from the contract's own definition.

**THE PROOF.** `test/linear-exit-retirement-switch-postgres.js` against that
PostgreSQL 17: **`LINEAR_EXIT_RETIREMENT_SWITCH_OK`, 46 checks**. This is the
lane that was red on `retirement_trigger_contract` and forced B10 out of the
catch-up on 2026-09-15. It is green with the table present.

**SEVEN pin sites, not four. The earlier estimate was short by three, and two
of the three were missed by the 2026-09-15 attempt as well.** Recorded because
"four pin re-derivations" is written into this file's own account of B10's
remaining work and is wrong.

| # | Site | Why |
|---|---|---|
| 1 | schema contract `.sources[]` | admission migration hash |
| 2 | release extension `sql_owners[]` | same |
| 3 | release extension `admission_preflight_contract` | schema contract hash |
| 4 | `CONTRACT_SHA` in the preflight | same |
| 5 | `PIN` in the release extension script | extension artifact hash |
| 6 | `control-retirement-public-owners.js` | retirement migration hash |
| 7 | `observed-full-install-plan.js` OWNERS | same |

Plus two the earlier attempt never reached, both found by TEST FAILURE, not by
reading:

| # | Site | Why | How found |
|---|---|---|---|
| 8 | `LINEAR_EXIT_SOURCE_BASELINE_CATALOG_V1.json` `.sources[]` **and** the `PIN` in `linear-exit-source-baseline-catalog.js` | the FIXTURE is a pinned source there | `SOURCE_BASELINE_SOURCE_DRIFT` |
| 9 | `test/linear-exit-complete-application-recovery.js` | pins the admission migration's hash inline | hash sweep |

**How 8 was found is the lesson, and it is the search rule again.** A sweep for
the two MIGRATION hashes found sites 6 and 7 and nothing else, and I believed
the set was closed. It was not: site 8 pins the *fixture*, whose hash I had
changed without ever sweeping for it. The suite caught it. **Neither of the two
migration edits would have revealed site 8** — only changing the fixture does,
and the 2026-09-15 attempt changed the fixture too and never hit it, because
that suite was not among the lanes it got to. A search of one shape closes
nothing; the second shape here was "run everything".

The extension artifact was regenerated with its own `generate()` and `verify()`
passes. Sites 1 to 5 reproduce the 2026-09-15 values byte for byte —
`454cfa64…`, `3288b4b5…`, `9c198325…`, each equal to what commit `0c923169`
removed — which is an independent confirmation of that work rather than a fresh
guess at it.

**Regression check, done properly rather than asserted.** Full suite with the
Postgres lanes enabled: **14 of 547 failed**. The same 14 fail **identically on
a clean control worktree** of the pushed branch head with the same environment
and the same server, so none is mine. They are sandbox failures, mostly
`git show <sha>:<file>` against history a shallow clone does not carry. Before
site 8 was fixed the count was 15; the extra one was site 8 and it is gone.
**Zero regressions.**

**Line endings were CHECKED at every edit, byte counted before and after, not
intended.**

| File | Kind | Before → after |
|---|---|---|
| admission migration | LF | 0 CR → 0 CR |
| fixture | **CRLF** | 82 → 86 CRLF, **0 lone LF** |
| retirement migration | **CRLF** | 296 → 296 CRLF, 3 → 3 lone LF |
| the four other code/JSON pins | LF | unchanged |

The fixture is the file that was silently flipped CRLF→LF on 2026-09-15, 168
lines of collateral change for a 4-line addition. This time the diff is **4
insertions, 0 deletions.** The flip did not recur.

---

### Where the line fell, and why it is there

**Everything below needs the private observed inputs, which only the storage
session can read. It is not a reluctance and not an effort problem.**

**1. The three profile pins are NOT re-pinned here, deliberately.** Measured,
final, with both migrations edited:

| Profile | Pinned in the file today | Measured after B10 |
|---|---|---|
| `observed67` | `3c000b76…` | `7043637f…` |
| `observed67_optout` | `0c889149…` | `92a4737f…` |
| `settled68` | `e3dae746…` | `508e6369…` |

The control run on the clean worktree reproduced all three **pinned** values
exactly, which is what makes these three trustworthy as measurements.

They are left unpinned on purpose. Pinning is the owner's reviewed step after
seeing the numbers — that is the precedent `settled68` itself set — and a new
plan hash beside a stale target would look re-pinned while being half-updated.
Left as they are, the operator refuses at `PLAN`, which is correct fail-closed
behavior and an accurate signal that the profile needs re-deriving.

**2. The three TARGET hashes cannot be derived here at all.** A target comes
from a real install run of the new plan against the private observed inputs in
`2026-09-12-fast-finish-evidence`. `settled68`'s `625430…` is superseded as the
entry above predicted in advance.

**3. A THIRD item, not previously recorded anywhere.**
`docs/independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` is
simultaneously a dated proof record and a **live gate**: the install operator
runs `for(const p of proof.source_pins) if(sha(file)!==p.sha256) fail('SOURCE_PIN')`
against the current files. Its `source_pins` carries the retirement migration's
old hash, and its `plan_sha256` and `target_sha256` are the superseded
`observed67` pair.

**I did not edit it, and this needs the owner's decision.** Updating a dated
proof record's pins would make the 2026-09-13 run claim a source hash it never
saw, which is rewriting history, and this file's own account says historical
pins keep their historical meaning. But left alone it fails `SOURCE_PIN` at
step 14. Those are the two horns; I am not choosing between them unilaterally.
My reading is that the 2026-09-13 pipeline proof is invalidated by B10 and
wants re-running on the storage session rather than editing, but that is a
recommendation, not a decision.

The four other stale references — two in
`LINEAR_EXIT_CONTROL_RETIREMENT_PROOF_20260913.json`, one in
`LINEAR_EXIT_RETIREMENT_SWITCH_PG17_20260913.json`, one in
`LINEAR_EXIT_CONSOLIDATED_CHECKPOINT_20260912.md` — are dated evidence with no
live consumer found, and were left for the same reason.

**What B10 does NOT need, restated so it is not re-opened.** No hosted anything,
no SQL against production, no deploy, no dispatch. Nothing here lifts the
freeze; this lands on the branch.

### 2026-09-16 — B10 will supersede the `settled68` target pinned at `c34c7e31`, and both other profiles' plan pins. Recorded IN ADVANCE, by measurement, before the change is made

Written before doing the work so the next reader meets an expected supersession
rather than an unexplained mismatch. **Nothing in the existing pin entry is
edited or removed**; this stands below it, per the append rule.

**The finding.** Both files B10 must edit are install-plan SOURCES. So B10 does
not merely add a table to a guard list: it moves the plan SHA-256 of **all
three** profiles, and with it every derived target.

- `20260912183653_application_dml_admission_preparation.sql` is `sql_owners`
  order 2 in the admission release extension, which
  `linear-exit-observed-install-plan.js` reads into `plan.sources`.
- `20260913062149_retirement_switch_preparation.sql` is the last entry in
  `linear-exit-observed-full-install-plan.js` `OWNERS`, read into the same
  `plan.sources`.

Both files' full SQL text is embedded in `planBytes`, so `planSha256` is a
function of their bytes.

**Measured, not read off the builders.** The real builder was run; the only
thing stubbed was the starting-catalog gate, which needs a private artifact
this sandbox does not hold. The same stub was applied to every run, so it
cancels out of a before/after comparison. The stub's honesty is checkable:
with the pre-B10 bytes the builder reproduced **all three pinned plan hashes
exactly**, which it could only do if everything except the gate was real.

| Profile | Pinned today | After B10's guard-list edit alone |
|---|---|---|
| `observed67` | `3c000b76…` | `9207e685…` |
| `observed67_optout` | `0c889149…` | `4d1879c8…` |
| `settled68` | `e3dae746…` | `fed2d004…` |

That is from the guard-list edit **alone**. The regenerated retirement trigger
blob edits the second plan source and will move all three again.

**The target moves with the plan**, also measured rather than inferred.
`linear-exit-observed-full-target.js` `create()` writes `plan_sha256` into the
target object, so the target bytes carry the plan hash. Building the real
target from each plan with an identical synthetic catalog: target
`78275009…` before, `265a7a20…` after. Plan moved true, target moved true.

**So `profiles.settled68.target` `625430…`, pinned at `c34c7e31`, is stale the
moment B10 lands.** It is not wrong today and it was not wrongly derived. It
was measured correctly against the plan that existed when it was measured, and
B10 changes that plan. This is supersession, not a defect, and the pin above
should be read that way.

**The re-measurement cannot happen in this sandbox, and this is not a
reluctance.** The target is produced by a real install run of the new plan, and
that run needs the private observed inputs from
`2026-09-12-fast-finish-evidence`. Those live on the owner's Windows machine
and only the **storage session** can read them. The cloud session can re-derive
every PLAN hash here — it just did — but the three TARGET hashes must be
re-measured there, by the storage session, on PostgreSQL 17, and read whole
from the run. Writing a plausible target here would be exactly the silencing
D8 forbids.

**One thing B10 does NOT invalidate, stated so nobody re-opens it.** The
post-install public table count of **91** survives. Measured in the same pair
of runs: 90 before and 90 after for `observed67`, unchanged, because B10 adds
no table to what the installation CREATES. It adds a name to a guard list over
tables that already exist. The derivation behind 91 stands.

**A correction to this file's own B10 reasoning, kept below the original per
the append rule.** The 2026-09-16 entry "B10's retirement-contract half"
states the guard "creates exactly one `aaa_application_dml_admission_statement`
trigger per table it guards", and gives the shape of ONE new contract entry.
That is wrong. The loop issues **two** `create trigger` statements per table,
`_statement` and `_row`, and the frozen blob confirms it. The checkpoint's
"adds two triggers" is the correct version.

The blob's numbers, counted and reconciled from both directions before anything
was touched, because a regeneration cannot be verified against a count nobody
is sure of:

| | |
|---|---|
| Guard list tables | 86, unique, sorted |
| `create trigger` per table | 2 |
| Admission triggers in the blob | 172 |
| Non-admission triggers in the blob | 18 |
| **Blob total** | **190** |

86 × 2 + 18 = 190. The 18 are not admission triggers at all: the contract's
aggregate has a second arm, `relname in (six named tables)`, contributing 14 on
`mirror_outbox`, 2 on `production_label_catalog_versions`, 1 on
`production_intake_manifests` and 1 on `card_write_transaction_context_v1`.
Closed from the other direction too: every table in the blob is either in the
guard list or one of the six named, with no strays, and the guard list's 86
names equal the blob's 86 admission tables exactly.

**So the regeneration target is 192 entries, not 191.** That is the number the
regenerated blob is checked against.

**Line endings were CHECKED, not merely intended.** Measured with `file` and a
CR count before editing: `20260912183653_…admission_preparation.sql` is **LF**
and was edited with a single in-place substitution that left the CR count at 0;
`20260913062149_retirement_switch_preparation.sql` and
`test/helpers/remaining-application-fixture.js` are both **CRLF** and any edit
to them preserves that. This is the trap recorded on 2026-09-15, when a Python
rewrite silently flipped the fixture to LF, 168 lines of collateral change for
a 4-line addition, invisible in a rendered diff and capable of breaking a hash
pin on the file.

**Independent cross-check of the edit itself.** The guard-list addition made
here reproduces the reverted 2026-09-15 work byte for byte: migration
`454cfa64…`, schema contract `3288b4b5…`, release extension `9c198325…` —
each equal to the value commit `0c923169` removed. The extension was
regenerated with its own `generate()`, never hand-edited, and `verify()`
passes.

### 2026-09-16 — The checkpoint was brought up to date so a session that has never seen this conversation can take over from the file alone

Written from this record and the execution map rather than from anyone's summary
of them, because the file should descend from the record and not from a
retelling of it. Additive: 157 lines added, one line deleted and immediately
re-added with a B9 closure clause appended, so no existing constraint was
dropped. The journal and the execution map were not restructured.

What the checkpoint now carries that it did not: the three-session arrangement
and what each session can and cannot reach, with the two consequences that cost
us something today (a session must not state as fact what only another session
can see; a reviewer's correction is a hypothesis); the standing constraints in
one place, including the frozen main SHA, the gates, Linear being untouched and
its retirement out of scope, the single n8n change needing its own approval, the
test client, and reporting a permission denial rather than working around it;
where the work stands, phase 2 of 7 and step 7 of 28 with step 8 next; a closure
table for today with each closure's evidence AND its stated limit; what is open,
with B10 named as next and the D12 ordering explaining why it was held; and the
working rules this record earned, in the form a stranger can use.

Also recorded there, because it is operationally load-bearing and was not
written down anywhere: the supervisor reply channel does not work yet. A message
fired into the Routine reached nothing and a message sent from that session
never arrived, so delivery failed in both directions on 2026-09-16.

REPO_MAP's three ambiguous entries were rewritten in the same pass, from
present-tense claims into statements of what each document records, each with
one clause naming what has changed since. That is the shape the owner ratified:
a map entry describing a document should not assert a present state it cannot
keep current.

### 2026-09-16 — REPO_MAP corrected where today's work made it state the opposite of the truth

A fresh session reads the map first, so a line there that confidently describes
a world that no longer exists is the most expensive kind of stale document we
keep. Three lines were plainly wrong and are corrected:

- the runner settled-world proposal, described as "not applied — the operator
  test runner has no settled68 branch". It was applied today; the runner carries
  the per-profile table and `settled68` adds the hiring migration.
- the settled contract, described as "NOT yet wired into the loader and nothing
  is built on it until its bytes are confirmed". The bytes were confirmed and it
  is the `settled68` contract in the loader. The replacement says the profile is
  pinned on both values and points at D17 for the target pin still being
  provisional, so the correction does not overstate in the other direction.
- the byte-pinned line-ending check, described as 97 pins over 98 files.
  Measured today: 98 pins, 99 files, the one addition being the settled
  contract's own pin.

**Reported rather than edited, because each describes a document's subject
rather than the state of the code, and the distinction is exactly what a map
gets wrong:**

- the B9 re-derivation entry ends "the knock-on to the install operator's
  hard-coded post-install table count". The operator no longer hard-codes it.
  True of what the document discusses, false as a present-tense claim.
- the guard-count sites entry calls them "the nine places the post-install
  public table count is restated as a literal". Several are now derived.
- the session C entry describes the two never-executed blocks it carries; both
  have since been run.

**Outside this file and left alone:** the `AGENTS.md` exemption-list rule quotes
the same 97 and 98. The rule does not depend on the numbers, and its text is
owner-ratified, so it is named here rather than edited.

### 2026-09-16 — `settled68` calibration RAN: post-install public tables 91, equal to the derivation; target measured, NOT pinned

**The last untested number in the chain has been tested.** The derivation (the
measured live 68 plus an install-created 23) was made once. This run is its
test, and it reports **91**. Nothing was adjusted before or after:
`INSTALL_CREATED_PUBLIC_TABLES` and the mapping were untouched, there was no
re-derivation, and the run was not repeated.

**What was run.** The reviewed `run-portable.ps1 -Lane install-operator`, from
the checkout at exactly
**`cd6f1808dc23141ce1bd3298a5f8ccd6ec608905`**, on the owner's machine.

- Cluster: PostgreSQL 17, ICU `en-US`, on `127.0.0.1`, libc `--locale=C`,
  password auth.
- Private observed inputs from `2026-09-12-fast-finish-evidence`.
- `INSTALL_OPERATOR_PROFILE=settled68` and `INSTALL_OPERATOR_CALIBRATE=1` as
  process environment, and no `INSTALL_OPERATOR_TARGET`.
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` cleared in that
  process only.
- The only code change since the neutrality check at `b600a747` is one line
  inside the calibrate branch of the worker, naming the target file after its
  profile. It was read before running.

**The chain, stage by stage, all executed.**

1. Observed-schema reconstruction: `exact_captured_catalog_match: true`.
2. The runner's `SETUP` row applied the opt-out prerequisite, the fixture and
   the hiring migration from main.
3. The `settled68` builder accepted the starting catalog as `ddfa4c4f…`.
4. Install under maintenance.
5. **The worker's assertion that the maintenance guard count equals
   `postInstallPublicTables(...).expected` passed.** The derived value it
   asserted against, measured by calling the same function:
   `{"contract":"settled68","pre_install":68,"created":23,"expected":91}`.
6. `targetApi.create()`'s table-count assertion passed.
7. Finalization ran.
8. The runner printed `LINEAR_EXIT_INSTALL_OPERATOR_OK`, exit 0, and the
   cluster stopped (no `postmaster.pid`).

**The measured values, each copied whole from the files, not from the run's
own report:**

| Item | Value |
|---|---|
| File written | **`settled68-target.private.json`**, named after the profile, so the profile reached the writer |
| **Post-install public table count** | **91** (`target.catalog.tables.length`) |
| **Target SHA-256** | **`625430979c5508f2a87b18bfa9d7135806273c909c3f5baf9f5a5fe835f97356`** |
| **Target byte length** | **1,613,093** |
| **Plan it ran under** | **`e3dae746b148fe18839209445e8b2142372335b18127430ba2d827f13cd27d54`**: the plan file, `operator-result.plan_sha256`, `target.plan_sha256` and the pinned `settled68` plan all equal |
| Plan's starting catalog | `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c` |
| Stage | `OBSERVED_PUBLIC_20260916_SETTLED_FULL_PREPARATION_V1` |
| Installed public catalog SHA-256 | `0d4eb7dc7993f48cdc86131893443b0ba7eea3ddd9ca50da8bcb89b167e3d91e` |
| Installed private catalog SHA-256 | `fccae16ac7200ac82369f73449512d21f762b86b53bdb306fba172388bbc2401` |
| Operator result | `CALIBRATION_ONLY`, `target_sha256` equal to the file's measured SHA-256, `activation_performed: false` |
| Target flags | `installation_authorized: false`, `hosted_target_verified: false` |

**Not pinned.** `profiles.settled68.target` remains `null`; pinning is the
owner's reviewed step after seeing these numbers. The target file stays in the
private evidence directory
(`linear-exit-install-operator-38a3b52acf654a87b2b55ac63fd5b4d4`) and is not
committed.

**How the chain behind 91 now stands.** The 90 was measured by the opt-out
neutrality pair against `d3cbca7f`'s literal. The 91 is now measured by a real
settled install. The chain's earlier weak links were the single-party reading
that the plan's source list is identical across profiles, and the unconfirmed
86-plus-4 decomposition. **Both are now bounded by observation:** a settled
install created exactly 23 tables on top of 68. That is a measurement for this
plan and this world. It does not make 23 a universal constant, and the comment
in the code already says so.

**Isolated, not hosted.** This is a PostgreSQL 17 install reconstructed from the
private inputs. It is not a hosted installation and not an authorization. Steps
9 onward have not run.

### 2026-09-16 — Neutrality check PASSED for both profiles at `b600a747`; the fix changed what gets checked, not what gets built; calibration still not run

**What was run.** Four runs of the reviewed
`run-portable.ps1 -Lane install-operator` on the owner's machine, with
PostgreSQL 17, ICU `en-US` on loopback and the private observed inputs. The
after tree was the checkout at exactly `b600a747`.

| Profile | Before | After |
|---|---|---|
| `observed67` | worktree at `05bf19f6` | `b600a747` |
| `observed67_optout` | worktree at **`d3cbca7f`**, the parent of `8299108` and the last clean opt-out state | `b600a747` |

The opt-out baseline was corrected by the owner. `05bf19f6` already carries the
`8299108` regression, so comparing against it could only show that the fix
unbroke something, not whether the artifacts moved. Same pinned opt-out target
(`79710a7f…`) and the same per-process environment clearing as before.

**Flagged BEFORE the runs, not after: the pin record differs in three entries,
not one.** `operator-source-pins.private.json` records the SHA-256 of four
files. By git blob ID, in **both** pairs the installer
(`scripts/linear-exit-install-operator.js`), the runner and the worker changed,
and `scripts/linear-exit-install-profiles.js` did not. So the whole pin record
was declared the known exception, reported entry by entry, and any other
differing byte was declared a stop.

**Result: `UNEXPECTED_DIFFERENCES=false`. All four runs exit 0.**

`observed67`, `05bf19f6` against `b600a747`:

- File sets identical.
- **Plan
  `3c000b76db5cf6dc31a90b61ad7dc7751d6ce02c74b6d40939dbbcccbe6acbfb`, identical.**
- Operator result byte-identical: `PASS`, `exact_final_target: true`,
  `exact_finalized_replay: true`, `zero_guards: true`.
- Worker output, reconstruction report and catalog, prerequisite file,
  `RESULT.txt` and markers byte-identical.
- Pin record: installer `1228be2b…` to `55f0cd6e…`, runner `0adb40d5…` to
  `04948adb…`, worker `6d8de859…` to `049c3a1c…`. `install-profiles.js`
  unchanged at `64296f5f…`.

`observed67_optout`, `d3cbca7f` against `b600a747`: **it completes again.**

- File sets identical.
- **Plan
  `0c88914972800f8268a9a5857535ca8cb624f6b25460b19b34091ea4b58ced57`, identical.**
- Operator result byte-identical: `PASS`, `exact_final_target: true`,
  `exact_finalized_replay: true`, `zero_guards: true`,
  `populated_optout_preserved: true`.
- Worker output, reconstruction report and catalog, prerequisite file,
  `RESULT.txt` and markers byte-identical.
- Pin record: installer `d8cafa56…` to `55f0cd6e…`, runner `0adb40d5…` to
  `04948adb…`, worker `c83daaba…` to `049c3a1c…`. `install-profiles.js`
  unchanged.

**What this establishes.** `87611aa2` and `b600a747` resolve the opt-out
world's count from its starting hash to the `observed67` contract's 90. They
move that resolution into `load()`, and add the `PREPARED_SHAPE` guard. Those
changes plus the `808bca20` runner table leave **everything the installer
builds and emits byte-identical**, including the target match, for both
existing profiles, measured against a real PostgreSQL 17 install from the
private inputs. **The fix changed what gets checked, not what gets built.**

**What it does not establish.**

- The `settled68` calibration has still not run, and the derived **91** is
  still untested. By instruction, the calibration runs only after both profiles
  pass, and it was not started in this sitting.
- The early refusal in `load()` and the `PREPARED_SHAPE` guard were not
  exercised on a failing input here. Every run was a passing profile. The
  supervisor verified them offline.

Run directories, all under the private evidence directory:
`linear-exit-install-operator-525619b9ddb24ce8abef7f36fe5631ad` and
`-fbc02a0cfe9c488aada27ee3ac767110` (`observed67`, before and after), and
`-734325f8adb142feb1f54fa66fc2ca04` and `-ede25d0b14ee46c681e09b18bc234ae2`
(opt-out, before and after). Worktrees are left at
`2026-09-16-runner-before-05bf19f6` and `2026-09-16-optout-before-d3cbca7f`.
Nothing was re-pinned or edited.

### 2026-09-16 — Runner-table neutrality check STOPPED on differences; the check exposed that `observed67_optout` has been broken since `8299108`; calibration NOT run

**What was asked.** Confirm the runner change in `808bca20`, which turned line
10's single `if` into a per-profile `SETUP` table, is behaviourally neutral for
the two existing profiles. Run each profile before and after, and require
identical results; if they differ in any way, stop and report. Only then run
the `settled68` calibration.

**How.** Both runs used the reviewed `run-portable.ps1 -Lane install-operator`
on the owner's machine, with PostgreSQL 17, ICU `en-US` on loopback and the
private observed inputs:

- **Before:** a separate git worktree at `05bf19f6`, the parent of
  `808bca20`, at `D:/Sidney/Codex/2026-09-16-runner-before-05bf19f6`.
- **After:** the checkout at `808bca20`.
- **Differences between the trees:** `git diff --stat` shows exactly one code
  file, the runner. `run-portable.ps1` and the Deno worker are byte-identical.
- **`observed67_optout`** was given `INSTALL_OPERATOR_TARGET` pointing at its
  pinned target from calibration `e7df95d7…` (sha `79710a7f…`, verified).
  `observed67` used the target in the observed inputs (`f3db4b7c…`, verified).
- **Environment:** `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` were
  cleared in each run's own process only (names only).
- **What "identical" meant, fixed before any run:** plan, operator result,
  worker output, reconstruction report and catalog, prerequisite file,
  `RESULT.txt` and log markers compared byte for byte. The source-pin record was
  declared in advance to differ by construction, because it records the
  runner's own hash.

**`observed67`: exit 0 on both sides.**

- **Identical:** plan `3c000b76…`, operator result, worker output,
  reconstruction report and catalog, prerequisite, `RESULT.txt`, and markers
  (`LINEAR_EXIT_OBSERVED_SCHEMA_OK`, `LINEAR_EXIT_INSTALL_OPERATOR_OK`).
- **Different:** only `operator-source-pins.private.json`. The runner sha is
  `0adb40d5…` before and `04948adb…` after, the declared by-construction
  difference.

**`observed67_optout`: exit 1 on BOTH sides, at the same point.**

- **Identical:** plan `0c889149…`, which is the pinned opt-out plan, so the
  prerequisite and the fixture row were applied in both. Also the
  reconstruction files, the prerequisite and `RESULT.txt`.
- **Different:** `operator-worker.private.json`, by 4 bytes. At its first
  divergence the difference is the repository path inside the stack trace,
  which appears twice and is two characters longer in the after tree. The rest
  of the file was not checked beyond that point.
- **Where both refused:** the worker's read-only observation and its
  wrong-identity refusal both passed. The real APPLY at worker line 20 then
  threw `INSTALL_OPERATOR_EXECUTION_REFUSED` from
  `scripts/linear-exit-install-operator.js:39`.

**Per the owner's rule, stopped on the differences and did not decide whether
they matter.** Two differences: the by-construction source-pin record, and the
environmental path in the worker's stack trace. **The calibration was NOT run.**

**The finding the neutrality check exposed: `observed67_optout` is broken, and
was broken before this runner change.** It passed on 2026-09-14 (verification
`b2498e97`). Measured with no database, calling the pure function that reads
only committed contracts:

```
ARTIFACTS ["observed67","settled68"]
observed67         {"contract":"observed67","pre_install":67,"created":23,"expected":90}
observed67_optout  THROWS OBSERVED_CATALOG_UNKNOWN_STARTING_CATALOG
settled68          {"contract":"settled68","pre_install":68,"created":23,"expected":91}
```

The same throw was measured at `05bf19f6`, which contains `8299108`. The
opt-out plan declares its starting catalog as `f5ed8a38…` (the profile builder
sets it). `postInstallPublicTables()` looks that hash up among the contracts in
`ARTIFACTS`, and there is **no contract for the opt-out catalog**. The installer
calls it during the install: line 35 for the guard count, and through
`targetApi.compare()` at line 37. **Line 39's `catch` then replaces the real
error with the generic `INSTALL_OPERATOR_EXECUTION_REFUSED`**, which is why the
failure did not name its cause. The worker does not record `operatorStage`, so
whether line 35 or line 37 threw first is **read from the code, not observed**.

**So `8299108` (Group 1, "sites 1, 2 and 3 derive the post-install count from
the profile's contract") fixed `observed67` and `settled68` and silently broke
`observed67_optout`.** That profile's starting catalog is not a contract, it is
a reversed delta on top of one. Group 1's offline tests could not see this; the
journal records that sites 1 and 3 were reachable only through a real install
or calibration. This was the first real install of that profile since.

**What this means for the gate, and what is still owed:**

- The runner change is **shown neutral for `observed67`**, apart from the
  declared pin difference.
- For `observed67_optout` it is **shown identical up to and including the
  plan**, and both runs fail after that on a pre-existing defect. Neutrality
  past the APPLY cannot be shown until that defect is fixed.
- **The `settled68` calibration has still never run.** The derived 91 is
  untested. The probe shows the helper returns 91 for the settled catalog, but
  that is the derivation, not its test.
- **Owner decision needed:** whether `observed67_optout` gets a
  `postInstallPublicTables()` answer (for example, a contract entry or an
  explicit mapping to its 67-table base), and whether the calibration may
  proceed before that fix or only after the neutrality check passes for both
  profiles.

Nothing was re-pinned or edited. The before worktree is left in place for any
re-run. All four run directories are preserved under the private evidence
directory:
`linear-exit-install-operator-ec97f57dfa384994acc17008d180bda2` and
`-f7c6984408f94612ae5d5ee0ef65dc0e` (`observed67`, before and after), and
`-087dc40f11f94182808b6af75c62e90b` and `-83486a5cddcf4ad99601c15ffc8567e7`
(opt-out, before and after).

### 2026-09-16 — The prose-precondition rule was ratified and added to AGENTS.md, discriminator intact

The owner ratified the rule proposed earlier today (section below, headed
PROPOSED rule, not added — left as written; this entry supersedes its status
rather than editing it). His words on why it was accepted in the shape it was
delivered:

> Adding the guard in front of the reviewed command rather than replacing it was
> the right shape.

And on what makes the rule usable:

> the discriminator is the reason. Add it to AGENTS.md with the three rows
> intact, because the rule without them flags everything and gets ignored.

So the AGENTS.md entry carries the three-row table verbatim, not a summary of
it. A rule that says "prose is not a check" with no test for when that matters
condemns every sentence in `docs/ops/` that describes what a step needs, which
is most of them, and a rule that fires on everything is a rule nobody runs.
The discriminator is the half that took the sweep to find: the question is not
whether *this block* checks the precondition — most blocks call a wrapper or a
lane that enforces its own — but whether **anything anywhere** enforces it.

Kept here rather than in AGENTS.md, per the owner's instruction: the sweep's
per-candidate reasoning, already recorded below at full length for both shapes
(45 and 15 candidates) including the negative results. A sweep that reports a
count has done the easy half. The count is not the evidence; the per-candidate
verdicts are, and they are what a later session needs in order to disagree with
one of them.

Nothing else moved in this pass. The calibration and the runner
before-and-after confirmation are the local session's, and are still outstanding
at the time of writing.

### 2026-09-16 — Recovery command brought up to its own prose; runner table applied; PROPOSED rule on prose preconditions, with the sweep behind it

### The recovery fix, and why it is not a change to a reviewed document

The owner's reasoning, which is right and worth stating in his terms. The
document already says, at line 47:

> 1. **From a clean checkout of the current main** create a recovery branch.

And the command underneath it said:

```powershell
git switch -c recovery/linear-exit-browser origin/main
```

**The reviewed decision is in the prose. The command simply does not do what the
document says.** `origin/main` is only as current as the last fetch. Making it
fetch is bringing the command up to an intent that was already reviewed, not
changing the intent.

Fail-closed, not merely fetching, because a recovery is exactly when a network
problem is plausible and exactly when a silent fall back to a stale local ref
would happen:

```powershell
git fetch origin main
if ($LASTEXITCODE -ne 0) {
  throw "REFUSING: could not fetch origin/main. Do not continue on the local ref; it may be stale, and publishing from a stale main reverts every merge since it."
}
"branching from: " + (git rev-parse origin/main).Trim() + "  " + (git log -1 --format='%ci %s' origin/main)
```

It prints the resolved commit and its subject, so whoever is running it can see
what they are about to branch from. **Both paths verified by execution**: the
happy path resolved `1abdd1fa…` with its commit line, and an unreachable remote
produced the refusal at exit 128.

### The runner change, applied

Line 10's single `if` is now a per-profile table:

```js
const SETUP={observed67:{optout:false,hiring:false},observed67_optout:{optout:true,hiring:false},settled68:{optout:true,hiring:true}};
```

`observed67` false/false and `observed67_optout` true/false are exactly their
existing behaviour, checked. `settled68` adds the hiring migration from main.
**The before-and-after confirmation needs the private inputs and goes to the
local session** with the calibration re-run, as the owner directed.

### PROPOSED rule, not added: prose stating a precondition is not a check of it

Three instances in one day, which is what makes it a pattern rather than three
mistakes:

1. The sitting page **asserted every path was absolute** and then used a
   relative one.
2. The capture section **ordered a STOP unless a scratch server reported
   stopped**, for a wrapper that has none.
3. The recovery procedure **named "the current main"** and then branched from
   whatever `origin/main` happened to be.

> **A sentence describing a property is not a check of that property.** Prose
> stating a precondition is the most convincing possible way to fail to enforce
> it: it reassures the reader and the author that the matter is handled, and it
> reads exactly like a guarantee while guaranteeing nothing. When a document
> names a precondition, either something must enforce it or the document must
> say plainly that the reader is the enforcement.

**The discriminator, which the sweep produced and which the rule needs to be
usable.** "The block contains no check" is not the test — most blocks here call
a wrapper or a lane that enforces its own preconditions, and that is fine. The
test is whether **anything anywhere** enforces it:

| | verdict |
|---|---|
| prose precondition + a callee that enforces it | fine |
| prose precondition + a human decision nothing could check | fine, if the document says the reader is the check |
| prose precondition + an unguarded primitive | **defect** |

`git switch -c … origin/main` is the third row: git will branch from a stale ref
without complaint, and there is no callee to catch it.

### The sweep, two shapes, and an honest result

**Shape A**: precondition language in the prose above a block, with no check in
the block — 45 candidates. **Shape B**, deliberately different: blocks whose
first act *mutates* with no validation anywhere in them — 15.

Hand-checked every candidate on a live operational path. **One real defect, the
one already fixed.** The rest fall in the first two rows above:

- `LINEAR_EXIT_RECOVERY_PROCEDURE.md` block@101 — `gh workflow run … --ref main`
  resolves the ref **server-side**, so staleness does not arise; its prose
  preconditions ("verify all 13", "after explicit recovery authorization") are
  human decisions with nothing machine-checkable.
- `LINEAR_EXIT_INSTALLATION_DAY_20260914.md` block@51 — calls the same three
  wrappers, and **the wrappers enforce their own preconditions.** Checked
  specifically, and reported as a negative result: **it does not repeat the four
  claims corrected on the sitting page today.** Those were the sitting page's
  own invention, not inherited.
- The F27 runbook's `gh workflow run` blocks — the deploy lanes **fail closed**
  on a fingerprint mismatch.
- Most of the remaining shape-A hits are ledger prose in `OPEN_REPAIRS.md`,
  not instructions anyone runs.

**So: swept, one found, and the reason the rest are not defects is written down
rather than left as a count.** A sweep that reports "45 candidates" and stops
has done the easy half.

### 2026-09-16 — B5 dry run PASSED under PowerShell 7.6.6 after an owner-approved install; this fixes the machine, NOT the block

**What was done, owner-approved, on the owner's machine.**

- `winget install --id Microsoft.PowerShell --source winget` exited 0 and
  reported version 7.6.6.0. That is the installer's claim. **Measured
  separately**, in a fresh `pwsh` process: `$PSVersionTable.PSVersion` =
  **7.6.6**. It installed as a Store/MSIX package
  (`C:\Program Files\WindowsApps\Microsoft.PowerShell_7.6.6.0_x64__8wekyb3d8bbwe\pwsh.exe`,
  launched through the `WindowsApps\pwsh.exe` alias), not under
  `Program Files\PowerShell\7`.
- **`main` fetched explicitly first.** `origin/main` moved from `73d5fdc3` to
  `1abdd1fa4b00f35f69c08e6ada2c1fc48dd3d052`, equal to `ls-remote`.

**The dry run, section 2's block verbatim except `UNIQUE`,** run from the
repository checkout into a new directory:

- First run (`b5-dryrun-20260916-2`): passed. But the shell-version line
  prepended to it failed on the session's own inline quoting, so for that
  process the version was inferred, not measured.
- **Second run (`b5-dryrun-20260916-3`), which is the one that counts.** It ran
  from a script file that prints the version in the same process as the block:

```
shell_PSVersion=7.6.6 edition=Core
main 1abdd1fa4b00f35f69c08e6ada2c1fc48dd3d052, 23 files expected
extracted 23 files
index.html sha256: 1d17a0f567071dd9a8ff70dd73244fc819614725c960fee95bbbb9b639979327
```

- **Expected hash checked independently, not taken from the page:**
  `index.html` at `1abdd1fa`, written straight to a file without a PowerShell
  pipe, hashes to `1d17a0f5…` (5,573,035 bytes, equal to git's blob size).

**What is now proven, on this machine under PowerShell 7.6.6:**

- `tar.exe` is present (bsdtar 3.8.8).
- The `git archive … | tar` pipe carries bytes intact.
- The file array reaches `git` as separate arguments: 23 expected, 23
  extracted.
- `git archive` reproduces main's `index.html` bytes exactly.

**What is still NOT proven:**

- **The real B5 capture has never run.** Its download from the live site and
  the served-against-git comparison are unexercised, by design until
  immediately before the exit merge.
- **Nothing makes step 16 use PowerShell 7.** Opened in Windows PowerShell 5.1,
  the block fails exactly as it did earlier today.
- **The block does not fetch `main` itself.** It trusts the checkout's
  `origin/main`, which was stale here until fetched by hand.

**The distinction the owner asked to keep, and it is the whole point.
Installing PowerShell 7 fixes THIS MACHINE, not THE BLOCK.** The block still
runs under Windows PowerShell 5.1 anywhere else and mangles the byte stream it
pipes. Here, under 5.1, it happened to fail loudly, because `tar` rejected the
corrupted stream. The block has no check of its own that it is running in a
shell that preserves bytes. So a machine that "has PowerShell" is not evidence
that the block will work. The owner has asked the cloud session to make the
block **refuse** under 5.1 rather than rely on the operator opening the right
shell. Until that change lands, this pass is a fact about one machine and one
shell, and it must not be quoted as the block being safe.

The runner change for the calibration and the four sitting-page corrections are
the cloud session's work. Nothing else was done tonight.

### 2026-09-16 — Session C fallout: runner proposal written, stale-reference sweep done, four page disagreements corrected from the wrappers, B5 shell guard added

Four pieces, sequenced as the owner asked rather than bundled.

### 1. Runner change — PROPOSED, NOT APPLIED

[`LINEAR_EXIT_RUNNER_SETTLED_WORLD_PROPOSAL.md`](LINEAR_EXIT_RUNNER_SETTLED_WORLD_PROPOSAL.md).

The refusal was the profile builder doing its job; **the runner is what is
incomplete.** Line 10 applies the extra setup for `observed67_optout` only,
there is no `settled68` branch, so the hiring migration is never applied and the
builder correctly refuses a catalog that is not the settled world.

The recipe does not need inventing — it is already proven in
`scripts/linear-exit-b9-catalog-derive.js`, which built the catalog the owner
byte-verified. **`settled68` is the opt-out world plus one migration.** The
proposal makes line 10 a small per-profile table rather than a third `if`, for
the same reason the guard counts stopped being literals: the next profile should
be a row, not a branch.

**Effect on the existing two paths: none**, and the proposal says how to confirm
that rather than assert it — run both before and after and require identical
results, which needs the private inputs and so belongs to whoever applies it.

It also says what it does **not** fix: it does not make the calibration runnable
in the cloud session, and it does not test the 91 derivation. It makes the test
possible.

### 2. Stale-reference sweep — three real defects, one of them worse than B5

Two search shapes, as the rule now requires. Shape A named remote refs; shape B
looked for **commands that read a ref** — `rev-parse`, `ls-tree`, `show`,
`archive`, `cat-file`, `diff`, `log`, `merge-base`, `describe` — in a block or
script with no `fetch` or `pull` anywhere in it. Fifteen hits, triaged, because
a hit is not a defect.

**Real, and of the class we have spent the day on — a wrong answer that looks
right:**

1. `LINEAR_EXIT_OWNER_SITTING_20260915.md`, the B5 capture block.
2. `LINEAR_EXIT_SESSION_C_20260916.md`, the B5 dry run.
3. **`LINEAR_EXIT_RECOVERY_PROCEDURE.md`, and it is worse than the other two.**
   `git switch -c recovery/linear-exit-browser origin/main`. The other two
   **read** a stale ref; this one **writes** from it. During a real recovery, on
   a checkout that has not fetched, it branches from an old main and publishes
   it — **silently reverting everything merged since**. It is also the one block
   you reach for when things are already going wrong. Its prose says "from a
   clean checkout of the current main", which is exactly the kind of sentence
   that does not make a ref current.

**Fail-closed, so not this class:** `scripts/f27-reconciler-closure.js` uses
`origin/main` as an equality gate and a stale ref makes it **refuse**
(`RELEASE_ORIGIN_MAIN_MISMATCH`), not approve. Five tests read it and would fail
loudly.

**Not applicable:** six CI workflows. `actions/checkout` performs the fetch as
part of the checkout, so the ref is current by construction.

**Fixed: 1 and 2**, since both blocks were already open for the shell guard.
**Reported and NOT fixed: 3.** The recovery procedure is a reviewed recovery
document and editing it unasked is the thing this session has been told not to
do. **It wants a decision.**

### 3. The four page-versus-wrapper disagreements — corrected from the wrappers

All four, with the wrapper as the authority and the old wording quoted so the
correction is visible rather than silent.

1. **The capture block would have aborted the sitting on success.** The page
   required "the scratch server is reported stopped" and ordered a **STOP** if
   it was not. The capture wrapper **starts no scratch server**. Now it expects
   the wrapper's real output and says plainly not to look for one.
2. **Restore**: the page waited for a line the wrapper never prints. Corrected,
   and the two preconditions it never stated — `CLUSTER_NOT_STOPPED` and
   `PORT_BUSY` — are now in front of the command rather than discovered under
   the clock.
3. **Downloaded-copy restore**: the input must be **inside the private evidence
   directory** (`PRIVATE_NEW_PATHS_REQUIRED`) and must be the **unpacked
   directory, not the archive**. Neither was stated.
4. **Catalog read**: "the identity matches" read as something the wrapper
   checks. It does not — it confirms one row came back. The comparison is by
   eye, and the page now says so.

**Worth naming, because the owner asked for it:** none of this needed a new
mechanism. The house already had the answer — *the wrapper's own usage line is
the authority* — applied to the Storage operator and never to these. Reusing an
existing pattern caught a page that would have ordered a stop after a success.

### 4. B5 shell guard — refuses loudly rather than hashing wrongly

The owner is installing PowerShell 7 and the local session is re-running the dry
run under it. **That fixes one machine; the guard fixes the block.**

Both B5 blocks now refuse before touching anything if
`$PSVersionTable.PSVersion.Major -lt 7`, with a message saying why: 5.1 decodes
and re-encodes bytes in a pipeline, so `git archive | tar` would still produce
files and `Get-FileHash` would still produce a hash — **and that hash would be
wrong.** A wrong hash here is a confidently wrong record of what was served,
which is worse than no record. `tar` missing is a refusal too, not a fallback.

Verified by execution, both directions: the guard refuses a simulated 5.1 and a
missing tool, and the fully guarded block still runs end to end under PowerShell
7.4.6 — fetch, 23 files expected, 23 extracted, `index.html` hash equal to
main's tip.

**Not touched, by instruction:** the decision about B5's shell on the owner's
machine is his.


### 2026-09-16 — Session C on the owner's machine: calibration REFUSED before any count; B5 dry run FAILED on this shell; wrapper preflight found four page disagreements

All three sections were run on the owner's Windows machine at branch head
`e6835ae1`, which contains `8299108`. Main is still `1abdd1fa`. Nothing was
re-pinned, nothing past step 8 ran, nothing hosted was touched.

#### Section 1, calibration: REFUSED at the plan build; no target and no post-install count exist

**What was run, and every difference from what was written.** The page has no
command for section 1, and its box says to ask rather than improvise. The owner
explicitly authorised the session to execute it instead. So the invocation was
constructed from reviewed parts and reported before running:

- **Route:** `qa/linear-exit-rehearsal/run-portable.ps1 -Lane install-operator`,
  the runbook's own command for this adapter's proof. It builds a PG17 cluster
  on `127.0.0.1` with ICU `en-US`, scrubs routing environment variables, and
  stops the server in `finally`.
  - Difference from the derivation cluster: its libc locale is `--locale=C`,
    where the derivation used `--locale=en-US`. Collation follows the ICU
    provider either way.
  - Difference: password authentication instead of trust.
- **Calibration flags:** this lane refuses `-CalibrateTarget`, so
  `INSTALL_OPERATOR_PROFILE=settled68` and `INSTALL_OPERATOR_CALIBRATE=1` were
  set as process environment variables. The runner reads them directly.
- **Environment:** the script refuses inherited routing variables. Two were
  present, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` (names
  only), and were cleared from that one PowerShell process. The user
  environment was not touched.
- Observed inputs: `2026-09-12-fast-finish-evidence`. Output root: the
  private final-review evidence directory.

**Result, from the preserved error log**
(`linear-exit-install-operator-9da3b590abe94a319915567344fe3773`):

```
AssertionError [ERR_ASSERTION]: exact settled observed baseline required
+ '809c5dc72a629d1c240631ca34e1050ac3ad559091b8c0127b8d5fab8cbf7edd'
- 'ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c'
    at Object.build (scripts/linear-exit-install-profiles.js:34:10)
    at test/linear-exit-install-operator-postgres.js:11:103
```

| Stage | State |
|---|---|
| Environment assertions, PG17 ICU loopback cluster | **passed, executed** |
| Observed-schema reconstruction | **passed, executed**: `exact_captured_catalog_match: true`, 67 tables, 115 routines, 14 identity sequences |
| `settled68` plan build | **REFUSED** |
| Plan, derived guard count, target creation | **not reached** |
| Cluster | stopped (`stop.log` present, no `postmaster.pid`) |

**Why, read before running and then confirmed by running.** The `settled68`
builder asserts that the starting catalog is the settled `ddfa4c4f…`. The
runner `test/linear-exit-install-operator-postgres.js` rebuilds the 67-table
observed schema. It applies the opt-out prerequisite **only** for
`observed67_optout` (line 10) and **never** applies the hiring migration, so
the starting catalog is `809c5dc7…`. The runner cannot produce the world
`settled68` is defined against. The cloud session's attempt stopped earlier, on
missing inputs, so no one had reached this line. It was predicted from the code
and then run anyway, per the rule that a fact which can be measured is measured.

**The 91 binding is untouched.** The calibration reported no count, so there is
nothing to compare with 91 and nothing was adjusted. The fix is a **runner
change**: build the settled world (opt-out prerequisite plus the hiring
migration from main) before `build(initial, 'settled68')`. That is outside what
this sitting was authorised to change, so it is left for review, not made here.

#### Section 2, B5 dry run: FAILED on this machine's shell; two findings

Run as written, from the repository checkout, in **Windows PowerShell
5.1.26100**. PowerShell 7 (`pwsh`) is **not installed** on this machine.

1. **`tar.exe` is on PATH**: `C:\Windows\system32\tar.exe`, bsdtar 3.8.8. The
   residual question the page named is answered **yes**.
2. **The `git archive … | tar` pipe fails in PowerShell 5.1:**
   `tar.exe: Error opening archive: Unrecognized archive format`. PowerShell
   5.1 is known to re-encode the bytes piped between two native programs as
   text; PowerShell 7.4 does not. That cause is **inferred from the symptom,
   not measured** here. The earlier successful execution was PowerShell 7.4.6
   on Linux, which does not exercise this path. As the page instructs, no
   alternative extraction was improvised.
3. **Stale `origin/main`:** the block printed `main 73d5fdc361…`, while main is
   `1abdd1fa` (confirmed with `ls-remote`). The block trusts the local
   remote-tracking ref, and this checkout had only fetched the prep branch. Even
   with a working pipe, the hash would have been compared against the wrong
   commit. The real capture block has the same dependency, and at step 16 that
   would matter.

Throwaway directory `b5-dryrun-20260916-1` left in place.

#### Section 3, wrapper preflight: parse OK; four disagreements with the later sitting page

`node --check` printed `ok` for all three wrappers (Node v22.12.0).

Each wrapper's argument checks and printed output were read against the later
sitting page (last changed `829638d5`). **Argument order and count agree** for
the catalog read, the capture and the local restore. **Where they disagree, the
wrapper is right; reported, not edited:**

1. **Capture, the worst of the four.** The page says the capture works when
   "the scratch server is reported stopped" and to **STOP** if it is not. The
   capture wrapper starts no scratch server and on success prints only
   `DATABASE_CAPTURE_PASS; restore, private upload and downloaded-copy restore
   still required`. Read literally, the page would order a STOP after a
   successful capture, **inside the one-hour clock**.
2. **Restore.** The page says it "reports its scratch server stopped". The
   wrapper stops its cluster in `finally` but prints only
   `ISOLATED_DATABASE_RESTORE_PASS`.
3. **Downloaded-copy restore.** The page gives `<path-to-downloaded-package>`
   with no constraint. The wrapper refuses any package not inside the private
   evidence directory (`PRIVATE_NEW_PATHS_REQUIRED`), and it needs the unpacked
   package directory, not the downloaded zip. That is how the 2026-09-14 drill
   worked. The page states neither requirement.
4. **Restore preconditions the page does not state.** The wrapper's owned
   scratch cluster, `native-preinstall-scratch-d307…`, must be stopped
   (`CLUSTER_NOT_STOPPED`) and its port free (`PORT_BUSY`).

Minor: the page's "identity matches" for the catalog read is a human
comparison. The wrapper checks only that its identity query returned one row.

#### What this leaves

- Section 1 needs a reviewed runner change before any calibration can produce
  a target or a count. The 91 derivation stays untested.
- The B5 capture block needs a decision for Windows: PowerShell 7, or an
  extraction step that does not pipe bytes through PowerShell 5.1. It also needs
  an explicit fetch of main.
- The later sitting page needs the four wrapper disagreements corrected before
  it is used under the clock.

### 2026-09-16 — Calibration handed to the local session; the two-step collapses; standing instruction for both outcomes

The owner is giving the calibration to the local session directly rather than
having this one prepare a block for it, on the reasoning this session gave:
**the local session has the private inputs, so its executing the command IS the
preparation.** The two-step only ever existed because this session cannot reach
those inputs. Removing a step that exists solely to work around a limitation is
the right call and it shortens the path by a whole round trip.

**Standing instruction, recorded so a replacement session does not have to ask.**
When the target hash and post-install count come back:

- **If the count is 91** — the derived value — pin the target and re-derive the
  constant from the measured number. That is the one derivation, and it has
  already happened; the calibration was its test and it passed.
- **If the count is anything else** — **nobody touches anything.** Not the
  constant, not the target, not the profile. Stop and put it to the owner. A
  second adjustment would be fitting the number to the observation, which is the
  thing this file records agreeing not to do, twice.

Nothing is pinned and nothing is prepared in the meantime. `settled68.target`
stays `null`, so `get()` still refuses the profile and it cannot be used by
accident while this is outstanding.

**Noted for the record on the method rather than the work.** The allowlist
correction earlier today was the fourth of its class — a claim caught **before**
being stated rather than after. The three before it were caught by the owner, by
the supervisor, and by this session's own second pass, in each case after the
claim had already been made. The difference is not that the error rate changed;
it is where in the sequence the check happens. Worth keeping because it is the
only one of the four that cost nothing.

### 2026-09-16 — Calibration rehearsal ATTEMPTED and executed; it stops at the private inputs, so the command still cannot be written

The owner asked for the rehearsal that was deferred, and for the box to come off
only if the command had actually been run. **It has not, so the box stays**, but
this time the answer is an executed attempt rather than a reasoned one.

**Both of my own environment gaps were removed first**, so that whatever
remained could not be confused with them: **PostgreSQL 17.11** on a throwaway
ICU `en-US` cluster listening on `127.0.0.1`, and **Deno 2.9.6** installed. The
calibration was then run with `INSTALL_OPERATOR_PROFILE=settled68` and
`INSTALL_OPERATOR_CALIBRATE=1`.

**Where it stopped, from the preserved error log:** `ENOENT` on the private
input directory, inside `applyObservedSchema` at
`scripts/linear-exit-observed-schema.js:16`, reached from
`test/linear-exit-install-operator-postgres.js:7`.

| Stage | State |
|---|---|
| the four environment assertions | **PASSED, executed** |
| throwaway ICU cluster on loopback | **PASSED, executed** |
| observed-schema reconstruction | **STOPPED**, private inputs absent |
| `settled68` profile allowlist | **NOT REACHED** |
| plan build, derived guard count, target creation | **NOT REACHED** |

**A precision worth stating, because it corrects something I would otherwise
have claimed.** I would have said this run proved the allowlist accepts
`settled68`. It did not: the allowlist is at line 9 and the reconstruction is at
line 7, so execution stopped **before** it. The allowlist fix is confirmed by
**reading the file**, not by running it. That distinction is small and it is
exactly the one this session has got wrong three times today, so it is written
down rather than rounded up.

**The earlier blocker is genuinely cleared.** Both hard-coded guard counts now
derive from the profile's contract, so the calibration would no longer abort at
91 guards. **Wired, not executed** — nothing past line 7 ran.

**So the command still cannot be written.** Writing it now would be precisely
the defect the sweep found: a block handed over having never run past its first
real step. The box on the session C page is updated to say so, with this table
in it, so whoever writes the command later knows exactly which part is proven
and which is not.

### Is session C runnable end to end? No. One section of three.

| Section | State |
|---|---|
| 1, calibration | **No command.** Executed here only as far as the private-input boundary. Cannot be prepared without the owner's machine. |
| 2, B5 dry run | **Executed as written**, PowerShell 7.4.6. Residual: `tar.exe` on Windows, which is what the dry run exists to discover. |
| 3, wrapper preflight | **Executed as written**, including its failure paths. Residual: the argument lists, closed by reading the wrappers' usage lines, not by the block. |

Two of three sections are proven and worth the sitting. The third does not exist
and must not be improvised at the keyboard.

### 2026-09-16 — Group 1 BUILT: sites 1, 2 and 3 derive their count from the profile's own contract; four files, 67 added lines, 5 removed

Scope exactly as approved. Sites 4, 5, 7 and 8 untouched, and **site 6 needed no
edit at all** — it builds its plan through the default contract, so the derived
answer for its world is 90, exactly what its synthetic fixture already provides.
It follows site 2 by construction rather than by being changed, which is better
than editing it.

| File | + | − |
|---|---|---|
| `scripts/linear-exit-observed-public-catalog.js` | 56 | 1 |
| `scripts/linear-exit-observed-full-target.js` | 8 | 2 |
| `scripts/linear-exit-install-operator.js` | 2 | 1 |
| `test/helpers/install-operator-worker.mjs` | 1 | 1 |

Most of the 56 is the provenance comment, which is the point.

### How it derives, and why nothing needed a new argument

`postInstallPublicTables(initialCatalogSha256)` resolves the **plan's own
declared starting catalog** to the contract that matches it, reads that
contract's reviewed table count, and adds the install-created constant. Verified:
observed67 resolves to 67 + 23 = **90**, settled68 to 68 + 23 = **91**, an
unknown starting catalog raises `OBSERVED_CATALOG_UNKNOWN_STARTING_CATALOG` and
a malformed one raises `OBSERVED_CATALOG_STARTING_SHA_SHAPE`.

**No call signature changed.** The plan already names its starting catalog, so
every site could answer the question from what it already held. That is what
made the scope four files instead of a refactor: the information was never
missing, it simply was not being read. Site 2 is the clearest case — `create()`
takes no profile, and now reads the **validated** plan object `j.compile` had
already produced rather than re-parsing raw bytes.

### The 23 is pinned with its provenance, not as a bare number

At the owner's condition. The comment beside it records that it is
90 − 67 from the committed target artifact, that it is a property of the plan's
**source list** rather than of any profile, and — explicitly — **why it is not
the tenth literal**: the nine it replaces each restated a finished number with no
way to tell which world it belonged to, whereas this is one input to an
arithmetic whose other input comes from the profile's own reviewed contract. It
also says what would make it wrong: a future profile that changes the plan's
source list, in which case it is re-derived from that profile's target and is
not a universal constant.

### Verification status, recorded because a later reader needs to know which links were independently checked

Written into the code comment as well as here, at the owner's instruction.

- The **90** and the **67** are READ from committed artifacts.
- "The plan's source list is identical across profiles" was established **by one
  party, by reading the builder.** Not independently confirmed.
- The related **86-plus-4 decomposition was NOT independently confirmed.** The
  supervisor attempted it **twice** and both attempts failed to extract it from
  compressed source. The owner recorded plainly that he did not treat those
  failures as confirmation, and approved on the structural argument plus the
  fact that the calibration can refute it.

So the chain behind 91 is: two read facts, one single-party code reading, and
one unconfirmed decomposition that the approval deliberately did not lean on.
**That is weaker than "verified" and stronger than "assumed", and the difference
matters enough to write down.**

### What cannot be tested here, stated rather than glossed

The helper's arithmetic is proven both ways. **Site 2's new assertion is not
behaviourally tested in this sandbox**: `create()` validates the full plan shape
before reaching the table count, and a synthetic plan cannot pass that
validation, so the only real exercise is a run with private inputs. Sites 1 and
3 are likewise reachable only through a real install or calibration. The offline
tests that touch the changed modules pass.

**The binding stands unchanged. The derivation has happened once. The
calibration is its test. If it reports anything other than 91, that is a finding:
stop and report it, and do not adjust a second time.**

### 2026-09-16 — The two groups ARE independently fixable, and the coupling I claimed does not exist; my "every 90 is that list's length" was wrong

The owner asked the right question and named the trap in it: if every 90 really
is the length of the custody name list, then a profile-derived count restates the
same fact in a second place, which is the defect this whole thread is about. He
said to say so if that was the honest answer.

**It is not. The two numbers are different facts, and I tested it rather than
repeating the assertion.**

### The evidence

- `expectedNames('v1')` is 86 names and is **byte-for-byte the source baseline
  catalog's table set** — diffed in both directions, zero difference either way.
- `expectedNames('v2')` is v1 **plus exactly four** `card_write_*` tables:
  `card_write_admission_v1`, `card_write_followups_v1`,
  `card_write_operations_v1`, `card_write_transaction_context_v1`.
- `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` records post-install
  `public_tables: 90` from a **67**-table live start.

So the two 90s decompose differently: **86 + 4** for the custody list, **67 + 23**
for the install target. 86 is not 67 and 4 is not 23. They coincide at 90 and
that is all.

**The decisive part is what happens next.** Under `settled68` the live start
becomes 68, so the install's post-install count becomes **91**, while v2 stays
**90** — the source-baseline universe has not moved. **Two quantities that take
different values are not one quantity restated.** That is as clean a refutation
of the coupling as the evidence allows, and it only became visible because the
second profile forced them apart.

### The answer to the sequencing question

**Yes, the groups are independently fixable, and sites 1, 2 and 3 do not need v3
to exist.**

The post-install count for a profile is its **own contract's** table count plus
the tables the install creates:

- The per-profile pre-install count already exists in a reviewed, byte-pinned
  artifact: `settled68`'s contract records 68, `observed67`'s records 67. Both
  are already wired into the loader and the settled one was byte-confirmed
  against the derivation's private candidate.
- The install-created count, 23, is a property of the plan's source list, which
  is **identical across all three profiles** — established earlier by reading the
  builder, where the contract changes only `initial_catalog_sha256` and the
  comparison target. It is derivable from artifacts that already exist:
  the target's 90 minus observed67's 67.

**Neither input is the complete-application-data list.** So the install path can
unblock now, and v3 gets its own review without holding anything up. That is the
tidy-looking route and it also happens to be the correct one, which is worth
saying explicitly because those are not usually the same and the owner was right
to check.

### What this does not change

A literal is still the wrong shape. Nine copies of a derived quantity is nine
copies whichever quantity it is. The correction is only about **which** fact was
being copied: per-profile arithmetic, not the custody list's length.

And site 9 still needs v3 regardless. It compares **names**, not counts, so
nothing in the group-1 fix touches it.

**Correction recorded against myself.** "Every 90 is just that set's length" was
stated twice, in the survey doc and in a report, and it was never tested. It is
the same shape as the identity claim and the closing claim: a statement that
sounded like a finding, was produced by pattern-matching two equal numbers, and
would have sent the work down a longer route than necessary. The survey doc's
section is corrected in place with the original claim quoted.

**Noted and moving on, per the owner:** the widened trace leaves steps 6 and 7
uncovered. They are Phase 6 and Phase 7 work, well past the install, so they are
not in front of anything.

### 2026-09-16 — Does any install-day step reach the fixed table-list check? NO for every step with a named script; checked by measurement where it could be run

**The question.** The cloud session found that `captureRows()` in
`scripts/linear-exit-complete-application-data.js` compares live table names
against a fixed versioned list as an exact set, and fails
`UNCLASSIFIED_OR_MISSING_TABLE` on any difference. On the settled 68-table
database it refuses. It is not a count, so no guard-count fix touches it. If any
install-day step reached it, that step would refuse on the day, and if it were
step 9, inside the one-hour catalog clock.

**Answer: no install-day step with a named script reaches a caller of
`captureRows()`**, and none reaches the list's other consumer outside
custody lanes, `isFixedPublicTrigger()`. Checked on the owner's machine at
branch head `38052694`, working from the steps in
`LINEAR_EXIT_INSTALLATION_DAY_20260914.md`.

**How it was established.** Two methods, reported separately because they
prove different things.

1. **Load measurement: run, not reasoned.** Each entry script's repository
   modules were loaded in a fresh Node process under a preload guard. The guard
   makes every network module, child-process launch and file write throw and
   record the attempt. The report is which repository modules Node actually
   loaded. Wrappers whose file runs `main()` on load were never loaded
   themselves; only the modules they require were. **Every run recorded zero
   guarded attempts and no load errors.**
2. **Call-site search over the modules that actually loaded.** A function runs
   only if loaded code calls it. So for each loaded set, the sources were
   searched for `captureRows(`, for `.capture(`, for computed-name calls
   (`x[name](`), and for the other callers of the fixed list. This rests on
   reading, applied to a measured set of modules.

**Step by step:**

| Step | What runs | Result |
|---|---|---|
| 0, Storage | private quiet-window operator, downloaded-copy verify | Watched modules absent from the static tree. That tree can only over-include, so absence is reliable |
| 1, catch-up | `linear-exit-main-catchup.js` and what it launches: `ef-fingerprint.js`, `repo-identity-exposure-check.js`, `test/f27-section4-deploy-lane.js`, `test/workload-capacity-placement.js`, `test/workload-plan-source.js`, `test/workload-tweak-exclusive-bucket.js` | Catch-up and fingerprint **measured**: one module each, nothing watched. The identity check and the four tests have no `main()` guard, so they were checked statically: one-file trees, none mentions the watched modules |
| 2, database | the three private wrappers: catalog read, capture, restore | **Measured.** Capture set loads 10 modules, restore set loads 5. Neither loads `linear-exit-complete-application-data`, `linear-exit-control-companion`, `linear-exit-complete-application-custody` or `linear-exit-asset-reference-coverage` |
| 3, install | `linear-exit-install-operator.js` | **Measured: it DOES load the data module and the control companion** (19 modules in total), because it calls `require('./linear-exit-control-companion').forProfile(...)` at top level. Its only use is `control.catalogSql()`, twice, which is a pure SQL string builder. Across all 19 loaded modules, `captureRows(` appears only inside the data module's own `capture()` and the companion's own `capture()`. Nothing outside those functions calls them. There are no computed-name calls. `isFixedPublicTrigger()` is reached only through `validateSchemaSection()`, which is called only by `readRecoveryPackage()` and `captureRecoveryPackage()`. Those in turn are called only inside the custody modules' own functions and the recovery package's command-line `main()` |
| 4, release | `deploy-onboarding-edge-functions.yml`: `ef-fingerprint.js`, `linear-exit-deploy-preflight.js` | Preflight **measured**: one module, nothing watched |
| 5, n8n | `prepare-urgent-editor-website-only.js` | No `main()` guard, so checked statically: one-file tree, nothing watched |

**Not checked, stated plainly:**

- **Steps 6 and 7** name no scripts. The TEST saves and the separately accepted
  capability components (the Calendar/Samples composers, the follow-up
  supervisor and others) were not identified to trace. They are not covered by
  this answer.
- **Call-time, as opposed to load-time.** Nothing here executed `capture()`,
  the installer's APPLY, or any function against a database. For steps 3 and 2
  the "not called" conclusion is a search of the measured loaded set. The
  strongest remaining measurement would wrap `captureRows()` and
  `isFixedPublicTrigger()` to record any call, then run the installer's
  existing isolated PG17 proof lane. It was not run.
- The deploy workflow runs in CI at the deployment commit. It was measured
  locally at this head, not at a future deploy SHA.
- Recovery-procedure routes are not install-day steps and were not traced.

**Where the check does live, so its scope is not lost.** The fixed list is
consumed by custody lanes, not by the install-day path:
`linear-exit-complete-application-data.js` `capture()`,
`linear-exit-control-companion.js` `capture()`, and the modules that drive
them: `linear-exit-complete-application-custody.js`,
`linear-exit-control-custody.js`, `linear-exit-credential-capture.js`,
`linear-exit-priority-capture.js`, and a reference in
`linear-exit-asset-reference-coverage.js`. **Any of those lanes would refuse on
the 68-table database.** If one is ever added to an install-day step, this
answer no longer holds for that step.

**Measurement confirmed the narrower step 9 answer and corrected its method.**
The earlier static reading said step 9's capture never runs the check. The load
measurement **confirmed** it: the data module is not even loaded. But it showed
the static dependency walk was **over-inclusive**, listing 20 and 17 files where
only 10 and 5 load, because it counted requires that sit inside functions.
That over-inclusion is what makes "absent from the static tree" safe to rely on
for scripts that could not be loaded.

**Widening the question found the thing the narrow one could not.** Step 3, not
step 9, is the step that loads the data module. It does not call the check. But
it is the step closest to the risk, and a narrow answer about step 9 would never
have looked at it.

**The reporting note the owner asked to keep.** Partway through, the session
reported **"points to no, two hops unread"** before it had the answer, instead
of stating a conclusion early. Today three sessions in a row closed a set at
whatever their first method returned. Stating the lean together with the unread
hops, then reading them before concluding, is the practice to keep. It is also
the rule ratified today: a fact that can be measured is measured before it is
stated.

### 2026-09-16 — Step 9 does NOT reach site 9 on static reading; v3 stays held for the wider question; and my own consumer list was over-reporting

**The local session's trace: no.** Step 9's capture never calls the exact-set
check. The module is in its dependency tree only through **lazy requires inside
functions step 9 never reaches.**

**Two limits, stated by the owner when he passed it on, and they are the
substance rather than hedging.** It is static reading, so a runtime
confirmation has been asked for — lazy requires and dynamic dispatch are exactly
what static reading is worst at, and a lazy require is precisely what this
answer turns on. And it is narrow: it answers *step 9*, which does not settle
whether any **other** install-day step reaches a caller.

**On current evidence v3 is not a day-of blocker**, so it gets done properly
rather than urgently. **Held** until the wider answer, because a yes there would
change the scoping.

### The repo-side half, and a correction to my own survey

The survey doc listed five "consumers" of site 9. **That was over-reporting, and
the way it over-reported is the defect this whole thread is about.** The grep
measured *which files reference the module*, not *which reach the check*. Four
of the five use only `read`, `sections` or `expectedNames`.

**There is exactly one repo-side caller of site 9:**
`scripts/linear-exit-control-companion.js`, calling `complete.captureRows`.

A trap found on the way, worth keeping because it would mislead the wider trace:
**three different modules export a function named `captureRows`** — the
complete-application-data one, `linear-exit-credential-capture.js:9` and
`linear-exit-priority-capture.js:9`. Only the first carries the exact-set check.
A search on the name over-reports by two. The name matched; the thing did not.

Repo-side reach into the install path, **static reading, same evidence class as
the local session's answer and no substitute for the runtime confirmation**: the
operator and the calibrate worker use exactly one export from the control
companion, `control.catalogSql`, not its `capture`. `control.capture` is called
only from a test helper. **No install-day path to site 9 was found here.**

Recorded as "not found", not "does not exist". A second search of a different
shape — required in this file since this morning — turned up five **lazy
requires** of the control companion inside `track-b-recovery-package.js` and a
file the wider trace should look at by name,
`scripts/linear-exit-control-custody.js`. Neither is on the operator's path.
Both are the kind of thing the first search shape could not have seen.

### Kept because the owner asked for it, and it is more useful than the rule

> The first search failed because it answered **"where are the sites I already
> know about"** while being read as **"where are all of them"**. The output
> looks identical either way.

That is the thing to look for next time, and it is more actionable than the rule
it produced. A search written from the examples in front of you inherits their
shape, and the result set it returns is indistinguishable from a complete one:
same format, same confidence, no marker saying which question was answered. The
only defence is asking, before believing a set is closed, **which of the two
questions the search actually asked** — and then asking the other one a
different way.

It has now happened three times in one day on the same investigation, twice to
this session and once to the supervisor, which is what makes it a property of
the method rather than a lapse.

### 2026-09-16 — Search rule ratified; per-site survey written with evidence labels; v3 held pending the site-9 trace

**The rule is in `AGENTS.md`.** Both halves, as ratified:

> A search proves what it found. It never proves what it did not find.

and the practical half, which is the part that changes behaviour:

> When a search closes a set, run a second search of a different shape and
> reconcile the two.

The concrete number is kept because it is more persuasive than the principle:
**the clever regex found one site; the dumb search for the bare number found
nine.** The clever one was written to match the two forms already expected, so
it matched exactly those and nothing else. It was not a bad regex. It was a
regex answering the question "where are the sites I already know about", while
being read as an answer to "where are all the sites".

**The supervisor failed the same way at one remove**, and the owner named it:
it found one more than this session had and stopped there. Three positions in a
row — session, supervisor, and the session's own second pass — each closed the
set at whatever their first method returned. That is worth keeping, because it
shows the defect is not carelessness in one place. It is the default behaviour
of looking for something and finding it.

### The survey

`docs/ops/LINEAR_EXIT_GUARD_COUNT_SITES.md` now carries all nine, each with what
it serves and what it should read instead. **Every row is labelled READ or
INDICATED**, because the whole reason this survey exists is that a claim looked
checked and was not.

Two rows are **INDICATED and not traced**, and are marked as such rather than
rounded up: #7 and #8, the control-companion proofs. Their 90 matches
`expectedNames('v2').length` exactly and they reach `captureRows`, but the set
of tables their OWNERS files create was not enumerated, so the coupling is
inferred from a matching number. What would settle it is written on the row.
Saying "indicated" costs a sentence; saying "read" and being wrong costs what
today already cost.

**The row that settles the design question is #2.**
`linear-exit-observed-full-target.js`'s `create({planBytes,planSha256,catalog,privateCatalog})`
**takes no profile argument at all** and asserts `catalog.tables.length===90`. It
asserts a number it has no way to be right about. And `compare` calls `create`,
so it fires on the operator's comparison path as well as the calibrate worker's
creation path. A function that cannot see which world it is in should be handed
that, not left to assume it.

**Held, at the owner's instruction:** the v3 proposal is not detailed further
until the local session reports whether step 9's private capture wrapper reaches
site 9. If it does, this is a blocker in the install-day path and gets scoped as
one. If it does not, it is a latent defect to fix properly rather than urgently.
The sequencing reason is the owner's and it is right: this now touches custody
and recovery, which B4 closed on, and this session said itself that it wants its
own review rather than riding in as a fix to a number.

### 2026-09-16 — The guard-count set is NINE sites, not two and not three; and the literal is the wrong shape because the real object is a NAMED SET, not a number

The owner declined the go-ahead and was right to. The supervisor found a third
site. Sweeping properly found nine, two of them in `scripts/` rather than tests,
and one of them is not a count at all.

**Nothing has been changed. This is the survey he asked for.**

### The full set, and which profile path each one serves

| # | Site | Shape | Serves |
|---|---|---|---|
| 1 | `scripts/linear-exit-install-operator.js:34` | literal 90 → `fail('GUARD_COUNT')` | **every profile** |
| 2 | `scripts/linear-exit-observed-full-target.js:6` | literal 90, `catalog.tables.length===90` | **every profile** (operator compares, calibrate creates) |
| 3 | `test/helpers/install-operator-worker.mjs:9` | literal 90 | **every profile**, selected by `INSTALL_OPERATOR_PROFILE` |
| 4 | `test/helpers/observed-full-pipeline-worker.mjs:11` | literal 90 | **67 only** |
| 5 | `test/linear-exit-observed-full-pipeline.js:33` | literal 90, `after.tables.length` | **67 only** |
| 6 | `test/linear-exit-observed-full-install.js:11` | synthetic 90-table fixture | coupled to #2, not to any profile |
| 7 | `test/helpers/control-recovery-proof.js:54` | literal 90 trigger count | the **control-companion** world |
| 8 | `test/linear-exit-control-restore-only-postgres.js:16` | same | the **control-companion** world |
| 9 | `scripts/linear-exit-complete-application-data.js:29` | **exact name-set comparison** | custody and recovery |

#4 and #5 are 67-only because `test/linear-exit-observed-full-pipeline.js` calls
`full.build(initial)` with **no options**, so it takes the default contract.
Read, not assumed. #7 and #8 are not on an install profile at all: they build
the control-companion world from `expectedNames('v2')`.

### Why a literal is the wrong shape, which is the real answer

`complete.expectedNames('v2')` returns exactly **90 names**. `expectedNames('v1')`
returns **86**. The reviewed object is a **named set of public tables**, versioned
and byte-pinned, and **every 90 in the table above is just that set's length,
copied into eight places as a constant.** Nobody chose eight literals; one
derived fact got flattened into eight.

So the answer to "is a literal the right shape now" is no, and it was never the
right shape — having two profiles with different starting sizes only makes the
existing defect visible.

**#9 is the proof, and it is the finding that matters most.**
`captureRows` compares the live catalog's table names against
`expectedNames(name)` as an **exact set** and fails
`UNCLASSIFIED_OR_MISSING_TABLE` on any difference. On the settled database, with
`hiring_practical_test_jobs` present and absent from v2, that refuses. **No
amount of changing 90 to 91 fixes it, because it is not counting.** That module
feeds `track-b-recovery-package.js` and
`linear-exit-complete-application-custody.js`.

**Flagged as UNVERIFIED and worth the owner's attention:** if the day-of database
capture wrapper reaches that code path, **step 9 may refuse on the settled
schema for this reason**, which would be a second thing failing inside the
one-hour clock. This session cannot read the private wrapper, so it cannot
determine whether it does. It is a question, not a claim.

### What is proposed, and not done

The reviewed change is **a v3 of the complete application data list**, 91 names
including `hiring_practical_test_jobs`, and then counts that **derive from the
list** rather than restating it:

- #1, #2, #3 take the expected count from the profile's own list version.
- #4, #5 stay on v2 and change nothing; they are the 67-table world and it is
  still correct.
- #7, #8 stay on v2; the control-companion world is not an install profile.
- #6 follows whatever #2 becomes.
- #9 selects v3 for the settled state.

That removes the class rather than the symptom: add a table, add it to the
reviewed list, and every count follows. The alternative, nine literals kept in
step by hand, is the same defect with a bigger surface.

**Costs, stated so the decision is real.** v2 is byte-pinned and historically
meaningful, so a v3 is an addition and never a mutation.
`test/linear-exit-complete-application-data.js:41` gates the v1 to v2 delta
(`names2.length===90`, `added.length===4`) and a v3 needs its own reviewed delta
assertion. And this touches the custody and recovery path, which is what B4 just
closed on, so it deserves its own review rather than riding in as a fix to a
number.

### 2026-09-16 — The closing claim was the unchecked part, for the third time today

Recorded at the owner's instruction and in the terms he used.

The rehearsal entry said there were two hard-coded counts and named
`finalize.js` as deriving rather than pinning. The `finalize.js` half was read
from the code and is correct. **The closing half — "so those two are the whole
set" — was never checked.** A search was run for the two shapes expected, it
found them, and the set was declared closed. The supervisor found a third
immediately; sweeping exhaustively found nine.

That is the third time today the same shape has landed:

1. the identity claim, where `IDENTITY_SQL` was read and what Supabase does with
   a restore was assumed;
2. the selfcheck, twice, which covered what was imagined to be fragile rather
   than what the code asserts;
3. this, where the members of a set were verified and the **completeness** of
   the set was not.

The composite-claim rule already names the mechanism, and this is its third
form: **"and that is all of them" is a claim, and it is usually the one part of
a careful piece of work that nobody checks.** A search proves what it found. It
never proves what it did not find, and the difference is invisible unless you
say which one you are asserting.

The practical form, since the rule wants a practical half: when a search closes
a set, run a second search of a **different shape** — here, every bare `90` in
every `.js`, `.mjs` and `.cjs` — and reconcile the two. The clever regex found
one site. The dumb one found nine.

### 2026-09-16 — Bound: the derivation happens once, and the calibration is its test

Recorded at the owner's instruction, as a standing constraint on this work.

> **The derivation happens once, and the calibration is the test of it. If the
> calibration reports anything other than what was derived, that is a finding.
> Stop and report it. It is not a licence to adjust a second time — adjusting
> twice is fitting the number to the observation, which is the thing we have
> twice agreed not to do.**

And the circularity, which the owner asked be kept in this session's own words:

> The calibration is the only thing that can measure the post-install count, and
> it cannot run until the constant it would verify has already been changed.
> **Nothing removes that except deriving first and letting the calibration
> confirm or refute.** The derivation has to be defensible on its own evidence
> before the measurement exists, because once the measurement exists it is too
> late to claim the derivation was independent of it.

### 2026-09-16 — Calibration rehearsal attempted; it found a SECOND hard-coded 90, in the calibrate path itself, which would have failed session C at the keyboard

The owner asked for the calibration command to be rehearsed and then written on
the page having actually been executed. The rehearsal did not get that far, and
what stopped it is worth more than the command would have been.

**There are two hard-coded guard counts, not one.** The known one is
`scripts/linear-exit-install-operator.js` line 34,
`if(guards.length!==(alreadyFinal?0:90))fail('GUARD_COUNT')`. The one nobody had
looked at is **inside the calibrate branch**:
`test/helpers/install-operator-worker.mjs` line 9,
`assert.equal(guards.length,90)`. `scripts/linear-exit-install-finalize.js`
derives its count and carries no literal, so those two are the whole set.

**Consequence: the calibration aborts before it can derive a target.** The
settled database has 68 public tables, so the install produces 91 guards, and
the calibrate path asserts 90. Deriving the target is the entire purpose of
session C, so section 1 would have consumed a keyboard sitting and produced
nothing.

### The derivation of the new constant, so it is not an edit from 90 to 91

Stated in full because D8 requires the anchors be confirmed rather than the
number be updated.

- `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` records `public_tables: 90` and
  `maintenance_guards_removed: 90`, built from `initial_public_catalog_sha256`
  `809c5dc7…`, which is the **67**-table observed67 live read. So the
  installation creates **23** public tables.
- The maintenance guard is applied to every relation found with
  `relnamespace='public' and relkind in ('r','p')`, not from a list, so the
  count tracks the database rather than the plan.
- The settled plan's **source list is identical** to observed67's. Verified by
  reading the builder: the contract changes only `initial_catalog_sha256` and
  the comparison target; the sources come from the pinned manifest and OWNERS
  either way. So the same 23 tables are created.
- Live is **68** public tables, measured by the owner on 2026-09-16, not
  derived.

68 + 23 = **91**. That is a re-derivation from two measured quantities and one
verified structural fact, which is the thing D8 distinguishes from silencing.

**NOT APPLIED. Both constants are left at 90 and this is deliberate.** The owner
has twice named this specific number as the one most tempting to silence,
precisely because the right answer looks one digit away. An unreviewed edit to a
reviewed contract constant is exactly what the rules forbid, even when the
derivation is sound, and especially when the derivation is sound. It waits for
his go-ahead.

There is also a genuine circularity worth naming: the calibration is what would
*measure* the post-install count, and it cannot run until the constant it would
verify is already changed. Nothing fixes that except deriving it first and
letting the calibration confirm or refute it. If the calibration then reports a
number other than 91, that is a finding and not a licence to adjust again.

### What the rehearsal DID establish

**PowerShell 7.4.6 was installed here**, so the two blocks that had never been
executed were executed, not reasoned about.

- **Section 2, the B5 dry run: runs clean.** `23 files expected`, `extracted 23
  files`, `index.html` hash equal to main's tip. Array splatting into `git`, the
  `git archive | tar` pipe and `Get-FileHash` all behave. Only the `$probe` path
  was substituted.
- **Section 3, the wrapper preflight: runs clean, and its failure paths work.**
  Tested with an intact file, a deliberately broken one and an absent one; it
  reported `ok`, `PARSE FAIL` and `MISSING` respectively, so the detection is
  proven rather than just the happy path.
- **A blocker fixed on the way:** the operator test's profile allowlist was
  `['observed67','observed67_optout']` and would have refused `settled68`
  outright. `settled68` added.

**Residual, stated rather than glossed:** those runs were PowerShell on Linux.
The Windows-specific unknown is `tar.exe` being on PATH, which is precisely what
the dry run exists to discover, so it is the right thing to leave to the sitting.

### Is session C runnable end to end? No, and here is the list

Answering the owner's question in the form he asked for.

| Section | State |
|---|---|
| 1, calibration | **BLOCKED.** Command not written and cannot be, until both guard constants are re-derived and reviewed. It would abort at 91 guards. |
| 2, B5 dry run | **Proven** in PowerShell 7.4.6, path substituted. `tar.exe` on Windows is the remaining unknown and is the point of the run. |
| 3, wrapper preflight | **Proven**, including failure detection. Its argument-list gap is closed by reading the wrappers' usage lines, not by the block. |

So: **two of three sections are proven and worth doing; the third does not exist
yet and must not be improvised at the keyboard.**

### 2026-09-16 — Session C page written; both unproven blocks moved into it; and what CANNOT be proven about steps 9 and 10, said plainly

Three things, all consequences of the sweep, all at the owner's direction.

**The runnable-block rule is now in `AGENTS.md` and covers chat handover
explicitly.** The sweep's most useful finding was not any single defect, it was
that `--plan-from` had never been on a page. **Work handed over in a message
skips every check that work in the repository gets** — not swept, not reviewed,
not run. The rule says so, and says the same of relaying someone else's block:
passing it along is not a reason to skip reading it. The supervisor relayed that
block unchecked, which is the same failure one level up.

**A session C page now exists**, which is itself the fix for the same problem:
session C had only ever been described in chat messages, so it had exactly the
status `--plan-from` had. The calibration command is deliberately **not** on it
yet, with a box saying why: no session has executed it in this form, and writing
it down now would reproduce the defect the sweep just found. It goes on the page
after it has been run against an isolated cluster.

**Both unproven blocks moved into session C**, because the owner's reasoning is
better than "well before the merge":

> **"Well before the merge" is how something ends up happening at the merge.**

- **B5** is now a dry run in session C, section 2. It proves `tar` is present,
  that PowerShell splats the file list into `git` correctly, and that
  `git archive` reproduces main's bytes. **It downloads nothing and records no
  capture**, because the real capture must be taken immediately before the exit
  merge and at no other moment.
- **Steps 9 and 10** get a preflight in section 3, run **before the one-hour
  clock exists**. That ordering is the real fix: a failure discovered inside the
  clock costs the catalog read and the sitting; the same failure discovered a
  day earlier costs nothing.

### What can be proven about the step 9 and 10 wrappers, and what cannot

The owner asked for this without reaching, so: **the preflight proves less than
it looks like it does, and one gap cannot be closed by any preflight.**

Provable, and now checked: the wrappers exist at the paths the page names;
`node --check` parses each one, executing nothing, so the files are readable and
intact; node is on PATH. That catches the single most likely defect, a wrong
path, which is the class that just bit us twice.

**Not provable by any preflight, and not by this session at all: the argument
lists.** Those wrappers are private. This session cannot read them, so the
argument order and flags written on the sitting page have never been verified
against the things they invoke. They are, precisely, guesses that happen to
resemble what was run on 2026-09-14.

**But the house already solved this, and the solution was simply never applied
here.** The Storage operator's section said, in terms: *that file is the
authority for the exact argument list. Do not guess flags from this page; read
its usage line.* The database wrappers got no such instruction, and their
argument lists were written out on the page as though they were known. So the
gap is not a missing capability, it is an existing pattern applied to one
wrapper and not the other two.

Session C section 3 closes it the same way: read each wrapper's usage line and
compare it against the page. **If they disagree, the wrapper is right and the
page is wrong.** That is a minute of the owner's time and it converts three
blocks from unverified to checked against their own authority.

The honest summary: **path resolution and file integrity are provable and now
proven; argument acceptance is not provable without either running the wrappers
or reading them, and reading them is the cheap one.**

### 2026-09-16 — Settled plan hash MEASURED on the owner's machine: `e3dae746…`; recorded, NOT pinned

**The value, copied whole from the printed output:**

```
settled_plan_sha256 = e3dae746b148fe18839209445e8b2142372335b18127430ba2d827f13cd27d54
```

**Where it came from, exactly.**

- Script `scripts/linear-exit-b9-catalog-derive.js` at repository head
  `0c35a3c8`. The `--plan-from` mode was added in `03d18fb3`.
- Working directory: the successful derivation's private output directory,
  `b9-derive-20260916-2`, not the failed `-1`.
- Input: that directory's `b9-settled-catalog.private.json`. File SHA-256
  `ab7d33e5d254b79e9714e05f08e4b6837789713653d1f4ac14d9d1dbf56dce27`; canonical
  catalog hash `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`,
  equal to the derivation's settled hash and to today's live read.
- Profile built: `settled68`. No cluster, nothing hosted, nothing written.

Full printed result: marker `B9_SETTLED_PLAN_MEASURED`; `settled_catalog_sha256`
and `initial_catalog_sha256` both
`ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`;
`plan_bytes` 945060; `stage_id`
`OBSERVED_PUBLIC_20260916_SETTLED_FULL_PREPARATION_V1`;
`target_still_required: true`, with the note that the target comes from a
calibration run of the installer. Exit 0.

**Not pinned.** Pinning is the cloud session's job, by owner decision. This
entry is the measured value and its provenance, nothing more.

**The deviation: the command could not run as written, and what was done
instead.**

The instruction was
`node scripts/linear-exit-b9-catalog-derive.js --plan-from=".\b9-settled-catalog.private.json"`,
run from `b9-derive-20260916-2`. It fails in two independent ways, and both
were **established by reading, not guessed**:

1. The script path is relative. The private output directory has no `scripts`
   folder, which was checked, so Node would not have found the module.
2. The `--plan-from` path is relative, and the script's `planFrom()` asserts
   `path.isAbsolute(file)` (line 295), which was read, so the input would have
   been refused.

Before running anything, the session **read `planFrom()` in full and confirmed
it is read-only**: it parses the catalog file, hashes it, and builds the
`settled68` plan in memory. It writes nothing, starts no cluster and connects
to nothing.

What was then run changed **only how the two paths were written**. The working
directory stayed the one named. The input stayed the exact file named. The
script was called by its absolute path in the checkout, and `--plan-from` was
given that same file's absolute path. **The substitution was reported to the
owner with the reasons, in the same message as the result**, not made silently.

That is the standard: when an instruction cannot run as written, establish why
from the code, verify that the adjusted action is safe, then report the
substitution. Do not quietly correct the instruction and present the result as
if it had run verbatim. **It is the second time today that declining to quietly
correct an instruction kept a check honest.** The first was the byte check
aimed at the failed `-1` directory.

**Where the flawed command originated.** The command was written by **the cloud
session** and **relayed by the supervisor without being checked** against the
script or the directory layout. It was not a local error on the owner's
machine. It is recorded so the trail shows its origin. Like the `-1` directory
earlier today, it was a relayed instruction that nobody between its author and
the machine checked.

### 2026-09-16 — Plan hash PINNED; and a sweep of every runnable block, after a prepared block failed at the keyboard

**`settled68.plan` is pinned to
`e3dae746b148fe18839209445e8b2142372335b18127430ba2d827f13cd27d54`**, read whole
from the owner's `--plan-from` run. The run also reported
`initial_catalog_sha256` equal to `settled_catalog_sha256`
(`ddfa4c4f…`), which is the check that matters: it proves the plan was built
against the settled picture and not a stale contract. `plan_bytes` 945,060,
stage_id `OBSERVED_PUBLIC_20260916_SETTLED_FULL_PREPARATION_V1`, exit 0.

`target` stays `null`, so `get('settled68')` still refuses the profile. Only a
calibration run produces the target.

**The block as handed over could not be run.** Two defects, both mine: the
script path was relative and resolves to nothing from the directory the page
tells the owner to stand in, and `--plan-from` is rejected unless absolute — by
an assertion I wrote, at line 295 of that same script. The local session found
both by reading the code, confirmed the function was read-only before running
it, and **reported what it substituted instead of quietly fixing it.** The
supervisor relayed the command without checking it either.

**The owner's framing, which is the lesson and is bigger than the instance:**

> The entire purpose of a prepared runnable block is that it can be run at the
> keyboard **without reasoning**. A block that needs a path corrected before it
> works has defeated its own purpose, and it failed in exactly the place where
> reasoning at the keyboard is most expensive.

### The sweep

Every runnable block in the sitting page and its appendices, and in the B9 page,
checked against the pages' own claims and against the scripts' actual
assertions. **Five defects found, all fixed. Two unproven blocks found and
recorded rather than fixed, because the honest thing is to say so.**

**D1. Relative script paths under a header promising absolute ones. Four
occurrences** — sitting page sections 1 and 2, B9 page twice. The sitting page
says, categorically, "**It does not matter.** Every path below is absolute",
and then invokes `node scripts/linear-exit-b9-catalog-derive.js`. Reproduced
here: from a non-repository directory that throws `Cannot find module`; with an
absolute script path it runs. **This is the defect that bit him**, and it was
present in four places, not one. Fixed by making every invocation absolute,
which is safe because the script resolves the repository from its own location
rather than from the working directory.

**D2. A Unix line continuation in a PowerShell block.** The `initdb` example
wrapped with a trailing backslash. PowerShell's continuation is a backtick, so
the block could not be pasted as written, and the failure mode is silent until
it runs. Fixed by making it one line, and by using **the flags the owner
actually ran on 2026-09-16** rather than the ones this session had proposed.

**D3. `initdb` invoked bare**, assuming it is on PATH. Fixed to an explicit
path to the PostgreSQL 17 binary.

**D4. Absolute-path requirements unstated.** `--observed-input` and `--out` are
both asserted absolute by the script; the page said only "your private
observed-schema input directory". The sitting page happened to give an absolute
value for `--out`, so it worked by example rather than by instruction. Both now
say ABSOLUTE.

**D5. The B9 page had lost its "where to run from" statement**, removed when the
collation section was inserted. Restored.

**And the one that explains the rest: the `--plan-from` block was never on a
page at all.** It existed only in a chat message. **A runnable block that lives
outside the prepared pages gets none of the checking the pages get** — it is not
swept, not reviewed, and not executed before it is handed over. It is now on the
B9 page, with that note attached to it.

**Recorded, not fixed, because they are unproven rather than wrong:**

- **The three step 9 and 10 blocks have never been executed in their current
  form.** They use absolute paths to the owner's own wrappers, the same shape as
  the catalog read that ran successfully, so there is no known defect. That is
  not proof and the page now says so.
- **The B5 browser capture has never been run on Windows.** Its git side was
  verified on Linux and it deliberately moves bytes with `git archive` and `tar`
  so PowerShell never touches them, but the block as a whole is untested there.
  It depends on `tar` being present and on PowerShell splatting an array into a
  native call. The page now says to **run it once well before the merge purely
  to find out** — the one moment it must not fail is the moment it is needed,
  and a dry run costs nothing.

**The general defect class, for whoever prepares the next block:** a runnable
block is only prepared if it has been **executed as written, from the place the
page says to stand**. Everything in this sweep was a difference between the
environment the block was authored in and the one it would be run in — working
directory, shell, PATH. None of it was visible by reading the block. This is the
same shape as the composite-claim rule ratified an hour earlier: the parts that
look obviously fine are exactly the parts nobody checks.


### 2026-09-16 — Composite-claim rule RATIFIED and added; the recursion is the point, not an embarrassment

Short form is now in `AGENTS.md`, in the hash rule's shape. The owner asked that
the practical half be the part written down, so it is: **split a claim and label
each part — read from the code, or assumed about the platform.** The mechanism
that needs the label is specific. A verified half **lends its credibility** to
an unverified half bolted onto it, and the composite then gets recorded as
checked without anyone deciding to record it that way.

The incident: the restore-to-new-project evaluation refused the route partly on
"it fails the installer's identity check, and that is verifiable". The
`IDENTITY_SQL` half really was read from the code. The other half — that
Supabase provisions a restored project as a fresh cluster with a new identifier
— was never checked and was entirely checkable. The rehearsal measured the
opposite.

**Kept prominently at the owner's instruction, because it is the most useful
thing in this record and a later session will be tempted to trim it:**

> That document **asserted the answer to its own open question in one section
> while arguing to go and measure it in another.** One section said the identity
> check would fail; another said the rehearsal was worth running precisely
> because whether identity survives a restore was assumed rather than known.
> Both were written in the same pass. And the push that carried them is the same
> push that recorded the rule about facts knowable by reading live.

That is not an anecdote about one bad paragraph. **It is the rule failing inside
the document that was arguing for the rule**, which is the strongest available
evidence that stating a rule does not apply it. A future session that finds
itself writing "and that is verifiable" should treat the phrase as a prompt to
split the claim, not as a summary of work already done.

Worth being precise about why it survived review by its own author: the claim
read as verified *because part of it was*. There was no moment of deciding to
assert something unchecked. The labelling step exists to create that moment.

### 2026-09-16 — Restore duration BOUNDED, not measured: at most 12 minutes; the rehearsal project is deleted

The owner started the restore-to-new-project rehearsal at **09:38 local**
(UTC-6) and ran the identity query at **09:50 local**. The restore was complete
by then. So it completed in **at most 12 minutes**.

**This is a ceiling, not a measured duration.** Nobody observed the moment the
restored database first became usable. It may have been ready several minutes
before 09:50 and simply waited until the query was run. "Twelve minutes" must
not be quoted anywhere as how long a restore takes.

What it does establish: B4's restore duration moves from **unknown** to
**under a quarter of an hour, as an upper bound**. That rules out the
hours-long case nobody could exclude before.

The full statement, with what would make it exact and what it does not cover,
is appended under B4's duration note.

**The rehearsal project has been deleted** by the owner. Nothing of it remains
to be cleaned up or paid for.

### 2026-09-16 — Identity: three of four fields measured across the restore; restore-to-new-project NOT adopted, and what it is proven for recorded

The owner reported two more identity fields from the restore rehearsal. The
restored project returned `current_database = postgres` and
`database_oid = 5`, and live returns the same. **Cross-checked on the owner's
machine with no new SQL:** the private identity records of the 2026-09-14,
2026-09-15 and 2026-09-16 catalog reads all show `postgres` and `5` for live.

So three of the installer's four `IDENTITY_SQL` fields now match across a
Supabase restore **by measurement**: `system_identifier`, `current_database`
and the database OID. The fourth, `session_user`, was **not measured** on the
restored side and stays unmeasured.

The owner then decided the route question. It is recorded as two decisions,
kept apart so the second can be found on its own:

- **D13**: restore-to-new-project is **not adopted** as the recovery route.
  In-place restore remains the route.
- **D14**: what restore-to-new-project **is** proven for. It can produce a
  restored copy beside the live database without touching it, which improves
  the accepted-loss position of 2026-09-15.

### 2026-09-16 — Owning the identity claim: I asserted what the rehearsal was for, and the rehearsal refuted it

The storage session's entry below caught this and was right. Recorded here as
the cloud session's own correction, because the mistake was mine and a record
where someone else always catches me teaches the next session the wrong thing.

The restore-to-new-project evaluation refused the route on two arguments. One
was that it fails the installer's identity check, "and that is verifiable".
**The rehearsal measured the opposite.** Live and the restored project both
report `7642734024280108049`. The restore carries the control file and the
identity check survives it. That section of the proposal is now retracted in
place, with the original claim quoted rather than deleted.

**The shape of the error, which is not "I got a fact wrong".** Half the claim
was genuinely verified: `IDENTITY_SQL` really does read `system_identifier` from
`pg_control_system()`, and I read that from the code. Bolted onto it was an
inference about what Supabase does when it provisions a restore — a new cluster,
therefore a new identifier — which was never checked and was entirely checkable.
The verified half lent its credibility to the unverified half, and the whole
thing got written down as "verifiable".

**And the thing that makes it worse rather than excusable:** it was checkable by
running the very rehearsal that document was proposing. The document asserted
the answer to its own open question in one section while arguing for measuring
it in another. That is the ratified rule failing at the moment it was most
obviously applicable — *when a fact about live is knowable by reading live, read
it rather than reasoning toward it* — and it went in the same push that recorded
the rule.

The refusal's other argument never depended on the identity claim and stands
untouched: a restored new project has a different reference, URL and keys,
nothing points at it, and the outage is not over until every consumer is
repointed. The verdict on the route is unchanged and is the owner's; only the
reasoning is corrected.

Adopted from the storage session's entry, because it is more precise than what I
wrote: `IDENTITY_SQL` checks **four** fields, and the rehearsal reported
`system_identifier` alone. The database OID would be carried by the same
physical-copy rule, but it was not measured, so it is expected and not
established. My own entry said "the identity check would still pass" without
that qualifier, which is the same over-claiming in the opposite direction.

**A composite claim is only as verified as its weakest part.** Splitting one
into "read from the code" and "assumed about the platform" would have caught
this before it was written, and neither half was hard to label.


### 2026-09-16 — MEASURED: `system_identifier` survives a Supabase restore; the B4 identity caveat is closed

**Result of the approved restore-to-new-project rehearsal, reported by the
owner:** the restored project's `system_identifier` is
**`7642734024280108049`**, and live reads the same value.

**Cross-checked independently on the owner's machine, with no new SQL.** The
private identity records written by the three catalog reads on this machine all
carry that value for live: 2026-09-14 (the last passing read), 2026-09-15, and
today's step 8 observation. So live's value is stable across three days and
three reads, and the restored project matches it.

**What this settles.** The earlier entry recorded a *rule*, measured on an
isolated cluster: a physical copy preserves `system_identifier`, a logical
restore cannot. It left one thing outstanding: whether a managed Supabase
restore actually carries the control file. **It does, observed on this
project.** The restore behaved as a physical copy, and by implication so does
the in-place restore of the same PHYSICAL backups. The recovery route B4 closed
on no longer rests on an assumption at this point: after a restore, the
installer's `IDENTITY_SQL` check keeps the identifier it expects.

**Stated precisely, so nothing is over-claimed.** `IDENTITY_SQL` checks four
fields: `current_database()`, the database OID, `session_user`, and
`system_identifier`. The rehearsal result names `system_identifier` only. By
the same physical-copy rule the database OID is carried too, but that was not
reported, so it is recorded as expected, not measured.

**Update, 2026-09-16, owner. Measured, no longer expected. The sentence above
is kept as written.** The restored project also returned
`current_database = postgres` and `database_oid = 5`. Live returns the same,
confirmed against three private reads. Three of four identity fields are now
measured to match: `system_identifier`, `current_database` and the database
OID. **`session_user` remains unmeasured** on the restored side.

**Correction to the restore-to-new-project evaluation. The original entry is
kept as written.** That entry refused the route partly by reading `IDENTITY_SQL`:
"a new cluster carries a different identifier, so `fail('IDENTITY')` follows".
**The rehearsal measured the opposite for `system_identifier`.** That half of
the refusal's reasoning does not hold. Its other argument is untouched and
stands on its own: a restored new project is a different reference, URL and
keys, nothing points at it, and the outage is not over until every consumer is
repointed or the data migrated back. Whether the route's adoption changes is
**not decided here**. The reasoning is corrected; the verdict is left to the
owner.

**Decided, 2026-09-16, owner: NOT adopted.** The identity objection is gone,
but the decisive objection stands: the consumer repointing has never been
rehearsed. In-place restore remains the route. See D13, and D14 for what the
route is nevertheless proven for.

### 2026-09-16 — Byte check PASSED on the authored contract; the directory named for it was the wrong one

The cloud session authored the settled-state observed contract against a stated
SHA-256, and nothing downstream was to be built until the bytes were confirmed.

**Result**, reported as the full value rather than a verdict:

- Candidate written by the successful derivation (`b9-derive-20260916-2`):
  SHA-256
  `c8e934bcdfd0f43ffe8767f076bbc65e6aae803285ae380e3e552f302fb6778a`,
  2,907 bytes.
- `docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260916.json` on the
  branch (`46a60b81`): the same SHA-256, 2,907 bytes on disk, git blob 2,907.

The owner compared the values and confirmed the check passed. No line diff was
needed.

**One line worth keeping.** The request named `b9-derive-20260916-1` as the
directory. That was the **failed** first run, which stopped before writing any
candidate, and the path came from the supervisor, not from the session's own
record. The session showed that `-1` held no candidate, did not quietly
substitute `-2`, and said so before running the command. Refusing to substitute
kept the check honest: a comparison run against a silently swapped input is not
the comparison that was asked for, however likely the swap is to be right.

### 2026-09-16 — RESTORE REHEARSAL ANSWERED BY MEASUREMENT: a Supabase restore preserves cluster identity, so the installer's identity check survives one

The owner ran the rehearsal on his own project. **Measured, on live and on the
restored copy:**

| | `system_identifier` |
|---|---|
| live | `7642734024280108049` |
| restored copy | `7642734024280108049` |

**Identical.** A Supabase restore preserves the cluster identity. The
installer's `IDENTITY_SQL` check, which is built on `system_identifier` from
`pg_control_system()`, would still pass against a restored database. By the
reasoning recorded earlier the same day — physical copies carry the control
file, logical restores into a new cluster cannot — **the in-place case is
settled by implication**, and the recovery route B4 closed on works on this
point.

That closes the question this file recorded on 2026-09-16 as "supported but not
observed". It is now observed, on the real project, and no longer rests on the
platform's PHYSICAL label plus a rule measured elsewhere.

**Clarification, at the owner's instruction, so a number in this file is never
misread as live's.** The earlier entry's table gave
`7686148391648556190` for the "original" cluster and
`7686148429403448532` for a logical restore. **Both were throwaway clusters in
the cloud session's sandbox**, created to establish the general rule about
physical versus logical restores. **Neither is live's value.** Live's is
`7642734024280108049`, above, and it is the only value in this file that
describes the real project. The earlier entry stands as written per the append
rule; this is its correction.

Worth naming why the mix-up was possible at all: the sandbox measurement and the
live measurement answer two different questions — *what does PostgreSQL do* and
*what does our project do* — and they were reported in the same units, one day
apart, in the same file. The general rule was the right thing to measure
locally, and it was never a substitute for the project's own number. This is the
same lesson the ICU correction produced, arriving from the other side: **a
measurement of the mechanism is not a measurement of the instance.**

### 2026-09-16 — Contract byte-confirmed and WIRED; settled68 profile added, fail-closed on two hashes that must be measured

The byte comparison passed: `c8e934bcdfd0f43ffe8767f076bbc65e6aae803285ae380e3e552f302fb6778a`,
2,907 bytes, on the private candidate and on the file on the branch. Downstream
work was unblocked by that result and not before it.

**The loader now holds a named registry rather than one pinned artifact.**
`linear-exit-observed-public-catalog.js` carries `ARTIFACTS` with `observed67`
(2026-09-12, 67 tables) and `settled68` (2026-09-16, 68 tables). A caller selects
**by name**; nothing accepts a caller-supplied path or hash, so a new starting
picture stays a reviewed addition to that table and can never be an argument.
The default is still `observed67`, so every existing caller is unchanged, and an
unknown name raises `OBSERVED_CATALOG_UNKNOWN_CONTRACT`. The contract selection
threads through `linear-exit-observed-install-plan.js` and
`linear-exit-observed-full-install-plan.js` as an optional argument, again
defaulting to the old behaviour.

**Route B, as decided, means no delta is reversed.** `settled68`'s build asserts
the catalog hashes to `ddfa4c4f…` and then builds the plan **directly** from it,
because the contract it is compared against is the settled one. That is the
whole reason Route B was chosen over reversing a six-class delta. The build also
asserts that the resulting plan declares `initial_catalog_sha256` equal to the
settled hash, so a contract and a profile can never be wired to different
pictures without the build noticing.

**Both of the profile's hashes are `null` and neither was guessed.** `get()`
refuses `settled68` until they are pinned, so it cannot be used by accident;
`build()` still works, because building is how the plan hash is obtained in the
first place. A plausible-looking hash written into that table would be exactly
the silencing D8 forbids, and the temptation is real because the slot is right
there. The refusal message says so in the code, not just here.

- **plan** is measured with `scripts/linear-exit-b9-catalog-derive.js
  --plan-from=<private settled catalog>`. Pure function of this repository plus
  the settled catalog: no cluster, no install, nothing hosted, seconds to run.
- **target** is not derivable anywhere but a calibration run of the installer,
  and that needs the private observed-schema inputs. It stays with session C.

**Verified offline:** both contracts load and report their own table counts, the
default is still `observed67`, an unknown contract is refused, `get()` refuses
the unpinned profile, both existing profiles still return their original pins,
and `settled68` refuses a catalog that is not the settled one.

**Not verified offline, and stated rather than glossed:**
`test/linear-exit-observed-full-install.js` and
`test/linear-exit-atomic-writer-bound-bundle.js` both fail here with "explicit
private observed catalog path required". They fail identically at the parent
commit, so this is the sandbox lacking the private inputs, not a regression —
the same class as `test/ef-deploy-provenance.js`. The settled profile's real
proof is the `--plan-from` run on the owner's machine.

### 2026-09-16 — NEAR MISS: the byte comparison was nearly run against the failed run's directory, and a refusal is what stopped it

Recorded at the owner's instruction, and it belongs in this section rather than
being softened into a footnote.

The directory named for the byte comparison was the **`-1`** output directory.
`-1` was the run that FAILED on the collation; `-2` was the successful
derivation. The candidate file in `-1` either does not exist or is not the one
that produced the published numbers. Comparing against it would have produced a
mismatch, or worse a false match against the wrong artifact, at the exact moment
the check existed to be trusted.

**The supervisor's instruction was wrong, and the storage session refused to
substitute rather than quietly picking the directory that looked right.** That
refusal is the whole reason this is a near miss and not an incident. A session
that had "helpfully" corrected `-1` to `-2` on its own would have produced the
right answer this time and taught everyone that the instruction did not need to
be right.

Two things worth keeping:

- **A mandatory check is only as good as the thing it points at.** The check
  itself was correctly specified and would still have been worthless. When a
  comparison is made mandatory, the identity of BOTH sides has to be as
  carefully established as the comparison.
- **Refusing to substitute is correct behaviour even when the substitution
  would have been right.** This file already records the same shape from the
  other direction, in D8: a permission system blocked an edit, the session
  stopped rather than routing around it, and the owner later judged the refusal
  correct on the merits.

Numbered attempt directories are exactly the setup for this: `-1` and `-2` look
interchangeable in an instruction and are not. The sitting page's rule that a
failed attempt keeps its directory is what made both exist at once.


### 2026-09-16 — Settled-state observed contract AUTHORED; awaiting the mandatory byte comparison before anything is built on it

`docs/independence/LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260916.json`, 2,907
bytes, file SHA-256
`c8e934bcdfd0f43ffe8767f076bbc65e6aae803285ae380e3e552f302fb6778a`.

**Nothing downstream has been built on it.** The loader still points at the
2026-09-12 artifact, no profile has been written, and no pin has moved. The
owner made the byte comparison mandatory rather than advisory, and that is the
next thing that happens.

**How transcription risk was removed rather than managed.** The fifteen section
hashes were **parsed out of the part 3 journal table by script**, never retyped.
The file was then assembled by Node using the same key order as
`observation()` and the same `JSON.stringify(x, null, 2) + '\n'` serialization
the derivation itself used, so a byte comparison against the private candidate
is a fair test rather than a formatting argument.

**Three independent checks passed before the file was written:**

- All **nine** sections the derivation marked unchanged hash **byte-identical**
  to the committed 2026-09-12 contract.
- All **six** sections marked moved differ from it. Neither direction had an
  exception.
- Every reviewed count in the table agrees with the committed contract's counts,
  and the catalog query's SHA-256 still equals the one the old contract pins,
  so the query has not drifted underneath either artifact.

Those checks constrain the parse and the arithmetic. **They do not verify the
six moved hashes or `catalog_sha256`**, because nothing in this repository holds
those values independently. Only the owner's private candidate does. That is
exactly the gap the byte comparison closes, and it is why it is mandatory.

The file is `-text` pinned in `.gitattributes`, the same way its predecessor is,
because `linear-exit-observed-public-catalog.js` hashes the file bytes as
`ARTIFACT_SHA256`. Pinned **before** the comparison deliberately: an unpinned
file could be rewritten by a Windows checkout and fail the comparison for a
reason that has nothing to do with its contents.

### 2026-09-16 — CORRECTION from the owner: the locale-independent ordering fix is DEFERRED, and the earlier "cheapest moment" framing was wrong

Recorded as the owner's own correction of guidance he had given earlier the same
day, and worth keeping in that form.

The earlier framing — mine and then his — was that the cheapest moment to make
the catalog query's ordering locale-independent is while the reviewed picture is
being re-authored anyway. **That was true before the derivation ran and is false
now.** Changing the catalog SQL changes the hash live produces, which invalidates
today's derivation and costs another keyboard sitting.

**Deferred, with the condition attached, because the condition is the whole
point:** the fix can only ever ride along with a future re-derivation that is
happening for some other reason. It must never be made as a standalone change.
A standalone change would invalidate whatever derivation is current and buy
nothing until the next one.

The fragility it addresses, restated so it is not rediscovered: the
`dependencies` array is ordered by text columns only to make it deterministic
for hashing, and nothing consumes that order. So the hash is sensitive to the
server's collation, which means it conflates *a different sort locale* with *a
different schema*. Making the ordering locale-independent would be a correctness
fix, not silencing. It is still deferred.

### 2026-09-16 — Rule: when a fact about live is knowable by reading live, read it rather than reasoning toward it

The owner's line, from the ICU correction, and the third time today the same
pattern showed. Kept as one rule because it is the general form of all three.

> **When a fact about live is knowable by reading live, read it rather than
> reasoning toward it.**

The collation case is the clean example. Portability was a true argument and it
pointed at the right answer. It was not the decisive one, and the decisive one —
live's own `pg_database` row — was a single read-only query away. An argument
that happens to land on the right answer is not a substitute for the fact, and
the cost of confusing the two is that the next one lands the other way.

This sits alongside the 2026-09-15 entry on verdicts reached through unchecked
reasoning. That entry was about methods that were never run. This one is about
methods that were run but were never the load-bearing thing.

### 2026-09-16 — Scope note on the date correction: it is the ONLY in-place edit the append rule permits

At the owner's instruction, so nobody generalises from it.

Eleven date stamps were corrected in place earlier today rather than by
appending a correction below them. That was right for one narrow reason: the
stamps were **clerical metadata**, not claims, and leaving them would have
inverted the record's order against this file's own newest-at-top rule, making
the owner's sitting appear to precede the analysis it followed and cited.

**That is the only in-place edit the append rule permits.** A wrong date is a
label on the record. A wrong claim, number, hash, conclusion or piece of
reasoning is part of the record, and it stays, with the correction below it.
If a future session finds itself reasoning that some other edit is "clerical
too", it is almost certainly about to delete evidence. The test is simple: if
removing it would make the file's history read as though a mistake had never
happened, it is not clerical.

### 2026-09-16 — CORRECTION to the collation entry: the right answer, reached by an argument that was not the decisive one

The ICU recommendation was correct and the owner's retry confirmed it. The
reasoning given for it was not the reason it is correct, and that is worth
recording because it is the failure shape this file already warns about.

The entry below argued ICU on **portability** grounds: PostgreSQL on Windows
does not handle UTF-8 libc locales well, and ICU behaves the same everywhere.
True, and beside the point. The decisive fact is that **live's own database uses
ICU `en-US`**, which the owner established with one read-only query against
`pg_database`. Matching live is the requirement; portability was a convenience
argument that happened to point the same way.

This session could not have read live — no SQL against production — but it could
have said so, and said that the collation must be taken from live's own
`pg_database` row rather than chosen on any other basis. Instead it recommended
a locale on secondary grounds and did not name the check that would settle it.
**A correct conclusion from an argument that was never the load-bearing one is
still an unchecked method**, and this file already records that lesson from
2026-09-15. It landed the right way twice now, which is luck.

Also recorded from the owner's run, because it is a real limit on what the match
proves: local ICU collation version **153.14** against live's **153.121**.
Different ICU majors. They produced identical orderings for this schema and the
exact-match checks prove it, but that is a fact about this data, not a
guarantee. A future divergence would surface as an order-only mismatch and stop
safely rather than producing a wrong hash.

And his `dependencies` observation is the sharper version of the durable fix
noted below: the array is ordered by text only to make it deterministic for
hashing, and nothing consumes that order, so the hash conflates a different sort
locale with a different schema. That is a latent defect in the check itself.
Making the ordering locale-independent would be a correctness fix rather than
silencing. Not needed today, not changed, and the cheapest moment to weigh it is
while the reviewed picture is being re-authored anyway.

### 2026-09-16 — Short sitting, part 3: B9 settled catalog DERIVED on an ICU cluster; it equals the live read

**Result: `B9_SETTLED_CATALOG_DERIVED`, derivation exit 0.** Every
self-verification in the chain passed, and the offline derivation agrees with
the live read exactly.

**How the retry differed from the failed run.** The owner checked live and
found the premise of the session's question wrong: live's database collation
is **ICU**, not glibc. So the retry used a new throwaway cluster whose flags
were worked out from live's own `pg_database` row (one read-only catalog query):

| | Live | Local throwaway cluster |
|---|---|---|
| PostgreSQL | 17.6 | 17.11 (runbook binaries) |
| Locale provider | ICU (`i`) | ICU (`i`) |
| ICU locale (`datlocale`) | `en-US` | `en-US` |
| Encoding | UTF8 | UTF8 |
| Collation version | **153.121** | **153.14** (bundled ICU 67) |
| ICU rules | none | none |

`initdb -E UTF8 --locale-provider=icu --icu-locale=en-US --locale=en-US`. The
last flag only sets the libc categories Windows still requires. Listening on
`127.0.0.1` only, `F63_REQUIRE_POSTGRES=1`, new directories, cluster stopped
afterwards (`pg_ctl status` exit 3, port not listening). Before the derivation,
a two-string sort probe put `…_counts(pg_catalog.text)` before
`…import(pg_catalog.jsonb)`, the same order as live and the pair the failed run
had inverted.

**The chain, stage by stage:**

- Observed-schema rebuild: `exact_captured_catalog_match: true` (67 tables,
  115 routines, 14 identity sequences). The failed run's order-only mismatch is
  gone.
- `pre_hiring_catalog_sha256`
  `f5ed8a38a4454e62905192c49de9a6a790c1bb48e247884efed12562b1161c25`,
  **`pre_hiring_matches_optout_profile: true`**.
- **`settled_catalog_sha256`
  `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`.**
- **Cross-check: equal to today's live step 8 read.** The live state is fully
  explained by the reviewed opt-out profile plus the hiring migration exactly
  as merged on main. Nothing else moved.
- **`settled_public_tables`: 68.** Equal to the live count measured in part 1.
- Repository head was `fffa901c` at both start and end of the run.

**Per-section hashes of the settled catalog** (reviewed count, then settled
count):

| Section | Counts | Settled SHA-256 | Moved |
|---|---|---|---|
| default_acls | 6 / 6 | `91df0c128bddd74cb59379a5527bd8adc3b226de6b6150053f16bbc3226e3903` | no |
| dependencies | 1336 / 1385 | `8468123989bbba5baee609b3f9f164de510bde51fdeb4c2152e52734c0b2ba3e` | **yes** |
| functions | 115 / 122 | `931a4c488a7894d3ddd39d7f146f0777618a328eb3946cb0a20750ae7ab528e4` | **yes** |
| indexes | 177 / 181 | `0a3d23ede3c0e06af89adffa11636c24e77e978d175aa239ab2356b08184286c` | **yes** |
| internal_constraint_triggers | 120 / 124 | `f30b8f0b305ad70a5e91d3dac295690c0afc8f7dfb8d84e96a086efcfd997341` | **yes** |
| policies | 31 / 31 | `acceb6c96263cf4d03acb1466b88476b8e5aba55ceb26e4d4ba325850b583342` | no |
| publications | 1 / 1 | `c60699c826fab3996ceaa77ef428af5d11f6a71a6e68fba28c8c6a3aac76e182` | no |
| rules | 5 / 5 | `fa1f9a6f1a685d5f39275ec91c73ed354d0ea2a5a37a416724b0b7a825228cb9` | no |
| schema | n/a | `c91069038c90fad6352cf43431351624bd97601f93cafa0d62a11fbc295a404e` | no |
| sequences | 14 / 14 | `52a5069240442913d3e49161ea79043d137531a30ba4aad06711c67d62a39083` | no |
| server_major | n/a | `4523540f1504cd17100c4835e85b7eefd49911580f8efff0599a8f283be6b9e3` | no |
| tables | 67 / 68 | `8b4e693aa135cc923bf7e68bb7c358a06c0675812b9dc865318564434ae40ff9` | **yes** |
| triggers | 28 / 30 | `762848f5011d66f2d08d771d6d84da3788eda7a840f195106407850bd95a2a5b` | **yes** |
| types | 0 / 0 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` | no |
| views | 5 / 5 | `aea9d547855042b848ba97e412b52d57c0503eefdca6defd79fdc0f3e3a0db0b` | no |

Every hash above is copied whole from the derivation's printed output, none
retyped from a prefix. The derived catalog and the candidate observed contract
stay in the private output directory and are **not** committed. Nothing was
re-pinned, no profile was written, and no step 9, 10 or 11 ran. Step 8 still
does not pass: there is no reviewed profile for `ddfa4c4f…` yet, and authoring
one is the cloud session's work.

**ICU version caveat, stated rather than discovered later (owner).** The two
sides run different ICU majors: collation version 153.14 locally against
153.121 live. For this schema they produced identical orderings, and the
exact-match checks prove that. That is a fact about **this** data, not a
guarantee. ICU collation can change between major versions, so a future
derivation on a different schema, or against a live server that upgrades ICU,
could order some text differently. A mismatch would surface as an order-only
difference, as in part 2, and stop safely. It would not produce a wrong hash
silently.

**Observation, not a proposal.** The catalog query orders the `dependencies`
array by text columns only so the array is deterministic for hashing, and
nothing consumes that order. So the hash is sensitive to the server's
collation, which conflates a different sort locale with a different schema.
That is a real latent defect in the check. The owner framed the fix well:
making the ordering locale-independent would be a correctness fix, not
silencing. But it touches a byte-pinned file and cascades into pins. The
cheapest moment to weigh it is while the reviewed picture is being re-authored
anyway. It was **not needed today** and **not changed**. It is recorded so it is
decided deliberately, not rediscovered.

### 2026-09-16 — Collation settled by measurement: use ICU `en-US`; the selfcheck now probes it, which is the fix that matters

Answering the choice the part 2 entry put to the owner. The diagnosis in that
entry is correct and was not taken on trust; the ordering was reproduced here.

**Measured on PostgreSQL 17.11**, on the exact two identities whose order
differed:

| Collation | order |
|---|---|
| `C` (byte order) | `…import(pg_catalog.jsonb)` then `…import_counts(x)` |
| ICU `en-US` | `…import_counts(x)` then `…import(pg_catalog.jsonb)` |
| ICU `unicode` | `…import_counts(x)` then `…import(pg_catalog.jsonb)` |

Live's order is `_counts(` first. So a linguistic collation reproduces it and
byte order does not, which is exactly what the failure showed.

**Recommendation, and it is ICU rather than libc `en_US.UTF-8` for a specific
reason.** The derivation runs on a Windows machine, and PostgreSQL on Windows
does not support UTF-8 libc locales properly — ICU exists for this. ICU is also
reproducible without generating OS locales, so it behaves the same on the
Windows machine, in CI and in this sandbox. The command is on both pages:

```
initdb -D <new data dir> -U postgres -A trust \
       --locale-provider=icu --icu-locale=en-US --encoding=UTF8
```

**The real fix is that the selfcheck now probes it.** It runs those same two
strings against the cluster you are about to use and refuses up front. Verified
both ways here: `B9_DERIVE_SELFCHECK_PROBLEMS` naming the collation against a
`C.UTF-8` cluster, `B9_DERIVE_SELFCHECK_OK` against an ICU `en-US` one.

This is the second time in one day the selfcheck missed something the owner then
hit at the keyboard — first `F63_REQUIRE_POSTGRES` and the loopback host, now
the collation. Both times the pattern was the same: **the check covered what
this session imagined was fragile, not what the code path actually requires.**
The preflight has now been rebuilt from the assertions themselves rather than
from intuition, which is what it should have been to begin with.

**One honest limit, stated on the page too.** ICU `en-US` matches live on the
case we could check. It is not proven identical to live's own collation across
all 1,336 dependency entries. The loader's exact-match comparison is the real
test and it is self-verifying: if `dependencies` matches, the collation was
compatible. If it refuses on `dependencies` again, that should be reported
rather than answered by trying locales in a loop — the next step would be
establishing live's actual collation, which is a read we have not done.

**A durable fix exists and is deliberately NOT being done now.** If the catalog
query sorted its text columns under an explicit `COLLATE`, reconstructions would
be reproducible under any cluster locale and this class of failure would be
gone. But the live captures were taken under live's collation and are pinned by
hash, so changing the query re-pins every observed artifact that depends on it.
That is a bigger change than the one in front of us and it belongs to whoever
revisits the baseline, not to the middle of an install window. Recorded so it is
not rediscovered as though it were new.


### 2026-09-16 — Short sitting, part 2: B9 derivation FAILED on a collation the session chose; stopped, not retried

**What happened.** A throwaway PostgreSQL 17.11 cluster was started on
`127.0.0.1` only, with the runbook's binaries and a new data directory. The
derivation ran with `F63_REQUIRE_POSTGRES=1` into a new private directory. It
returned `B9_DERIVE_FAILED` with stages `["cluster_started"]`. The cluster was
then stopped: `pg_ctl status` exit 3, nothing listening. The directory and its
error log are preserved.

**Where.** Inside the observed-schema reconstruction, before the opt-out
prerequisite or the hiring migration was applied. The loader rebuilds the
2026-09-12 observed schema and compares every catalog section with the capture.
Exactly one section differed: **`dependencies`**.

**Why, measured and not assumed.**

- The rebuilt `dependencies` section holds **the same 1,336 entries** as the
  capture: none missing, none extra. **Only their order differs.** 37 of 1,336
  positions shift. The loader compares each section canonically, so array order
  counts.
- The pinned catalog query orders dependencies by
  `o.type, o.identity, r.type, r.identity, d.deptype`. Those are text columns,
  so the order follows the cluster's collation.
- The first differing position shows the mechanism. Live sorts
  `production_comment_card_import_counts(…)` **before**
  `production_comment_card_import(pg_catalog.jsonb…)`, which is linguistic
  ordering with punctuation weighted low. The rebuild sorts them the other way,
  byte order, where `(` (0x28) precedes `_` (0x5F).
- **The session initialised the cluster with `--locale=C`.** The sitting page
  and the B9 page name no locale; C was the session's own choice, and it was the
  wrong one. CI's PG17 lanes use the `postgres:17` image, whose default locale is
  linguistic, which is why the same reconstruction passes there.

**So this is an environment artifact introduced by the session, not a finding
about the schema, the live database or the scripts.** No derivation numbers
exist yet. Nothing was retried. A retry needs a new cluster, with a linguistic
collation that reproduces live's sort order, and a new output directory. The
choice of collation is put to the owner.

**For whoever writes the next version of these pages:** a derivation or rebuild
whose catalog query sorts text is only reproducible under a collation that
matches live's. State the locale explicitly. "A throwaway PostgreSQL 17 cluster"
is not a sufficient specification, and the `observed-schema` loader's
exact-match check is what caught it.

### 2026-09-16 — CORRECTION: eleven date stamps in this session's work said 2026-09-17 and the date was 2026-09-16; plus the two page defects the sitting found, both fixed

Three corrections, all from the same push.

**The dates were wrong.** Seven progress entries and four in-text references
were stamped `2026-09-17`. The date was `2026-09-16`; the container clock says
so and so do this session's own commit timestamps. The stamps were assumed, not
read. They are corrected in place — the heading date is clerical metadata rather
than the content the append rule protects, and leaving them would have been
actively misleading: the rule here is newest at the top, so a reader would have
concluded the owner's sitting happened *before* the analysis it followed, when
his entry cites the very page that analysis produced.

Nothing in any entry's text was changed. This note is the record that it
happened.

The narrow lesson, and it is the same family as the hash rule: **a date is a
value to be read, not assumed.** `date` costs nothing. The wider one is that
this session also has no reliable sense of elapsed time across turns, so it
should read the clock rather than infer a new day from a new instruction.

**The B9 page said the hiring migration adds three indexes. It adds four**, and
the owner's live read (177 to 181) is right. The migration creates two by name;
the new table's `id uuid primary key` and its `application_id ... unique`
constraint each add a backing index that no `create index` statement mentions.
Verified against the migration rather than taken on trust. The instructive part
is kept on the page: **a migration's catalog footprint is not the list of DDL
statements in it.** Constraints create objects too.

**Neither page named two hard refusals, and that gap was found at the
keyboard.** `scripts/linear-exit-observed-schema.js` asserts
`F63_REQUIRE_POSTGRES=1` and asserts the host is `127.0.0.1` or `::1`, a
caller-owned loopback. The test helper's self-managed cluster satisfies neither:
it starts Postgres with `listen_addresses=''` and connects over a Unix socket,
which is not a loopback address and does not exist on Windows at all. Both are
now on the sitting page and the B9 page.

**The selfcheck now catches both**, which is the actual fix. A selfcheck exists
so that nothing surprises the owner mid-run; one that passes while two hard
refusals are already guaranteed is not doing its job. Verified both ways: it
reports `B9_DERIVE_SELFCHECK_PROBLEMS` naming each when unset, and
`B9_DERIVE_SELFCHECK_OK` when they are set.

That the owner hit these rather than the selfcheck is the point worth keeping.
The check was written to cover what this session thought was fragile — the
PostgreSQL binaries — and not what the code actually asserts. **The right source
for a preflight is the assertions in the code path, read one by one, not a guess
at what usually goes wrong.**


### 2026-09-16 — Short sitting, part 1: selfcheck OK; step 8 catalog read taken as observation only

Run from the owner's Windows machine against the rewritten sitting page
(`c399dc6`). The earlier page's back-to-back ordering was not used. Main is
frozen at `1abdd1fa`.

**Derivation selfcheck, run first as the owner asked:** `B9_DERIVE_SELFCHECK_OK`,
`problems: []`, PostgreSQL **17.11**. Run with nothing set, it found PG17 on
PATH at a second copy under the user's Documents folder. With
`F42_REHEARSAL_PGBIN` set, it found the runbook's copy. Both report 17.11, and
the runbook's copy is the one used.

**Catalog read (step 8), observation only. It does not pass step 8 and was not
meant to.**

1. Catalog hash
   `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`.
   Recomputed from the catalog, it matches the receipt, and it is
   **byte-identical to the 2026-09-15 read**, so nothing moved live overnight.
2. `profile: null`, `matches_reviewed_baseline: false`, exit 2: the expected
   result. `tls_verified: true`. Identity equal to both the 2026-09-15 read and
   the last passing 2026-09-14 read.
3. Section diff against the last passing `observed67_optout` catalog
   (`f5ed8a38…`): tables 67 to 68 (4 entries added, 3 removed: one new table and
   three changed hiring tables); indexes 177 to 181; triggers 28 to 30;
   functions 115 to 122 (10 entries added, 3 removed: seven new and three
   changed); dependencies 1,336 to 1,385; internal constraint triggers 120 to
   124. Identical: rules, types, views, schema, policies, sequences, default
   ACLs, publications and server major.
4. **Live public tables: 68.** This is measured, not derived. It confirms the B9
   page's reasoning that the operator's hard-coded post-install constant of 90
   would now refuse at `GUARD_COUNT`. The constant is not touched here; it is
   re-derived with the new target, per D8.

**Two things found, recorded rather than edited:**

- **The B9 page says the hiring migration "adds three" indexes. Live shows
  four.** The migration creates two indexes explicitly
  (`hiring_applications_role_slug_idx` and the dispatch index). The new table's
  primary key and its unique `application_id` constraint each add a backing
  index. The table on that page understates by one. The page is left for its
  author to correct.
- **The sitting page and the B9 page do not mention `F63_REQUIRE_POSTGRES=1`.**
  The observed-schema loader asserts it, so the derivation fails at its first
  real stage without it. They also do not say that the helper's self-managed
  cluster cannot work on Windows: it listens on a Unix socket only, while the
  derivation insists on `127.0.0.1`. The page's instruction to start a loopback
  cluster yourself is the only route that works here.

The four observed-schema inputs are at the top of the directory the checkpoint
records, `2026-09-12-fast-finish-evidence`. Only their filenames and sizes were
listed, not their contents.

### 2026-09-16 — Rewrite rule RATIFIED and added; extending append-only to the rest of `docs/ops/` was considered and deliberately NOT done

The proposed rule below is ratified by the owner and its short form is now in
`AGENTS.md`, in the same shape as the hash rule: statement there, reasoning
here.

The more interesting half is what was decided against.

The observation that prompted it: **the journal is the only document in this
estate with structural protection against losing what it already said.** Its
append-only rule means a correction goes *below* the original and nothing is
deleted by default. Nothing else in `docs/ops/` has that, which is exactly why
the 2026-09-16 failure landed on the sitting page and could not have landed
here. The sitting page was rebuilt wholesale; the journal cannot be.

The obvious response is to extend append-only to the rest of `docs/ops/`. **The
owner ruled against it, and the reasoning is worth keeping so nobody proposes it
again as though it were new.**

Those documents genuinely need editing. A runbook, a checklist and a sitting
page exist to describe the current state accurately; an append-only runbook
accumulates contradictory instructions and pushes the reader into deciding which
paragraph is live — which is a worse failure than the one being prevented, and a
more dangerous one at a keyboard mid-procedure. The journal can be append-only
precisely because it is a *record* rather than an *instruction*: it is read to
understand how we got here, not to decide what to type next.

So the two kinds of document get two kinds of protection. Records get
append-only. Instructions get the rewrite rule, which costs one diff and leaves
them editable. **The rule is the right level of response and the stronger
version was rejected on purpose, not overlooked.**

Also confirmed today: the restore-to-new-project rehearsal is approved at the
$10 figure, **to start when the offline authoring day begins and not before**,
with the project deleted the same day. The owner's framing of it, which is the
accurate one: the physical-versus-logical measurement already did most of the
work, so the rehearsal is confirmation plus the duration number rather than a
discovery.


### 2026-09-16 — MEASURED: a physical restore preserves `system_identifier`, a logical one cannot; the in-place recovery route's identity assumption is now supported rather than assumed

The owner asked for this answered explicitly and journalled either way, because
if the identity does not survive a restore then the recovery route B4 has just
been closed on does not actually work.

Measured on an isolated PostgreSQL 17.11 cluster in this sandbox, not reasoned
from documentation:

| Cluster | `system_identifier` |
|---|---|
| original | `7686148391648556190` |
| physical copy via `pg_basebackup` | `7686148391648556190` — preserved |
| logical restore into a fresh `initdb` cluster | `7686148429403448532` — new |

The rule, stated once so it is not re-derived: **the identifier is a property of
the cluster, written when the cluster is created. A physical copy carries the
control file and preserves it. A logical restore into a new cluster cannot,
because the new cluster wrote its own.**

Applied to us: the Backups page marks all eight daily backups **PHYSICAL**. So
an in-place restore should preserve the identifier, and the install operator's
`IDENTITY_SQL` check would still pass after one. That moves the recovery route
from *assumed sound* to *supported by the platform's own label plus a measured
rule*.

**It is still not observed.** Nobody has watched a managed restore of this
project and read the value afterwards, and the managed flow is not ours to read.
What remains is narrow and is exactly what the rehearsal will observe: whether
restore-to-new-project carries the control file, or re-provisions and replays.
If it carries it, the in-place case is settled by implication. If it does not,
that route is logical in effect and a restored project would need its identity
expectation re-derived before any installation could resume against it.

Recorded as a partial answer rather than a full one, deliberately. The rule is
established; the observation is outstanding.

### 2026-09-16 — Restore-to-new-project rehearsal approved; cost confirmed at $10/month; the REASONING recorded, not just the verdict

The owner approved the rehearsal and asked that the reasoning be kept, not only
the conclusion, because the next person to open that Backups page will form the
same first impression this session did.

**The first impression, which is wrong.** The dashboard offers "Restore to new
project (BETA)" beside the in-place restore, and it reads as the strictly safer
of the two: it does not destroy the live database. Every instinct says take the
one that cannot lose anything. That instinct is about the *database*, and the
question is about the *recovery*.

**What breaks it.** A new project is a different database with a different
reference, URL and keys. The browser configuration, the Edge functions, the
scheduled workers and the n8n workflows all still point at the old project and
keep pointing there. So the restore produces a healthy database that nothing is
talking to. **The outage is not over when the restore finishes.** Ending it
needs a second operation — repointing every consumer, or migrating the data back
— which is not written down, not rehearsed, and in the repointing case is a
configuration change inside the scope of the current freeze.

**How that was found, which is the part worth keeping.** Not by reasoning from
the dashboard's framing, which would have produced "safer, therefore better",
but by asking what the installer actually checks. `IDENTITY_SQL` in
`linear-exit-install-journal.js` builds its identity from `current_database()`,
the database OID, `session_user`, and `system_identifier` from
`pg_control_system()`. Reading that query is what turned a plausible-sounding
option into a verifiable refusal: a new cluster carries a different identifier,
so `fail('IDENTITY')` follows. **The general lesson is the cheap one: when
evaluating a route, read what the code asserts about it rather than what the
interface says about itself.**

**The Storage consequence, which nothing in the interface hints at.** The page
says database backups exclude Storage objects, and that is true of both routes.
But the two are not equally affected. In place, a database restore leaves the
existing Storage bucket untouched, so Storage is merely not-restored. In a new
project, Storage is **empty**. The separate Storage custody package stops being
a backstop and becomes the only source. That asymmetry is invisible from the
dashboard and only appears once you ask what the restored project *has*, rather
than what the backup *contains*.

**Cost, confirmed rather than guessed.** Read from this organization's own cost
endpoint: an additional project on the Pro plan is **$10/month recurring**.
Supabase bills compute hourly so a short-lived project should cost a fraction of
that, but **that proration was not verified here**, so the recorded figure is up
to $10 and the mitigation is deleting the rehearsal project the same day. That
deletion is written into the rehearsal steps rather than left to memory.

Scheduled to run during the offline authoring day, so it costs the owner almost
no attention: start it, leave it, come back for the elapsed time and one query's
output. Click path, the query, and what each answer means are in
[`LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md`](LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md).
**The reviewed recovery procedure remains unchanged.**

### 2026-09-16 — The collapsed-sitting idea has a dependency problem, noticed not solved, recorded for whoever revisits it

The owner declined the collapsed script on scheduling grounds — the offline
authoring day is the long pole and cannot start until the sitting finishes, so
time spent building and reviewing a collapse delays the thing that is actually
slow. The session it would save is the following day's, which is not the
constraint.

He also pointed at something this session had not noticed, and it is the part
worth keeping:

> A collapse calibrates against a profile that does not exist yet.

That is right, and it is a design question rather than a plumbing one. The
second keyboard session exists **because** the third profile has to be in code
before the installer can be pointed at it: `linear-exit-install-profiles.js`
resolves a profile by name and the operator worker is driven from it. A script
that derived the catalog and calibrated the target in one run would have to
build a plan against a profile nobody had authored or reviewed, in the same
breath as inventing it.

There may be an answer — the existing `INSTALL_OPERATOR_CALIBRATE=1` path is
already a way of deriving a target before its hash is pinned, so the shape is
not unprecedented. But it has to be answered before any of the plumbing is
written, not after. **Anyone revisiting the collapse should start there and not
with the script.**

### 2026-09-16 — PROPOSED house rule, not added: a rewrite is not a refactor

Proposed at the owner's request, in the shape of the hash rule. **Not added to
`AGENTS.md`.** It goes in only if he ratifies it.

> ## A REWRITE IS NOT A REFACTOR. DIFF IT AGAINST WHAT IT REPLACES.
>
> When you rewrite a document or a file wholesale rather than editing it in
> place, diff your version against the one it replaces before you ship it, and
> confirm that **every warning, constraint and stop condition you dropped was
> dropped on purpose.** Say which ones, and why, in the commit message.
>
> The failure this exists for is not carelessness. It is building to a
> requested *shape*. On 2026-09-16 a sitting page was rebuilt as "one ordered
> pass" because that was the shape asked for, and the shape silently discarded
> a constraint written down in the page being replaced: that two of those steps
> cannot run until a profile exists. Three separate places in the record said
> so. The rewrite contradicted all three and was never compared against any of
> them.
>
> A wholesale rewrite deletes everything by default and re-adds what the author
> happens to remember. That is the opposite of an edit, where everything
> survives by default. Treat the deletions as the risk, because they are the
> part nobody reviews: a reader of the new version cannot see what is missing.

One note on scope, for the ratification decision: the rule is cheap when the
thing being rewritten is a document, and it is the same discipline the estate
already applies to the journal through its append-only rule. The journal has
that protection; nothing else in `docs/ops/` does.

### 2026-09-16 — CORRECTION: yesterday's sitting page put steps 9 and 10 in a sitting they cannot run in

Caught by the owner asking the right question before clearing his day, which is
the only reason it did not cost him the sitting.

The page as rewritten on 2026-09-16 ran sections 1 to 4 back to back: catalog
read, database capture, custody drill, with the one-hour catalog clock between
the first two. The page it replaced said the opposite, in terms:

> **Do not run step 3 after this one today.** Its wrapper consumes a catalog
> receipt and will refuse one that names no profile. Steps 9 and 10 wait until
> the new profile exists.

That warning was dropped in the rewrite. It should not have been. D12 says the
same thing — steps 8, 9 and 10 run back to back **after** the profile exists —
and the B9 row says it again. Three independent places in the record, and the
rewrite contradicted all three.

The mechanism of the error is worth keeping, because it is not carelessness in
the usual sense. The instruction was to put steps 8, 9, 10 and 11 into **one
ordered pass**, and the page was built to satisfy that shape. The shape was
wrong for the current state, and building to it silently discarded a constraint
that was written down in the thing being rewritten. **A rewrite is not a
refactor: every warning removed has to be removed on purpose.** Nothing in the
rewrite was checked against the page it replaced.

Corrected: the sitting is now the catalog read (observation only) and the B9
derivation, about 35 minutes with no clock in it. Steps 9 and 10 live in a
clearly-labelled later sitting, with the clock attached to that one. Step 11
moves there too, and now says plainly that it needs fields from the owner's
private receipt because this session has no route to read them.

### 2026-09-16 — B4 CLOSED with the restore duration recorded as unknown; "restore to new project" evaluated and NOT adopted as the recovery route

The owner ran the B4 dashboard check read-only on 2026-09-16, clicking nothing.
Eight daily backups, 09 Sep through 16 Sep, newest 16 Sep 11:19:55 +0000, all
PHYSICAL, each with a **Restore** control present and enabled. Point in Time tab
present; PITR stays declined on cost. The page states that database backups do
not include Storage objects and that restoring does not bring back deleted
files.

B4 closes. The capability question is answered yes, the decision half was
already taken, and the only remaining piece — how long an outage a real restore
would cost — is not measurable without performing one. **Recorded as unknown
rather than estimated.** An estimate here would be a number with nothing behind
it, and it would be treated as a fact by the next session.

The Storage exclusion is recorded as part of the closure, not as a footnote: it
is the reason the separate Storage custody capture exists, and it means a
database restore returns a database whose Storage references are only as good as
that separate package.

The owner also found **Restore to new project (BETA)** and asked whether it is a
better route. Evaluated in
[`LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md`](LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md).
It is not, for one reason that the dashboard's framing hides: a new project is a
different database with a different reference, URL and keys, and nothing points
at it. The restore does not end the outage; it produces a healthy database with
no consumers, and ending the outage then needs an unrehearsed repointing that is
itself inside the freeze's scope.

Verified rather than assumed: it would also fail the installer's identity check.
`IDENTITY_SQL` includes `system_identifier` from `pg_control_system()`, which is
a property of the cluster, so a new project carries a different one and
`fail('IDENTITY')` follows.

It is proposed instead as a **rehearsal** route, because it can close two things
cheaply and at no risk: it measures the restore duration that B4 has just been
closed calling unknown, and it answers a question the procedure currently
assumes — whether `system_identifier` survives a restore at all. If it does not,
an installation could not resume against its own recorded identity after a real
recovery. Nobody has checked. **The reviewed procedure is unchanged**, as
instructed.

### 2026-09-16 — Corrections accepted and recorded: B10's "blocked on access" was wrong, and the branch was right

Both at the owner's direction, recorded here so the file does not keep the wrong
version as its only account.

**B10 was never blocked on PostgreSQL 17 access.** The 2026-09-16 note
concluded "the missing thing is a disposable PG17 server". That was wrong twice
over: the PGDG repository was reachable and simply not configured, so a server
was available for the asking; and B10's actual gate is D12's ordering, which
puts it behind B9 regardless of what servers exist. The note stands above per
the append rule. PostgreSQL 17.11 now runs in this sandbox.

**The working branch is `prep/linear-exit-review-fixes-20260913`**, as the
checkpoint says and as the owner confirmed, not the branch named in the session
bootstrap. Recorded because a future session will meet the same contradiction
and should resolve it the same way: the checkpoint and the owner win.

**B9 and the 90 are both confirmed by the owner, 2026-09-16.** Derive a new
reviewed picture at the settled state; do not attempt the six-class reversal.
The operator's constant is re-derived from the measured table count, never
edited to match. The owner read the constant himself and confirmed it is a hard
`fail('GUARD_COUNT')` counting one guard trigger per public table, not a
warning. He also named the trap directly, which is worth quoting because it is
sharper than D8's general form: editing 90 to 91 is exactly the silencing D8
forbids, **and it is more tempting here precisely because the right answer looks
one digit away.**

### 2026-09-16 — B10 confirmed OFF the critical path from code; the guard installs open, and adding the table today would BREAK the install

The owner's reading was that the admission guard installs open and only bites
once admission is closed. Confirmed against the code rather than the briefing,
in `supabase/migrations/20260912174907_card_atomic_admission_preparation.sql`
and `20260912183653_application_dml_admission_preparation.sql`:

- `card_write_admission_v1.mode` is `text not null default 'open'`, and the
  singleton row is inserted naming only `singleton`, so it takes that default.
- `production_application_dml_guard_v1` opens with
  `if gate.mode='open' and context.kind is distinct from 'followup' then` and
  returns straight through for statement, row and delete. At `open` the guard
  is inert on every table it is attached to.
- Closing is a separate explicit call. Nothing in the install path makes it.

So B10 does not block the install or the merge. **Recorded as not blocking.**

The check turned up something stronger, which is worth stating plainly because
it inverts the intuition: **doing B10 today would break step 14.**
`production_retirement_contract_assert_v1` compares the live set of
`aaa_application_dml_admission_%` triggers, across all public tables, against a
frozen expected blob, and `scripts/linear-exit-install-operator.js` asserts that
contract **twice** — once at target comparison, once after finalization. Adding
`hiring_practical_test_jobs` to the guard list adds two triggers, the actual set
stops matching the blob, and the operator refuses. Not adding it is what keeps
the install able to run.

That also explains the red lane B10 recorded: with the addition reverted out of
the catch-up, the contract matches again. Verified by running
`test/linear-exit-retirement-switch-postgres.js` against an isolated PostgreSQL
17 in this sandbox: `LINEAR_EXIT_RETIREMENT_SWITCH_OK`, 46 checks.

D12's ordering stands unchanged: hiring migration on main (done), profile
re-derived (B9), and only then the guard list.

### 2026-09-16 — PG17 IS available in this sandbox; the recorded B10 blocker was a missing repo, not a missing server

The 2026-09-16 B10 note says this sandbox has "only 16, no PGDG repo and no
docker daemon", and concludes "the missing thing is a disposable PG17 server".
Two of the three facts are still true — the daemon is down, the base image is
PostgreSQL 16 — but the conclusion was wrong. The PGDG repository was not
*unreachable*, it was *not configured*. It was reachable on the first try.

PostgreSQL 17.11 is now installed here from PGDG and an isolated cluster runs
on `127.0.0.1`. The existing harness finds it through `F42_REHEARSAL_PGBIN`.

Consequence: PG17-dependent work is no longer gated on the owner's machine for
sessions in this environment. It does **not** move B10 forward, because B10 is
gated on D12's ordering, not on a server. It does mean the B9 derivation and
the target calibration can be rehearsed here before they are asked of him.

Recorded because the original note would otherwise send the next session to the
owner's keyboard for something it can do itself. The narrower lesson is the one
already in this file: check whether a missing thing was ever configured before
concluding it is unavailable.

### 2026-09-16 — B9 is not a re-pin: the plan builder REFUSES any catalog but the reviewed one, and the hiring delta cannot be reversed the way the opt-out one was

B9 is written as "re-derive the catalog profile once". Reading the builder, that
understates it, and the difference is the freeze-lift date.

`linear-exit-observed-install-plan.js` `build()` begins by asserting
`observed.compare(catalog, expected, …).status === 'MATCHED_OBSERVED_PUBLIC_CATALOG'`
against the reviewed observed contract
(`LINEAR_EXIT_OBSERVED_PUBLIC_CATALOG_20260912.json`, 67 public tables,
`809c5dc7…`). The plan's SQL sources are pinned and do not vary with the
catalog; the **gate** does. That is why `observed67_optout` reverses its delta —
one column and one ACL string — back to `809c5dc7…` before building.

The hiring delta will not reverse that cheaply. Read off
`migrations/2026-09-15-hiring-video-editor-role.sql` on main: one new public
table, two added columns with comments, three indexes, two triggers, ten
`create or replace function`, RLS plus revokes and grants on the table and six
functions, and alters to two further hiring tables. Six object classes.

So the routes are: reverse all of that exactly (fragile), or derive and review a
**new observed public catalog contract** at the settled state and let the plan
build from it. The second is the recommendation. Either way this is a reviewed
artifact change that must land on the branch before the exit merge, not a
number swapped in place.

Written up with the runnable derivation at
[`LINEAR_EXIT_B9_CATALOG_REDERIVATION.md`](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md),
with `scripts/linear-exit-b9-catalog-derive.js --selfcheck` passing here.

### 2026-09-16 — A hard-coded 90 in the install operator, and one new live table, predict `GUARD_COUNT` stopping step 14

Found while confirming B10. Not measured against the live database — this
session is read-only with no SQL — so it is stated as derived, and the step-8
receipt is what settles it.

`scripts/linear-exit-install-operator.js` has
`if(guards.length!==(alreadyFinal?0:90))fail('GUARD_COUNT')`. The maintenance
guard is not applied from a reviewed list; `linear-exit-install-maintenance.js`
applies it to every relation it finds with
`relnamespace='public' and relkind in ('r','p')`. So the count tracks the
database, not the plan.

Provenance of the 90: `LINEAR_EXIT_OBSERVED_INSTALL_TARGET_V1.json` records
`public_tables: 90` and `maintenance_guards_removed: 90`, derived from
`initial_public_catalog_sha256` `809c5dc7…` — the 67-table live read of
2026-09-12. The hiring migration adds exactly one public table.

If the live count is now 68, the post-install count is 91 and the operator
refuses **before installing anything**. Nothing is lost when it does; it is a
fail-closed refusal, not a partial install. But it would end a window that cost
an owner sitting to reach.

Consequence for B9: the constant is re-derived **with** the new target, not
edited to match whatever comes back. D8's distinction applies exactly —
confirming the anchors, understanding the change, then updating the number is
re-derivation; updating the number is silencing.

The step-8 instruction on the sitting page now asks for the public table count
as a fourth thing to copy back.

### 2026-09-16 — The whitespace gate is blind to 98 files, most of them the installer's own code

Approved in principle by the supervisor last night; the finding was confirmed
here before the guard was written, by reproduction rather than by argument.

`.gitattributes` carries **97 `-text` pins**, which resolve to **98 tracked
files**. `git diff --check` — the repo's whitespace gate — honours those pins,
so it does not examine any of them. The reproduction, on this branch:
flipping every CRLF to LF in
`qa/linear-exit-rehearsal/serving/sql/calendar-merge-comments.sql` changed 13
lines and dropped 13 bytes; `git diff --check` printed nothing and exited 0.
Only `git diff --stat` showed anything, and what it showed reads like an
ordinary edit.

The part that makes this more than a tidy-up: the exempt set is **not** just
captured evidence. It includes `scripts/linear-exit-install-operator.js`,
`linear-exit-install-profiles.js`, `linear-exit-install-maintenance.js`,
`linear-exit-install-finalize.js`, their tests and their workers — the
installation's own executable code — on a plan whose operator machine is
Windows, where `core.autocrlf=true` is the default. Nobody decided to exempt
98 files; each pin had a good local reason and the exemption accumulated
underneath the gate.

Fixed with `scripts/byte-pinned-line-ending-check.js`, wired into the existing
pull-request job in `.github/workflows/calendar-unit-tests.yml`. It resolves its
scope with `git check-attr` — **driven off the pins themselves, never off a copy
of the list** — and fails when a byte-pinned file's CRLF/LF composition changes
across the diff, naming the file and saying whether the content was otherwise
identical. A deliberate re-capture is acknowledged per path with
`--accept-recapture=<path>`. Verified both ways on this branch: it fails the
reproduction the old gate passed, and it is clean against `origin/main`.

The general rule went into `AGENTS.md` as the second house rule: a gate with an
exemption list is off for everything on that list, so count the list, and any
second check must be driven off the exemption itself rather than a shadow copy
that will drift.

### 2026-09-16 — Step 1 COMPLETE on the owner's explicit decision; count 7 of 28; B1 closed with a permanent caveat

The owner accepted the reduced Storage drill as sufficient for step 1, and asked
the session to check the reasoning against the execution map rather than take
it on trust.

**The map was read as it stands on origin, and it supports the decision.**

- Step 1 reads: "capture, encrypt, upload privately, **owner downloads**, hash
  matches, isolated restore of the downloaded copy". It names no device.
- Step 10, two rows down, reads "Owner downloads it **on another device**". So
  where the map means another device, it says so. Its silence in step 1 is
  meaningful, not an oversight to be filled in.
- The map's rule is that a step is complete when its *Done when* column is
  satisfied. Step 1's column: "Restore of the downloaded copy verifies, scratch
  server stopped, receipt recorded."
  - *Restore of the downloaded copy verifies:* **met.** The authenticated
    decrypt of the Drive-downloaded copy verified all 1,085 objects and
    2,343,907,896 bytes in a fresh, isolated directory.
  - *Receipt recorded:* **met.** The private receipt
    `downloaded-storage-readback-20260915-2.json` exists, and the result is
    journaled below.
  - *Scratch server stopped:* **not applicable, rather than satisfied.** The
    Storage drill involves no scratch database server. The operator procedure
    states that no backend restore or database connection is part of it, and
    the verify script never starts Postgres. The clause reads as carried over
    from the database custody row. It cannot block step 1, and it is recorded
    as not applicable rather than claimed as met.

**One correction to the premise, recorded for accuracy.** The owner attributed
the second-device requirement to the sitting page, written later. It was also
in the private Storage operator procedure, written 2026-09-14, which says the
owner downloads the file "through another device". That does not change the
map's reading, since the map is the completion authority. But the requirement
had two sources, not one.

**Therefore: step 1 is complete. The authoritative count moves from 6 to 7 of
28 (25%).** Step 1 is complete on the owner's explicit acceptance of the reduced
substitute, read against the map's own wording. It is not claimed that a
second-device drill happened.

**B1 is closed as accepted by the owner, with a permanent caveat.** See the
closure note under B1 in the blocker section. The caveat is part of the record
indefinitely and is not an open decision.

Nothing else was done: no B9 re-derivation, no steps 8, 9 or 10. Those run
together in one sitting with ninety clear minutes, because the catalog read
expires after an hour and the database capture has to follow it immediately.

### 2026-09-15 — Reduced Storage drill PASSED: same-machine Drive round trip and full decrypt

Same owner sitting as the Storage capture below; placed at the top because it is
the most recent event. The owner uploaded the packed Storage archive to the
private Drive folder and downloaded it back onto **this same machine**, into
their general Downloads folder. The session worked only from a clean directory
of its own and never wrote into Downloads.

Results, in order:

- Downloaded archive: 2,346,184,452 bytes and SHA-256
  `02bbd69b6a98fa8990a1a4dd7e2bab7b24b01284e1ca47e1eadadcdab7ef9a5a`, both
  equal to the packed archive. Byte-for-byte identical after the round trip.
- Transport verify: `DOWNLOADED_CIPHERTEXT_EXACT`, all 2,824 ciphertext files
  present with matching size and hash, whole-archive hash checked before
  extraction.
- Full authenticated decrypt against the signed inventory (`c2867ecb…`):
  `PASS_LOCAL_DOWNLOADED_RESTORE`, **1,085 objects, 2,343,907,896 bytes, every
  object's bucket, path, SHA-256 and size verified.** Exit 0.
- The restored tree holds 1,087 files. The two beyond the objects are the
  package's own signed evidence, `coverage.hmac` and `storage-metadata.hmac`,
  under `export-evidence`, which is not a bucket and is not in the inventory.
  The two real buckets hold 1,061 and 24 objects, which is exactly the 1,085.
- The receipt records, correctly and by design,
  `other_device_retrieval_independently_proven: false` and
  `independent_key_retrieval_proven: false`. Nothing set those true.

**What this establishes:** the archive survives a round trip through private
Drive unchanged, and the recovery record decrypts it with every object matching
the capture. **What it does not:** retrieval on a separate device.

**Step 1 remains incomplete** and B1 stays open, narrowed to the second-device
gap alone. This was a reduced substitute the owner chose, not an equivalent;
see the B1 note in the blocker section and the correction under the 2026-09-14
entry.

Decrypted plaintext is retained on the machine for the owner's review and later
confined cleanup, as the operator procedure intends.

### 2026-09-16 — B10 blocked on the Windows machine: this sandbox has no route to PostgreSQL 17

Answered concretely rather than assumed, because "regenerate on PG17" is only a
plan if someone can actually reach a PG17 server.

**This sandbox cannot provide one.** Checked, not guessed:

- Locally installed: PostgreSQL **16** only (`/usr/lib/postgresql/16`).
- `apt` offers `postgresql-16` and nothing higher; no PGDG repository is
  configured, so 17 is not installable from here.
- Docker is present as a binary but its **daemon is not running** (no
  `/var/run/docker.sock`), so `postgres:17` cannot be pulled or run.
- The live Supabase project *is* PostgreSQL 17, but it is production. It is
  read-only here, and the generator needs the admission schema with the new
  trigger installed, which is not on live and could not be put there.
- CI runs PG17 lanes, but running a *generator* there is not the same as a lane
  running: it would need a workflow change and a dispatch, both out of scope.

**The missing thing, named:** a disposable PostgreSQL 17 server that the
existing generator can be pointed at.

**It is not missing from the project, only from here.** The owner's machine has
PG17 at `D:/Sidney/Codex/2026-09-09-repair-evidence/postgres17/pgsql/bin`, which
the installation runbook already uses, and the portable runner accepts it via
`-PgBin`. So B10 is blocked on **the Windows machine**, not on effort and not on
a capability nobody has.

Recorded so nobody re-attempts the regeneration from a session and quietly
substitutes a PG16-derived value, which is the failure this blocker exists to
prevent. A `definition_md5` produced on 16 and asserted on 17 is a guess wearing
a hash's clothing.

### 2026-09-16 — Catch-up landed GREEN at `0c923169`; B10 reasoning done, one field blocked on PG17

**Twelve of twelve green, confirmed on the exact commit after the revert**, not
before it and not inferred. `Isolated PG17 retirement-switch` is green again,
which confirms B10 was the sole cause of the red.

**What was reverted**, six files, none of which main touched, so the revert
could not undo any of main's work: the admission guard's table list; the source
hash in both the schema contract and the release extension; the contract hash in
both the release extension and `CONTRACT_SHA`; the extension hash in `PIN`; and
the shared fixture's migration entry.

The revert also undid something unintended. Rewriting the fixture with Python
had silently converted the whole file from **CRLF to LF**, 168 lines of
collateral change for a 4-line addition. That is a third instance of a tool
doing more than intended without being checked, and it is the most insidious of
the three: a whole-file line-ending flip changes the file's hash while looking
like nothing in a rendered diff, so it can break a pin on that file for reasons
no reviewer would see.

---

**B10's retirement-contract half, reasoned from the contract's own definition.**

The check lives in `supabase/migrations/20260913062149_retirement_switch_preparation.sql`.
It aggregates triggers with

```
where c.relnamespace='public'::regnamespace and not t.tgisinternal
  and (c.relname in (...six named tables...) or t.tgname like 'aaa_application_dml_admission_%')
```

and compares that aggregate to a hardcoded `expected->'triggers'`, raising
`retirement_trigger_contract` on any difference.

The `like 'aaa_application_dml_admission_%'` arm matches across **all** public
tables, not a fixed list. The admission guard creates exactly one
`aaa_application_dml_admission_statement` trigger per table it guards. So adding
`hiring_practical_test_jobs` to the guard list necessarily adds one trigger to
this aggregate, and the expected array does not know about it. That is the whole
mechanism; nothing about it is mysterious.

**What the contract should therefore say** is one additional entry, and its
shape is fully determined:

| Field | Value | How it is known |
|---|---|---|
| `name` | `aaa_application_dml_admission_statement` | the guard's `create trigger` names every one identically |
| `table` | `hiring_practical_test_jobs` | the table being added |
| `internal` | false | `not t.tgisinternal` is in the filter |
| `deferrable` | false | the guard creates a plain statement trigger |
| `initially_deferred` | false | same |
| `enabled` | same as the sibling admission triggers | no clause changes it |
| position | between `hiring_invite_jobs` and the `kasper_*` tables | `order by c.relname, t.tgname` |
| `definition_md5` | **NOT ESTABLISHABLE HERE** | see below |

**The blocked field, and why I am not guessing it.** `definition_md5` is
`md5(pg_get_triggerdef(t.oid))`, an MD5 of PostgreSQL's own rendering of the
trigger definition. It differs per trigger because the rendering embeds the
table name, so it cannot be copied from a sibling entry. It can only be obtained
by asking a PostgreSQL server. This sandbox has **16**; the lane asserts on
**17**. Deriving it on 16 and assuming the two render identically is an
assumption I have no basis for, and writing an md5 I did not obtain in full from
a command is precisely the failure recorded in the near-miss entry below.

**The correct closure is not a hand-edited md5 at all.** That expected blob has
generators in the repository (`scripts/linear-exit-control-companion.js` and
`scripts/linear-exit-observed-schema.js` both produce `definition_md5`). The
right closure regenerates the blob with the existing generator against PG17,
which produces every field including the md5 from the real server, rather than
hand-patching one value until the lane stops objecting. Hand-editing it would be
the silencing that has been ruled out twice now.

**So B10's remaining work, precisely:** re-apply the guard-list addition and its
four pin re-derivations and the fixture migration entry, then regenerate the
retirement expected blob on PG17 with the existing generator, then let CI
confirm. Everything except the PG17 regeneration is already understood and was
demonstrated working today.

### 2026-09-15 — B10 is not a catch-up-sized change: STOPPED after three CI rounds

The catch-up to `1abdd1fa` is done and clean. **B10 is the only thing red**, and
it needs an owner decision rather than a fourth guess.

B10's own note said the change touches "the reviewed admission list **and
retirement contract**". Only the first half was actioned. Three CI rounds each
surfaced a different artifact that predates the table:

1. `application_admission_missing_owner:hiring_practical_test_jobs` — the guard
   calls `to_regclass` and aborts on a listed table that does not exist, so the
   shared fixture had to apply the migration that creates it. Fixed.
2. `hiring_practical_test_jobs_raw_footage_url_check` — adding the table to the
   fixture's `TABLES` list made it synthesise a row, and the generator builds
   rows from column metadata without knowing check constraints. The guard only
   needs the table to exist, not to be populated, so that half was reverted.
   Fixed.
3. `retirement_trigger_contract` — the reviewed retirement contract enumerates
   the expected trigger set, and the admission guard now attaches a trigger to
   a table that contract does not know about. **Not fixed, deliberately.**

The third is a reviewed contract describing what the retirement switch is
allowed to see. Re-deriving it to match would be exactly the silencing rule D8
forbids: changing a number until a guard stops objecting, without establishing
that the new state is the intended one. It is also not verifiable here, because
this sandbox has PostgreSQL 16 and the lane requires 17.

**The shape of the finding, which is the useful part.** One word added to a
table list has now invalidated: four hash pins across three files, one shared
test fixture, and one reviewed retirement contract. The source file's own
comment said it plainly and was right: *"New tables/DDL require separate
closure."* Separate closure means a reviewed change of its own, not a line in a
catch-up.

**Two options for the owner, neither taken unilaterally:**

- **Separate B10 out.** Revert the guard-list addition and its four pin
  re-derivations and the fixture migration entry, land the pure catch-up green,
  and do B10 as its own reviewed change that includes the retirement contract.
  Recommended: it gets CI green now and gives B10 the review it evidently needs.
- **Continue inside the catch-up**, which means re-deriving the retirement
  trigger contract. That needs someone to establish what the contract *should*
  say with the new trigger present, not just what makes it stop failing.

Everything else on the branch is green: all 547 unit suites with the Postgres
lanes enabled, the mocked Calendar browser gate, and 11 of 12 CI checks.

### 2026-09-15 — NEAR MISS: a hash was fabricated from a printed prefix, caught and corrected before it shipped

Recorded first because it is the most dangerous thing that happened today, and
it was self-inflicted.

While re-deriving the admission pin chain, a 64-character `CONTRACT_SHA` was
written into `scripts/linear-exit-admission-preflight.js` by taking the
**12-character prefix** that had been printed earlier and inventing the
remaining 52 characters. It was noticed immediately, the real value was computed
with `sha256sum`, and the file was corrected before anything was committed,
tested or pushed.

Why it matters more than an ordinary slip: a fabricated hash in a drift guard
does not fail loudly in an obvious way. It would have made the guard reject the
correct file forever, and the natural next move when a guard refuses is to
"re-derive" it again, which is how a wrong value becomes permanent. It also
defeats the exact protection the guard exists to provide.

The rule this adds, narrower than "be careful": **never write a hash that was
not produced in full by a command in the same breath.** Print the full value and
copy it. A truncated display is for reading, never for authoring. Anywhere a
64-character constant is being written, the full value must come from the tool,
not from memory or reconstruction.

This is the fourth time today reasoning outran checking, and the first where the
output would have been actively harmful rather than merely wrong.

### 2026-09-15 — Catch-up to new main `1abdd1fa`, B10 closed, and what a one-word change actually cost

Main moved to `1abdd1fa` (PR #1407, the hiring Video Editor work) and was
re-frozen there with the wider scope: merges, live database changes from any
session or dashboard, and deployments of anything the exit plan checks against.

**The catch-up itself was small.** One conflict, `migrations/README.md`, where
both sides had appended a bullet to the same list; both kept, chronologically
ordered. Main brought 9 files from the merge base, which was exactly the old
frozen main `0aa5954`.

**The predicted failure did not recur, and was checked rather than assumed.**
Last catch-up, the only failure CI could see was the native-intake fixture
building its database from a hardcoded migration list missing main's new
migration. The new migration `2026-09-15-hiring-video-editor-role.sql` is also
absent from that list, but it is entirely hiring-scoped: it touches no table the
fixture builds and no code path the native-intake lanes exercise. Rather than
reason about that, the whole suite was run **with the Postgres lanes enabled
locally**, which is what makes local match CI. That is now the standard for this
branch: a run that skips the Postgres lanes has not tested the branch.

**Pins re-derived.** `production-write` was unchanged, since main touched only
the two hiring Edge functions. `index.html` changed, so the write-diagnostics
composer's `index.html` hash was re-derived after confirming its seam still
appears exactly once and that main did not touch the seam region.

**B10 closed, and the real cost of it.** `hiring_practical_test_jobs` was added
to the admission guard's table list in
`supabase/migrations/20260912183653_application_dml_admission_preparation.sql`,
in sorted position: 86 entries to 87, still alphabetical, neighbours
`hiring_invite_jobs` and `kasper_ad_campaign_daily`.

That one word broke four pins across three files, in a chain three levels deep:

1. the source's own hash, in `LINEAR_EXIT_ADMISSION_SCHEMA_CONTRACT_20260912.json`
   and again in `LINEAR_EXIT_ADMISSION_RELEASE_EXTENSION_V1.json`;
2. the contract JSON's hash, held both inside the extension JSON and as
   `CONTRACT_SHA` in `scripts/linear-exit-admission-preflight.js`;
3. the extension JSON's hash, as `PIN` in
   `scripts/linear-exit-admission-release-extension.js`.

Re-derived in dependency order, each by string replacement so every file stayed
byte-identical apart from the hash. Structural invariants confirmed rather than
assumed: the contract still lists 7 sources, the extension still lists 7
`sql_owners`, and their `order` values are unchanged. The contract's `tables`
inventory was read directly and needed no change; it describes the admission
machinery's own four `card_write_*` tables, not the guarded list.

Worth carrying forward: **the admission source sits behind a four-deep pin
chain.** Any future change to it, however small, costs the same four
re-derivations. The `ADMISSION_CONTRACT_HASH_DRIFT` level in particular was only
discovered after the first three were fixed, because it lives in a different
script than the other two. Anyone touching that file should map the chain first.

**Result:** all 547 unit suites pass with the Postgres lanes enabled, plus the
mocked Calendar browser gate. 61 profiles are NOT_RUN in that lane by design.

### 2026-09-15 — Two hiring Edge deploys inside the freeze window, deliberately outside its scope

Owner dispatched `hiring-applications` and `hiring-automation` at `1abdd1fa`.

Recorded so a deploy timestamp inside the freeze window does not surprise a
later reader, which is the second time today that has needed saying. Neither is
among B7's twelve, neither touches the database schema, and neither is the
browser, so nothing the exit plan checks against moved. The freeze covers
deployments of things the plan checks against; these are not among them.

### 2026-09-15 — B4 decided: accept the loss, no PITR, so steps 9 and 10 are the recovery route that matters

Owner decisions, recorded for their consequence rather than as bookkeeping.

On any managed restore: **accept the loss of newer saves and reconcile by hand
afterwards.** And **no Point in Time Recovery**, on cost.

The consequence is the part worth writing down. With PITR declined, the managed
restore can only go back to a nightly backup, so the recovery position is
materially weaker than it looked, and **the database backup refresh in steps 9
and 10 becomes the recovery route that actually matters.** It is no longer a
belt-and-braces custody drill running alongside a strong platform fallback; it
is the fallback. Anything that lets steps 9 and 10 slip, or that accepts them as
"done" before the downloaded copy has actually restored, removes the real safety
net rather than a spare one.

B4's mechanical half, whether the Restore control is enabled at all, still needs
the click path in the sitting page appendix.

### 2026-09-15 — B7 settled: frozen main `0aa5954` matches all twelve deployed functions (12 PASS)

The appendix's authenticated fingerprint block was run once on the owner's
Windows machine, from the repository root, exactly as written, pinned at
`0aa5954a5c63e3b6f399caf739e562b371393325`. It used the
`SUPABASE_ACCESS_TOKEN` already present in that machine's user environment,
the same variable the Storage wrapper consumes. The token was not requested,
printed or written anywhere. Mode reported: `live-read-only`. Nothing was
deployed or written.

Printed result, per function (version, then source and live fingerprint
prefixes, which agree in every row):

| Function | Live version | Fingerprint | Files |
|---|---|---|---|
| ai-onboarding-list | 36 | `bce568a72fce` | 2/2 |
| client-credentials | 44 | `d6300381fa19` | 2/2 |
| filming-plans | 34 | `ef1f6aee94d0` | 2/2 |
| key-verify | 39 | `68e6d3094a08` | 2/2 |
| legacy-onboarding-list | 36 | `d1f6a2d9caf4` | 2/2 |
| linear-outbound | 48 | `f59b6206e3cc` | 5/5 |
| onboarding-full | 36 | `68da4d8f413d` | 2/2 |
| onboarding-list | 36 | `a23980f1da39` | 2/2 |
| production-archive | 8 | `3c478af053f2` | 2/2 |
| production-comments | 24 | `202c9492e063` | 3/3 |
| production-write | 71 | `746f8b918d36` | 5/5 |
| smm-weekly-reports | 32 | `e1f925289245` | 2/2 |

```
Summary: 12 PASS, 0 FAIL, 0 ERROR
JWT posture: 12 verify_jwt=false, 0 off-posture
```

Exit code 0. There were no FAIL or ERROR reason lines.

By the appendix's own reading, **recovery route C1 exists and `0aa5954` is the
commit.** This confirms the candidate the full-history analysis named, and the
entry below, which reasoned that the hiring drift cannot affect these twelve.
The earlier "unavailable" and "unproven" entries stay further down as the
record of how the question was narrowed.

It closes B7 only. As the entry below lists, it does not close B5. The sealed
previous-functions record still has to be written; C1's rollback lane remains
UNTESTED; `notify` stays outside it; and the browser half is untouched.

**Step count left at 6 of 28.** Step 2's done-condition asks for a recorded
previous version for every deployed function and whether one single commit
matches all of them. This run answers the second half, but a sealed record is
not yet written. The count is flagged for the owner rather than moved by the
session.

Run once only. It was completed before the owner's repeat request for the same
run arrived, so it was not run again.

### 2026-09-15 — B9 does not touch B7; B4 and B5 worked out the same way B7 was

**B7 is unaffected by the hiring drift, and `0aa5954` remains the candidate.**
The twelve are the eight staff functions plus `linear-outbound`,
`production-comments`, `production-archive` and `production-write`.
`hiring-applications` and `hiring-automation` are not among them, and a database
migration does not enter an Edge function's source-closure fingerprint in any
case. None of the twelve's source changed.

One correction to the framing that reached this session: the two hiring Edge
functions **are** deployed, both at version 3 since 2026-08-25, not undeployed.
It does not change the conclusion, only the reason.

---

**B4: no executable hosted database recovery route if journal resume cannot
finish.**

*What precisely closes it.* Four things, and only the first is mechanical: a
named operator confirming the managed **Restore** control is present and enabled
on the correct project; an identified eligible restore point with its timestamp;
an owner decision taken **in advance** on newer accepted saves, which the
procedure says must be explicit before any overwrite; and an accepted outage
expectation, for which no hosted measurement exists.

*Offline from this sandbox now.* Nothing that closes it. No amount of reading
establishes a permission or an ETA. What can be prepared is the pre-restore
evidence set the route's step 1 demands, so it is not composed under pressure.

*Needs the Windows machine or a browser.* The permission check, prepared as a
click path in the sitting page appendix. Deliberately not a script: it is a
capability question, and a script that "checks" it would either do nothing or
start a restore.

*Needs an owner decision.* Two. The disposition of newer saves, pre-decided
rather than decided mid-incident. And whether to enable **PITR**, which was
observed disabled on 2026-09-14; enabling it before the installation converts
recovery from "the last nightly backup" to "a chosen moment". That is a real
improvement to the recovery position and is nobody's call but the owner's.

Honest summary: B4 is not a blocker a session can clear. It closes on a
capability check and a pre-decision.

---

**B5: no captured compatible browser and function versions with an executable
restoration route before merge.** Two halves, and they are not symmetric.

*What precisely closes the functions half.* The procedure requires one private
row per slug carrying `captured_at`, `prior_version`, `source_sha256`,
`entrypoint_path_sha256`, `file_count`, `verify_jwt`, `matched_git_sha` and the
capture location, across the staff group of eight and the Track-B group of five.

*What a passing B7 would close there, precisely.* Most of it. A PASS means every
deployed function's closure equals `0aa5954`, which supplies `matched_git_sha`
for twelve of the thirteen and, with it, `source_sha256`,
`entrypoint_path_sha256` and `file_count` from the expected side at that commit.
This session has already captured `prior_version` and `verify_jwt` read-only for
all twelve (`verify_jwt` is false on every one).

*What a passing B7 would NOT close.* Four things, stated rather than assumed:

1. **`notify`.** It is in the Track-B five and has no previous version, so no
   pin can exist for it. B8's amendment covers what rollback means there, but it
   remains outside anything B7 can say.
2. **The record still has to be written.** A verified fact in a chat transcript
   is not the sealed private `previous-functions.json` the procedure requires,
   and the configuration backup is recorded separately from it.
3. **Executable is not the same as matched.** C1 restores by deploying an older
   commit through the onboarding lane; matching pins establish that `0aa5954` is
   the right commit, not that the lane will accept and deploy it. The procedure
   already marks that rollback UNTESTED.
4. **The browser half. Entirely.** B7 concerns Edge functions and says nothing
   whatever about the served browser.

*What can be established offline now, and was.* The browser half's baseline. If
Pages publishes from main, the served browser should be `0aa5954`'s, so the
comparison values were computed here: `index.html` at
`61282fa2c0cb568668b49566373723bcac5d6cd32c2c9771e01b1bb1c52fcff7`, plus
`404.html`, `CNAME`, the favicon, the logo and 18 `nav-icons/` files. That is
half the check done without touching anything.

*Needs the Windows machine.* Downloading the actually served files and hashing
them, prepared as a runnable block in the sitting page appendix. It must happen
**before the merge**: afterwards Pages republishes and the pre-merge browser is
no longer downloadable. If `index.html` does not match, that is a finding in its
own right, because it would mean Pages is serving something other than the
frozen commit.

*Needs an owner decision.* Whether an UNTESTED C1 rollback is acceptable as the
function-side route, which is the same question B6 was withdrawn over and B7
feeds.

### 2026-09-15 — LESSON: the freeze covered merges, not the live database

This is the real lesson of the day, and it is recorded on its own so it is not
lost inside the hiring details.

The owner froze main at `0aa5954` and defined the freeze as **no merges**. The
reviewed installation plan does not depend on main alone. It depends on the
**live database** matching a reviewed catalog profile. The freeze said nothing
about live schema changes. The same day, a separate session applied a
legitimate, dry-run-tested migration directly to production. Nobody noticed the
gap, because nothing in the freeze definition made anyone look for it. It
surfaced only when the catalog read refused.

Nothing was harmed, because the check refused as designed. But a freeze that
leaves the thing under review free to change is not a freeze.

**For the next freeze, define it from the start to cover everything the plan is
pinned against:**

- merges to main;
- live DDL on the production database, from any session, dashboard or tool;
- deployments that change what the plan observes;
- and an explicit, named exception process if something must change, so the
  plan owner hears about it before the catalog read does, not after.

State the scope in the freeze entry itself, not only "main is frozen".

**Second lesson worth carrying forward: read the actual list.** Structural
checks could not see the admission guard gap. The dependency catalog showed
hiring objects linked only to hiring objects, and Postgres does not record what a
plpgsql body touches. The gap was found only by reading the literal table list
in the admission source. It named three hiring tables and not the new one. When
a question is "does X cover Y", read the thing that enumerates X. Do not infer
coverage from the absence of structural links. The owner then confirmed it by
reading the same list independently.

### 2026-09-15 — Owner sitting on the Windows machine: Storage capture passed; catalog refused on live schema drift; steps 8, 9 and 10 not run

Run from the owner's machine against the sitting page, in its order. Nothing
installed, applied, deployed, merged or dispatched. Main still `0aa5954`.

**Storage capture (step 1), two attempts.**

- Attempt 1 refused after about 19 minutes with `STORAGE_EXPORT_BODY`, at 15,307
  Storage reads during the encrypted export. Read against the adapter source,
  that code is a stream error while reading an object body after the request
  was answered: not the version/size drift fence, not a timeout, not the size
  limit, and the log shows no non-200 response. Classified as transport, not a
  broken quiet window. Directory, log and refusal receipt preserved; no
  plaintext left behind. Owner chose one new attempt.
- Between the two attempts Storage gained one object (1,084 to 1,085) with no
  known source. Harmless to attempt 2 because it takes a fresh inventory, and it
  did not recur during the export.
- Attempt 2 **PASSED**: 1,085 objects, 2 buckets, 2,343,907,896 bytes,
  `local_readback_verified: true`, plaintext readback removed. All seven source
  pins equal to independently computed hashes of the checkout. Inventory SHA-256
  `c2867ecb6f4cf17fe1238913e046ead12822ac596e2c1a824dc93df5ec17803c`, encrypted
  manifest SHA-256
  `47efa156367266af775d68125706be3616aa0f730217003cb3c61e4af61150ce`. 2,824
  ciphertext files.
- Transport archive packed with the operator file's own `pack` command:
  `PACKAGED_NOT_UPLOADED`, 2,824 files, 2,346,184,452 bytes, SHA-256
  `02bbd69b6a98fa8990a1a4dd7e2bab7b24b01284e1ca47e1eadadcdab7ef9a5a`.
- **Step 1 is not complete.** The owner has not uploaded it, not chosen the
  second device, and not downloaded it. The drill is explicitly not started.

**Catalog read (step 8), two runs.**

- Run 1 refused with the wrapper's catch-all. Local checks found the pinned CA
  file `%APPDATA%\postgresql\root.crt` absent, with its whole folder gone,
  although yesterday's passing smoke run had used it. Nothing was substituted by
  the session. The owner downloaded Supabase's public root certificate from the
  project's own dashboard and placed it. The session verified it before use:
  exact filename, one clean PEM block, no HTML or stray text, parses as the
  self-signed CA "Supabase Root 2021 CA", valid to 2031, SHA-256 fingerprint
  beginning `80:70:25:AD`. **Why the folder disappeared is unknown; recorded by
  owner instruction, not chased.**
- Run 2: identity matched yesterday exactly, `tls_verified: true`, but catalog
  hash `ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c`
  matched **neither** profile (`profile: null`, exit 2). Stopped. Step 9 was not
  started and its wrapper would have refused that receipt anyway.
- The diff against yesterday's passing `observed67_optout` catalog is entirely
  hiring: one new table, 4 indexes, 2 triggers, 4 internal constraint triggers,
  7 new functions, 3 changed function bodies, two new columns and check changes
  on `hiring_applications`, check changes on two other hiring tables, and 49
  dependency rows. Policies, default ACLs, sequences, views, types, rules and
  publications identical. Nothing named `team_members` changed.
- Source: the owner's own hiring practical-test migration, applied deliberately
  and dry-run first, unrelated to the Linear exit, on branch
  `claude/serene-hawking-6cdglo` (PR #1407), not on main.

**Owner decisions taken in the sitting.** Do not re-pin; do not run 8, 9 or 10
today; classify instead. See D12.

**Classification: is the hiring change confined to hiring?** Answered from code,
not from structure.

What was checked:

1. The migration file on the branch (964 lines, fetched only, never checked
   out), SHA-256 `92af9c25e5b0c2846c58e62e596b3a68a5a6e3217a68efd4dabcb82fdd5024e0`.
2. The live definitions of all ten functions, read-only via
   `pg_get_functiondef`: the seven new
   `hiring_authorize_practical_test_send_v1`,
   `hiring_claim_next_practical_test_v1`, `hiring_queue_practical_test_v1`,
   `hiring_record_practical_test_result_v1`,
   `hiring_require_practical_test_send_authorization`,
   `hiring_retry_failed_practical_test_v1`,
   `hiring_set_practical_test_verdict_v1`, and the three changed
   `hiring_capture_application_v1`, `hiring_queue_interview_invite_v1`,
   `hiring_record_interview_booking_v1`.
3. **File against live: identical.** For all ten, the md5 of the body text in
   the file equals the live `body_raw_md5` in today's catalog. Security-definer,
   `search_path` and execute grants also agree with the file.
4. The new table's columns, constraints and its only foreign key (to
   `hiring_applications`), its two triggers, and every added dependency edge.
5. The installation side: the 48-source plan builders, the admission guard
   source and the retirement contract source.

The answer has two directions, and it is **not** "confined to hiring".

- **Hiring code into non-hiring objects.** Every table read or written by the
  ten bodies is a hiring table, with one exception:
  `public.syncview_runtime_flags`. Six functions read their own keys from it
  (`hiring_practical_tests_enabled`, and `hiring_invites_enabled` in the
  interview invite). `hiring_authorize_practical_test_send_v1` takes a
  `FOR SHARE` row lock on its row. The migration also **inserted one row** into
  that table (the new kill switch, seeded disabled). No function writes outside
  hiring. The `touch_updated_at` trigger calls the pre-existing
  `hiring_touch_updated_at()`. The one non-security-definer trigger function
  keeps Postgres's default public execute, which the file never revokes.
- **The installation into hiring.** The installation writes onto hiring tables.
  The admission guard source, which is in the 48 through the admission release
  extension, creates `aaa_application_dml_admission_statement` and `…_row`
  triggers on an exact 86-table list. That list includes `hiring_applications`,
  `hiring_application_events`, `hiring_invite_jobs` and
  `syncview_runtime_flags`, but **not** `hiring_practical_test_jobs`. The
  retirement contract pins those three hiring guard triggers by definition hash.
  The admission gate installs `open`, so on install day the guards pass
  everything through. Once admission is closed, writes to the three guarded
  hiring tables are refused, while updates confined to the new table (claim,
  authorize, record result) would still commit. The source's own comment says
  new tables require separate closure. See B10.
- **Not affected.** The retirement trigger contract scopes itself to named
  control tables plus the `aaa_application_dml_admission_%` triggers, so the new
  table's own triggers do not trip it. None of the four legacy hiring migrations
  is in the install manifest, so installation replays nothing hiring. The new
  table uses no sequences.

### 2026-09-15 — Step 2 answered: NO single commit matches all thirteen deployed functions

Recovery route C1, which assumes one older main commit matches every deployed
Edge function, **is not available**. This became an owner decision before step
13. Nothing was built in response; the instruction was explicitly to report and
stop, not to start a replacement route.

The decisive evidence needs no fingerprint comparison at all: **`notify` is not
deployed.** It exists in the repository with three source files, but the live
project has no function by that slug. Confirmed by direct lookup, which returned
`NotFoundException`, rather than inferred from its absence in a list. One of the
thirteen has no currently deployed version, so no commit can match all thirteen.

Corroborating, the other twelve were deployed across five distinct events
spanning twenty days:

| Deployed | Functions | Live version |
|---|---|---|
| 2026-08-26 | production-comments | 24 |
| 2026-08-29 | production-archive | 8 |
| 2026-09-04 | the eight staff functions, within 21 seconds of each other | 32 to 44 |
| 2026-09-14 | production-write | 71 |
| 2026-09-15 | linear-outbound | 48 |

Where the set splits is therefore those five groups, with `notify` as a sixth
case of its own.

**What was proven versus what was not.** Proven: the live inventory, the version
numbers, the deploy timestamps, and `notify` being absent. Not proven: a
per-function source fingerprint mapped to a specific commit. `ef-fingerprint.js`
refuses its live comparison without a Supabase access token, which this
sandbox does not carry and which nobody should be asked for. The answer does not
depend on that missing piece, because `notify` settles it on its own, but the
gap is recorded rather than papered over.

One observation worth keeping, not a finding: `linear-outbound` was deployed at
16:57 UTC on 2026-09-15, about two minutes after the frozen main commit landed
at 16:55 UTC. That is consistent with a deploy lane running off the merge that
became the freeze point. The freeze is on merges, not deploys, so this does not
break it. Noted so a later reader is not startled by a deploy timestamp inside
the freeze window.

### 2026-09-15 — CORRECTION to the entry above: the decisive argument was wrong, and the question is now UNPROVEN

Placed below the original per the house rule. The original entry stays exactly
as written; it is wrong and that is the point of keeping it.

**What was wrong.** The entry treated `notify` having no live deployment as
proof that no commit could match all thirteen. That inverts the meaning.
`notify` **does not exist on frozen main at all**. It is new code this migration
branch adds. Verified both ways: no `notify` source directory at `0aa5954`, one
on the prep branch; main's onboarding lane deploys **twelve** slugs, the prep
branch's deploys thirteen with `notify` as the addition.

So `notify` having no live version is the ordinary state of a function that has
not shipped yet, not a missing prior deployment. The premise was true and meant
the opposite of what was drawn from it. The verdict happened to be defensible;
the reasoning that produced it was not, which is worse than a wrong answer
honestly reasoned, because it would have survived review on false grounds.

The failure was not checking whether `notify` existed on main before building an
argument on its absence. One `git ls-tree` would have caught it.

**Re-answer for the twelve that do have deployed versions: UNPROVEN from this
sandbox.** Not "no". Unproven.

Worse, the original entry's supporting evidence leaned toward "no" and that lean
was also unjustified. The offline structure actually leaves a single matching
commit **plausible**: of the twelve, ten saw no changes to their own source
directories across the whole deploy window, and the two that moved a lot,
`linear-outbound` and `production-write`, are the two deployed most recently. A
commit near the top of main is a reasonable candidate. That is not a finding
either; it is the reason the question needs a real answer rather than an
inference in either direction.

**What would prove it, exactly.** Live fingerprints are what is missing, and
they are independent of whichever commit is pinned, so one authenticated run
produces all of them:

1. On a machine that carries `SUPABASE_ACCESS_TOKEN` (the owner's machine, or
   CI), run `node scripts/ef-fingerprint.js <any-40-char-sha>
   --slugs=onboarding-list,ai-onboarding-list,legacy-onboarding-list,onboarding-full,client-credentials,filming-plans,smm-weekly-reports,key-verify,linear-outbound,production-comments,production-archive,production-write
   --format=json` and keep the twelve `live_fingerprint` values.
2. Offline, walk main backwards from `0aa5954` running the same command with
   `--expected-only` at each candidate commit.
3. The answer is the first commit whose twelve `expected_fingerprint` values all
   equal the live ones. If no commit matches, C1 is genuinely unavailable.

This session cannot do step 1: `ef-fingerprint` refuses its live comparison
without that token, the sandbox does not carry it, and the house rule is that
nobody asks the owner for it. Reading deployed source through the Supabase
connection and re-hashing it locally was considered and rejected as a
workaround that would reimplement the closure algorithm and could quietly
disagree with the real tool.

**Also corrected: the live function count is 36, not 37.** A miscount. It
cross-checks: the branch manifest carries 38 slugs, and the two not live are
`notify`, unshipped, and `write-diagnostics`, dormant by design.

**New point nobody had stated.** Rolling back a brand-new function is a
different operation from rolling back the other twelve. For the twelve there is
a previous version to restore. For `notify` there is no previous version, so
"rollback" means **removing the function or leaving it inert**, not restoring
anything. The recovery procedure currently describes a thirteen-function
restoration in uniform terms and should say which of the two it intends for
`notify`. Recorded as B8.

### 2026-09-15 — Authoritative step count, and the B7 run prepared for handover

**The step count is 6 of 28, about 21%.** Two sessions were reporting different
figures into the same record, 6 of 28 against 7 of 28. Take the number from this
file, not from either chat. The difference was step 8: it is in progress, and
the map says in progress is not complete, so it does not count. Step 2 being
answered does not move the figure either, because step 2 sits in Phase 0 and its
own done-condition is currently unmet.

**The B7 authenticated run is prepared and ready to hand over**, written as a
runnable block in the [owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md)
appendix. Not queued and not run: the local session was mid Storage capture and
must not be interrupted. The token was not requested and does not appear
anywhere in the repository.

The appendix records that the run settles **both** gaps the offline analysis
left open, and why:

- A deploy cut from a ref other than main's tip stops mattering once content is
  compared, because C1 asks whether a commit matches what is deployed and the
  fingerprint compares closure content directly.
- The `release/` staging path is handled by `normalizeLivePath`, which maps
  deployed paths back to the canonical `functions/<slug>/…` form and **throws**
  on anything it cannot map. A layout mismatch therefore cannot produce a false
  PASS, only an honest FAIL or a loud ERROR naming the path.

Both of those were checked in the tool's source before being written down,
rather than assumed from its documentation.

### 2026-09-15 — This round, the supervisor's claim was the thing that failed

Worth recording explicitly, because the previous two rounds went the other way
and a record that only shows one direction teaches the wrong lesson.

The supervisor's correction about `f2c889d` and the three staff functions did
not reproduce, and the instruction to verify rather than accept it is what found
the real problem: the clone was shallow, so both sides had been measuring over
truncated history. The supervisor independently confirmed this on their own
clone.

The general rule this supports: a correction from a reviewer is a hypothesis,
not a fact, and checking it costs one command. Accepting it unverified would
have written a wrong conclusion into this file with a second signature on it,
which is harder to unpick later than a single session's error.

### 2026-09-15 — SECOND correction on step 2: the clone was shallow, and B7 narrows rather than closing

Appended below both earlier entries. Neither is edited.

**The clone was shallow.** This is the important finding, and it invalidates
earlier reasoning. `git rev-parse --is-shallow-repository` returned true, and
the commit at the boundary reported no parents, so every `git log --since`
count in the first step 2 entry was computed over truncated history and a
`git show --stat` on a boundary merge showed the whole tree as additions.
History was fetched in full, 3787 commits on main, before redoing anything.

Any future session doing history archaeology here should check for a shallow
clone first. A truncated history does not announce itself; it just quietly
answers the wrong question.

**A supervisor claim was checked and did not reproduce.** The claim was that
commit `f2c889d` on 2026-09-07 added 361 lines across `filming-plans`,
`key-verify` and `onboarding-list`, which would have put source changes after
those functions' 2026-09-04 deploy. Measured against full history, `f2c889d`
touches none of those three directories on either parent, and **none** of the
eight staff functions' own directories changed on main at any point after
2026-09-04. The conclusion drawn from that premise therefore does not follow.

**The closures were then measured with the real tool**, rather than by counting
commits, using `ef-fingerprint --expected-only` at a commit just after the staff
deploy and at frozen main. Across that whole window:

- **Ten of the twelve are byte-identical**: the eight staff functions plus
  `production-comments` and `production-archive`.
- **Two moved**: `production-write` and `linear-outbound`.

**Where the two moved, and when they deployed:**

| Function | Closure last changed on main | Deployed |
|---|---|---|
| `production-write` | `73d5fdc3`, 2026-09-14 20:20 UTC | 2026-09-14 21:34 UTC |
| `linear-outbound` | `0aa5954`, 2026-09-15 16:55 UTC | 2026-09-15 16:57 UTC |

Each was deployed shortly after the commit that last changed it, and neither
changed again afterwards. That also explains the deploy timestamp inside the
freeze window noted in the first entry: `linear-outbound` was deployed two
minutes after the merge that became the freeze point.

**So B7 does not close to "C1 unavailable". The offline evidence points the
other way.** Frozen main `0aa5954` is the single leading candidate: ten of the
twelve are stable through it, `production-write` sits at its deployed value
unchanged since `73d5fdc3`, and `linear-outbound` changed exactly at `0aa5954`
and deployed minutes later.

**The honest limit, unchanged.** This is expected-side evidence plus deploy
timing. It is circumstantial, not proof. Nothing here observes what is actually
running. Two specific gaps: a deploy could have come from a ref other than
main's tip, and the deployed entrypoint paths for `production-write` and
`linear-outbound` sit under a `release/` staging directory rather than the
`supabase/functions/` paths the expected side is computed from, so path-level
agreement has not been shown either. One authenticated `ef-fingerprint` live
read settles all of it, and remains the final word.

B7 is therefore narrowed, not closed: named candidate `0aa5954`, one live read
to confirm or refute.

### 2026-09-15 — Owner sitting page written for steps 1, 8, 9, 10 and 11

Prepared a single ordered page the owner can follow cold at the keyboard, with
the exact command per step, what output means it worked, timings, stop
conditions placed inline, prerequisites, and safe stopping points.

Changed the order the owner sketched. He had listed the catalog read first, then
Storage. The runbook requires the catalog read to be immediately followed by the
database refresh and treats a catalog over an hour old as stale; Storage takes
20 to 30 minutes plus transfer. Running Storage between them would have expired
the catalog and forced a re-run at the keyboard. Storage now runs first. Owner
accepted the correction.

Two limits stated on the page rather than papered over: the exact argument list
for the Storage operator lives in a private file on the owner's machine that no
session can read, so the page points at that file instead of guessing flags; and
only the 20 to 30 minute Storage figure comes from the runbook, the rest are
estimates and are labelled as estimates.

### 2026-09-15 — Step 8 partially done: identity and profile confirmed, hash and TLS still owed

Confirmed read-only: project `syncview-calendar`, the direct host the operator
config expects, PostgreSQL 17, healthy.

The live catalog matches the **`observed67_optout`** profile. This was checked
against both discriminators the profile actually keys on, not just the obvious
one. The profile derives the older baseline by removing
`team_members.auto_assign_opt_out` *and* by rewriting the table ACL to restore
table-wide read. Live, the column exists as boolean, default false, not null;
and the table ACL has table-wide read revoked from the two public roles, which
instead hold column-level read on 11 of 12 columns with the flag withheld. Both
halves agree with the profile.

Reported as **in progress, not complete**. Two parts of its done-condition
cannot be produced from a session: the full-catalog hash comparison and the
direct-connection TLS check both need the private catalog script and CA file on
the owner's machine. Verifying a profile by its discriminating features is
strong evidence but it is not the hash comparison the step asks for, and saying
otherwise would have been the easy lie.

### 2026-09-15 — Twelve of twelve green on `f4452dc5`; step 7 complete

Four commits took the branch from conflicted to fully green against frozen main:
the catch-up merge, the test register, the two re-derived source pins, and the
fixture schema fix. The owner verified the twelve checks himself.

The last failure was the instructive one. Five Postgres-routed native-intake
suites failed **only in CI**; they skip locally unless a disposable database is
explicitly required, so a clean 547-suite local run had said nothing about them.
Root cause: the native-intake harness builds each throwaway database from a
hardcoded migration list which did not include main's new migration, so the
fixture lacked the `auto_assign_opt_out` column while the gateway's roster read
now names it, and every assignee lookup returned 503. Exactly the failure that
migration's own note warns about.

Reproduced against a real local PostgreSQL before fixing (30 passed, 18 failed,
matching CI), then 48 passed and 0 failed after. That confirmed the missing
column accounted for **all** eighteen, which the owner had required before any
push.

### 2026-09-15 — Five pins broken by the catch-up, all tracing to one feature

Catching main up invalidated five things that had pinned themselves to the
pre-merge picture of the repository. Four traced to a single cause: main's
auto-assign opt-out feature changing the write gateway.

1. The explicit test register, which the branch introduced and main does not
   have, so main's two new test files arrived unregistered. This single refusal
   was the root cause of all three of the first CI failures, because the unit
   lane and both isolated database lanes run the same routing script.
2. The Section 4 deploy-lane fingerprints, regenerated during the merge.
3. The write-diagnostics composer's two stored source hashes.
4. The native-intake test's pinned baseline commit.
5. The native-intake fixture's hardcoded migration list.

### 2026-09-15 — Catch-up merge: five conflicts, not the three that were rehearsed

The reviewed helper refused with `STOP_UNEXPECTED_CONFLICT`. The plan expected
three bookkeeping conflicts; there were five, the new ones being the directory
map and `index.html`, which is application code.

`index.html` looked catastrophic (about 2,400 changed lines on the branch
against about 1,000 on main) but almost all of it merged automatically. Only two
hunks survived, roughly 90 lines, and they were in the worst possible place:
both sides had rewritten the same notice-priority ladder on the Workload board,
the code that decides which single warning a person sees.

Resolved by keeping both sides' behavior. See decisions D5, D6 and D7.

### 2026-09-15 — Owner froze main at `0aa5954`

Verified against the remote rather than taken on trust. No merges until the
installation is finished. A merge in this window would also invalidate a handed
over deploy SHA, which has cost rejected dispatches twice before.

### 2026-09-14 — Execution map published

One flat list of 28 numbered steps across 7 phases with 7 owner approval gates,
with a done-condition per step and a reporting format. It exists because the
preparation had grown into many documents and no single ordered thing an
execution session could follow and report against. Publishing it authorizes
nothing.

### 2026-09-14 — Recovery procedure written, and what it exposed

Writing the recovery routes down is what revealed that several of them were not
proven. The document says so in its own words: the 13-function hosted rollback,
the prior pin set and the safe transition are **untested and unestablished until
day-of checks pass**. It also records that redeploying code does not rewind
accepted database saves or reverse notifications, so a code rollback is not a
data rollback.

That honesty produced two concrete day-of prerequisites which are still open,
listed in blockers below. The value of the document was as much in what it
proved missing as in what it documented.

### 2026-09-14 — Database custody drill completed

Captured, encrypted, uploaded to the private Drive folder, downloaded on a
second device, hash matched, restored into an isolated database. This is the
drill that makes a backup real: a package that has only ever existed on the
machine that made it has not been shown to be recoverable.

It has to be refreshed on installation day, which is steps 9 and 10.

**CORRECTION, added 2026-09-15. The entry above is kept as written.** "Downloaded
on a second device" is not what the private custody record says. Its retrieval
scope records an actual browser download of the encrypted package from the
private Drive folder **back onto the same computer** that made it. The
downloaded archive's SHA-256 matched, and the restore of that downloaded copy
passed. Separately, the owner opened the recovery record on their phone.

So the 2026-09-14 drill proved three things: a Drive round trip, a restore of
the downloaded copy, and the recovery record's existence on a separate device.
It did **not** prove retrieval of the package on a separate device. The owner
confirmed on 2026-09-15 that the file's wording is the correct record. The
recovery record itself has been exercised once: it decrypted that downloaded
package.

### 2026-09-14 — Three owner approvals recorded

See decisions D2, D3 and D4. In short: a narrow three-field browser exception;
a correction that normal Slack alerts are preserved and only the one displayed
Linear link goes; and a scope limit to website decoupling with Linear itself
untouched.

### 2026-09-13 — PR #1382 superseded by PR #1391 on a main base

Review found #1382 conflicted. Preparation moved to
`prep/linear-exit-review-fixes-20260913`, opened as draft PR #1391 on 2026-09-14
with main as its base.

Recorded precisely because the wording matters to a future session: **#1382 is
still open, not closed.** It is superseded, not replaced. Its branch,
`integration/linear-exit-current-main-20260910`, sits on an older main base
(`340a3be0`). Do not treat it as the live line of work, and do not take its body
as current state.

### through 2026-09-12 — Preparation build and isolated proofs

The preparation build reached: a 48-source, 55-chunk observed installation with
exact routine bodies and matching fresh replay; a proven interruption and resume
that preserves the committed chunk prefix and finalizes removal of the temporary
guards; encrypted recovery coverage; and guarded retirement and native reopening
behind isolated checks.

The load-bearing caveat, stated at the time and still true: these are isolated
and offline proofs, **not hosted acceptance**. Nothing about them establishes
that the live system behaves the same way.

---

## 2. Open blockers

Live list. Items come off with a date and a note, never by deletion.

| # | Blocker | Waiting on | What would clear it |
|---|---|---|---|
| B1 | Storage custody outstanding from step 1 | Owner, needs a genuinely quiet window where nobody is editing Drive files | Run the Storage operator, then upload, download on a second device, hash compare and restore the downloaded copy. Must be done before step 13 |
| B2 | Step 8 incomplete | Owner's catalog script run | A receipt with its supported-baseline and TLS checks passing, naming `observed67_optout`. Identity and profile are already confirmed read-only; the full-catalog hash and direct-connection TLS are what remain |
| B3 | Fourteen inaccessible Drive file references undecided | Owner | A decision per reference. A private decision sheet exists. No replacement or deletion is authorized. Does **not** block the dormant install |
| B4 | No executable hosted database recovery route if journal resume cannot finish | Owner and session, before step 13 | Carried from the checkpoint, not in the owner's own list of three. Named there as a day-of prerequisite |
| B5 | No captured compatible browser and function versions with an executable restoration route before merge | Owner and session, before step 16 | Carried from the checkpoint, not in the owner's own list of three. Named there as a day-of prerequisite |

| B6 | Recovery route C1 is not available: no single older commit matches all thirteen deployed functions, and `notify` is not deployed at all | Owner, before step 13 | An owner decision. Either accept proceeding without C1, or authorize a separately prepared and reviewed exact-capture restoration lane. Added 2026-09-15 from the step 2 capture. Tightens B5, which assumed a restoration route would exist |

| B7 | Whether one older main commit matches all **twelve** functions that have deployed versions is UNPROVEN, so C1 is neither confirmed nor ruled out | Owner or CI, before step 13 | One authenticated `ef-fingerprint` live read plus an offline walk back through main. Recipe in the 2026-09-15 correction entry. Added 2026-09-15, superseding B6 |
| B8 | The recovery procedure does not say what rollback means for a brand-new function | Owner, before step 16 | For `notify` there is no previous version, so rollback means removing it or leaving it inert, not restoring. The procedure should state which. Added 2026-09-15 |

**B10 blocked on PG17 access, 2026-09-16.** Reverted out of the catch-up by owner
decision so the catch-up could land green, which it did at `0c923169`. The
remaining work is understood and was demonstrated today: re-apply the guard-list
addition, its four pin re-derivations and the fixture migration entry, then
regenerate the retirement expected blob with the existing generator against a
real PostgreSQL 17 server. This sandbox has only 16, no PGDG repo and no docker
daemon; the owner's machine has PG17 at the path the runbook already uses. The
missing thing is a disposable PG17 server, not effort.

**B10 NOT closed, corrected 2026-09-15 later the same day. The note below stands
as written per the append rule and is wrong.** The guard-list addition and its
four pin re-derivations landed, but closure also requires the reviewed
retirement trigger contract, which B10's own note named and which was missed.
CI's Isolated PG17 retirement-switch lane is red on `retirement_trigger_contract`.
B10 is open and needs an owner decision: separate it out of the catch-up, or
re-derive that contract deliberately. See the top progress entry.

**B10 closed, 2026-09-15.** `hiring_practical_test_jobs` added to the admission
guard list in sorted position, 86 entries to 87, and the four downstream pins
re-derived in dependency order. The ordering constraint was satisfied by the
hiring migration landing on main at `1abdd1fa`.

**B4 decided in part, 2026-09-15, owner. Row kept above, still open.** Accept
the loss of newer saves and reconcile by hand; no PITR, on cost. Consequence:
steps 9 and 10 are now the recovery route that actually matters, not a spare.
What remains open is the mechanical half, whether the managed Restore control is
enabled at all, which is the click path in the sitting page appendix.

**Accepted-loss position IMPROVED, 2026-09-16, owner. The note above is kept as
written.** In a real incident, "reconcile newer saves by hand" no longer has to
mean reconstructing them from memory. Restore-to-new-project can produce a
restored copy beside the live database without touching it, so newer saves can
be reconciled against a real source. See **D14**. The route itself is unchanged:
in-place restore (D13).

**B5 browser baseline re-derived, 2026-09-15, still open.** Recomputed against
`1abdd1fa`; the `0aa5954` values are stale and removed from the sitting page. The
framing was also corrected: the capture must be taken immediately before the
**exit** merge, not before any merge, because every merge republishes Pages. The
page now says to re-derive from main's tip at capture time rather than trusting
any value written in advance.

**B7 closed yes, 2026-09-15.** 12 PASS, 0 FAIL, 0 ERROR at `0aa5954` on the
Windows machine. C1 exists and `0aa5954` is the commit; it remains an ancestor of
`1abdd1fa`, so both the answer and the rollback target survive the merge. It does
not close B5.

**B7 narrowed, 2026-09-15, row kept above.** It does not close to "C1
unavailable". Measured over full history, ten of the twelve closures are stable
across the deploy window and the two that moved were each deployed minutes after
the commit that changed them, making frozen main `0aa5954` the single leading
candidate for a commit matching all twelve. Still unproven: the evidence is
expected-side plus deploy timing, and does not observe what is running. One
authenticated `ef-fingerprint` live read confirms or refutes. B7 stays open with
that candidate named.

**B7 closed YES, 2026-09-15, row kept above.** One authenticated
`ef-fingerprint` live read pinned at frozen main `0aa5954` returned
`Summary: 12 PASS, 0 FAIL, 0 ERROR` with all twelve at the expected JWT
posture. Every function with a deployed version matches `0aa5954`, so recovery
route C1 exists and `0aa5954` is its commit. `notify` stays outside C1 by
design (B8). B5 is not closed by this; see the B7 progress entry.

**B8 closed, 2026-09-15.** The recovery procedure now states that `notify` has
no previous version, so its rollback means removal or leaving it inert, and that
the other twelve are a different operation. Owner-approved amendment.

**B6 is withdrawn as reasoned, 2026-09-15.** Its row stays above per the append
rule. It asserted that C1 was unavailable *because* `notify` had no deployed
version. That reasoning was wrong: `notify` is new code that does not exist on
frozen main, so having no deployed version is expected. B7 replaces it on the
correct basis, and reaches a weaker and more honest conclusion: unproven rather
than unavailable.

| B9 | The live database is ahead of main: the owner's hiring practical-test migration was applied live, so the catalog matches neither reviewed profile and steps 8, 9 and 10 cannot pass | Owner, the hiring migration landing on main after the freeze | Once it is on main, re-derive the catalog profile once against that settled state, review it, then run steps 8, 9 and 10 back to back. Added 2026-09-15. Keeps B2 open |
| B10 | Admission closure does not cover the new `hiring_practical_test_jobs` table, and the reviewed admission list and retirement contract predate it | Owner and session, before the installation is re-planned for B9 and before admission is ever closed | Decide whether the new table joins the admission guard list, re-derive the guard source and retirement contract expectations if so, and record the classification of the hiring reads and the one inserted row in `syncview_runtime_flags`. Added 2026-09-15 |

**B1 narrowed, 2026-09-15, not cleared.** The quiet-window capture passed on
its second attempt and the transport archive is packed. Still outstanding: the
owner's private upload, a download on a second device (not yet chosen), the
hash and size comparison, and a passing restore of the downloaded copy. B1 stays
open until that restore passes.

**B10 decided in principle, 2026-09-15, owner. Row kept above, still open.**
The owner confirmed the gap by reading the admission list directly: it names
`hiring_applications`, `hiring_application_events` and `hiring_invite_jobs`, and
not `hiring_practical_test_jobs`. Decision: the new table **will** join the
admission guard list. Implementation waits.

**Ordering constraint. Do not get this wrong.** The admission loop raises
`application_admission_missing_owner` for any listed table that does not exist.
So adding `hiring_practical_test_jobs` to the list **before** the hiring
migration is on main would make the installation abort on every database that
lacks the table: fresh replays, the isolated proof clusters, and any restore.
Required order:

1. The hiring migration merges to main, after the freeze lifts.
2. The catalog profile is re-derived once against that settled state (B9).
3. Only then is the table added to the admission guard list, with the guard
   source and the retirement contract's expected guard triggers re-derived
   together and reviewed.

Adding the name first, to "get ahead", is the wrong order.

**B1, B2 and B9 unchanged, 2026-09-15, owner.** B1 is the owner's to finish. No
second computer has been chosen, the drill has not started, and step 1 is not
complete. B9 and B2 stand as written: no re-pin; the hiring change merges after
the freeze lifts, then the profile is re-derived once, and only then do steps 8,
9 and 10 run back to back.

**B1: reduced Storage drill chosen, 2026-09-15, owner. Row kept above, still
open.** The owner has no convenient second computer and will not chase one.
In place of the second-device drill, the owner uploads the packed Storage
archive to the private Drive folder and downloads it back onto **this same
machine**, into a fresh directory. The session then verifies the downloaded
copy's SHA-256 and byte size, runs the transport verify, and runs the full
authenticated decrypt against the signed inventory.

What the reduced drill establishes, if it passes:

- the archive survives a round trip through private Drive byte for byte;
- the recovery record decrypts it, with every object checked against the
  inventory hash and size.

What it does **not** establish:

- independent retrieval of the package on a separate device.

This is a **reduced substitute the owner chose, not an equivalent.** It matches
what was actually done for the database package on 2026-09-14 (see the
correction under that entry): a same-machine Drive round trip, with the
recovery record opened on the phone. It is not the stronger second-device drill
the sitting page describes. To be plain: **no package, database or Storage, has
yet been retrieved on a separate device.**

**Step 1 is not marked complete on this basis.** When the reduced drill passes,
B1 narrows to the second-device gap alone, and stays open.

**Reduced drill RESULT, 2026-09-15: PASSED.** Hash and size of the downloaded
copy equalled the packed archive, all 2,824 ciphertext files verified exact,
and the authenticated decrypt verified all 1,085 objects and 2,343,907,896
bytes against the signed inventory. Receipt
`downloaded-storage-readback-20260915-2.json`, which still records
`other_device_retrieval_independently_proven: false`.

**B1 is therefore narrowed to exactly one thing: no package has ever been
retrieved on a separate device.** Step 1 is not complete. Whoever closes B1
must either do that drill or record an explicit owner acceptance of the
reduced substitute as sufficient for step 13.

**B1 CLOSED, 2026-09-16, accepted by the owner. Row kept above.** The owner
explicitly accepted the reduced drill as sufficient for step 1, and the
execution map's step 1 wording supports that reading (see the 2026-09-16
progress entry). Step 1 is complete.

**PERMANENT CAVEAT. This is part of the record, not an open item, and must not
be removed or softened by a later session.**

> No package, database or Storage, has ever been retrieved on a separate
> device. The 2026-09-14 database drill and the 2026-09-15 Storage drill were
> both same-machine round trips through private Drive. Each proves that the
> archive survives the round trip byte for byte and that the recovery record
> decrypts it with every item verified. Neither proves hardware independence:
> that the backup is retrievable when this machine is lost or unavailable. The
> recovery record itself has been opened on a separate device, the owner's
> phone. The packages have not.

Anyone relying on these backups for a scenario that includes loss of the owner's
Windows machine should treat retrieval from another device as **unproven**.

**B2 stays open, 2026-09-15.** Run 2 of the catalog read verified TLS and
identity, which clears the TLS half of the original row. The profile half now
fails for a new reason, B9. Not cleared.

**Note on the freeze, 2026-09-15, owner.** The freeze at `0aa5954` was defined
as a merge freeze. It did not cover live schema changes, and one was applied the
same day through a separate session. Freezing merges does not freeze the
database the plan was reviewed against. A future freeze for this work should
say whether it also freezes live DDL.

**B3 DEFERRED past the merge, 2026-09-16, owner. Row kept above, still open.**
The fourteen inaccessible Drive file references are decided after the merge.
The row already recorded that they do not block the dormant install; the owner
has now also taken them off the pre-merge path. Nothing else changes: no
replacement, deletion or link change is authorized, and the private decision
sheet stands.

**B10 RECORDED AS NOT BLOCKING the install or the merge, 2026-09-16, owner
decision, confirmed from code by this session. Row kept above, still open.**
The admission guard installs with `mode='open'` and is a pass-through at that
mode; closing is a separate explicit call that nothing in the install path
makes. See the progress entry for the two files and the exact lines.

The confirmation went further than the decision needed: **adding the table to
the guard list today would make step 14 refuse**, because the retirement trigger
contract compares the whole `aaa_application_dml_admission_%` trigger set
against a frozen blob and the install operator asserts it twice. So deferring
B10 is not merely safe, it is required. D12's ordering is unchanged, and B10
stays gated on B9 rather than on PG17 access — that access now exists in this
sandbox, which the 2026-09-16 note above assumed it did not.

**B9 RE-SIZED, 2026-09-16, still open. It is the long pole before the install
gate at step 13, not the thing that lifts the freeze — it lands on the branch,
not on main. Wording corrected 2026-09-16.**
Not a re-pin. The plan builder refuses any starting catalog that is not
byte-exact against the reviewed observed contract, and the hiring delta spans
six object classes, so it will not reverse the way the opt-out delta did. The
route is to derive and review a new observed catalog contract at the settled
state, then a new install target, then the operator's post-install table
constant. Runnable derivation and both routes:
[`LINEAR_EXIT_B9_CATALOG_REDERIVATION.md`](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md).
B2 stays open behind it, unchanged.

**New, carried under B9 rather than as its own row, 2026-09-16.** The install
operator's hard-coded `GUARD_COUNT` of 90 public tables was derived from a
67-table live read, and the live database has gained one table. Derived from
code, not measured — step 8's receipt settles it. See the progress entry.

**B10 NARROWED, not closed, 2026-09-16. Row kept above.** The half that was
blocked is done and proven: the table is in the admission guard list, the
fixture creates it, seven pin sites are re-derived, and the retirement trigger
contract blob was regenerated on a real PostgreSQL 17 in this sandbox with both
`definition_md5` values read from the server. The lane that forced B10 out of
the catch-up is green — `LINEAR_EXIT_RETIREMENT_SWITCH_OK`, 46 checks — and the
full suite shows zero regressions against a clean control worktree.

**B10 now reduces to exactly three things, all of which need the private
observed inputs and therefore the storage session:**

1. Re-pin the three profile plan hashes. Measured here and recorded in the
   progress entry; deliberately NOT written, because pinning is the owner's
   reviewed step and a new plan beside a stale target would read as re-pinned
   while being half-updated.
2. Re-derive the three profile TARGET hashes, which requires a real install run
   of the new plan. `settled68`'s `625430…` is superseded, as recorded in
   advance earlier today.
3. Decide what happens to
   `docs/independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json`, which
   is both a dated proof record and a live `SOURCE_PIN` gate in the install
   operator. Not edited here; it is an owner decision, because editing a dated
   proof record's pins rewrites history and leaving it fails step 14. Added
   2026-09-16, not previously recorded anywhere.

Nothing in 1 to 3 blocks the merge or the install any more than B10 already did:
the admission guard still installs `open` and is inert until something closes
it, which nothing in the install path does.

**B10 item 3 DECIDED, 2026-09-16, owner. The note above stands as written.**
The pipeline proof is **re-run, never edited**. The re-run writes a NEW dated
proof file and leaves the 2026-09-13 file byte-identical; the install operator's
`source_pins` read is then pointed at the new file. Confirmed by this session
that the re-run **requires the private observed inputs** — four private capture
files the lane refuses to start without — so it is the storage session's, not
this one's. Its `--verify` mode also takes a private target path and SHA, which
puts it downstream of item 2; `--calibrate` does not and can go first.

So all three of B10's remaining items are now the storage session's, and item 3
is no longer an open question, only unexecuted work.

**Correction to item 3's scope, same day.** Three of the 26 pins are stale, not
the two named when the decision was taken, and **only one of the three is
B10's**. The other two, the full install plan builder and the observed full
target, went stale earlier on 2026-09-16 from the settled-contract and
count-derivation work. The proof has therefore been failing its own gate since
before B10 started. Whoever re-runs it is re-proving today's earlier work too.

**Separately, not a blocker and not B10.** The dual role of that file — dated
receipt and live gate in one document — is recorded as a structural finding with
a proposed direction in the progress log. Deliberately not fixed.

**B4 mechanical half PREPARED, not closed, 2026-09-16.** The dashboard check is
now a numbered click path in the sitting page, section 4, with what to write
down and what each outcome means. It is two minutes and changes nothing. It
stays open until the owner runs it, because no command can answer it. The
decision half was already made: no PITR, on cost, which is what makes steps 9
and 10 the recovery route rather than a spare — the sitting page now says that
where the drill is, not only here.

**B5 browser capture PREPARED, not closed, 2026-09-16. Row kept above.** The
capture block on the sitting page no longer carries written-down baselines to
go stale: it reads the expected hashes out of git at capture time, covers all
23 published files rather than the five that were listed, and moves bytes with
`git archive` and `tar` so it is binary-safe. The timing constraint is stated
where it bites and nowhere else — **immediately before the exit merge at step
17, and not before any other merge**, with the failure mode spelled out, which
is that a capture taken at any other moment still looks complete. Verified here
that the git side of the pipeline reproduces `1abdd1fa`'s `index.html` hash
exactly.

**B4 identity question CLOSED BY MEASUREMENT, 2026-09-16, owner's rehearsal.**
Live and the restored copy both report `system_identifier`
`7642734024280108049`. A Supabase restore preserves cluster identity, so the
installer's identity check survives a restore and the recovery route works on
this point. This supersedes the "supported but not observed" note below. What
remains unmeasured under B4 is only the restore's outage DURATION, which is
recorded as unknown by deliberate choice.

**B4 identity assumption UPGRADED, 2026-09-16, closure unchanged.** The
recovery route B4 closed on depends on the installer's identity check still
passing after a restore. Measured here: a physical restore preserves
`system_identifier`, a logical one cannot. All eight backups are marked
PHYSICAL, so the assumption is now supported rather than assumed. It is not yet
observed on this project; the approved rehearsal settles that. B4 stays closed
either way — this narrows a caveat, it does not reopen the blocker.

**B4 CLOSED, 2026-09-16, owner. Row kept above.** The managed restore route is
executable: eight daily PHYSICAL backups, newest 16 Sep 2026 11:19:55 +0000,
each with a Restore control present and enabled, checked read-only with nothing
clicked. Combined with the accepted-loss decision of 2026-09-15 (no PITR, on
cost, reconcile newer saves by hand), the mechanical and decision halves are
both settled.

**Recorded as part of the closure, not as a caveat to be dropped later:**

> The outage duration a real restore would cost is **UNKNOWN**. It cannot be
> measured without performing a restore, and performing one in place destroys
> the live database. No estimate has been written down, deliberately.
>
> Database backups **do not include Storage objects**, and restoring does not
> bring back deleted files. This is the platform's own statement on the Backups
> page. It is why the separate Storage custody capture exists, and it means a
> database restore returns a database whose Storage references are only as good
> as that separate package.

**Duration UPDATE, 2026-09-16, owner: an upper bound, NOT a measurement. The
note above is kept as written.** The approved restore-to-new-project rehearsal
was started at 09:38 local and the restored project answered a query at 09:50
local. **The restore therefore completed in at most 12 minutes.**

- **It is a ceiling.** The moment the database first became usable was never
  observed. It may have been ready several minutes earlier and simply waited
  until the owner ran the query. Do not record or quote "12 minutes" as a
  measured restore duration.
- **What it replaces:** "unknown" becomes **"under a quarter of an hour, upper
  bound"**. That excludes the hours-long outage that could not be ruled out
  before.
- **What would make it exact:** watch for the moment the restored database
  **first answers a query**, for example by polling a trivial read on a short
  interval from the moment the restore starts, rather than timing to whenever
  someone happens to try. The first successful answer is the measured
  duration.
- **What it does not cover, so it is not over-read.** The bound was taken on a
  **restore to a new project**. The recovery route is the **in-place** restore
  (D13). Both restore the same daily PHYSICAL backups, so a similar duration is
  plausible. But the in-place duration itself has not been observed and cannot
  be observed without destroying live. It is also one observation, of one
  backup, at the database's size on 2026-09-16.

A route to close the duration unknown at no risk is proposed, not adopted, in
[`LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md`](LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md).
It also names a question the recovery procedure currently assumes rather than
establishes: whether `system_identifier`, which the installer's identity check
is built on, survives a restore at all. The reviewed procedure is unchanged.

**B4 identity caveat CLOSED, 2026-09-16, by measurement. Row and notes kept
above.** The question left open, whether `system_identifier` survives a
restore, is answered **yes**, observed on this project. The approved
restore-to-new-project rehearsal read `7642734024280108049` on the restored
project, and live reads the same, cross-checked against three private reads
on 2026-09-14, 2026-09-15 and 2026-09-16. B4 was already closed; this removes
the one assumption its recovery route still carried. Two things are unchanged:
the restore duration is still recorded as **unknown**, and database backups
still exclude Storage objects. The rehearsal result names
`system_identifier` only, so the database OID is expected to survive by the
physical-copy rule but was not reported.

**Update, 2026-09-16, owner. The sentence above is kept as written.** The
database OID and the database name are now **measured**, not expected: the
restored project returned `database_oid = 5` and `current_database = postgres`,
equal to live, confirmed against three private reads. Three of the four
`IDENTITY_SQL` fields match across a restore by measurement. `session_user`
remains unmeasured. The route is unchanged: in-place restore (D13).

B4 and B5 are recorded here because a blocker list that omits known
prerequisites is worse than no list. They are the checkpoint's own words, not a
session's addition.

**B2 CLOSED, 2026-09-17T00:10Z (2026-09-16 18:10 on the owner's machine), storage
session, on the owner's authorisation of step 8. Row kept above.** The row asked
for a receipt with the supported-baseline and TLS checks passing, naming
`observed67_optout`. The naming half was superseded, not failed. D12 held the
re-pin until the hiring migration reached main, B9 derived `settled68` against
that settled state, and D17 and D18 made it the world step 14 installs against.
Receipt `day-catalog-20260916-5/receipt.private.json`, SHA-256
`685482e88f490d3e81235cbf2126b539d112c8d352bd27b3eaf073fbca45ec41`:
`catalog_sha256` `ddfa4c4f…`, `profile: settled68`,
`matches_reviewed_baseline: true`, `tls_verified: true`, 68 tables. Identity is
identical to three earlier reads. Full evidence is in the progress entry "STEP 8
CLOSED". **B9 is not closed by this note.**

---

## 3. Decisions

The most valuable section. Each entry is a judgment call, its reasoning, and who
made it, so that a future session does not relitigate it or undo it unaware.

### D1 — Move preparation onto a main base (2026-09-13, owner after review)

#1382 conflicted. Rather than fight the conflicts on an old base, preparation
was rebuilt on a branch based on main and opened as #1391. Consequence a future
session must respect: #1391 is the live line of work; #1382 remains open but is
not current.

### D2 — Narrow three-field browser exception (2026-09-14, owner)

Exact missing-column compatibility for three planned native projection fields.
Deliberately narrow. Existing canonical reads stay in use and no authorization
is synthesized by it.

### D3 — Normal Slack alerts are preserved; only the one displayed Linear link goes (2026-09-14, owner correction)

This was a correction to an earlier understanding, which is why it is recorded
as its own decision. The migration does **not** touch normal notification
behavior. Exactly one n8n change is in scope for the entire migration: removing
the displayed Linear link from the legacy editor workflow, at step 22, requiring
its own separate go-ahead in the same session it happens. Every other workflow
stays untouched. No client Slack message is ever sent by this work.

### D4 — Scope is website decoupling; Linear itself is untouched (2026-09-14, owner)

The goal is that the website no longer depends on Linear. Linear's account,
billing, credentials, data and its own integrations are out of scope. **Actual
Linear retirement is not a later step of this plan** and would need a new,
separate owner decision with its own plan. Verified native receipts are kept,
never deleted.

A future session should read this as a hard boundary, not as a sequencing hint.

### D5 — Do not widen the catch-up helper's conflict allowlist (2026-09-15, session, endorsed by owner)

The helper resolves only three bookkeeping files. That narrowness is not a
limitation, it is the safety contract: because it only ever touches version pins
and independent log entries, a later step can verify its output byte for byte
before staging it. Teaching it to merge application code would have destroyed
the property that makes that verification meaningful, and the "rehearsal" would
then have been the machine blessing a merge it invented for itself.

The refusal was correct behavior and was left intact.

### D6 — For this one merge, the rehearsal receipt is replaced by owner review plus substitute proofs (2026-09-15, owner)

Because of D5, a receipt could not be produced: it requires exactly the three
known conflicts and there were five. So steps 4 and 6 as written were not
executable. Rather than weaken the helper, the owner substituted his own review
of the resolution diff plus named substitute proofs.

Scope limit, deliberately tight: **this catch-up only**. The helper is unchanged
and remains the mechanism for any future catch-up whose conflicts are its three
known files. Recorded as an amendment inside the execution map as well, so the
deviation is visible rather than silent.

### D7 — `index.html` resolved by keeping both sides' behavior (2026-09-15, session, reviewed and approved by owner)

Both sides had rewritten the same notice-priority ladder. The branch had
converted it from a suppression chain into an ordered list; main had added two
new notices as early returns. Both of main's became pushes at the rank main gave
them, with main's firing conditions unchanged.

The ranking was verified mechanically rather than by eye: the unmatched
saved-work-days notice sits above the metadata note, above the short-refresh
note and above the completeness note, which is what main's own comment demands.

One behavior change was flagged for explicit approval rather than slipped
through: under main that notice **silenced** everything below it; under the
merged ladder it leads and lesser notices are appended. That makes it harder to
bury, not easier, and it is the branch's deliberate design. The owner approved.

### D8 — The re-derivation rule for pins (2026-09-15, owner, sharpened mid-flight)

The first formulation was "did behavior change", and it was applied correctly
but turned out to be too blunt. The rule the owner settled on:

> The question is not *did behavior change*. It is **whose behavior, and did I
> approve it.** A behavior change originating in a merge resolution is a stop. A
> behavior change that is main's own shipped feature arriving through the
> catch-up is not, because it was approved when it merged.

And the test that separates the two acts:

> Confirming the guard's structural anchors still hold, understanding what
> changed and why, then updating the number, is **re-derivation**. Updating the
> number without that is **silencing**. Do the first, never the second.

Applied: before the two stored hashes moved, all four composition anchors were
confirmed to appear exactly once, and the changed region was confirmed not to be
one of them and not to interact with them.

Context worth preserving: a permission system blocked the first attempt to edit
those hashes, flagging it as possible removal of a security check. The session
stopped rather than routing around it, and agreed with the flag on the merits.
The owner later judged it a correct denial and lifted it explicitly. A future
session should expect that flag and should report it, not work around it.

### D9 — The intake test re-baseline was more than a number, and was flagged (2026-09-15, session, accepted by owner)

That test pins a **git commit**, not embedded text, and could not simply be
advanced: the old pin is a branch commit carrying the native-epoch work, frozen
main carries the opt-out and none of the native work, so no pre-existing commit
held both. The four-symbol check was re-anchored to the reviewed catch-up merge,
which is exactly both, while the longer history was left alone for the other
comparisons.

The owner's standing instruction, set here for all future deviations: **do it,
flag it, explain it in the file.** The comment left in the file is what makes it
reviewable later.

### D10 — Custody work is batched into one owner sitting, Storage first (2026-09-15, owner, order corrected by session)

Steps 1, 8, 9, 10 and 11 run in one sitting so the owner's time is spent once
and both custody jobs carry the same date. Storage runs first for the timing
reason in the progress log above.

### D11 — The Create Post picker deliberately ignores the auto-assign opt-out (2026-09-14 owner ruling, re-confirmed 2026-09-15)

An earlier draft ranked opted-out editors last in the picker, reasoning that the
dialog's suggestion should match the automatic pick. The owner rejected it: the
picker is a deliberate human choice and belongs to nobody's automation. That
half was reverted.

Re-confirmed on 2026-09-15 while checking a related risk, and worth stating
plainly so nobody "fixes" it later: the picker ignoring the flag is **correct
and intended**, not an oversight. It is also why the flag is withheld from the
public database roles, since the browser has no need to read it.

The related risk was checked at the same time and is clear: automatic
assignment routes through the same function on the native lane as on the legacy
one, and the helper that builds the native pool filters and sorts the same
objects without reshaping them, so the flag survives. **The opt-out does not
silently stop working when intake switches to native.** Nothing to record for
step 27.

---

### D12 — No catalog re-pin until the hiring migration is on main (2026-09-15, owner)

The live catalog no longer matches either reviewed profile, because of the
owner's own deliberate hiring migration. The owner ruled against adding or
re-deriving a profile now. The live database is ahead of main, and re-pinning
against it would mean doing it twice: once now, and again when the migration
merges after the freeze. The profile is re-derived **once**, against a settled
state, after the hiring change is on main.

Consequence: steps 8, 9 and 10 do not run until then. They are day-of work
anyway, so little is lost. A future session must not "fix" the catalog refusal
by adding the `ddfa4c4f…` hash as a third profile.

### D13 — Restore-to-new-project is NOT the recovery route; in-place restore remains it (2026-09-16, owner)

The rehearsal removed one objection to restore-to-new-project. Three of the
installer's four identity fields, `system_identifier`, `current_database` and
the database OID, survived the restore by measurement. So a restored project
does not fail the identity check for the reason the original evaluation gave.

**The decisive objection stands, and it is why the route is not adopted.** A
new project is a different reference, URL and set of keys. Nothing points at
it: not the browser configuration, the Edge functions, the scheduled workers or
the n8n workflows. A restore to a new project produces a healthy database that
nothing is talking to. **The outage is not over until every consumer is
repointed, or the data is migrated back, and that repointing has never been
rehearsed.** In the repointing case it is also a configuration change inside the
current freeze.

**In-place restore of the managed PHYSICAL backups remains the recovery route**,
as B4 closed on.

A future session must not read the identity measurement as having made
restore-to-new-project the preferred route. It removed one argument against it,
not the argument that decided it.

### D14 — What restore-to-new-project IS proven for: a restored copy beside live, to reconcile newer saves against (2026-09-16, owner)

**Recorded as its own decision because it improves one the owner already made,
and it must be findable.**

On 2026-09-15 the owner accepted a recovery position: no PITR, on cost, and
**accept the loss of newer saves and reconcile by hand**. Read plainly, a
reconcile "by hand" after an in-place restore meant reconstructing lost saves
from memory, messages and whatever else survived. The restore itself overwrote
the only database that held them.

**The rehearsal showed a better position is available.** In a real incident,
restore-to-new-project can produce a restored copy of a backup **beside** the
live database without touching live. That copy is a real, queryable source. So
reconciliation becomes a comparison against actual data, not a reconstruction
from memory.

This does **not** change the recovery route; that is D13. It changes how well
the accepted loss can be recovered from. It is a better position than the one
accepted on 2026-09-15, and the owner has named it as such.

What it is **not** proven for, so the claim stays exact: repointing any consumer
to the restored project, the time a restore to a new project takes during a
real incident, and any automated or rehearsed reconciliation procedure. Those
remain unrehearsed.

**Note, 2026-09-16. The entry above is kept as written.** The rehearsal did
bound one of those items: a restore to a new project completed in **at most 12
minutes**, an upper bound and not a measurement (see B4's duration update).
That was a rehearsal, not an incident. So "the time a restore to a new project
takes during a real incident" remains **not proven**; it is now bounded by one
rehearsal observation, not unknown.


### D15 — The opt-out world's post-install count resolves from its starting hash, to the observed67 contract's count (2026-09-16, supervisor decision, verified independently by the session before applying)

**What broke, and when.** `8299108` replaced nine hard-coded `90`s with one
derivation, `postInstallPublicTables(plan.initial_catalog_sha256)`. That
function resolves the starting catalog against the named contract artifacts.
The opt-out world's starting catalog `f5ed8a38…` **is not a contract artifact**
— it is a world the builder reverses back to `observed67` — so the lookup found
nothing and threw. Before `8299108` the literal `90` was simply correct for it,
by coincidence of arithmetic rather than by anything checking.

**The change was approved by the supervisor, and the approval rested on a claim
that was true of one profile and stated of two.** The executor said the two
existing profiles were unaffected. That held for `observed67`. It did not hold
for `observed67_optout`, and nothing in the approval asked which of the two had
been exercised. Recorded here because the shape recurs: a claim about a set,
evidenced against one member of it.

**The neutrality check that found it, and what it proved.** The `observed67`
run was genuinely neutral across the runner change: exit 0 on both sides, plan
`3c000b76…` and every artifact byte-identical, with the single expected
difference being the runner's own self-hash pin — and that difference was named
**before** the run rather than explained after it. That is the half that is
worth keeping. The opt-out run failed identically on both sides, at the same
APPLY, with an identical plan, which is what identified the defect as older than
the runner change.

**The generic catch cost a diagnostic cycle.** `execute()` converts every
failure into `INSTALL_OPERATOR_EXECUTION_REFUSED` carrying only a stage, which
is deliberate — it keeps private detail out of operator output. The price is
that a failure whose cause is a plain missing lookup entry arrives as an
unnamed refusal. Naming it needed a separate no-database probe written for the
purpose. The catch is not being changed here; the cost is being recorded so the
next session reaches for a probe sooner instead of re-reading the install path.

**The defect was mid-install, not pre-install, and that is the second half of
the fix.** The resolution sat at `stage='target_comparison'`, after
`maintenance.run()`. So an unresolvable starting catalog aborted an install with
the maintenance guards already written to every public table, rather than
refusing before the connection was opened. The resolution now happens in the
installer's preflight `load()`, which runs before the postgres driver is even
required, and the comparison site reads the already-resolved value. A world
nothing can resolve is now a refusal that touches nothing.

**Why the mapping is a hash-to-contract entry and not a field.** The opt-out
plan hash `0c889149…` is pinned and checked. Any field added to the plan to
carry this would change the plan bytes and break that pin. The entry therefore
resolves from the starting hash alone, in a frozen reviewed table beside the
contracts, and carries its own provenance: the delta is one column and one ACL
string on an existing table and **zero tables**, proven by the builder's own
`assert.equal(j.sha(j.canonical(old)),OLD,…)` — a delta that added or dropped a
table could not reverse that way and would fail that assert. What would make it
wrong is stated in the same comment: any future opt-out delta that adds or drops
a table.

**Verified independently before applying**, by reading
`linear-exit-install-profiles.js`, `linear-exit-observed-public-catalog.js` and
`linear-exit-install-operator.js`, and by executing the resolution for all three
starting catalogs: `observed67` 67+23=90, opt-out 67+23=90, `settled68` 68+23=91,
with an unknown hash still refused. `INSTALL_CREATED_PUBLIC_TABLES` was not
touched and no hash was re-pinned.

**One companion change beyond the letter of the decision, flagged rather than
folded in silently.** `test/helpers/install-operator-worker.mjs` builds its own
`prepared` object instead of calling `load()`. Moving the resolution into
`load()` would have left that object without the field, and the comparison site
would then have failed `GUARD_COUNT` for **every** profile — the same class of
misleading error this entry is about. The worker now resolves the value the same
way `load()` does. It is not adjacent work; it is the second producer of the
object whose contract changed.

**The 91 remains untested, not contradicted.** Nothing here measured a
post-install count. The calibration is still the test of the `settled68`
arithmetic, and it does not run until both existing profiles pass neutrality.

**Addendum, same day, on approval of the above.** The session proposed a
`PREPARED_SHAPE` refusal so that a `prepared` object missing the resolved count
would be named rather than surfacing as a misleading `GUARD_COUNT`. It was
proposed at the comparison site. The supervisor ruled it in at **preflight
instead**, on the line after the destructuring and outside the try, for a reason
worth keeping: inside the try, the same catch that masked the original defect
would have rewritten it as `INSTALL_OPERATOR_EXECUTION_REFUSED` at stage
`target_comparison`, making the new guard exactly as uninformative as the
`GUARD_COUNT` it was meant to replace. Outside the try it throws under its own
name. **That catch has now cost clarity three times in one day**, and each time
the fix has been to keep the failure out of its reach rather than to change it.

Moving the guard ahead of the try also brought the offline operator test's
fixture into scope: it is the third producer of a `prepared` object and its
synthetic world has zero tables, so it now carries
`INSTALL_CREATED_PUBLIC_TABLES` rather than a fresh literal. Three producers of
one object, only one of which is `load()`, is the reason a missing field needed
a name in the first place.

### D16 — The calibration's derived target is written under a filename that names its profile (2026-09-16, supervisor, found on review of the lane)

The calibrate path of `test/helpers/install-operator-worker.mjs` wrote its
derived target to `optout-target.private.json` regardless of
`INSTALL_OPERATOR_PROFILE`. The `settled68` calibration would therefore have
written the settled world's target into a file named for the opt-out world.

**Not cosmetic.** `profiles.settled68.target` is deliberately `null` so that no
plausible-looking hash can be written there by accident, and the file this run
produces is the only thing that will ever fill it. A target read out of a file
named for a different world is precisely how a confidently wrong pin gets made,
and the pin would then be checked against itself forever after. It is the same
defect class as the nine literals and the masked catch: an artifact stating
something it has no way to be right about.

The name is now `<profile>-target.private.json`, built from the same env var and
the same `observed67` default the worker's non-calibrate path already uses:
`observed67-target.private.json`, `observed67_optout-target.private.json`,
`settled68-target.private.json`.

**What the reference check found, reported rather than renamed past.** Two
references to the old name exist in the repository and only one is code.

- `test/helpers/install-operator-worker.mjs` — the producer, changed here.
- `docs/ops/LINEAR_EXIT_INSTALLATION_DAY_20260914.md` line 141 — **a historical
  record, not a consumer.** It names
  `linear-exit-install-operator-e7df95d7…/optout-target.private.json` as the
  private target file of calibration receipt `e7df95d7…`, a run that already
  happened on 2026-09-14. That file keeps its name; the line stays true and was
  not touched. A future opt-out calibration writes into its own receipt
  directory under the new name, so nothing is made ambiguous by the two
  coexisting.

Nothing reads the written file back by name: the postgres runner passes the
target in through `INSTALL_OPERATOR_TARGET` and skips the hash assertion while
calibrating, the CI workflow does not mention it, and no copy exists anywhere in
the working tree. Checked by searching the tracked repository for both the exact
name and the `*target.private.json` shape, and by searching the filesystem.

**Left alone deliberately:** the sibling `operator-result.private.json`, written
by the same branch, is also profile-neutral. It records a status and the hashes
it just computed rather than a value anything will be pinned from, so it is not
in the same class. Named here so the next reader knows it was considered.

Nothing was run against a database.

### D17 — The settled68 target is pinned; the calibration reported the derived 91, so the derivation stands (2026-09-16, supervisor, on the calibration result)

The calibration reported a post-install public table count of **91**, which is
the number derived once from the settled contract before the run. Under the
binding set on 2026-09-16 that is the only outcome that is not a finding: 91
confirms the derivation, anything else would have stopped everything. So the
derivation stands and the target that run produced is the reviewed one.

`profiles.settled68.target` is now
`625430979c5508f2a87b18bfa9d7135806273c909c3f5baf9f5a5fe835f97356`.

**Provenance, all measured.** Derived by the settled68 calibration at
`cd6f1808` on a fresh PostgreSQL 17. File `settled68-target.private.json`,
1,613,093 bytes, built under plan `e3dae746…` from starting catalog
`ddfa4c4f…`, installed public catalog `0d4eb7dc…`, private `fccae16a…`. The 91
was confirmed by two independent measurements inside the run, the worker's
guard count and the target builder's table count, neither of which was handed
the number.

**The pin is committed but NOT closed.** The value comes from a private file
only the storage session can read and reached this session as text in chat. The
house rule is that a hash is read whole from a command's output, and this one
was not read by the session writing it down. The storage session re-reads its
own file and confirms the committed value; until that lands, the pin is
provisional. Recorded in the profile comment as well, so the file says so and
not only this entry.

**The behavior change, reported before it was made rather than handled
quietly.** Pinning the target makes `get('settled68')` stop refusing, because
`get()` refuses any profile whose plan or target is missing. Five searches of
different shapes were run to find anything depending on that refusal:
`settled68` across the whole tracked repository; every caller of
`profiles.get`; refusal assertions in the test tree; the phrases that describe
the profile as unpinned; and every test file naming the profile at all.

What they found:

- **No test and no assertion anywhere depends on `settled68` refusing.** Nothing
  was deleted, weakened or adjusted, because there was nothing to adjust.
- `test/linear-exit-install-operator-postgres.js` is the only test file that
  names the profile. It carries the per-profile SETUP row and, on a
  non-calibrating run, compares the target file's hash to `get(profile).target`.
  For `settled68` that line previously threw "not pinned yet" before it could
  compare; it now compares. Same for
  `test/helpers/install-operator-worker.mjs` line 12. Both are consumers that
  become live, not assertions that break.
- `profiles.build(catalog,'settled68')` never went through `get()` at all: the
  settled branch returns before that line, which is why the plan could be
  exercised while the target was null. The pin does not change `build()`.

**One stale line found in passing, reported rather than edited**, since this
decision's scope was the pin: `REPO_MAP.md` line 467 still describes
`LINEAR_EXIT_RUNNER_SETTLED_WORLD_PROPOSAL.md` as "proposal, not applied — the
operator test runner has no settled68 branch". The runner change was applied
earlier today and that file now carries the per-profile table including
`settled68`, so the line describes a world that no longer exists.

Nothing was run against a database.

### D18 — The two 67-table profiles no longer need to be installable (2026-09-16, owner)

Given in response to the storage session's report at `ff9b379f`. After B10,
`observed67` and `observed67_optout` refuse at install with
`application_admission_missing_owner:hiring_practical_test_jobs`. **The owner
ruled that this is not a regression.**

- Neither profile is named in any numbered step of the execution map.
- Step 14 installs against the live world, which is the 68-table settled world
  (`ddfa4c4f…`, `settled68`).
- So their failed installs at `957db6c8…` and `8f40b44d…` are the expected
  consequence of B10, not a defect to chase. **A future session must not treat
  them as a regression, and must not "fix" them.**

What this does not decide: whether the two profiles are removed from the code,
and what happens to their existing pins. Neither was ruled on here, and nothing
was removed.

### D19 — The pipeline proof moves to the settled world (2026-09-16, owner)

The observed full pipeline proof is re-based on the settled 68-table world
instead of the 2026-09-12 67-table capture. This supersedes the plan in the
entry "Pipeline proof: DECIDED re-run, never edit" only as to **which world**
the re-run proves. The re-run-never-edit rule stands:
`LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json` stays byte-identical, and a
re-run writes a new dated file.

**Explicitly deferred by the owner:** no plan or target pin, and no repointing
of the install operator's `source_pins` read, until the backup-path fix and the
hard-coded world-description sweep are done.

### D20 — The admission guard is NOT made tolerant of a missing table (2026-09-16, owner)

The guard's refusal when a guarded table does not exist is the check working
correctly. This rules out, finally, the third option the storage session listed
at `ff9b379f`. A future session must not relax
`application_admission_missing_owner` to make a pre-hiring world install.


### D21 — No claim of "zero regressions" without its denominator (2026-09-16, owner)

**Binding on every session.** A session reporting that a change broke nothing
must say **how many suites ran and how many exist**. "Zero regressions" alone is
not a permitted report.

Given after this session reported B10 as zero regressions on the evidence of 547
passing suites and a clean control worktree, when 61 more existed that the unit
lane defers and three of those were broken by the change. The claim was true of
what ran and false of the repository, and the missing denominator is precisely
what hid the difference.

The correct form is "547 of 608 ran; the 61 deferred were not run", not a bare
adjective.

### D22 — All 61 deferred suites run before the exit merge (2026-09-16, owner)

Not a sample, not the ones that look relevant: **all of them.** The unit lane
defers 61 suites as `NOT_RUN_BY_UNIT_LANE`, 18 of which carry a hard-coded world
literal, and the deferral is static rather than environment-dependent, so
nothing about a better-equipped machine changes it.

Not scheduled here. It is a gate before the exit merge, and it is not started
until the backup-path review and ruling 3 are settled.

### D23 — The table-name coupling is DECLARED, not patched (2026-09-16, owner)

The same table-name set is written down in more than one place and nothing says
they must agree. Updating the stale copy closes today's failure and leaves the
coupling undeclared for next time, so that is ruled out. **Either the places
derive from one source, or something asserts they agree — and which one is
proposed before it is implemented.**

Proposal written, not implemented:
[`LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md`](LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md).
It recommends **assert, not derive**, and corrects this session's own "four
places" to three, of which two are already byte-identical. Two reasons deriving
is wrong rather than merely harder: one of the three is a **captured
observation**, and generating it from a list would be the same falsification the
pipeline-proof decision rejected this morning; and the guard list is install-plan
source #2, so generating it would make every custody-corpus edit move all three
profile plan and target pins, which B10 measured the cost of.

**It is blocked on one question the owner must answer**, stated in §4 of the
proposal: is the intended relation between the admission guard list and the
custody corpus **equality** or **containment**? They were equal throughout
history and are now guard = corpus + 1. Nothing in the repository states which
was intended, and freezing a guess into an assertion whose purpose is to state
the rule explicitly would defeat the point.

### D24 — The three broken suites are re-based onto the settled world (2026-09-16, owner)

`linear-exit-application-dml-admission`, `linear-exit-source-phases-postgres`
and `linear-exit-source-baseline-catalog-postgres` are re-based onto the settled
68-table world. They are **not** repaired against the 67-table profiles, per
D18, which ruled that those two profiles need not be installable.

Not started. It waits on the backup-path review and on D23's open question,
because re-basing moves the custody corpus and an assertion written against
today's sets would have to be revisited immediately.

### D25 — The guard list and the custody corpus are EQUAL, and any divergence is named in the assertion (2026-09-16, owner)

Answers the open question in
[`LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md`](LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md) §4,
which was the one thing blocking D23 from implementation.

**The relation is equality, not containment.** The owner's reasoning, recorded
because it is the part a future session needs and not the verdict:

> A table worth guarding holds data worth backing up. A table that is guarded
> but never backed up can lose its data behind a check that makes it look
> protected.

That is the worse bug named in the sweep, and it is ruled out by construction
rather than left to be noticed.

**Deliberate divergence stays possible, but only on the record.** The assertion
does not become containment to accommodate a future exception. It stays
equality, and any exception is **named inside the assertion together with its
reason**. So a divergence cannot happen by accident, and can happen only as a
reviewed, written statement.

**Also approved in the same ruling:** the proposal's "assert, do not derive"
recommendation, with **the plan-hash cost as the decisive argument** — the guard
list is install-plan source #2, so generating it would make every custody-corpus
edit move all three profile plan hashes and invalidate all three targets, which
is the blast radius B10 measured. The check **lives in the unit lane**, not the
deferred set.

**Sequencing.** Implementation was gated on the independent review of the
backup-path fix `6da60581` being done and reported. That review is in the
progress log above: PASS, with the synthetic override's loopback gate recorded
as decorative. Implementation is not started in the same breath as the ruling;
D24 also moves the custody corpus, and an assertion written against today's sets
would have to be revisited the moment it lands.

### D26 — Every new check must be seen to fire before it lands (2026-09-16, owner)

**Binding on every session, for every check added from here on.** A check that
has never been observed failing is not evidence that anything holds; it is a
line of code that has only ever been seen agreeing.

The standard, in three steps, all three recorded in the journal:

1. run it unmutated and see it pass;
2. break the thing it guards, run it, and **see it fail**;
3. restore, run it again, and see it pass.

And no red-on-arrival state: the fix and the check land in the **same commit**,
so the repository is never knowingly left with a failing check waiting for a
follow-up.

**One refinement learned immediately, on the first application.** If the thing
being mutated is hash-pinned, the mutation must move the pin too. Otherwise the
drift guard fires first, the check under test never executes, and the "failure"
proves only that a different check works. **A mutation caught by a check other
than the one under test is not a proof of the check under test.** Recorded
because it would be easy to do the weak version and believe the standard had
been met.
## 4. Corrections the session made against itself

Kept as its own section because the owner asked for them explicitly, and because
a record that only contains things that went right teaches a future session
nothing.

### 2026-09-15 — The sitting session reported 7 of 28, and nearly called the hiring change confined

Two things from the Windows sitting.

The session printed "7 of 28" in its progress lines. The authoritative figure
is **6 of 28, about 21%**, per the entry above. Step 8 was in progress and does
not count. The owner caught it.

On the hiring drift, the first structural pass (one foreign key inside hiring,
dependency edges only to the language and the schema) invited the conclusion
"confined to hiring". Postgres does not record what a plpgsql body reads, so
that pass could not have seen the reads and row lock on `syncview_runtime_flags`,
which are in the bodies. Nor does it show the reverse direction, the
installation's own guard triggers on hiring tables. The owner required the
answer from code. The code showed it was not confined in either direction.

### 2026-09-15 — The pin sweep was wrong in kind, not just in count

A sweep was run for broken pins and reported as "three or four, finite". It
swept for stored hashes and pinned file lists. It did not sweep for **fixture
schema chains**, which pin the shape of a database rather than the bytes of a
file. A fifth item was then found only because CI ran suites the local run
skips.

The useful lesson is not "count again". It is that the sweep had a blind spot in
its categories, so no amount of re-running it would have found the fifth item.

### 2026-09-15 — "Four edits" was actually one

The fixture fix was quoted to the owner as four edits, one per failing chain. It
was one: all five suites route through the same shared cluster builder. The
scope was checked properly only after the number had already been given.

### 2026-09-15 — Twice a verdict was reached through reasoning that was never checked

Recorded as one lesson because the two failures are the same shape.

The first was **inverted**: `notify` having no deployment was called decisive
proof, without checking whether `notify` was ever supposed to be deployed.

The second was **too generous**: "ten of the twelve saw no changes to their own
source directories" was asserted from a command that had lumped each function's
directory together with `_shared`, so it never measured what was claimed. The
claim later turned out to be true when measured properly with
`ef-fingerprint`, which is luck, not method. A correct conclusion from an
unchecked method is still an unchecked method, and next time it lands the other
way.

Both checks were cheap. One `git ls-tree`, one correctly scoped command. Neither
was run before the conclusion was stated.

A third, in the same family, was structural rather than logical: the repository
was a **shallow clone**, so the history commands underpinning the second claim
were answering over truncated history. That was not discovered until a commit
reported having no parents.

The useful generalisation: before a fact becomes load-bearing, confirm the
command measured the thing named, and confirm the data source is complete.
Absence, aggregation and truncation each produce confident wrong answers.

### 2026-09-15 — A step 2 argument was built on a premise never checked against main

The worst of the session's errors, because it was not a miscount or a loose
description but a confident inference from a fact that meant the opposite of
what was claimed. `notify` having no live deployment was presented as decisive
proof, without first checking whether `notify` existed on main. It does not; it
is new code this branch adds.

The supervisor caught it. The lesson is narrow and worth keeping: when a missing
thing is about to become the load-bearing part of an argument, establish whether
it was ever supposed to be there. Absence has at least two causes and they point
in opposite directions.

Also corrected in the same pass: the live function count was reported as 37 and
is 36; and the current head was described as green while three of its checks
were still running. Both are small, but the second is the same species of error
as the first, which is asserting a state that had not actually been observed.

### 2026-09-15 — The intake test was described as pinning expected source text

It pins a git commit. The description was given to the owner before the file had
been read closely enough, and was corrected on contact with the actual code. See
D9.

---

Related: [living checkpoint](LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md) ·
[execution map](LINEAR_EXIT_EXECUTION_MAP.md) ·
[owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md) ·
[recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md)
