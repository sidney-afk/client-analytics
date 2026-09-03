#!/usr/bin/env node
/*
 * calendar-native-projection-dry-run.js — what would the native status
 * projection do, right now, if it ran?
 *
 * READ-ONLY. No writes, no apply path, no credentials beyond the browser
 * publishable key already in index.html. Safe to run any time, by anyone.
 *
 * WHY IT EXISTS. The change it measures alters a job that writes client-facing
 * cards, and its safety cap is 15: if the first run wanted to move more than
 * that it would abort and write nothing, which is a wasted cycle and a scare.
 * "How many cards move on day one?" should therefore be answerable BEFORE the
 * change ships and re-answerable afterwards, by the owner, without reading any
 * code. On 2026-09-03 the answer was ZERO -- 1,126 linked components already
 * agreed with their deliverable -- which is what made the change safe to land:
 * it is a no-op on today's data and only starts mattering when Linear stops
 * delivering.
 *
 * It runs the REAL decision function extracted from the reconciler and the REAL
 * status mappers extracted from index.html, so it cannot drift from the job it
 * describes by being a second copy of the rules.
 *
 * OUTPUT IS PUBLIC-SAFE (F64): counts and status transitions only, never a
 * client slug, card id or issue title.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('../test/helpers/extract-function.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const RECON = fs.readFileSync(path.join(ROOT, 'scripts', 'linear-sync-reconcile.js'), 'utf8');
const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1';
const KEY = (SRC.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/) || [])[1];

function grabFunc(name) {
  const at = SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  }
  throw new Error('unbalanced braces: ' + name);
}
const grabConst = name => (SRC.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm')) || [''])[0];

/* Rebuild the sandbox from the reconciler's OWN grab list, so this tool uses
 * exactly the mappers the job uses rather than a hand-copied second opinion. */
function loadRules() {
  const ctx = { module: { exports: {} }, console };
  vm.createContext(ctx);
  let src = '';
  for (const m of RECON.matchAll(/grabConst\('([^']+)'\)/g)) { try { src += grabConst(m[1]) + '\n'; } catch (_) {} }
  for (const m of RECON.matchAll(/grabFunc\('([^']+)'\)/g)) { try { src += grabFunc(m[1]) + '\n'; } catch (_) {} }
  src += extractFunction(RECON, 'nativeProjectionDecision') + '\n';
  src += 'module.exports = { _calMapNativeStatusStrict, _calNormStatus, nativeProjectionDecision };';
  vm.runInContext(src, ctx);
  return ctx.module.exports;
}

async function get(url) {
  const res = await fetch(url, { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, Accept: 'application/json' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url.split('?')[0]);
  return res.json();
}

async function main() {
  if (!KEY) throw new Error('publishable key not found in index.html');
  const rules = loadRules();
  const cards = await get(`${SUPA}/calendar_posts?select=id,status,video_status,graphic_status,`
    + `video_status_at,graphic_status_at,video_deliverable_id,graphic_deliverable_id`
    + `&or=(status.is.null,status.neq.Archived)&limit=5000`);
  const ids = [...new Set(cards.flatMap(c => ['video_deliverable_id', 'graphic_deliverable_id']
    .map(k => String(c[k] || '').trim()).filter(Boolean)))];
  const rows = new Map();
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80).map(encodeURIComponent).join(',');
    for (const r of await get(`${SUPA}/deliverables?select=id,status,status_at,origin,team&id=in.(${chunk})`)) {
      rows.set(String(r.id), r);
    }
  }

  const tally = { 'in-sync': 0, project: 0, 'card-ahead': 0, 'na-parked': 0, 'no-canonical': 0, unmappable: 0 };
  const transitions = new Map();
  for (const card of cards) {
    for (const comp of ['video', 'graphic']) {
      const id = String(card[comp === 'video' ? 'video_deliverable_id' : 'graphic_deliverable_id'] || '').trim();
      const row = id ? rows.get(id) : null;
      if (!row) { tally['no-canonical']++; continue; }
      const canonical = rules._calMapNativeStatusStrict(row.status, row.origin);
      if (!canonical) { tally.unmappable++; continue; }
      const cardCal = rules._calNormStatus(card[comp + '_status'] || '');
      const iso = v => (v && isFinite(Date.parse(v))) ? new Date(v).toISOString() : null;
      const d = rules.nativeProjectionDecision(cardCal, canonical, iso(card[comp + '_status_at']), iso(row.status_at));
      tally[d.kind]++;
      if (d.kind === 'project') {
        const k = `${cardCal} → ${d.target}`;
        transitions.set(k, (transitions.get(k) || 0) + 1);
      }
    }
  }

  console.log(`\nNative status projection — dry run over ${cards.length} live cards × 2 components\n`);
  for (const k of Object.keys(tally)) console.log('  ' + k.padEnd(14) + String(tally[k]).padStart(6));
  console.log(`\n  WOULD WRITE ${tally.project} card statuses   (the job's safety cap is 15;`);
  console.log(`  above it the run aborts and writes nothing)`);
  if (transitions.size) {
    console.log('\n  transitions it would make:');
    for (const [k, v] of [...transitions].sort((a, b) => b[1] - a[1])) {
      console.log('    ' + String(v).padStart(4) + '  ' + k);
    }
  }
  console.log('\n  no-canonical = components with no native deliverable row; these still');
  console.log('  use the Linear path and are what remains before Linear can go dark.\n');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
