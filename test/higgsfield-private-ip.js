'use strict';
// The connector refuses links that point at private or local addresses
// (supabase/functions/higgsfield-mcp/netcheck.mjs, used by publicHost before
// import_file and voice_cleanup fetch anything). Every host here goes through
// the same URL parser the function uses, so the forms an attacker would type
// ("[::ffff:127.0.0.1]" becomes "[::ffff:7f00:1]") are the ones checked.
const assert = require('node:assert/strict');
const path = require('node:path');

(async () => {
  const { privateIp } = await import(path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp', 'netcheck.mjs'));
  const host = (link) => new URL(link).hostname.replace(/^\[|\]$/g, '');
  let n = 0;
  const priv = (link) => { assert.equal(privateIp(host(link)), true, link + ' must count as private (' + host(link) + ')'); n++; };
  const pub = (link) => { assert.equal(privateIp(host(link)), false, link + ' must count as public (' + host(link) + ')'); n++; };

  // IPv4, in every spelling the URL parser accepts.
  ['https://127.0.0.1/', 'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://0177.0.0.1/',
   'https://10.1.2.3/', 'https://172.16.0.1/', 'https://192.168.1.1/', 'https://169.254.169.254/', 'https://100.64.0.1/',
   'https://0.0.0.0/', 'https://224.0.0.1/', 'https://192.0.2.1/', 'https://198.18.0.1/'].forEach(priv);
  ['https://8.8.8.8/', 'https://1.1.1.1/', 'https://172.32.0.1/', 'https://100.128.0.1/'].forEach(pub);

  // IPv6, including every way to hide an IPv4 address (the gap found in review, 2026-10-17).
  ['https://[::1]/', 'https://[::]/', 'https://[fe80::1]/', 'https://[fc00::1]/', 'https://[fd12:3456::1]/', 'https://[ff02::1]/',
   'https://[::ffff:127.0.0.1]/', 'https://[::ffff:169.254.169.254]/', 'https://[::ffff:10.0.0.1]/', 'https://[0:0:0:0:0:ffff:7f00:1]/',
   'https://[::7f00:1]/', 'https://[::127.0.0.1]/', 'https://[64:ff9b::7f00:1]/', 'https://[64:ff9b::a9fe:a9fe]/',
   'https://[2002:7f00:1::]/', 'https://[2002:a9fe:a9fe::1]/', 'https://[2001:db8::1]/', 'https://[100::1]/'].forEach(priv);
  ['https://[2606:4700:4700::1111]/', 'https://[2001:4860:4860::8888]/', 'https://[::ffff:8.8.8.8]/', 'https://[64:ff9b::808:808]/',
   'https://[2002:808:808::1]/'].forEach(pub);

  // DNS answers come back as plain strings in these forms too.
  ['::ffff:7f00:1', '::FFFF:A9FE:A9FE', 'fe80::1%eth0'].forEach((ip) => { assert.equal(privateIp(ip), true, ip); n++; });
  // Anything that does not parse is refused (fail closed).
  ['', 'not-an-ip', '1.2.3.999', '1::2::3', '12345::1', ':::'].forEach((ip) => { assert.equal(privateIp(ip), true, JSON.stringify(ip)); n++; });

  console.log('higgsfield-private-ip: ' + n + ' checks passed');
})().catch((e) => { console.error('higgsfield-private-ip: FAIL ' + e.message); process.exit(1); });
