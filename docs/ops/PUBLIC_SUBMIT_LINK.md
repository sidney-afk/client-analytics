# Public Submit link — owner-executable switch

The client-facing Submit link (`?intake=1`) is what clients and videographers
use to send footage. This file owns its runtime switch.

**Why it is not in `FLIP_RUNBOOK.md`.** That file's SQL fences are the flip's
own reviewed set, pinned by count and position
(`test/f63-flip-runbook-sql-gate.js`), and this flag has nothing to do with team
authority — it can be moved at any time, before or after any flip, without
reference to the sequence. `FLIP_RUNBOOK.md` §F7 points here.

## What it fixes

From the 2026-08-14 full-roster enrollment until 2026-08-24, **no client could
complete a submission on this link.** Transport is chosen by ENROLLMENT rather
than authority, so once every client was enrolled every client took the native
lane, which demanded staff sign-in — and intake mode deliberately suppresses the
staff dialog, so the visitor read `Staff sign-in required.` with nothing to
click. Ten days, every client, and no error anywhere: the submission simply
could not be made. `OPEN_REPAIRS.md` item 34 carries the full diagnosis.

## What ON means

`production-write` accepts `intake_create` on the `submission` surface from a
caller with **no credentials**. Nothing else on the gateway becomes public — the
public principal is minted at that one call site rather than inside
`authenticate()`, so every other handler stays closed, and a caller who DID
present a credential is judged on it and can never fall through to this path.

Bounded on five axes, all load-bearing:

| bound | value |
|---|---|
| operations | `intake_create` only |
| surfaces | `submission` only |
| runtime flag | `public_intake_enabled`, default OFF, fail-closed on missing/unreadable/malformed |
| item cap | 25 (an authenticated caller gets 100) |
| rate limit | 12 per client and 60 overall per rolling hour, from `public_intake_log` |

Accepted rows are stamped `created_by = 'public-intake'`, so anything submitted
this way is identifiable and reversible in one query.

**The client a submission names is caller-asserted.** The owner chose one open
link over per-client scoped tokens (2026-08-24), which is exactly how the legacy
n8n lane this replaces already behaved. The rate limit, not an identity check,
is what bounds that choice. The client picker also still lists every active
client to anyone holding the link — a known exposure that a per-client token
would have removed and an open link cannot.

## What OFF means

The public path is closed and a credential-less submission is refused with
`credentials_required`, exactly as before 2026-08-24. **OFF is the shipped
default and the one-step rollback** — the gateway fails closed on a missing row,
an unreadable row, or a malformed value, so withdrawing the capability never
needs a deploy.

## Before turning it ON

1. Apply `migrations/2026-08-24-public-intake-log.sql` — it creates the rate
   ledger and seeds this flag OFF.
2. Deploy `production-write` at a version containing the public-intake path. It
   is one of the four F27 Section 4 functions, so this is an owner-window deploy
   (`docs/ops/F27_INSTALL_RUNBOOK.md`).

Turning the flag on before the deploy is harmless: the older function simply
refuses as it does today.

## Turn it ON

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled": true}'::jsonb, updated_by = 'owner-runbook'
  where key = 'public_intake_enabled' and value <> '{"enabled": true}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'public intake enable refused: row missing or already enabled'; end if;
end $$;
```

## Turn it OFF (the rollback)

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled": false}'::jsonb, updated_by = 'owner-runbook'
  where key = 'public_intake_enabled' and value <> '{"enabled": false}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'public intake disable refused: row missing or already disabled'; end if;
end $$;
```

## Read back after either

```sql
select key, value, updated_by, updated_at
from public.syncview_runtime_flags where key = 'public_intake_enabled';
```

## What to watch on the first day it is on

- `public_intake_log` row counts per client — the rate ledger is also the
  ownership record.
- Any deliverable with `created_by = 'public-intake'` naming a client the
  submitter should not have chosen. The client is caller-asserted by design;
  this is the query that makes an abuse of that visible, and the same stamp
  makes it reversible.
