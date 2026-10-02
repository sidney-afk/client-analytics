'use strict';

// Read-only TEST-client projection equality. Never prints rows or identities.
const assert = require('node:assert/strict');
const { TEST_CLIENT } = require('../test-client-entry');
const BASE = 'https://uzltbbrjidmjwwfakwve.supabase.co';
async function rows(table, query) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(key, 'private service credential required');
  const response = await fetch(`${BASE}/rest/v1/${table}?${query}`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
  assert.equal(response.status, 200, table + ': scoped read succeeds');
  const data = await response.json();
  assert(Array.isArray(data) && data.length < 1000, table + ': bounded read complete');
  return data;
}
async function run() {
  const scope = `client_slug=eq.${encodeURIComponent(TEST_CLIENT.slug)}&select=id,status&order=id&limit=1000`;
  const canonical = await rows('deliverables', scope);
  const projected = await rows('production_deliverables_browser_v1', scope);
  assert(canonical.length > 0, 'TEST fixture is nonempty');
  const byId = new Map(canonical.map(row => [row.id, row.status]));
  assert(projected.length > 0, 'browser projection is nonempty');
  assert.equal(projected.length, canonical.length, 'TEST projection contains every scoped canonical row');
  for (const row of projected) assert.equal(row.status, byId.get(row.id), 'projected TEST status agrees with its canonical row');
  const flags = await rows('syncview_runtime_flags', 'key=in.(prod_authority,linear_outbound_enabled,linear_inbound_enabled)&select=key,value&limit=1000');
  const authority = flags.find(row => row.key === 'prod_authority')?.value;
  assert(authority?.video === 'syncview' && authority?.graphics === 'syncview', 'both teams remain native');
  assert(flags.find(row => row.key === 'linear_outbound_enabled')?.value?.mode === 'off', 'outbound remains off');
  const inbound = flags.find(row => row.key === 'linear_inbound_enabled')?.value;
  console.log('Inbound switch observation: ' + JSON.stringify({ present: !!inbound, enabled: inbound?.enabled, mode: inbound?.mode }));
  if (inbound?.enabled !== false && inbound?.mode !== 'off') {
    assert(process.env.SUPABASE_ACCESS_TOKEN, 'Management credential required to prove removed inbound endpoint');
    const response = await fetch('https://api.supabase.com/v1/projects/uzltbbrjidmjwwfakwve/functions', { headers: { authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } });
    assert.equal(response.status, 200, 'function catalog read');
    const functions = await response.json();
    assert(!functions.some(row => row.slug === 'linear-inbound' && row.status === 'ACTIVE'), 'retired inbound endpoint is absent');
  }
  console.log(`Native TEST read: ${projected.length} projected rows agree with canonical statuses; native authority and both retired sync switches verified; zero mutations.`);
  console.log('Scope: read correctness only; browser role auth, writes and populated intake remain separate proofs.');
}
if (require.main === module) run().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : 'Native TEST read failed; protected response omitted.'); process.exitCode = 1; });
module.exports = { run };
