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

> **Revised 2026-08-11 after the first live attempt.** The original block
> assumed RLS was already active on the four tables; the live database has it
> OFF (the self-check caught this on `syncview_runtime_flags` and rolled the
> whole paste back — nothing was half-applied). This version enables RLS per
> table while preserving today's read access exactly: every non-bypass role
> holding a direct SELECT grant gets a matching permissive policy BEFORE RLS
> activates, so the app's anon reads never blink. It also reads
> `pg_class.relrowsecurity` instead of `row_security_active()` in the
> self-check — the latter reports the calling role's own exposure and is
> always false for the table owner, which would have failed the check forever.
> After running it, verify anon reads immediately (flags + a bounded
> deliverable_events read with the publishable key).

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

grant select on public.syncview_runtime_flags to graphics_f2_evidence;
grant select on public.mirror_outbox         to graphics_f2_evidence;
grant select on public.flag_flips            to graphics_f2_evidence;
grant select on public.deliverable_events    to graphics_f2_evidence;

-- Enable RLS where missing, PRESERVING today's read access exactly: every role
-- that currently holds a direct SELECT grant (and does not bypass RLS) gets a
-- matching permissive read policy, so the app's anon reads keep working the
-- moment RLS activates. A PUBLIC-held SELECT grant is a stop condition — the
-- verifier bans PUBLIC-targeted policies, so preserving it needs owner
-- classification, not automation.
do $$
declare
  t text; g record;
begin
  foreach t in array array['syncview_runtime_flags','mirror_outbox','flag_flips','deliverable_events']
  loop
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || t)) then
      for g in
        select acl.grantee as role_oid, r.rolname
        from pg_class c
        cross join lateral aclexplode(c.relacl) as acl(grantor, grantee, privilege_type, is_grantable)
        left join pg_roles r on r.oid = acl.grantee
        where c.oid = to_regclass('public.' || t)
          and acl.privilege_type = 'SELECT'
      loop
        if g.role_oid = 0 then
          raise exception 'public.% grants SELECT to PUBLIC — enabling RLS needs owner classification first', t;
        end if;
        if g.rolname is not null
           and g.rolname <> 'graphics_f2_evidence'
           and not (select rolbypassrls from pg_roles where oid = g.role_oid)
           and not exists (
             select 1 from pg_policy p
             where p.polrelid = to_regclass('public.' || t)
               and p.polname = 'graphics_f2_preserve_read_' || g.rolname)
        then
          execute format(
            'create policy %I on public.%I for select to %I using (true)',
            'graphics_f2_preserve_read_' || g.rolname, t, g.rolname);
        end if;
      end loop;
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- The evidence role's own all-rows read policy, targeting ONLY this role.
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

-- Self-verification. relrowsecurity is read from pg_class, NOT
-- row_security_active(): the latter reports the CURRENT role's exposure, and
-- the SQL-editor role owns these tables, so it reads false even when RLS is
-- correctly enabled — the first version of this block tripped over exactly
-- that distinction.
do $$
declare
  v_oid oid := (select oid from pg_roles where rolname = 'graphics_f2_evidence');
  v_n integer;
  v_bad text;
begin
  select count(*) into v_n from pg_auth_members where member = v_oid;
  if v_n <> 0 then raise exception 'evidence role has % role membership(s); it must have none', v_n; end if;

  select count(distinct c.oid) into v_n
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) as acl(grantor, grantee, privilege_type, is_grantable)
  where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
    and acl.grantee = v_oid and acl.privilege_type = 'SELECT';
  if v_n <> 4 then raise exception 'evidence role has direct SELECT on % public relation(s); expected exactly 4', v_n; end if;

  select string_agg(distinct c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) as acl(grantor, grantee, privilege_type, is_grantable)
  where c.relkind in ('r','p','v','m','f')
    and n.nspname not in ('pg_catalog','information_schema')
    and acl.grantee = v_oid
    and acl.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN');
  if v_bad is not null then raise exception 'evidence role holds write privileges on: %', v_bad; end if;

  for v_bad in
    select t from (values ('syncview_runtime_flags'),('mirror_outbox'),('flag_flips'),('deliverable_events')) as req(t)
  loop
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || v_bad)) then
      raise exception 'RLS still not enabled on public.%', v_bad;
    end if;
    if exists (
      select 1 from pg_policy p
      where p.polrelid = to_regclass('public.' || v_bad)
        and p.polcmd in ('r','*') and p.polroles @> array[0::oid]
    ) then
      raise exception 'public.% carries a read policy targeting PUBLIC — owner classification needed, do not delete anything', v_bad;
    end if;
  end loop;
end $$;

commit;

-- Readback receipt (screenshot this): the role, plus per-table policy inventory
select r.rolname, r.rolcanlogin, r.rolsuper, r.rolbypassrls,
       (select count(*) from pg_auth_members m where m.member = r.oid) as memberships
from pg_roles r where r.rolname = 'graphics_f2_evidence';
select c.relname, c.relrowsecurity,
       (select count(*) from pg_policy p where p.polrelid = c.oid) as policies
from pg_class c
where c.oid in ('public.syncview_runtime_flags'::regclass, 'public.mirror_outbox'::regclass,
                'public.flag_flips'::regclass, 'public.deliverable_events'::regclass);
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
