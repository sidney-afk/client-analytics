'use strict';

/*
 * READ-ONLY retirement health check.
 *
 * Before release activation the SQL contract reports mode=active; that is the
 * intended dormant state and is healthy. After activation, the check requires
 * the database's high-water census to show no ordinary post-cutoff rows and no
 * non-terminal work. The database trigger is the boundary; this script only
 * reports whether that boundary continues to hold.
 *
 * No client slug, receipt key, payload, or provider identity is logged.
 */

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');

const VERDICTS = Object.freeze({ DORMANT: 'dormant', RETIRED: 'retired', VIOLATION: 'violation', UNREADABLE: 'unreadable' });

function finiteNonNegative(value) {
  return Number.isInteger(value) && value >= 0;
}

function assessRetirement(census) {
  const data = census && typeof census === 'object' ? census : null;
  if (!data || data.contract !== 'syncview-retirement-admission-v1') {
    return { verdict: VERDICTS.UNREADABLE, ok: false, detail: 'retirement census contract is missing or malformed' };
  }
  if (data.mode === 'active') {
    return { verdict: VERDICTS.DORMANT, ok: true, detail: null };
  }
  if (data.mode !== 'retired' || !finiteNonNegative(data.high_water_outbox_id)
      || !finiteNonNegative(data.ordinary_post_cutoff_total) || !finiteNonNegative(data.nonterminal_total)
      || !finiteNonNegative(data.native_post_cutoff_total) || !finiteNonNegative(data.f27_post_cutoff_total)
      || !data.ordinary_post_cutoff || typeof data.ordinary_post_cutoff !== 'object'
      || Array.isArray(data.ordinary_post_cutoff)) {
    return { verdict: VERDICTS.UNREADABLE, ok: false, detail: 'retired census is incomplete or malformed' };
  }
  const ordinarySum = Object.values(data.ordinary_post_cutoff)
    .reduce((total, count) => total + (finiteNonNegative(count) ? count : NaN), 0);
  if (!Number.isFinite(ordinarySum) || ordinarySum !== data.ordinary_post_cutoff_total) {
    return { verdict: VERDICTS.UNREADABLE, ok: false, detail: 'ordinary post-cutoff totals do not reconcile' };
  }
  if (data.ordinary_post_cutoff_total !== 0 || data.nonterminal_total !== 0) {
    return { verdict: VERDICTS.VIOLATION, ok: false, detail: 'ordinary post-cutoff rows or non-terminal outbox work exist' };
  }
  return { verdict: VERDICTS.RETIRED, ok: true, detail: null };
}

async function readCensus() {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const response = await fetch(`${SUPA_URL}/rest/v1/rpc/production_syncview_retirement_census`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new Error(`retirement census HTTP ${response.status}`);
  return response.json();
}

async function main() {
  let assessment;
  try {
    assessment = assessRetirement(await readCensus());
  } catch (_) {
    assessment = { verdict: VERDICTS.UNREADABLE, ok: false, detail: 'retirement census read failed' };
  }
  console.log(JSON.stringify(assessment));
  if (!assessment.ok) throw new Error(`syncview retirement ${assessment.verdict}: ${assessment.detail}`);
}

if (require.main === module) {
  main().catch(error => { console.error(error.message || String(error)); process.exit(1); });
}

module.exports = { VERDICTS, assessRetirement };
