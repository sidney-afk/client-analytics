#!/usr/bin/env node
// Filming pipeline, item 1 PR 2: the toolkit downloads (toolkit_latest, with
// studio_latest unchanged), the pass's own calls in pipeline-google (files,
// batch numbers, notes, brain snapshot) and the connector's client_record,
// feedback_note and feedback_notes. Offline: every database, Storage and
// GitHub call is a mock, and the wiring is read as source. Every name, id and
// slug below is invented.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fnDir = path.join(root, 'supabase', 'functions');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed++; };
const eq = (a, b, label) => { assert.deepStrictEqual(a, b, label); passed++; };

const OWNER = 'Owner Example';
const OTHER = 'Member Example';
const COMMIT = 'a'.repeat(40);
const NEWER = 'b'.repeat(40);
const NOTE_ID = '11111111-2222-4333-8444-555555555555';

// An in-memory file store, batch counter and notes table that behave like the
// SQL functions in 20261016230000_filming_pipeline_passes.sql.
function world(opts = {}) {
  const files = new Map(); // "client|name" -> { name, version, body, updated_by, updated_at }
  const counter = new Map();
  const notes = [];
  const publishers = new Set(opts.publishers || [OWNER]);
  const settings = new Map(Object.entries(opts.settings || { file_admins: [OWNER] }));
  const snapshots = new Map(Object.entries(opts.snapshots || {}));
  const calls = { fetched: [], stored: [], signed: [], heads: 0 };
  const deps = {
    getFiles: async (client, name) => [...files.entries()]
      .filter(([k, f]) => k.startsWith(client + '|') && (!name || f.name === name)).map(([, f]) => f)
      .sort((a, b) => a.name.localeCompare(b.name)),
    saveFile: async (client, name, v, body, member) => {
      const key = client + '|' + name;
      const cur = files.get(key);
      const curV = cur ? cur.version : 0;
      if (v !== curV) return { saved: false, new_version: null, current_version: curV };
      files.set(key, { name, version: curV + 1, body, updated_by: member, updated_at: '2026-01-01T00:00:00Z' });
      return { saved: true, new_version: curV + 1, current_version: curV + 1 };
    },
    isPublisher: async (m) => publishers.has(m),
    setting: async (k) => (settings.has(k) ? settings.get(k) : null),
    takeBatch: async (client) => { const n = counter.get(client) || 1; counter.set(client, n + 1); return n; },
    noteExists: async (id) => notes.some((n) => n.id === id),
    addNote: async (row) => {
      const id = notes.length ? crypto.randomUUID() : NOTE_ID;
      const saved = { id, created_at: `2026-01-0${notes.length + 1}T00:00:00Z`, ...row };
      notes.push(saved);
      return { id, created_at: saved.created_at };
    },
    brainHead: async () => { calls.heads++; if (opts.headFails) throw new Error('GitHub down'); return opts.head || COMMIT; },
    snapshotSize: async (c) => (snapshots.has(c) ? snapshots.get(c) : null),
    snapshotFetch: async (c) => { calls.fetched.push(c); return TINY_ZIP; },
    snapshotStore: async (c, bytes) => { calls.stored.push([c, bytes.byteLength]); snapshots.set(c, bytes.byteLength); },
    snapshotSign: async (c, s) => { calls.signed.push([c, s]); return `https://example.invalid/storage/v1/object/sign/brain-snapshots/${c}.zip?token=t`; },
  };
  return { files, counter, notes, deps, calls, settings };
}


// A small zip writer and reader for the snapshot tests: deflated and stored
// entries, some with a data descriptor after the data (as streamed zips have).
const zlib = require('zlib');
function makeZip(files, comment = '') {
  const parts = [], central = [];
  let off = 0;
  files.forEach(([name, text, how], i) => {
    const data = Buffer.from(text);
    const deflate = how !== 'stored';
    const packed = deflate ? zlib.deflateRawSync(data) : data;
    const crc = zlib.crc32(data);
    const descriptor = i % 2 === 1;
    const n = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(descriptor ? 8 : 0, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(descriptor ? 0 : crc, 14); local.writeUInt32LE(descriptor ? 0 : packed.length, 18); local.writeUInt32LE(descriptor ? 0 : data.length, 22);
    local.writeUInt16LE(n.length, 26);
    const desc = Buffer.alloc(descriptor ? 16 : 0);
    if (descriptor) { desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc, 4); desc.writeUInt32LE(packed.length, 8); desc.writeUInt32LE(data.length, 12); }
    parts.push(local, n, packed, desc);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(descriptor ? 8 : 0, 8); c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + packed.length + desc.length;
  });
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  const cm = Buffer.from(comment);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16); end.writeUInt16LE(cm.length, 20);
  return new Uint8Array(Buffer.concat([...parts, cd, end, cm]));
}
function readZip(u8) {
  const b = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  const count = b.readUInt16LE(e + 10), cdOff = b.readUInt32LE(e + 16);
  const comment = b.subarray(e + 22, e + 22 + b.readUInt16LE(e + 20)).toString();
  const out = {};
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    assert.strictEqual(b.readUInt32LE(p), 0x02014b50);
    const method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), size = b.readUInt32LE(p + 20);
    const nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), lo = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nl).toString();
    assert.strictEqual(b.readUInt32LE(lo), 0x04034b50, 'local header where the central directory says');
    const start = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28);
    const packed = b.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(packed) : packed;
    assert.strictEqual(zlib.crc32(data), crc, 'crc of ' + name);
    out[name] = data.toString();
    p += 46 + nl + xl + cl;
  }
  return { files: out, comment };
}

const TINY_ZIP = makeZip([['brain/README.md', '# Brain']]);
const personal = (member) => ({ member, via: 'personal', client_slug: 'clienta', target: 'client' });
const team = { member: OWNER, via: 'team', client_slug: 'clienta', target: 'test' };

(async () => {
  const store = await import(path.join(fnDir, 'pipeline-google', 'store.mjs'));
  const studio = await import(path.join(fnDir, 'higgsfield-mcp', 'studio.mjs'));
  const rec = await import(path.join(fnDir, 'higgsfield-mcp', 'filmingrecord.mjs'));
  const who = await import(path.join(fnDir, 'higgsfield-mcp', 'who.mjs'));
  const run = (w, action, body, pass = personal(OTHER)) => store.storeAction(action, body, pass, w.deps);

  // ---- Who may save which file ---------------------------------------------------
  const open = ['ideas.json', 'references.json', 'own_performance.json', 'filming_plans/2026-01.md'];
  const admin = ['config.json', 'plan_voice.json', 'brief.md', 'backlog.json', 'plan_doc.json', 'style_card.json'];
  for (const n of open) eq(store.fileKind(n), 'open', `${n} is open to any pass`);
  for (const n of admin) eq(store.fileKind(n), 'admin', `${n} is for the owner only`);
  for (const n of ['secrets.json', 'filming_plans/../config.json', 'filming_plans/a/b.md', 'filming_plans/x.txt', '../ideas.json', '']) {
    eq(store.fileKind(n), null, `"${n}" is not a pipeline file`);
  }
  const adminRule = (pass, isPublisher, admins) => store.maySave('config.json', pass, { isPublisher, admins });
  ok(adminRule(personal(OWNER), true, [OWNER]).ok, 'publisher + file admin + personal link may save an admin file');
  ok(!adminRule(personal(OWNER), false, [OWNER]).ok, 'a file admin not on the publish list may not');
  ok(!adminRule(personal(OTHER), true, [OWNER]).ok, 'a publisher who is not a file admin may not');
  ok(!adminRule({ ...personal(OWNER), via: 'team' }, true, [OWNER]).ok, 'a team-link pass may never save an admin file, whatever its name');
  ok(!adminRule(personal(OWNER), true, null).ok && !adminRule(personal(OWNER), true, 'not json').ok, 'no file_admins setting means nobody');
  ok(adminRule(personal(OWNER), true, JSON.stringify([OWNER])).ok && adminRule(personal(OWNER), true, { members: [OWNER] }).ok, 'file_admins may be a JSON list, as text or as { members }');
  eq(store.parseAdmins([' ' + OWNER + ' ', 3, '']), [OWNER], 'file_admins keeps only names');
  ok(/Refused: only the account owner saves config\.json/.test(adminRule(personal(OTHER), true, [OWNER]).error), 'the refusal says who may');
  for (const n of open) ok(store.maySave(n, team, { isPublisher: false, admins: null }).ok, `${n}: even a team-link pass may save it`);

  // Through the action, end to end.
  let w = world();
  let r = await run(w, 'files.save', { name: 'config.json', expected_version: 0, body: '{}' }, personal(OTHER));
  eq([r.status, r.body.ok], [403, false], 'a non-admin save of config.json is refused 403');
  ok(!w.files.size, 'and nothing was written');
  r = await run(w, 'files.save', { name: 'config.json', expected_version: 0, body: '{"sheet":"x"}' }, personal(OWNER));
  eq(r, { status: 200, body: { ok: true, saved: true, name: 'config.json', version: 1 } }, 'the owner saves config.json as version 1');
  eq(w.files.get('clienta|config.json').updated_by, OWNER, 'filed under the pass member');
  w.settings.delete('file_admins');
  r = await run(w, 'files.save', { name: 'config.json', expected_version: 1, body: '{}' }, personal(OWNER));
  eq(r.status, 403, 'file_admins is read on every call: removing the owner from it stops the next save');
  r = await run(w, 'files.save', { name: 'ideas.json', expected_version: 0, body: '[]' }, team);
  eq([r.status, r.body.saved, r.body.version], [200, true, 1], 'a team-link pass saves ideas.json');
  r = await run(w, 'files.save', { name: 'filming_plans/2026-01.md', expected_version: 0, body: '# Plan' }, personal(OTHER));
  eq(r.body.saved, true, 'any pass saves a filming plan markdown file');
  r = await run(w, 'files.save', { name: 'secrets.json', expected_version: 0, body: '{}' }, personal(OWNER));
  eq(r.status, 400, 'an unknown file name is refused 400');

  // ---- Stale versions --------------------------------------------------------------
  r = await run(w, 'files.save', { name: 'ideas.json', expected_version: 0, body: '[1]' });
  eq(r, { status: 200, body: { ok: true, saved: false, name: 'ideas.json', version: 1, message: r.body.message } }, 'a stale version answers saved:false with the current version');
  ok(/is at version 1, not 0/.test(r.body.message) && /files\.get/.test(r.body.message), 'and says to re-read');
  eq(w.files.get('clienta|ideas.json').body, '[]', 'the stale save changed nothing');
  r = await run(w, 'files.save', { name: 'ideas.json', expected_version: 1, body: '[1]' });
  eq([r.body.saved, r.body.version], [true, 2], 'the current version saves and bumps');
  r = await run(w, 'files.save', { name: 'references.json', expected_version: 3, body: '[]' });
  eq([r.body.saved, r.body.version], [false, 0], 'a version for a file that does not exist yet answers version 0');
  for (const v of [-1, 1.5, '1', null, undefined]) {
    r = await run(w, 'files.save', { name: 'ideas.json', expected_version: v, body: '[]' });
    eq(r.status, 400, `expected_version ${JSON.stringify(v)} is refused`);
  }
  r = await run(w, 'files.save', { name: 'ideas.json', expected_version: 2, body: '{oops' });
  ok(r.status === 400 && /valid JSON/.test(r.body.error), 'a .json file must hold valid JSON');
  r = await run(w, 'files.save', { name: 'ideas.json', expected_version: 2, body: { a: 1 } });
  ok(r.status === 400 && /string/.test(r.body.error), 'the body must be text');
  r = await run(w, 'files.save', { name: 'filming_plans/2026-01.md', expected_version: 1, body: 'x'.repeat(store.BODY_MAX + 1) });
  eq(r.status, 400, 'a body over 2,000,000 characters is refused (the table limit)');

  // ---- files.get -------------------------------------------------------------------
  r = await run(w, 'files.get', {});
  eq(r.body.files.map((f) => [f.name, f.version]), [['config.json', 1], ['filming_plans/2026-01.md', 1], ['ideas.json', 2]], 'all of the client\'s files with name and version');
  ok(r.body.files.every((f) => typeof f.body === 'string'), 'with their bodies');
  r = await run(w, 'files.get', { name: 'ideas.json' });
  eq([r.status, r.body.file.name, r.body.file.version, r.body.file.body], [200, 'ideas.json', 2, '[1]'], 'one file by name');
  r = await run(w, 'files.get', { name: 'plan_doc.json' });
  eq([r.status, r.body.ok, r.body.version], [404, false, 0], 'a file not saved yet is 404 with version 0');
  r = await run(w, 'files.get', { name: '../x' });
  eq(r.status, 400, 'a bad name is refused');
  r = await store.storeAction('files.get', {}, { ...personal(OTHER), client_slug: 'clientb' }, w.deps);
  eq(r.body.files, [], 'a pass sees only its own client\'s files');

  // ---- Batch numbers ---------------------------------------------------------------
  w = world();
  eq((await run(w, 'batch.take', {})).body, { ok: true, batch: 1 }, 'the first batch is 1');
  eq((await run(w, 'batch.take', {})).body.batch, 2, 'then 2');
  eq((await store.storeAction('batch.take', {}, { ...personal(OTHER), client_slug: 'clientb' }, w.deps)).body.batch, 1, 'each client counts on its own');
  eq((await run(w, 'batch.take', {})).body.batch, 3, 'and the first client goes on at 3');
  const sql = read(root, 'supabase', 'migrations', '20261016230000_filming_pipeline_passes.sql');
  ok(/on conflict \(client_slug\) do update set next = c\.next \+ 1\s*returning c\.next - 1 into taken/.test(sql), 'fp_take_batch hands out each number once, in one statement');

  // ---- Notes -----------------------------------------------------------------------
  w = world();
  r = await run(w, 'notes.add', { title: ' Hooks ', body: 'Shorter hooks', source: 'sheet' }, personal(OTHER));
  eq(r, { status: 200, body: { ok: true, id: NOTE_ID, created_at: '2026-01-01T00:00:00Z' } }, 'a note is saved and its id returned');
  eq(w.notes[0], { id: NOTE_ID, created_at: '2026-01-01T00:00:00Z', client_slug: 'clienta', title: 'Hooks', body: 'Shorter hooks', source: 'sheet', follows: null, member: OTHER }, 'with the pass member and client');
  r = await run(w, 'notes.add', { title: 'Again', body: 'Still', source: 'chat', follows: NOTE_ID.toUpperCase() });
  eq([r.status, w.notes[1].follows], [200, NOTE_ID], 'a note may follow an earlier one');
  for (const [bad, re] of [
    [{ body: 'b', source: 'chat' }, /title/],
    [{ title: 't', source: 'chat' }, /body/],
    [{ title: 't', body: 'b', source: 'email' }, /source/],
    [{ title: 'x'.repeat(201), body: 'b', source: 'chat' }, /title is too long/],
    [{ title: 't', body: 'x'.repeat(20001), source: 'chat' }, /body is too long/],
    [{ title: 't', body: 'b', source: 'chat', follows: 'nope' }, /earlier note/],
  ]) {
    r = await run(w, 'notes.add', bad);
    ok(r.status === 400 && re.test(r.body.error), 'a bad note is refused: ' + re);
  }
  r = await run(w, 'notes.add', { title: 't', body: 'b', source: 'chat', follows: '99999999-2222-4333-8444-555555555555' });
  ok(r.status === 400 && /does not exist/.test(r.body.error), 'follows must name a note that exists');
  ok(/source text not null check \(source in \('chat', 'sheet'\)\)/.test(sql) && /title text not null check \(length\(title\) between 1 and 200\)/.test(sql) && /body text not null check \(length\(body\) between 1 and 20000\)/.test(sql),
    'the note limits match the table');

  // ---- Brain snapshot --------------------------------------------------------------
  w = world();
  r = await run(w, 'brain.snapshot', { have_commit: COMMIT.toUpperCase() });
  eq(r, { status: 200, body: { ok: true, unchanged: true, commit: COMMIT } }, 'the same commit answers unchanged, no download');
  eq([w.calls.fetched, w.calls.signed], [[], []], 'nothing was fetched or signed');
  r = await run(w, 'brain.snapshot', {});
  eq([r.body.unchanged, r.body.commit, r.body.bytes, r.body.expires], [false, COMMIT, TINY_ZIP.length, 'in about 10 minutes'], 'no commit held: the zip link');
  ok(/^https:\/\//.test(r.body.download_url), 'a signed https link');
  eq([w.calls.fetched, w.calls.stored, w.calls.signed], [[COMMIT], [[COMMIT, TINY_ZIP.length]], [[COMMIT, 600]]], 'fetched once from GitHub, cached, signed for 10 minutes');
  r = await run(w, 'brain.snapshot', { have_commit: NEWER });
  eq([r.body.unchanged, w.calls.fetched.length], [false, 1], 'a cached commit is not fetched again');
  w = world({ snapshots: { [COMMIT]: 999 } });
  r = await run(w, 'brain.snapshot', {});
  eq([r.body.bytes, w.calls.fetched], [999, []], 'a commit cached earlier is served from the bucket');
  w = world({ headFails: true });
  r = await run(w, 'brain.snapshot', {});
  ok(r.status === 503 && r.body.ok === false && /^Could not do brain\.snapshot/.test(r.body.error), 'GitHub down: a plain-English failure');
  w = world({ head: 'not-a-commit' });
  eq((await run(w, 'brain.snapshot', {})).status, 502, 'an odd commit id is refused');


  // ---- The snapshot: everything except inputs/ outside inputs/drive/ ----------------
  const TOP = 'example-brain-0000000/';
  const BRAIN = [
    [TOP, '', 'stored'],
    [TOP + 'README.md', '# Brain'],
    [TOP + 'clients/client-a/brief.md', 'brief a'],
    [TOP + 'clients/client-a/money.md', 'MONEY A'],
    [TOP + 'clients/client-a/history.md', 'history a'],
    [TOP + 'clients/client-b/Money.md', 'MONEY B', 'stored'],
    [TOP + 'company/money.md', 'MONEY CO'],
    [TOP + 'inputs/', '', 'stored'],
    [TOP + 'inputs/drive/plan-a.md', 'plan a'],
    [TOP + 'inputs/drive/sub/plan-b.md', 'plan b', 'stored'],
    [TOP + 'inputs/calls/call-1.md', 'DROP transcript'],
    [TOP + 'inputs/slack/day.md', 'DROP slack'],
    [TOP + 'clients/client-a/inputs/calls/call-2.md', 'DROP nested transcript'],
    [TOP + 'clients/client-a/inputs/drive/doc.md', 'nested drive'],
    [TOP + 'notinputs/calls/x.md', 'kept, not an inputs folder'],
  ];
  const isDropped = (t) => /^DROP/.test(t);
  const src = makeZip(BRAIN, COMMIT);
  const before = readZip(src);
  eq(Object.keys(before.files).length, BRAIN.length, 'the test zip reads back whole');
  const re = store.repackZip(src);
  const after = readZip(re.zip);
  const nDrop = BRAIN.filter(([, t]) => isDropped(t)).length;
  eq([re.kept, re.dropped], [BRAIN.length - nDrop, nDrop], 'only inputs/ outside inputs/drive/ is left out');
  ok(!Object.values(after.files).some(isDropped), 'no raw transcript or chat entry survives, at the top or nested');
  for (const [name, text] of BRAIN) {
    if (isDropped(text)) continue;
    eq(after.files[name], text, 'kept byte for byte: ' + name.slice(TOP.length || 0));
  }
  ok(after.files[TOP + 'clients/client-a/money.md'] === 'MONEY A' && after.files[TOP + 'company/money.md'] === 'MONEY CO', 'money.md stays (the money guard reads it)');
  ok(after.files[TOP + 'clients/client-a/history.md'] === 'history a', 'history.md stays');
  ok(after.files[TOP + 'inputs/drive/plan-a.md'] === 'plan a' && after.files[TOP + 'clients/client-a/inputs/drive/doc.md'] === 'nested drive', 'inputs/drive/ stays, at the top and nested');
  eq(after.comment, COMMIT, 'the zip comment (GitHub puts the commit there) is kept');
  eq(readZip(store.repackZip(re.zip).zip).files, after.files, 'repacking again changes nothing');
  const plain = makeZip([['a.md', 'x'], ['b.md', 'y']]);
  eq(Array.from(store.repackZip(plain).zip), Array.from(plain), 'a zip with nothing to drop comes back identical');
  for (const [label, bytes] of [
    ['not a zip', new Uint8Array(100)],
    ['a Zip64 zip', (() => { const z = makeZip([['a.md', 'x']]); const pad = new Uint8Array(z.length + 20); const at = z.length - 22; pad.set(z.subarray(0, at)); new DataView(pad.buffer).setUint32(at, 0x07064b50, true); pad.set(z.subarray(at), at + 20); return pad; })()],
    ['a cut-off zip', src.subarray(0, src.length - 40)],
    ['a zip cut in its end record', src.subarray(0, src.length - 50)],
    ['a zip cut in its data', src.subarray(200)],
  ]) {
    let threw = '';
    try { store.repackZip(bytes); } catch (e) { threw = e.message; }
    ok(/^the brain zip could not be read/.test(threw), `${label} is refused, never handed out half-filtered`);
  }
  // Through the action: what is stored and handed out is the repacked zip.
  w = world();
  w.deps.snapshotFetch = async (c) => { w.calls.fetched.push(c); return src; };
  let storedBytes = null;
  w.deps.snapshotStore = async (c, bytes) => { storedBytes = bytes; w.calls.stored.push([c, bytes.byteLength]); };
  r = await run(w, 'brain.snapshot', {});
  ok(storedBytes && !Object.values(readZip(storedBytes).files).some(isDropped) && readZip(storedBytes).files[TOP + 'clients/client-a/money.md'] === 'MONEY A', 'the cached snapshot is the filtered one: no raw inputs, money.md kept');
  eq(r.body.bytes, storedBytes.byteLength, 'and its size is the one answered');
  w = world({ headFails: false });
  w.deps.snapshotFetch = async () => new Uint8Array(10);
  r = await run(w, 'brain.snapshot', {});
  ok(r.status === 503 && /could not be read/.test(r.body.error) && !w.calls.stored.length && !w.calls.signed.length, 'an unreadable zip is never stored or handed out');
  eq(store.snapshotName(COMMIT), COMMIT + '.inputs-drive-only-1.zip', 'the cache name says the rule, so an older (no-money-1) build is never served');
  ok(/zipName = \(commit: string\) => snapshotName\(commit\)/.test(read(fnDir, 'pipeline-google', 'index.ts')), 'pipeline-google caches under that name');

  // ---- Who may use the filming plan pipeline (fp_settings "pipeline_users") --------
  const users = await import(path.join(fnDir, 'pipeline-google', 'users.mjs'));
  const LISTED = 'Listed Example';
  const UNLISTED = 'Unlisted Example';
  const NAMED_TEXT = 'The filming plan is only for Example People. Ask Example Owner.';
  const userSettings = (init) => {
    const m = new Map(Object.entries(init));
    return { m, setting: async (k) => (m.has(k) ? m.get(k) : null) };
  };
  let us = userSettings({ pipeline_users: [LISTED] });
  eq(await users.pipelineGate(us.setting, { member: LISTED, teamLink: false }), null, 'a personal link on the list is let in');
  let gate = await users.pipelineGate(us.setting, { member: UNLISTED, teamLink: false });
  eq(gate, { text: users.REFUSAL_FALLBACK, status: 403 }, 'a personal link not on the list is refused, with the fallback text when none is set');
  gate = await users.pipelineGate(us.setting, { member: LISTED, teamLink: true });
  eq(gate && gate.status, 403, 'the shared team link is refused even when its typed name is on the list');
  us.m.set('pipeline_users_refusal', NAMED_TEXT);
  eq((await users.pipelineGate(us.setting, { member: UNLISTED, teamLink: false })).text, NAMED_TEXT, 'the refusal text comes from pipeline_users_refusal when set');
  eq(users.refusalText(JSON.stringify(NAMED_TEXT)), NAMED_TEXT, 'a JSON string setting is read as its text');
  eq(users.refusalText({ text: NAMED_TEXT }), NAMED_TEXT, 'and so is { text }');
  for (const v of [null, '', '   ', 42, [], {}]) eq(users.refusalText(v), users.REFUSAL_FALLBACK, 'an unusable refusal setting falls back: ' + JSON.stringify(v));
  for (const v of [null, 'not json', '{"x":1}', 7, [' ', 3]]) {
    ok(!users.mayUsePipeline({ member: LISTED, teamLink: false, users: v }), 'an unusable list lets nobody in: ' + JSON.stringify(v));
  }
  ok(users.mayUsePipeline({ member: LISTED, teamLink: false, users: JSON.stringify([LISTED]) }), 'a list stored as JSON text works');
  ok(users.mayUsePipeline({ member: LISTED, teamLink: false, users: { members: [LISTED] } }), 'and { members: [...] }');
  ok(!users.mayUsePipeline({ member: '', teamLink: false, users: [''] }) && !users.mayUsePipeline({ member: 'listed example', teamLink: false, users: [LISTED] }), 'an empty name or another spelling is refused');
  const broken = async () => { throw new Error('db down'); };
  eq((await users.pipelineGate(broken, { member: LISTED, teamLink: false })).status, 503, 'a list that cannot be read refuses, never lets in');
  // Removal takes effect on a pass already handed out: the list is read on every call.
  const passOf = (p) => ({ member: p.member, teamLink: p.via !== 'personal' });
  us = userSettings({ pipeline_users: [LISTED, OTHER] });
  const existing = personal(OTHER);
  eq(await users.pipelineGate(us.setting, passOf(existing)), null, 'a pass whose member is listed works');
  us.m.set('pipeline_users', [LISTED]);
  eq((await users.pipelineGate(us.setting, passOf(existing))).status, 403, 'the same pass is refused once its member is removed');
  eq((await users.pipelineGate(us.setting, passOf({ ...team, member: LISTED }))).status, 403, 'a team-link pass is refused whatever name it carries');
  eq((await users.pipelineGate(us.setting, passOf({ member: LISTED, via: 'odd' }))).status, 403, 'a pass with an unknown link kind is refused');

  // Wiring: pipeline-google checks every pass action; the connector gates only the filming plan tools.
  const pgw = read(fnDir, 'pipeline-google', 'index.ts');
  const wpw = pgw.slice(pgw.indexOf('async function withPass('), pgw.indexOf('// ---- The pipeline\'s own data'));
  const gAt = wpw.indexOf('await pipelineGate(readSetting(sb), { member: String(pass.member ?? ""), teamLink: pass.via !== "personal" })');
  ok(gAt > wpw.indexOf('if (pass.expired)') && gAt < wpw.indexOf('STORE_ACTIONS.has(action)') && gAt < wpw.indexOf('readCreds()'), 'pipeline-google re-checks the list on every pass action, store and Google alike, after the pass is found');
  ok(/if \(gate\) return refused\(gate\.text, gate\.status\);/.test(wpw), 'and refuses with the gate\'s text');
  const hm = read(fnDir, 'higgsfield-mcp', 'index.ts');
  const call = hm.slice(hm.indexOf('async function callTool('));
  const gHm = call.indexOf('const gate = await pipelineGate(fpSetting, { member, teamLink: isTeamLink(member) });');
  ok(gHm > 0 && gHm < call.indexOf('return await pipelinePass(') && gHm < call.indexOf('return await toolkitLatest('), 'the connector checks the list before pipeline_pass and toolkit_latest');
  ok(/const filmingPlanTool = name === "pipeline_pass" \|\|\n\s*\(name === "toolkit_latest" && String\(args\.name \|\| ""\)\.trim\(\)\.toLowerCase\(\) === "filming-plan"\);/.test(call), 'only pipeline_pass and toolkit_latest "filming-plan" are gated; studio and studio_latest stay open');
  ok(call.indexOf('if (name === "studio_latest")') > gHm && !/studio_latest[^\n]*pipelineGate/.test(call), 'studio_latest is not gated');
  eq(who.outcomeOf('pipeline_pass', users.REFUSAL_FALLBACK).ok, false, 'a refusal is logged as a failure');
  eq(who.outcomeOf('toolkit_latest', NAMED_TEXT).ok, false, 'the named refusal text too');

  ok((await run(world(), 'files.delete', {})).status === 400, 'an unknown store action is refused');
  eq([...store.STORE_ACTIONS].sort(), ['batch.take', 'brain.snapshot', 'files.get', 'files.save', 'notes.add'], 'the five pass actions');

  // ---- pipeline-google wiring ------------------------------------------------------
  const pg = read(fnDir, 'pipeline-google', 'index.ts');
  const wp = pg.slice(pg.indexOf('async function withPass('), pg.indexOf('// ---- The pipeline\'s own data'));
  const at = (s) => wp.indexOf(s);
  ok(at('if (pass.expired)') > 0 && at('if (pass.expired)') < at('STORE_ACTIONS.has(action)'), 'store actions run only after the pass is checked and not expired');
  ok(at('STORE_ACTIONS.has(action)') < at('.eq("name", "config.json")'), 'and before the Google file rules, so a client with no config yet can be filled');
  ok(/const out = await storeAction\(action, b, pass, storeDeps\(sb\)\);\n\s*return json\(out\.body, out\.status\);/.test(wp), 'the answer is passed back as plain JSON');
  const serve = pg.slice(pg.indexOf('Deno.serve('), pg.indexOf('// One Google call for an action'));
  ok(!/STORE_ACTIONS|storeAction/.test(serve), 'the old password path has no store actions (they need a pass\'s member and client)');
  const deps = pg.slice(pg.indexOf('function storeDeps('));
  ok(deps.includes('sb.rpc("fp_file_save"') && deps.includes('sb.rpc("fp_take_batch"'), 'saves and batch numbers go through the SQL functions');
  ok(!/from\("fp_files"\)\.(insert|update|upsert|delete)/.test(pg), 'fp_files is never written directly');
  ok(deps.includes('from("fp_feedback_notes").insert(row)'), 'notes are inserted');
  ok(/brainGh\(`zipball\/\$\{commit\}`/.test(deps) && /createSignedUrl\(zipName\(commit\), seconds/.test(deps), 'the snapshot is GitHub\'s zipball, cached, handed out as a signed link');
  ok(!/getPublicUrl/.test(pg), 'never a public link');
  ok(/BRAIN_GITHUB_TOKEN/.test(deps) && !/json\([^)]*BRAIN_GITHUB_TOKEN/.test(pg), 'the GitHub token is used server side and never answered');
  eq(store.SNAPSHOT_BUCKET, 'brain-snapshots', 'the snapshot bucket');

  // ---- Toolkits: name routing and the studio alias unchanged --------------------
  function bucket(files) {
    const logged = [], signed = [], asked = [];
    return {
      logged, signed, asked,
      exists: async (n) => { asked.push(n); return n in files; },
      readText: async (n) => { if (!(n in files)) throw new Error('Object not found'); return files[n]; },
      sign: async (n, s) => { if (!(n in files)) throw new Error('Object not found'); signed.push([n, s]); return 'https://example.invalid/sign/' + n; },
      log: (row) => logged.push(row),
    };
  }
  const both = {
    'latest.json': '{"version":"0.3","file":"synchro-video-studio-v0.3.zip","notes":"Studio"}',
    'synchro-video-studio-v0.3.zip': 'z',
    'filming-plan/latest.json': '{"version":"1.0","notes":"Plans"}',
    'filming-plan/synchro-filming-plan-1.0.zip': 'z',
  };
  const a = bucket(both), b2 = bucket(both);
  const viaAlias = await studio.studioLatest(a, { member: 'm', who: '' });
  const viaName = await studio.toolkitLatest(b2, 'studio', { member: 'm', who: '' });
  eq(viaAlias, viaName, 'studio_latest answers exactly what toolkit_latest("studio") answers');
  eq([a.asked, a.signed, a.logged], [['latest.json'], [['synchro-video-studio-v0.3.zip', 600]], [{ member_name: 'm', who: null, version: '0.3', file: 'synchro-video-studio-v0.3.zip' }]],
    'studio reads the top of the bucket, as before, and its log row has no toolkit field (the column default)');
  const fp = bucket(both);
  const fpOut = JSON.parse(await studio.toolkitLatest(fp, ' Filming-Plan ', { member: 'm', who: 'Sam' }));
  eq([fpOut.version, fpOut.notes], ['1.0', 'Plans'], 'filming-plan has its own latest.json');
  eq([fp.asked, fp.signed], [['filming-plan/latest.json'], [['filming-plan/synchro-filming-plan-1.0.zip', 600]]], 'read from its own folder');
  eq(fp.logged, [{ member_name: 'm', who: 'Sam', version: '1.0', file: 'synchro-filming-plan-1.0.zip', toolkit: 'filming-plan' }], 'logged with the toolkit name');
  const studioOnly = bucket({ 'latest.json': both['latest.json'], 'synchro-video-studio-v0.3.zip': 'z' });
  const none = await studio.toolkitLatest(studioOnly, 'filming-plan', { member: 'm', who: '' });
  ok(/^No filming-plan toolkit version uploaded yet/.test(none), 'a toolkit with nothing uploaded says so (and never falls back to the studio)');
  ok(studio.parseLatest('{"version":"1.0","file":"synchro-video-studio-1.0.zip"}', studio.TOOLKITS['filming-plan']).error, 'a filming-plan latest.json cannot hand out a studio zip');
  ok(studio.parseLatest('{"version":"1.0","file":"../synchro-filming-plan-1.0.zip"}', studio.TOOLKITS['filming-plan']).error, 'or climb out of its folder');
  const unknown = bucket(both);
  const u = await studio.toolkitLatest(unknown, 'editor', { member: 'm', who: '' });
  ok(u.startsWith('Give name:') && !unknown.asked.length && !unknown.logged.length, 'an unknown toolkit asks for a name and touches nothing');
  eq(who.outcomeOf('toolkit_latest', u).ok, false, 'and is logged as a failure');
  eq(studio.TOOLKIT_NAMES, ['studio', 'filming-plan'], 'the two toolkits');

  // ---- client_record, feedback_note, feedback_notes ---------------------------------
  const plan = { client_slug: 'clienta', client_name: 'Client A' };
  const finder = async (q) => (q.toLowerCase().startsWith('client a') ? { plan } : { choices: ['Client A'] });
  const noteRows = [];
  const rdeps = {
    findClient: finder,
    files: async () => [
      { name: 'ideas.json', version: 4, updated_by: OTHER, updated_at: '2026-01-02T10:30:00Z' },
      { name: 'config.json', version: 1, updated_by: OWNER, updated_at: '2026-01-01T09:00:00Z' },
    ],
    nextBatch: async () => 8,
    noteExists: async (id) => noteRows.some((n) => n.id === id),
    addNote: async (row) => { const n = { id: NOTE_ID, created_at: '2026-01-03T00:00:00Z', ...row }; noteRows.push(n); return { id: n.id, created_at: n.created_at }; },
    notes: async ({ since, slug, limit }) => noteRows.filter((n) => n.created_at >= since && (!slug || n.client_slug === slug)).slice(0, limit),
    clientNames: async () => new Map([['clienta', 'Client A']]),
    isPublisher: async (m) => m === OWNER,
  };
  const record = await rec.clientRecord(rdeps, 'Client A');
  ok(record.startsWith('Client A: filming pipeline record'), 'client_record names the client');
  ok(record.includes('Latest idea batch: 7 (the next one taken will be 8).'), 'the latest batch number is next minus one');
  ok(record.includes('- config.json: version 1, last saved 2026-01-01 09:00 UTC by Owner Example') && record.indexOf('config.json') < record.indexOf('ideas.json'), 'each file with version, time and who, by name');
  ok(!/body/i.test(record.replace('no contents', '')), 'no file contents');
  ok((await rec.clientRecord({ ...rdeps, files: async () => [], nextBatch: async () => null }, 'Client A')).includes('none taken yet'), 'a client with no batch yet');
  ok((await rec.clientRecord(rdeps, 'nobody')).startsWith('Which client?'), 'an unknown client asks which');
  const idx = read(fnDir, 'higgsfield-mcp', 'index.ts');
  ok(/from\("fp_files"\)\.select\("name,version,updated_by,updated_at"\)/.test(idx), 'client_record never selects a body');

  let saidNote = await rec.feedbackNote(rdeps, { client: 'Client A', title: 'Hooks', body: '**Shorter**' }, OTHER);
  eq(saidNote, `Saved note ${NOTE_ID} for Client A: "Hooks".`, 'feedback_note saves and confirms with the id');
  eq([noteRows[0].source, noteRows[0].member, noteRows[0].client_slug], ['chat', OTHER, 'clienta'], 'always source chat, filed under the caller');
  saidNote = await rec.feedbackNote(rdeps, { title: 'General', body: 'b', source: 'sheet', follows: NOTE_ID }, OTHER);
  eq([noteRows[1].client_slug, noteRows[1].source, noteRows[1].follows], [null, 'chat', NOTE_ID], 'no client is allowed, a chat note stays chat, follows is kept');
  ok((await rec.feedbackNote(rdeps, { title: 't', body: 'b', follows: '99999999-2222-4333-8444-555555555555' }, OTHER)).startsWith('Could not save the note'), 'follows must exist');
  ok((await rec.feedbackNote(rdeps, { body: 'b' }, OTHER)).startsWith('Give '), 'a missing title asks for one');
  ok((await rec.feedbackNote(rdeps, { client: 'nobody', title: 't', body: 'b' }, OTHER)).startsWith('Which client?'), 'an unknown client asks which');
  eq(who.outcomeOf('feedback_note', saidNote).ok, true, 'a saved note is logged as a success');

  const SUP = { member: OWNER, teamLink: false };
  for (const [whoCalls, label] of [[{ member: OWNER, teamLink: true }, 'the shared team link'], [{ member: OTHER, teamLink: false }, 'a personal link not on the publish list'], [null, 'no caller']]) {
    const refused = await rec.feedbackNotes(rdeps, { since: '2026-01-01' }, whoCalls);
    ok(refused === rec.NOTES_REFUSED && !refused.includes('Hooks'), `feedback_notes refuses ${label}, before reading any note`);
  }
  eq(who.outcomeOf('feedback_notes', rec.NOTES_REFUSED).ok, false, 'a refusal is logged as a failure');
  const list = await rec.feedbackNotes(rdeps, { since: '2026-01-01' }, SUP);
  ok(list.startsWith('Feedback notes since 2026-01-01 00:00 UTC (all clients), oldest first: 2.'), 'feedback_notes reads every client by default');
  ok(list.includes('## Hooks') && list.includes(`id ${NOTE_ID}`) && list.includes('client Client A') && list.includes('no client') && list.includes(`follows ${NOTE_ID}`), 'each note with its id, client, source and follow-up');
  ok(!list.includes('Not all notes'), 'all shown: no paging line');
  ok((await rec.feedbackNotes(rdeps, { since: '2026-01-01', client: 'Client A' }, SUP)).includes('(Client A), oldest first: 1.'), 'filtered by client: the note with no client is left out');
  ok((await rec.feedbackNotes(rdeps, { since: '2027-01-01' }, SUP)).startsWith('No feedback notes since'), 'nothing since then');
  ok((await rec.feedbackNotes(rdeps, { since: 'last week' }, SUP)).startsWith('Give since'), 'a bad since asks for a date');
  const many = Array.from({ length: 60 }, (_, i) => ({ id: NOTE_ID, created_at: `2026-02-01T00:${String(i).padStart(2, '0')}:00Z`, client_slug: null, title: 'n' + i, body: 'x', source: 'chat', follows: null, member: OTHER }));
  const paged = await rec.feedbackNotes({ ...rdeps, notes: async ({ limit }) => many.slice(0, limit) }, { since: '2026-02-01' }, SUP);
  ok(paged.includes('oldest first: 50 shown, and there are more.') && paged.includes('Read the rest with since "2026-02-01T00:49:00Z"'), 'more than 50: says so and where to continue, never a silent cut');
  const big = Array.from({ length: 5 }, (_, i) => ({ ...many[i], body: 'y'.repeat(19000) }));
  const capped = await rec.feedbackNotes({ ...rdeps, notes: async () => big }, { since: '2026-02-01' }, SUP);
  ok(capped.length <= rec.NOTES_MAX_CHARS + 200 && /Not all notes are shown\. Read the rest with since "2026-02-01T00:02:00Z"/.test(capped), 'the size cap pages too, from the last note shown');
  eq(rec.sinceOf('2026-10-17T02:50:12.123456+00:00'), '2026-10-17T02:50:12.123Z', 'a database time is a valid since');

  // ---- Connector wiring --------------------------------------------------------------
  const tools = idx.slice(idx.indexOf('const TOOLS = ['), idx.indexOf('// ---- Input validation'));
  for (const t of ['toolkit_latest', 'client_record', 'feedback_note', 'feedback_notes', 'studio_latest', 'pipeline_pass', 'client_brain']) ok(tools.includes(`name: "${t}"`), `${t} is offered`);
  const def = (t) => tools.slice(tools.indexOf(`name: "${t}"`), tools.indexOf('name: "', tools.indexOf(`name: "${t}"`) + 8));
  ok(/required: \["name"\]/.test(def('toolkit_latest')) && /enum: TOOLKIT_NAMES/.test(def('toolkit_latest')), 'toolkit_latest takes name: studio or filming-plan');
  ok(/required: \["client"\]/.test(def('client_record')), 'client_record takes client');
  ok(/required: \["title", "body"\]/.test(def('feedback_note')) && /enum: \["chat"\]/.test(def('feedback_note')), 'feedback_note takes title and body; source can only be chat');
  ok(/required: \["since"\]/.test(def('feedback_notes')), 'feedback_notes takes since');
  ok(/if \(name === "toolkit_latest"\) \{\n\s*return await toolkitLatest\(studioStore\(\), String\(args\.name \|\| ""\), \{ member, who: isTeamLink\(member\) \? cleanWho\(args\.who\) : "" \}\);/.test(idx), 'toolkit_latest uses the same bucket and log as studio_latest');
  ok(/if \(name === "feedback_notes"\) return await feedbackNotes\(recordDeps\(\), args, \{ member, teamLink: isTeamLink\(member\) \}\);/.test(idx), 'feedback_notes is told the caller\'s link kind, server side');
  ok(/isPublisher: async \(m: string\) => \{\n\s*const \{ data, error \} = await db\(\)\.from\("fp_publishers"\)/.test(idx), 'and checks the publish list');
  ok(/if \(name === "feedback_note"\) return await feedbackNote\(recordDeps\(\), args, author\);/.test(idx), 'a chat note is filed under the caller (the team link\'s "<name> (team)")');
  ok(/const folder = cut < 0 \? "" : name\.slice\(0, cut\);/.test(idx), 'the bucket check looks inside a toolkit\'s folder');
  ok(!/VIEWER_TOOLS = new Set\([^)]*(toolkit_latest|client_record|feedback_note)/.test(idx), 'none of them shows the media viewer');

  // client_brain: focus.md (only when it exists) and audience.md, size cap kept.
  const ci = read(fnDir, 'higgsfield-mcp', 'clientinfo.ts');
  const cb = ci.slice(ci.indexOf('export async function clientBrain('), ci.indexOf('export async function brainChange('));
  ok(cb.includes('read("focus")') && cb.includes('read("audience")'), 'client_brain reads focus.md and audience.md');
  ok(/if \(r\.status === 404\) return "";/.test(cb), 'a missing focus.md reads as nothing, not a failure');
  ok(/\$\{p\.client_name\}, from the Synchro Brain\.\\n\\n\$\{focusText\}# Brief/.test(cb), 'focus comes before the brief, so the cap never cuts it');
  ok(/const focusText = focusFacts\.length \?/.test(cb), 'and only when focus.md has written facts');
  ok(cb.includes('...parseAudience(audience)'), 'audience facts are still there');
  ok(/text\.length > BRAIN_MAX_CHARS/.test(cb) && /const BRAIN_MAX_CHARS = 60_000;/.test(ci), 'the size cap is kept');
  const parse = await import(path.join(fnDir, 'brain', 'parse.mjs'));
  const focusMd = '# Focus\n\n## Current focus\n<!-- brain\nid:      client.example.focus.current\nowner:   someone\nstatus:  written\n-->\nCurrent focus: sleep.\n';
  const ff = parse.parseBrainFacts(focusMd, 'focus').filter((f) => f.status === 'written');
  eq([ff.length, ff[0].id, ff[0].file, ff[0].body.trim()], [1, 'client.example.focus.current', 'focus', 'Current focus: sleep.'], 'a focus.md fact parses with its id');
  eq(parse.parseBrainFacts('', 'focus'), [], 'no focus.md, no facts');

  // ---- The migration -----------------------------------------------------------------
  const mig = read(root, 'supabase', 'migrations', '20261017090000_toolkit_downloads_and_brain_snapshots.sql');
  const probe = mig.split('\n').slice(0, 40).join('\n').match(/^--\s*ef-auto-deploy-applied-when:\s*(.+?)\s*$/m);
  ok(probe && /column_name = 'toolkit'/.test(probe[1]) && /id = 'brain-snapshots' and public = false/.test(probe[1]), 'the migration says how to tell it is applied');
  require(path.join(root, 'scripts', 'repo-vs-live')).assertReadOnlyProbe(probe[1]);
  passed++;
  ok(/add column if not exists toolkit text not null default 'studio'/.test(mig), 'studio rows keep working without naming the column');
  ok(/values \('brain-snapshots', 'brain-snapshots', false,/.test(mig), 'the snapshot bucket is private');
  ok(!/create (table|function|policy)/i.test(mig) && !/\bgrant\b/i.test(mig.replace(/^--.*$/gm, '').replace(/\$assert\$[\s\S]*?\$assert\$/, '')), 'no new table, function, policy or grant');
  ok(/expected INSERT,SELECT/.test(mig) && /a storage policy names the bucket/.test(mig), 'the assert re-checks the table grants and that no storage policy opens the bucket');

  // ---- Public repo: nothing identifying -------------------------------------------
  const added = [read(fnDir, 'pipeline-google', 'store.mjs'), read(fnDir, 'higgsfield-mcp', 'filmingrecord.mjs'), mig].join('\n');
  ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(added.replace(/sidney-afk\/synchro-brain/g, '')) && !/fpp_[0-9a-f]{8}/.test(added), 'no email or pass token in the new files');

  console.log(`pipeline-store: ${passed} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
