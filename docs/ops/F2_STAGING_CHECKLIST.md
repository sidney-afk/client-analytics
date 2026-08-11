# F2 staging checklist — the owner's exact sequence

Closes `OPEN_REPAIRS.md` item 9 ("the machine gates are currently unsatisfiable").
This is the provisioning the `FLIP_RUNBOOK.md` evidence/preflight lanes REQUIRE
but do not perform: they verify a database role, three GitHub Environment
secrets, and a one-time ACL revoke, and refuse until all exist. Nothing here
touches a runtime flag, a writer, or the flip itself — staging is reversible
and safe to do days early. **Owner-authorized 2026-08-11** ("for the flip
staging … yes, let's do it").

Public-repo rule (F64): every credential below is a placeholder. Real values go
into the Supabase SQL editor or GitHub's secret fields only — never into a
commit, an issue, or a workflow log.

Order matters only in one place: step 1 (the role) before step 2 (the secret
that contains its connection string). Steps 3–4 are independent; step 5 is last.

---

## Step 1 — create the evidence database role (Supabase SQL editor, one paste)

The evidence lanes open the database as a dedicated role that can read exactly
four tables and do nothing else. `scripts/graphics-f2-evidence.js` verifies
every property below with catalog queries and fails closed on any deviation, so
this block **self-checks the same properties and raises immediately** — a
failure here is a readable error now instead of a `REFUSE` on flip night.

Replace `<STRONG_PASSWORD>` (both occurrences of the value: once in this paste,
once inside the step-2 connection string) before running.

```sql
begin;

-- The role: login only. No memberships, no attributes, nothing inherited.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'graphics_f2_evidence') then
    create role graphics_f2_evidence login password '<STRONG_PASSWORD>'
      nosuperuser nocreatedb nocreaterole noreplication nobypassrls
      noinherit connection limit 4;
  end if;
end $$;

grant usage on schema public to graphics_f2_evidence;

-- Exactly the four relations the evidence transaction reads. Nothing else.
grant select on public.syncview_runtime_flags to graphics_f2_evidence;
grant select on public.mirror_outbox         to graphics_f2_evidence;
grant select on public.flag_flips            to graphics_f2_evidence;
grant select on public.deliverable_events    to graphics_f2_evidence;

-- One permissive all-rows read policy per table, targeting ONLY this role.
-- The verifier requires polroles to equal exactly this role's oid, so the
-- policy must name the role and must not be FOR ALL / TO PUBLIC.
do $$
declare t text;
begin
  foreach t in array array['syncview_runtime_flags','mirror_outbox','flag_flips','deliverable_events']
  loop
    if not exists (
      select 1 from pg_policy p
      where p.polrelid = to_regclass('public.' || t)
        and p.polname = 'graphics_f2_evidence_read'
    ) then
      execute format(
        'create policy graphics_f2_evidence_read on public.%I for select to graphics_f2_evidence using (true)', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- Self-verification: the same catalog checks the evidence lane will run.
-- Any raise here means the environment differs from the verifier's contract —
-- read the message; do NOT widen grants or drop other roles' policies to
-- force a pass. A PUBLIC-targeted read policy on one of the four tables is an
-- owner-classification stop (it may be load-bearing for the app), not a
-- license to delete it.
-- ============================================================================
do $$
declare
  v_oid oid := (select oid from pg_roles where rolname = 'graphics_f2_evidence');
  v_n integer;
  v_bad text;
begin
  -- no memberships of any kind
  select count(*) into v_n from pg_auth_members where member = v_oid;
  if v_n <> 0 then raise exception 'evidence role has % role membership(s); it must have none', v_n; end if;

  -- direct SELECT on exactly the four
  select count(distinct c.oid) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) as acl(grantor, grantee, privilege_type, is_grantable)
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
    and acl.grantee = v_oid and acl.privilege_type = 'SELECT';
  if v_n <> 4 then raise exception 'evidence role has direct SELECT on % public relation(s); expected exactly 4', v_n; end if;

  -- no write-shaped privilege anywhere
  select string_agg(distinct c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) as acl(grantor, grantee, privilege_type, is_grantable)
  where c.relkind in ('r','p','v','m','f')
    and n.nspname not in ('pg_catalog','information_schema')
    and acl.grantee = v_oid
    and acl.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN');
  if v_bad is not null then raise exception 'evidence role holds write privileges on: %', v_bad; end if;

  -- each of the four tables: RLS active, our exact policy present, and no
  -- PUBLIC-targeted read policy (the verifier hard-fails on one)
  for v_bad in
    select t from (values ('syncview_runtime_flags'),('mirror_outbox'),('flag_flips'),('deliverable_events')) as req(t)
  loop
    if not row_security_active(to_regclass('public.' || v_bad)) then
      raise exception 'RLS is not active on public.% — enable it (alter table ... enable row level security) or classify why not', v_bad;
    end if;
    if exists (
      select 1 from pg_policy p
      where p.polrelid = to_regclass('public.' || v_bad)
        and p.polcmd in ('r','*') and p.polroles @> array[0::oid]
    ) then
      raise exception 'public.% carries a read policy targeting PUBLIC — the evidence verifier will refuse; this needs owner classification, not deletion', v_bad;
    end if;
  end loop;
end $$;

commit;

-- Readback receipt (runs after commit; screenshot this)
select r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreaterole, r.rolcreatedb,
       r.rolreplication, r.rolbypassrls,
       (select count(*) from pg_auth_members m where m.member = r.oid) as memberships
from pg_roles r where r.rolname = 'graphics_f2_evidence';
```

**Rollback** (any time before F2, one paste):
`drop owned by graphics_f2_evidence; drop role graphics_f2_evidence;`

## Step 2 — the GitHub `production` Environment and its three secrets

Both F2 workflows run in the Environment named exactly `production`
(`graphics-f2-evidence.yml:197`, `graphics-f2-preflight.yml:27`).

GitHub → repo **Settings → Environments → New environment** → name it
`production` (skip if it exists) → **Add environment secret**, three times:

| Secret name | Value |
|---|---|
| `GRAPHICS_F2_READONLY_DATABASE_URL` | `postgresql://graphics_f2_evidence.uzltbbrjidmjwwfakwve:<STRONG_PASSWORD>@aws-1-us-east-2.pooler.supabase.com:5432/postgres` — same password as step 1; the `role.projectref` username form is how the Supabase pooler routes a custom role |
| `LINEAR_MIRROR_API_KEY` | the existing protected Linear mirror credential (same value the mirror already uses — copy it in; do not mint a new one) |
| `GRAPHICS_F2_OWNER_DISPATCH_ATTESTATION` | a fresh random 32–128 char base64url string. Used ONLY for the owner's pre/post manual drainer dispatches inside the F2 window; keep it out of n8n; rotate after the window |

The evidence workflow also reads `SUPABASE_ACCESS_TOKEN` — already a repo
secret used by the deploy lanes; nothing to add unless the Environment
scoping hides it (if the run says it is missing, add it to the Environment
with the same value).

## Step 3 — the one-time ACL revoke (Supabase SQL editor, one paste)

Paste the fenced block in `FLIP_RUNBOOK.md` between
`GRAPHICS_F2_TRIGGER_EXECUTE_REVOKE_SQL_BEGIN/END` (lines ~165–271), exactly as
written. It revokes only the pre-existing `PUBLIC EXECUTE` on
`public.track_b_enqueue_outbound_intent()`, asserts the trigger binding
survives, and prints a bounded receipt. If the receipt's
`other_public_security_definer` array is non-empty, STOP and bring the list
back for classification — that is a stop condition, not permission to widen
the revoke. (Owner-only rollback lives directly below it in the runbook,
`…ROLLBACK_SQL_BEGIN/END`.)

## Step 4 — nothing. There is no step 4; the drainer stays scheduled

Explicitly recorded because an older draft implied a drainer change here:
the scheduled drainer needs no attestation and keeps running untouched.

## Step 5 — the GO receipt

Actions → **Graphics F2 hard pre-flight** → Run workflow. It must print a
literal line beginning `GO graphics_f2_preflight`. A `REFUSE` line is a hard
stop: bring the refusal text back verbatim — every refusal names the exact
check that failed, and steps 1–3 above were built to satisfy them all.

The GO receipt is consumed by the flip-night sequence in `FLIP_RUNBOOK.md`;
staging ends here. F2 itself remains a separate owner decision.
