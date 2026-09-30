'use strict';
/* index-split.js -- the split build (scripts/index-split.js) serves the same
 * code, and the switch-off build is the plain concatenation.
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 2. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const { readModuleList, servedBytes } = require('../scripts/index-modules');
const { buildOutputs, readSplitConfig } = require('../scripts/index-split');

const SRC = path.join(__dirname, '..', 'src', 'index');
let failed = 0;
const t = (ok, msg) => { console.log((ok ? '  ok  ' : '  ❌  ') + msg); if (!ok) failed++; };

const entries = fs.readFileSync(path.join(SRC, 'manifest.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
const bufs = entries.map(e => fs.readFileSync(path.join(SRC, e)));
const modules = readModuleList(SRC);
const served = entries.map((e, i) => servedBytes(e, bufs[i], modules));
const concat = Buffer.concat(served);
const jsIdx = entries.map((e, i) => (e.endsWith('.js.part') ? i : -1)).filter(i => i >= 0);
const script = Buffer.concat(jsIdx.map(i => served[i]));
const markerOf = name => Buffer.from(`\n;(self.__svParts || (self.__svParts = [])).push(${JSON.stringify(name)});\n`);
const strip = (name, buf) => {
  const m = markerOf(name);
  return buf.subarray(buf.length - m.length).equals(m) ? buf.subarray(0, buf.length - m.length) : null;
};

const cfg = readSplitConfig(SRC);
const areas = new Map();
for (const line of fs.readFileSync(path.join(SRC, 'areas.txt'), 'utf8').split(/\r?\n/)) {
  const [frag, area] = line.replace(/#.*/, '').trim().split(/\s+/);
  if (frag && area) areas.set(frag, area.replace(/!$/, ''));
}
t(typeof cfg.enabled === 'boolean', 'split.json has an on/off "enabled"');
if (!cfg.enabled) {
  const off = buildOutputs(SRC, entries, bufs, modules, null);
  t(off.size === 1 && off.get('index.html').equals(concat), 'switch off: index.html is exactly the fragments concatenated, nothing else written');
}

// A build with split.json as it is on disk, but with "minify" set as asked.
function buildWith(minify, force) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'svmin-'));
  fs.copyFileSync(path.join(SRC, 'areas.txt'), path.join(tmp, 'areas.txt'));
  fs.writeFileSync(path.join(tmp, 'split.json'), JSON.stringify({ ...cfg, enabled: true, minify }));
  try { return buildOutputs(tmp, entries, bufs, modules, force); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

for (const force of ['split', 'parts']) {
  // The byte-for-byte checks below are about the cut, so they build readable.
  const out = buildWith(false, force);
  const html = out.get('index.html').toString('utf8');
  const files = [...out.keys()].filter(k => k !== 'index.html');
  const full = files.find(f => /^js\/sv-full-[0-9a-f]{12}\.js$/.test(f));
  const parts = files.filter(f => /^js\/sv-\d\d-[a-z-]+-[0-9a-f]{12}\.js$/.test(f)).sort();
  t(!!full && strip(full, out.get(full)) && strip(full, out.get(full)).equals(script), `${force}: the full file is the inline script, byte for byte, plus its ran-marker`);
  // Core parts in order are the non-lazy code; each lazy file is all of its
  // area's code in page order (an area may be several runs, core between).
  const lazyNames = new Set(cfg.lazy || []);
  const areaOf = e => areas.get(e);
  const lazyFiles = parts.filter(p => lazyNames.has(p.replace(/^js\/sv-\d\d-/, '').replace(/-[0-9a-f]{12}\.js$/, '')));
  const coreFiles = parts.filter(p => !lazyFiles.includes(p));
  const coreCode = Buffer.concat(jsIdx.filter(i => !lazyNames.has(areaOf(entries[i]))).map(i => served[i]));
  t(Buffer.concat(coreFiles.map(p => strip(p, out.get(p)))).equals(coreCode), `${force}: the always-loaded parts, in order, are the non-on-demand code, byte for byte`);
  t([...lazyNames].every(a => {
    const f = lazyFiles.find(p => p.includes('-' + a + '-'));
    return f && strip(f, out.get(f)).equals(Buffer.concat(jsIdx.filter(i => areaOf(entries[i]) === a).map(i => served[i])));
  }), `${force}: each on-demand file is all of its area's code, in page order`);
  t(parts.reduce((s, p) => s + strip(p, out.get(p)).length, 0) === script.length, `${force}: together the parts cover the whole script once`);
  t(files.length === parts.length + 1, `${force}: nothing else is written to js/`);
  const htmlBuf = out.get('index.html');
  const head = Buffer.concat(served.slice(0, jsIdx[0]));
  t(htmlBuf.subarray(0, head.length).equals(head) && htmlBuf.indexOf('    /* SyncView loader.') === head.length,
    `${force}: every byte before the main script is unchanged, and the loader sits where the script began`);
  t(html.endsWith(Buffer.concat(served.slice(jsIdx[jsIdx.length - 1] + 1)).toString('utf8')), `${force}: every byte after the main script is unchanged`);
  t(parts.every(p => html.includes(JSON.stringify(p))) && html.includes(JSON.stringify(full)), `${force}: the loader names every file`);
  t(/var FORCE = (null|"parts");/.test(html) && (force === 'parts') === html.includes('var FORCE = "parts";'), `${force}: only --force-split=parts sends everyone the parts`);
}

// "minify": true shrinks the parts and on-demand files only. The readable full
// file, the file list and the loader's file names' shape stay as they are.
{
  const { loadEsbuild } = require('../scripts/index-minify');
  if (!loadEsbuild({ install: false })) console.log('  skip  minify checks: esbuild is not installed here (check-modules and check-index run them in CI)');
  else {
    const plain = buildWith(false, 'split');
    const mini = buildWith(true, 'split');
    const kind = (out, re) => [...out.keys()].filter(k => re.test(k)).sort();
    const isFull = k => /^js\/sv-full-/.test(k);
    const isPart = k => /^js\/sv-\d\d-/.test(k);
    t(kind(plain, /^js\/sv-full-/).join() === kind(mini, /^js\/sv-full-/).join(), 'minify: the readable full file is byte for byte the same (name and content)');
    t(kind(plain, /^js\/sv-\d\d-/).length === kind(mini, /^js\/sv-\d\d-/).length, 'minify: the same parts and on-demand files are written');
    const size = out => [...out].filter(([k]) => isPart(k)).reduce((n, [, b]) => n + b.length, 0);
    t(size(mini) < size(plain) * 0.7, `minify: the parts shrink by at least 30% (${size(plain)} -> ${size(mini)} bytes)`);
    t([...mini].filter(([k]) => isPart(k)).every(([k, b]) => { try { new vm.Script(b.toString('utf8')); return strip(k, b) !== null; } catch (e) { return false; } }),
      'minify: every part still parses and still ends with its ran-marker');
    t([...mini].filter(([k]) => isPart(k)).every(([k, b]) => k.includes(require('crypto').createHash('sha256').update(strip(k, b)).digest('hex').slice(0, 12))), 'minify: each file name carries the hash of its own (minified) content');
    t(buildWith(true, 'split').get('index.html').equals(mini.get('index.html')), 'minify: building twice gives the same page (the same files)');
    t(!plain.get('index.html').equals(mini.get('index.html')), 'minify: the loader names the minified files, not the readable ones');
  }
}

// Who gets which script (plan step 5): run the real loader, from a build made with
// split.json "clients" on and off, against a fake browser, for every kind of visitor.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'svsplit-'));
  fs.copyFileSync(path.join(SRC, 'areas.txt'), path.join(tmp, 'areas.txt'));
  const loaderFor = clients => {
    fs.writeFileSync(path.join(tmp, 'split.json'), JSON.stringify(Object.assign({ enabled: true, lazy: cfg.lazy || [] }, clients === undefined ? {} : { clients })));
    const html = buildOutputs(tmp, entries, bufs, modules, null).get('index.html').toString('utf8');
    const start = html.indexOf('    /* SyncView loader.');
    return html.slice(start, html.indexOf('\n    })();\n', start) + '\n    })();\n'.length);
  };
  const run = (src, { url, staff, off }) => {
    const u = new URL('https://example.invalid' + url);
    const store = new Map(off ? [['syncview_split_off', '1']] : []);
    if (staff) store.set('syncview_staff_identity_v1', '{}');
    const written = [], replaced = [];
    const ctx = {
      location: { search: u.search, hash: u.hash, pathname: u.pathname },
      localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
      sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      document: { write: s => written.push(s) }, URLSearchParams,
      history: { state: null, replaceState: (_s, _t, url) => { replaced.push(url); } },
    };
    ctx.self = ctx;
    vm.runInNewContext(src, ctx);
    return { mode: ctx.__svLoad.mode, client: ctx.__svLoad.client, lazy: Object.keys(ctx.__svLoad.lazy).length, files: ctx.__svLoad.files.length, sticky: store.get('syncview_split_off') === '1', replaced, store };
  };
  const CLIENT = '/index.html?c=Some+Client&t=tok&v=calendar';
  const on = loaderFor(true), offCfg = loaderFor(false), unset = loaderFor(undefined);
  t(/var CLIENTS = true;/.test(on) && /var CLIENTS = false;/.test(offCfg) && /var CLIENTS = false;/.test(unset), 'the loader records "clients" from split.json (missing means false: client links keep the single file)');
  const cases = [
    ['client link, clients on', on, { url: CLIENT }, 'parts', true],
    ['client link with ?t only, clients on', on, { url: '/index.html?t=tok' }, 'parts', true],
    ['client link, staff browser, clients on', on, { url: CLIENT, staff: true }, 'parts', true],
    ['client link, clients off', offCfg, { url: CLIENT }, 'full', false],
    ['client link, clients missing from split.json', unset, { url: CLIENT }, 'full', false],
    ['client link, clients off, staff browser', offCfg, { url: CLIENT, staff: true }, 'full', false],
    ['client link with ?split=0', on, { url: CLIENT + '&split=0' }, 'full', false],
    ['client link in a browser that opted out', on, { url: CLIENT, off: true }, 'full', false],
    ['intake form', on, { url: '/?intake=1' }, 'full', false],
    ['onboarding form', on, { url: '/?onboarding=1&c=Some+Client' }, 'full', false],
    ['onboarding view, staff browser', on, { url: '/?onboarding_view=1', staff: true }, 'full', false],
    ['SMM weekly report, staff browser', on, { url: '/#smm-weekly-report', staff: true }, 'full', false],
    ['signed-out visitor', on, { url: '/' }, 'full', false],
    ['signed-in staff', on, { url: '/#calendar', staff: true }, 'parts', false],
    ['signed-in staff, clients off', offCfg, { url: '/', staff: true }, 'parts', false],
    ['signed-in staff with ?split=0', on, { url: '/?split=0', staff: true }, 'full', false],
  ];
  for (const [label, src, opts, mode, client] of cases) {
    const r = run(src, opts);
    t(r.mode === mode && r.client === client && (mode === 'full' ? r.files === 1 && r.lazy === 0 : r.files > 1 && r.lazy === (cfg.lazy || []).length), `loader: ${label} gets ${mode}${mode === 'parts' ? ' (' + r.files + ' files, ' + r.lazy + ' on demand)' : ''}${client ? ', flagged as a client link' : ''}`);
  }
  const s0 = run(on, { url: CLIENT + '&split=0' });
  t(s0.sticky, 'loader: ?split=0 on a client link is remembered for that browser');
  // ?split=0|1 is taken out of a client link's address once read; nothing else in it moves.
  t(JSON.stringify(s0.replaced) === JSON.stringify(['/index.html?c=Some+Client&t=tok&v=calendar']), 'loader: ?split=0 leaves a client link\'s address, the rest of the link untouched (got ' + JSON.stringify(s0.replaced) + ')');
  t(JSON.stringify(run(on, { url: '/index.html?split=1&c=Some+Client&t=tok' }).replaced) === JSON.stringify(['/index.html?c=Some+Client&t=tok']), 'loader: ?split=1 first in the address is removed cleanly');
  t(JSON.stringify(run(on, { url: '/index.html?c=A&split=0&t=tok&v=calendar#x' }).replaced) === JSON.stringify(['/index.html?c=A&t=tok&v=calendar#x']), 'loader: split in the middle is removed, hash kept');
  // A repeated or odd split is left exactly as it is (the client link check refuses it): no opt-out, no rewrite.
  for (const odd of ['&split=0&split=1', '&split=2', '&split=', '&SPLIT=0']) {
    const r = run(on, { url: CLIENT + odd });
    t(r.replaced.length === 0 && !r.sticky && r.mode === 'parts', `loader: ${odd} on a client link is left alone (no opt-out stored, address not rewritten)`);
  }
  t(run(on, { url: '/?split=0', staff: true }).replaced.length === 0, 'loader: a staff address is not rewritten');
  t(run(on, { url: CLIENT + '&split=1', off: true }).mode === 'parts', 'loader: ?split=1 on a client link clears the opt-out');
  // The way back for everyone: with "enabled" false, whatever "clients" says, the
  // build is the plain single file, byte for byte, and writes nothing else.
  fs.writeFileSync(path.join(tmp, 'split.json'), JSON.stringify({ enabled: false, lazy: cfg.lazy || [], clients: true }));
  const offBuild = buildOutputs(tmp, entries, bufs, modules, null);
  t(offBuild.size === 1 && offBuild.get('index.html').equals(concat), 'split off (with clients on): index.html is exactly the fragments concatenated, nothing else written');
  fs.writeFileSync(path.join(tmp, 'split.json'), JSON.stringify({ enabled: true, clients: 'yes' }));
  let bad = false; try { buildOutputs(tmp, entries, bufs, modules, null); } catch (e) { bad = /clients/.test(e.message); }
  t(bad, 'a "clients" value that is not true or false is refused');
  fs.writeFileSync(path.join(tmp, 'split.json'), JSON.stringify({ enabled: true, lazy: cfg.lazy || [], clients: true }));
  const forced = buildOutputs(tmp, entries, bufs, modules, 'parts').get('index.html').toString('utf8');
  const fl = forced.slice(forced.indexOf('    /* SyncView loader.'));
  t(run(fl.slice(0, fl.indexOf('\n    })();\n') + '\n    })();\n'.length), { url: CLIENT }).client === true, 'loader: forced-parts preview still flags a client link, so it skips the quiet download');
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) { console.error(`index-split: ${failed} check(s) failed`); process.exit(1); }
console.log('index-split: all checks passed');
