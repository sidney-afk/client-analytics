'use strict';
// crm-gmail: read only, server key only, headers only, never logs an address.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/crm-gmail/index.ts'), 'utf8');
let passed = 0;
function ok(c, m) { if (!c) { console.error('FAIL ' + m); process.exit(1); } passed++; console.log('  ok  ' + m); }
ok(/const SCOPE = "https:\/\/www\.googleapis\.com\/auth\/gmail\.metadata";/.test(src) && /const SCOPE_READ = "https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly";/.test(src) && (src.match(/googleapis\.com\/auth\//g) || []).length === 2, 'scopes are gmail.metadata and, for contact_digest only, gmail.readonly; nothing that can send or change mail');
ok((src.match(/SCOPE_READ/g) || []).length === 2 && /contactDigest\(await token\(creds, mailbox, SCOPE_READ\), body\)/.test(src), 'gmail.readonly is used by contact_digest only');
ok(!/\/send\b|messages\/send|drafts|\/modify|\/trash|method: "(PUT|DELETE|PATCH)"/.test(src), 'no send, draft, modify or delete call');
ok(/format=metadata&metadataHeaders=To&metadataHeaders=Cc/.test(src) && !/format=full|format=raw/.test(src), 'reads To and Cc headers only, never a body');
ok(/if \(!\(await serverKeyOk\(req\)\)\) return json\(\{ ok: false, error: "unauthorized" \}, 401\);/.test(src) && src.indexOf('serverKeyOk(req)') < src.indexOf('readCreds()\n') + 1e9, 'server key checked before anything else');
ok(/const MAILBOX = "kasper@" \+ OWN_DOMAIN;/.test(src) && /token\(creds, mailbox\)/.test(src) && /const mailbox = MAILBOX;/.test(src) && !/body\.mailbox|CRM_GMAIL_MAILBOX|sub: body/.test(src), 'acts only as the one fixed mailbox, never one from a request or secret');
ok(!/console\.(log|error|warn)\([^)]*(email|recipients|people|\.name)/.test(src), 'never logs an address or name');
ok(/endsWith\("@" \+ OWN_DOMAIN\)/.test(src), 'skips our own domain');
ok(/if \(!m\) \{ failed\+\+; continue; \}/.test(src) && /failed, complete: failed === 0/.test(src), 'a failed message read is counted and the result says it is incomplete');
// parseAddresses, run on its own.
const fnSrc = src.slice(src.indexOf('export function parseAddresses'), src.indexOf('async function sentRecipients'))
  .replace('export function', 'function').replace(/: \{ email: string; name: string \}\[\]/g, '').replace(/\(header: string\)/, '(header)');
const parseAddresses = new Function('clean', fnSrc + '; return parseAddresses;')((v) => String(v == null ? '' : v).trim());
const got = parseAddresses('"Doe, Jane" <Jane@Example.com>, b@c.io, not-an-address');
ok(got.length === 2 && got[0].email === 'jane@example.com' && got[0].name === 'Doe, Jane' && got[1].email === 'b@c.io', 'parses quoted names with commas, lowercases, drops junk');
console.log('crm-gmail: ' + passed + ' checks passed');
