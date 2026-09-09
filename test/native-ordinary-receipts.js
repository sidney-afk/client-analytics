/* Source contract guard.  PostgreSQL transaction/race proof is intentionally
   separate: this host has no disposable PostgreSQL server. */
const fs = require('fs');
const assert = require('assert');
const sql = fs.readFileSync('migrations/2026-09-09-native-ordinary-receipts.sql','utf8');
const need = text => assert(sql.includes(text), 'missing '+text);
need('production_native_ordinary_receipt_admissions');
need('enable row level security');
need('revoke all on table public.production_native_ordinary_receipt_admissions from public, anon, authenticated, service_role');
need("'production_native_ordinary_receipts'");
need("'native_ordinary',true");
need('zzz_native_ordinary_receipt_guard');
need("new.status:='skipped'");
need('production_native_ordinary_event(v_event');
need('v_cap:=public.production_native_ordinary_capability');
need("if v_cap->>'mode'='provider' then return v_event; end if;");
need("'native_operation',v_action");
need("v_action in ('edit', 'delete') or (v_outbound->'payload' ? '_native_ordinary_receipt')");
for (const op of ['status','due','title','priority','archive','restore','parent','description','attachment']) need(`'${op}'`);
for (const op of ['comment','edit','delete','resolve','unresolve']) need(`'${op}'`);
assert(!sql.includes('drop trigger if exists track_b_f27_hold_guard'), 'must retain F27');
assert(!sql.includes('update public.mirror_outbox\nset status'), 'must not convert prior provider rows');
const repair = fs.readFileSync('migrations/2026-09-11-native-ordinary-receipt-repair.sql','utf8');
assert(repair.includes('deferrable initially deferred'), 'receipt FK must survive BEFORE INSERT attachment');
assert(repair.indexOf("if v_cap->>'mode'='provider' then return v_event; end if;") < repair.indexOf('native_ordinary_receipt_scope_forbidden'), 'provider TEST/parity must return before native scope checks');
console.log('native ordinary receipt source contract passed');
