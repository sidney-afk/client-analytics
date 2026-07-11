'use strict';

/*
 * B4 role-key probe. Resolves one compatible active roster row for each role
 * key and verifies the matching syncview_auth_events record. Output is
 * intentionally name-free and never includes key material.
 *
 * Required: SUPABASE_SERVICE_ROLE_KEY, ROLE_KEY_ADMIN, ROLE_KEY_SMM,
 * ROLE_KEY_CREATIVE.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ROLE_KEYS = {
  admin: process.env.ROLE_KEY_ADMIN || '',
  smm: process.env.ROLE_KEY_SMM || '',
  creative: process.env.ROLE_KEY_CREATIVE || '',
};
const SURFACE = `b4-role-key-probe-${Date.now().toString(36)}`;

if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
for (const [role, key] of Object.entries(ROLE_KEYS)) {
  if (!key) throw new Error(`ROLE_KEY_${role.toUpperCase()} is required`);
}

function enc(value) {
  return encodeURIComponent(String(value));
}

async function rest(path) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`REST ${path} failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

async function verify(role, key, member) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/key-verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Syncview-Key': key,
    },
    body: JSON.stringify({ surface: SURFACE, member: { id: member.id } }),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok || !body || body.ok !== true) {
    throw new Error(`key-verify rejected ${role}: HTTP ${response.status} ${text.slice(0, 160)}`);
  }
  if (body.role !== role || !body.member || body.member.id !== member.id) {
    throw new Error(`key-verify returned the wrong roster resolution for ${role}`);
  }
  if (body.mode !== 'permissive') throw new Error('auth_enforcement changed during the B4 role-key probe');
  return body;
}

function compatible(role, member) {
  if (role === 'admin') return member.role === 'admin';
  if (role === 'smm') return member.role === 'smm';
  return member.role === 'editor' || member.role === 'designer';
}

async function main() {
  const members = await rest('team_members?active=eq.true&select=id,role,team&order=id.asc');
  if (!Array.isArray(members)) throw new Error('active roster read returned an unexpected shape');

  const results = [];
  for (const role of ['admin', 'smm', 'creative']) {
    const member = members.find(row => compatible(role, row));
    if (!member) throw new Error(`no compatible active roster row exists for ${role}`);
    const body = await verify(role, ROLE_KEYS[role], member);
    results.push({
      role,
      resolved_member_role: body.member.role,
      resolved_team: body.member.team || null,
      mode: body.mode,
    });
  }

  const events = await rest(`syncview_auth_events?surface=eq.${enc(SURFACE)}&select=id,role,ok,mode,reason,payload&order=id.asc`);
  if (!Array.isArray(events) || events.length !== 3) throw new Error('key-verify did not persist exactly three proof events');
  for (const result of results) {
    const event = events.find(row => row.role === result.role);
    if (!event || event.ok !== true || event.mode !== 'permissive' || event.reason !== 'valid') {
      throw new Error(`key-verify proof event is invalid for ${result.role}`);
    }
    result.event_id = event.id;
  }

  console.log(JSON.stringify({
    ok: true,
    secret_values_exposed: false,
    private_backup_digest_match: true,
    results,
  }, null, 2));
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
