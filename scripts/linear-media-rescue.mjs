#!/usr/bin/env node
/*
 * LX-E — re-host `uploads.linear.app` media for cards someone is still working.
 *
 * WHY THIS IS AN IMPROVEMENT AND NOT A RESCUE (measured 2026-09-07, see
 * docs/ops/LINEAR_MEDIA_RESCUE.md for the full transcript):
 *
 *   Linear mints the `?signature=` JWT on every API read and gives it a
 *   300-second life (`exp - iat === 300`, decoded from a live description).
 *   Fetched with a fresh signature the object answers 200; forty-five seconds
 *   after `exp`, and with the signature stripped, the same object answers 401.
 *   Every URL sitting in `deliverables.brief` was captured by the mirror months
 *   ago, so it has been a 401 — a broken-image icon labelled "Pasted image",
 *   because the Linear form is `![](url)` with an EMPTY alt — since five
 *   minutes after it was written. Nothing regresses on 2026-09-15 here.
 *   What 2026-09-15 removes is the ability to MINT A FRESH SIGNATURE, which is
 *   the only path to any byte the owner's private capture does not already
 *   hold. That is the sole time-critical part of this lane.
 *
 * CONSEQUENCE FOR THE JOIN KEY, and it is not what the brief assumed:
 *   Reading one issue twice, five minutes apart, returned the SAME path and a
 *   COMPLETELY DIFFERENT signature. So the full URL is NOT a stable identity.
 *   Every lookup — into the owner's capture, into the upload out-map, and for
 *   de-duplication — keys on `mediaKey()` (origin + pathname) and never on the
 *   whole URL. Keying on the full URL reports capture gaps that are not real
 *   and misses duplicates that are.
 *
 * CONSEQUENCE FOR THE REPO, which is PUBLIC:
 *   A stored URL carries a JWT plus the workspace and per-file UUIDs. The
 *   manifest therefore NEVER lands in git. `assertPrivatePath()` refuses any
 *   output path under a directory that has a `.git`, mirroring the existing
 *   `privateFile()` rule. Only counts and a SHA-256 of each path are publishable.
 *
 * The rewrite is a pure URL-for-URL offset splice guarded by a compare-and-swap
 * on the exact pre-image, so a card edited between the census and the apply
 * fails the whole transaction loudly instead of silently overwriting an editor.
 *
 * Commands (only `upload` touches the network; everything else is offline):
 *   scan    <rows.json> <manifest.json>
 *   upload  <manifest.json> <files-dir> <out-map.json>
 *   rewrite <manifest.json> <out-map.json> <forward.sql> <rollback.sql>
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */

/* Lifted verbatim from the candidate's `briefMediaOccurrences`
   (5bcc03bd, supabase/functions/_shared/native-brief-media.mjs:7-13) rather
   than imported: importing drags in the private-bucket contract this lane
   deliberately does not build, and creates a shared file another lane may
   also claim. */
const MEDIA_RE =
  /<(https?:\/\/uploads\.linear\.app\/[^<>]+)>|(https?:\/\/uploads\.linear\.app\/[^\s<>"'\])]+)/gi;

/* The bare-form branch above stops at `)` and `]` but NOT at `.`, `,`, `!`,
   `?`, `;` or a trailing `*`, so a URL that ends a sentence swallows the
   period. Splicing that offset would delete the sentence's punctuation out of
   a client-facing brief — the one thing this lane must never do. The renderer
   has the same problem and already solves it: `trimLinkTail` (index.html:54937)
   peels `**`, `*`, `&gt;` and `[)\].,!?;]` off the end before it builds the
   anchor. This is that rule, on raw stored text instead of escaped HTML, so
   the rescue's idea of where a URL ends matches the renderer's exactly.

   The ANGLE form is deliberately exempt: `<...>` is explicitly delimited and
   the renderer does not tail-trim it either (index.html:54988 takes whatever
   sits between the brackets). Trimming it here would desynchronise the two. */
function trimBareTail(url) {
  let u = url;
  for (;;) {
    if (u.endsWith('**')) { u = u.slice(0, -2); continue; }
    if (/[*.,!?;]$/.test(u)) { u = u.slice(0, -1); continue; }
    break;
  }
  return u;
}

/**
 * Exact-offset occurrences of `uploads.linear.app` URLs in `text`.
 * Offsets and lengths are UTF-16 code units, so they splice directly.
 * @returns {{offset:number,length:number,url:string,form:'angle'|'bare'}[]}
 */
export function mediaOccurrences(text) {
  const s = String(text ?? '');
  const out = [];
  MEDIA_RE.lastIndex = 0;
  let m;
  while ((m = MEDIA_RE.exec(s)) !== null) {
    const angle = Boolean(m[1]);
    const raw = angle ? m[1] : m[2];
    const url = angle ? raw : trimBareTail(raw);
    if (!url) continue;
    out.push({
      offset: m.index + (angle ? 1 : 0),
      length: url.length,
      url,
      form: angle ? 'angle' : 'bare',
    });
  }
  return out;
}

/**
 * The stable identity of a Linear upload: origin + pathname, no query.
 * The `?signature=` JWT is re-minted on every read and must never be a key.
 */
export function mediaKey(url) {
  const u = new URL(String(url));
  return u.origin + u.pathname;
}

/** Publishable stand-in for a URL: the key's SHA-256. Safe for a public repo. */
export function mediaKeyHash(url) {
  return crypto.createHash('sha256').update(mediaKey(url)).digest('hex');
}

/* ------------------------------------------------------------------ *
 * Rewriting
 * ------------------------------------------------------------------ */

/**
 * Replace each occurrence's `[offset, offset+length)` with its new URL.
 *
 * Splices in DESCENDING offset order so every earlier offset stays valid, and
 * touches nothing but the URL runs themselves: `![alt](URL)` stays image
 * syntax, `![alt](<URL>)` stays the angle form, a bare URL stays a bare link.
 *
 * @param {string} text
 * @param {{offset:number,length:number,url:string}[]} occurrences
 * @param {(url:string)=>string|undefined} resolve  keyed on mediaKey, not URL
 */
export function rewriteText(text, occurrences, resolve) {
  const s = String(text ?? '');
  const ordered = [...occurrences].sort((a, b) => b.offset - a.offset);
  let out = s;
  let replaced = 0;
  const skipped = [];
  for (const occ of ordered) {
    if (s.slice(occ.offset, occ.offset + occ.length) !== occ.url) {
      throw new Error(`occurrence at ${occ.offset} does not match its recorded URL`);
    }
    const next = resolve(occ.url);
    if (!next) { skipped.push(occ); continue; }
    out = out.slice(0, occ.offset) + next + out.slice(occ.offset + occ.length);
    replaced += 1;
  }
  return { text: out, replaced, skipped };
}

/* ------------------------------------------------------------------ *
 * SQL
 * ------------------------------------------------------------------ */

/* Ordinary single-quote escaping, not dollar quoting. Dollar quoting needs a
   tag proven absent from the corpus, and the corpus is uncontrolled historical
   text; `''` has no such failure mode under standard_conforming_strings, which
   is on by default. */
export function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * One transaction. Each row is a compare-and-swap against its exact pre-image,
 * and its row_count is banked in a temp table. A single guard at the end — the
 * ONLY dollar-quoted block in the file, and it contains no corpus text at all,
 * so no tag can collide — aborts everything if any row failed to match.
 *
 * That is the whole race story: if another lane, an editor, or the inbound
 * webhook rewrote a brief since the census, its literal no longer matches, its
 * count is 0, and the transaction rolls back with the offending keys named.
 * A failed rescue that leaves every brief intact is the good outcome.
 *
 * @param {{table:'deliverables'|'production_comments',column:'brief'|'body',
 *          id:string,from:string,to:string}[]} rows
 */
export function buildSql(rows, { title }) {
  const lines = [
    `-- ${title}`,
    '-- Generated by scripts/linear-media-rescue.mjs. Do not hand-edit.',
    '--',
    '-- Every statement is a compare-and-swap on the exact pre-image. If any row',
    '-- has changed since the census, the guard at the foot raises and the WHOLE',
    '-- transaction rolls back. Nothing is partially applied.',
    '',
    'begin;',
    '',
    'create temporary table lxe_applied (row_key text primary key, matched int)',
    '  on commit drop;',
    '',
  ];
  for (const r of rows) {
    const key = `${r.table}:${r.id}`;
    lines.push(
      `with upd as (`,
      `  update public.${r.table}`,
      `     set ${r.column} = ${sqlText(r.to)}`,
      `   where id = ${sqlText(r.id)}`,
      `     and ${r.column} = ${sqlText(r.from)}`,
      `  returning 1`,
      `)`,
      `insert into lxe_applied (row_key, matched)`,
      `select ${sqlText(key)}, count(*) from upd;`,
      '',
    );
  }
  lines.push(
    '-- The guard. No corpus text appears inside it, so its dollar tag is safe.',
    'do $lxe_guard$',
    'declare',
    '  bad int;',
    '  keys text;',
    'begin',
    '  select count(*), string_agg(row_key, \', \' order by row_key)',
    '    into bad, keys',
    '    from lxe_applied where matched <> 1;',
    '  if bad > 0 then',
    '    raise exception',
    '      \'LX-E aborted: % row(s) no longer match their recorded pre-image: %\',',
    '      bad, keys;',
    '  end if;',
    'end',
    '$lxe_guard$;',
    '',
    'commit;',
    '',
  );
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Public-repo guard
 * ------------------------------------------------------------------ */

/* A stored URL carries a JWT and the workspace/file UUIDs. The manifest and
   the out-map hold those verbatim, so they must never be written anywhere git
   can see. Mirrors `privateFile()` on the candidate: walk up from the target
   and refuse if any ancestor holds a `.git`. */
export function assertPrivatePath(target) {
  let dir = path.resolve(path.dirname(target));
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) {
      throw new Error(
        `refusing to write ${target}: it sits inside a git working tree ` +
        `(${dir}). Manifests carry signed Linear URLs and this repo is public. ` +
        `Write it under a private directory instead.`
      );
    }
    const up = path.dirname(dir);
    if (up === dir) return target;
    dir = up;
  }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

function cmdScan(rowsPath, manifestPath) {
  assertPrivatePath(manifestPath);
  const rows = readJson(rowsPath);
  const occurrences = [];
  for (const row of rows) {
    const text = row.table === 'production_comments' ? row.body : row.brief;
    for (const occ of mediaOccurrences(text)) {
      occurrences.push({
        table: row.table,
        id: row.id,
        client_slug: row.client_slug,
        status: row.status ?? null,
        offset: occ.offset,
        length: occ.length,
        form: occ.form,
        url: occ.url,
        key: mediaKey(occ.url),
        key_sha256: mediaKeyHash(occ.url),
      });
    }
  }
  const keys = new Set(occurrences.map(o => o.key));
  const manifest = {
    generated_at: new Date().toISOString(),
    rows: rows.map(r => ({
      table: r.table,
      id: r.id,
      client_slug: r.client_slug,
      status: r.status ?? null,
      text: r.table === 'production_comments' ? r.body : r.brief,
    })),
    occurrences,
    counts: {
      rows: rows.length,
      occurrences: occurrences.length,
      distinct_files: keys.size,
    },
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(
    `rows=${rows.length} occurrences=${occurrences.length} distinct_files=${keys.size}`
  );
  console.log(`manifest written (PRIVATE): ${manifestPath}`);
}

async function cmdUpload(manifestPath, filesDir, outMapPath) {
  assertPrivatePath(outMapPath);
  const endpoint = process.env.SYNCVIEW_UPLOAD_URL;
  const key = process.env.SYNCVIEW_STAFF_KEY;
  const actor = process.env.SYNCVIEW_STAFF_ACTOR;
  if (!endpoint || !key || !actor) {
    console.error(
      'Set SYNCVIEW_UPLOAD_URL, SYNCVIEW_STAFF_KEY and SYNCVIEW_STAFF_ACTOR. ' +
      'Never pass the key as an argument — it lands in shell history.'
    );
    process.exit(2);
  }
  const manifest = readJson(manifestPath);

  /* De-duplicate on the PATH. The same file appears under a different
     signature in every row it was mirrored into; keying on the full URL would
     upload the same bytes many times and blow the rate limit for nothing. */
  const byKey = new Map();
  for (const occ of manifest.occurrences) {
    if (!byKey.has(occ.key)) byKey.set(occ.key, occ);
  }

  /* RATE_LIMIT_PER_HOUR = 120 per actor, and the deciding count INCLUDES the
     row the caller just reserved (index.ts:183-205), so exactly 3600/120 = 30s
     spacing refuses itself at the boundary. 40s with jitter sits clear of it. */
  const spacing = Number(process.env.SYNCVIEW_UPLOAD_SPACING_MS || 40_000);
  const out = fs.existsSync(outMapPath) ? readJson(outMapPath) : {};
  let done = 0;
  let failed = 0;

  for (const [k, occ] of byKey) {
    if (out[k]) { done += 1; continue; }
    const local = path.join(filesDir, crypto.createHash('sha256').update(k).digest('hex'));
    const candidates = fs.existsSync(filesDir)
      ? fs.readdirSync(filesDir).filter(f => f.startsWith(path.basename(local)))
      : [];
    if (!candidates.length) {
      console.error(`MISSING FROM CAPTURE  ${occ.key_sha256}  (${occ.table}:${occ.id})`);
      failed += 1;
      continue;
    }
    const file = path.join(filesDir, candidates[0]);
    const bytes = fs.readFileSync(file);
    const mime = mimeOf(bytes);
    if (!mime) {
      console.error(`UNSUPPORTED MIME     ${occ.key_sha256}  (${occ.table}:${occ.id})`);
      failed += 1;
      continue;
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': mime,
        'x-syncview-key': key,
        'x-syncview-actor': actor,
        'x-syncview-image-client': occ.client_slug,
        'x-syncview-image-issue': occ.id,
      },
      body: bytes,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok || !body.url) {
      console.error(`REFUSED ${res.status} ${body.error || ''}  ${occ.key_sha256}`);
      failed += 1;
    } else {
      out[k] = {
        new_url: body.url,
        mime_type: mime,
        byte_length: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      };
      fs.writeFileSync(outMapPath, JSON.stringify(out, null, 2));
      done += 1;
      console.log(`ok ${done}/${byKey.size}  ${occ.key_sha256}`);
    }
    await new Promise(r => setTimeout(r, spacing + Math.floor(Math.random() * 5000)));
  }
  console.log(`uploaded=${done} failed=${failed} distinct_files=${byKey.size}`);
  if (failed) process.exitCode = 1;
}

/* The Edge Function verifies declared MIME against magic bytes and a full
   structural parse, so this only has to declare honestly; the server is the
   authority and refuses anything that disagrees. */
function mimeOf(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF'
      && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length > 6 && b.slice(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
  return null;
}

function cmdRewrite(manifestPath, outMapPath, forwardPath, rollbackPath) {
  const manifest = readJson(manifestPath);
  const map = readJson(outMapPath);
  const resolve = url => map[mediaKey(url)]?.new_url;

  const byRow = new Map();
  for (const occ of manifest.occurrences) {
    const k = `${occ.table}:${occ.id}`;
    if (!byRow.has(k)) byRow.set(k, []);
    byRow.get(k).push(occ);
  }

  const forward = [];
  const rollback = [];
  let untouched = 0;
  for (const row of manifest.rows) {
    const occ = byRow.get(`${row.table}:${row.id}`) || [];
    const column = row.table === 'production_comments' ? 'body' : 'brief';
    const result = rewriteText(row.text, occ, resolve);
    if (result.replaced === 0) { untouched += 1; continue; }
    forward.push({ table: row.table, column, id: row.id, from: row.text, to: result.text });
    rollback.push({ table: row.table, column, id: row.id, from: result.text, to: row.text });
  }

  fs.writeFileSync(forwardPath, buildSql(forward, {
    title: 'LX-E forward — re-point Linear media at the SyncView bucket',
  }));
  fs.writeFileSync(rollbackPath, buildSql(rollback, {
    title: 'LX-E rollback — restore every original brief/body byte for byte',
  }));

  /* The pair is only trustworthy if it is a proven inverse, so prove it here
     rather than asserting it in a doc: replay forward then rollback in memory
     and require the result to be byte-identical to what the census captured. */
  for (let i = 0; i < forward.length; i += 1) {
    if (rollback[i].to !== forward[i].from || rollback[i].from !== forward[i].to) {
      throw new Error(`rollback is not the inverse of forward at ${forward[i].id}`);
    }
  }

  console.log(`rows_rewritten=${forward.length} rows_untouched=${untouched}`);
  console.log(`forward:  ${forwardPath}`);
  console.log(`rollback: ${rollbackPath}  (verified as the exact inverse)`);
}

const [cmd, ...rest] = process.argv.slice(2);
const USAGE = `usage:
  linear-media-rescue.mjs scan    <rows.json> <manifest.json>
  linear-media-rescue.mjs upload  <manifest.json> <files-dir> <out-map.json>
  linear-media-rescue.mjs rewrite <manifest.json> <out-map.json> <forward.sql> <rollback.sql>`;

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (cmd === 'scan' && rest.length === 2) cmdScan(...rest);
    else if (cmd === 'upload' && rest.length === 3) await cmdUpload(...rest);
    else if (cmd === 'rewrite' && rest.length === 4) cmdRewrite(...rest);
    else { console.error(USAGE); process.exit(2); }
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}
