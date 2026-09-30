'use strict';
/*
 * index-split.js — the served page, as one file or split into several.
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 2.
 *
 * GitHub Pages serves this repository's files as they are, so every served
 * file is a build output committed next to index.html. src/index/split.json
 * is the switch:
 *
 *   { "enabled": false }  index.html is the plain concatenation of the
 *                         fragments, exactly as before this file existed. No
 *                         other file is written. This is the default, and
 *                         turning the switch back off is the way back.
 *   { "enabled": true }   index.html keeps every byte outside the main
 *                         script, but the main script's body is replaced by a
 *                         small loader, and the code is served from js/:
 *                           js/sv-full-<hash>.js  the whole main script, the
 *                             same bytes that were inline, as one file;
 *                           js/sv-NN-<area>-<hash>.js  the same code cut into
 *                             runs of consecutive fragments of one area
 *                             (src/index/areas.txt), in page order.
 *
 * The loader picks, while the page is still being read:
 *   - "full" for the onboarding and intake forms, the SMM weekly report and
 *     signed-out visitors. These public entries get it even in a browser that
 *     also holds a staff sign-in; the address is read through svRoute, so clean
 *     paths (/intake, /onboarding/<id>) count. They run the same single script
 *     as before the split.
 *   - "parts" for signed-in staff on any other address, and (plan step 5) for
 *     client share links (?c= / ?t=) when split.json says "clients": true: the
 *     runs, in the same order, each as its own <script>, except the areas
 *     split.json lists as "lazy": those are left out and fetched the first time
 *     their tab asks (040's svArea). Staff also get them quietly once the first
 *     screen is up; a client link never does (it has no such tabs). A lazy area
 *     made of several runs (core between them) is one file.
 * The loader also honours a per-browser opt-out, ?split=0 (sticky; ?split=1
 * clears it), which sends that browser the whole script as one file. It works on
 * a client link too. Ways back: "enabled": false (everyone), "clients": false
 * (client links only), ?split=0 (one browser).
 * Both are parser-blocking scripts written at the exact place the inline
 * script stood, so they run at the same moment relative to the page's
 * markup as the inline script did.
 *
 * File names carry a hash of their contents, so a page kept in a browser's
 * cache only ever asks for the files it was built with. The build never
 * deletes older js/ files (a tab left open may still need them); a pruning
 * script for the ones no recent index.html names comes with the switch-on
 * step (plan step 4), since nothing is written while the switch is off.
 *
 * Every js/ file ends by recording its name in self.__svParts; the loader
 * checks that every file it asked for ran, and if one did not (a failed
 * download), reloads the page once.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { servedBytes } = require('./index-modules');
const { minifyScript } = require('./index-minify');

const CONFIG_FILE = 'split.json';
const AREAS_FILE = 'areas.txt';
const JS_DIR = 'js';
const OPEN = Buffer.from('<script>\n');
const CLOSE = Buffer.from('</script>');

function readSplitConfig(srcDir) {
  const file = path.join(srcDir, CONFIG_FILE);
  if (!fs.existsSync(file)) return { enabled: false };
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (typeof cfg.enabled !== 'boolean') throw new Error(`${CONFIG_FILE}: "enabled" must be true or false`);
  if (cfg.lazy !== undefined && (!Array.isArray(cfg.lazy) || cfg.lazy.some(a => typeof a !== 'string'))) throw new Error(`${CONFIG_FILE}: "lazy" must be a list of area names`);
  if (cfg.clients !== undefined && typeof cfg.clients !== 'boolean') throw new Error(`${CONFIG_FILE}: "clients" must be true or false`);
  if (cfg.minify !== undefined && typeof cfg.minify !== 'boolean') throw new Error(`${CONFIG_FILE}: "minify" must be true or false`);
  return cfg;
}

function readAreas(srcDir) {
  const areas = new Map();
  for (const line of fs.readFileSync(path.join(srcDir, AREAS_FILE), 'utf8').split(/\r?\n/)) {
    const [frag, area] = line.replace(/#.*/, '').trim().split(/\s+/);
    if (frag && area) areas.set(frag, area.replace(/!$/, ''));
  }
  return areas;
}

const hash = buf => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

/*
 * Returns Map(relative path -> Buffer) of every served file this build
 * writes. `force` ('split' | 'parts') builds the split version whatever
 * split.json says; 'parts' also sends everyone, clients included, the parts
 * (used only by the split-preview CI job, never committed).
 */
function buildOutputs(srcDir, entries, bufs, modules, force) {
  const served = entries.map((e, i) => servedBytes(e, bufs[i], modules));
  const cfg = readSplitConfig(srcDir);
  if (!cfg.enabled && !force) return new Map([['index.html', Buffer.concat(served)]]);

  // The main script is the contiguous run of .js.part fragments, opened by
  // the fragment before it and closed by the one after it.
  const first = entries.findIndex(e => e.endsWith('.js.part'));
  let last = first;
  while (last + 1 < entries.length && entries[last + 1].endsWith('.js.part')) last++;
  if (first < 1 || entries.slice(last + 1).some(e => e.endsWith('.js.part'))) {
    throw new Error('index-split: the .js.part fragments must be one contiguous run');
  }
  const before = served[first - 1];
  const after = served[last + 1];
  if (!before.subarray(before.length - OPEN.length).equals(OPEN) || !after.subarray(0, CLOSE.length).equals(CLOSE)) {
    throw new Error('index-split: the main script must open at the end of the fragment before it and close at the start of the one after it');
  }

  const areas = readAreas(srcDir);
  const out = new Map();
  const marker = name => Buffer.from(`\n;(self.__svParts || (self.__svParts = [])).push(${JSON.stringify(name)});\n`);
  // "minify": true shrinks the parts and the on-demand files, never sv-full
  // (the readable whole script: forms, ?split=0, and the way back).
  const file = (stem, body, minify) => {
    if (minify && cfg.minify === true) body = minifyScript(body);
    const name = `${JS_DIR}/${stem}-${hash(body)}.js`;
    out.set(name, Buffer.concat([body, marker(name)]));
    return name;
  };
  const full = file('sv-full', Buffer.concat(served.slice(first, last + 1)), false);
  const lazyAreas = new Set(cfg.lazy || []);
  const parts = [];
  const lazy = {};
  // An on-demand area may be several runs with core between them (Workload's
  // shared pieces were cut out into core in place). Its runs become ONE file,
  // in page order: it only ever runs after every core part has, so nothing
  // the runs need from the core between them is missing.
  const lazyRuns = new Map();   // area -> { n, bufs }
  let n = 0;
  for (let i = first; i <= last;) {
    const area = areas.get(entries[i]);
    if (!area) throw new Error(`index-split: ${AREAS_FILE} does not list ${entries[i]}`);
    let j = i;
    while (j + 1 <= last && areas.get(entries[j + 1]) === area) j++;
    const body = Buffer.concat(served.slice(i, j + 1));
    if (lazyAreas.has(area)) {
      if (!lazyRuns.has(area)) lazyRuns.set(area, { n: ++n, bufs: [] });
      lazyRuns.get(area).bufs.push(body);
    } else {
      parts.push(file(`sv-${String(++n).padStart(2, '0')}-${area}`, body, true));
    }
    i = j + 1;
  }
  for (const [area, run] of lazyRuns) {
    lazy[area] = file(`sv-${String(run.n).padStart(2, '0')}-${area}`, Buffer.concat(run.bufs), true);
  }
  for (const a of lazyAreas) {
    if (a === 'core') throw new Error('index-split: core can never be lazy');
    if (!lazy[a]) throw new Error(`index-split: ${CONFIG_FILE} lists lazy area "${a}", which has no fragments`);
  }

  const loader = Buffer.from(loaderSource({ full, parts, lazy, clients: cfg.clients === true, force: force === 'parts' ? 'parts' : null }));
  out.set('index.html', Buffer.concat([...served.slice(0, first), loader, ...served.slice(last + 1)]));
  return out;
}

function loaderSource({ full, parts, lazy, clients, force }) {
  return `    /* SyncView loader. Generated by scripts/index-split.js from src/index/split.json;
       plan: docs/plans/2026-09-28-load-per-tab-plan.md. Signed-in staff and client
       share links get the code in parts; everyone else (forms, signed-out visitors)
       gets the whole script as one file. Must never throw. */
    (function () {
        var FULL = ${JSON.stringify(full)};
        var PARTS = ${JSON.stringify(parts)};
        var LAZY = ${JSON.stringify(lazy)};
        var FORCE = ${JSON.stringify(force)};
        var CLIENTS = ${JSON.stringify(clients)};
        var isClient = false;
        function useParts() {
            if (FORCE) { try { var f = new URLSearchParams(self.svRoute ? self.svRoute.search() : location.search); isClient = f.has('c') || f.has('t'); } catch (e) {} return FORCE === 'parts'; }
            try {
                // Read the address the way the app does: svRoute (003, which ran
                // first) turns clean paths such as /intake or /onboarding/<id>
                // back into their query and hash form. The forms and the weekly
                // report, which never meet the staff gate or a client link, get
                // the full file even in a browser that also holds a staff sign-in.
                var r = self.svRoute;
                var q = new URLSearchParams(r ? r.search() : location.search);
                var h = String(r ? r.hash() : location.hash).replace(/^#/, '').split(/[/?]/)[0];
                if (q.has('onboarding') || q.has('onboarding_view') || q.get('intake') === '1') return false;
                if (h === 'smm-weekly-report' || h === 'smm-weekly-reports') return false;
                isClient = q.has('c') || q.has('t');
                // A per-browser way back, no deploy needed: ?split=0 sticks (this
                // browser gets the whole script as one file), ?split=1 clears it.
                // It works on a client link too.
                // Exactly one split key counts: a repeated one is left alone (the client
                // link check refuses it), so nothing here can turn a refused link into a valid one.
                var splits = q.getAll('split');
                var sp = splits.length === 1 ? splits[0] : null;
                if (sp === '0') localStorage.setItem('syncview_split_off', '1');
                else if (sp === '1') localStorage.removeItem('syncview_split_off');
                // The client link check refuses keys it does not know, so once the
                // choice is read, take ?split=0|1 out of a client link's address
                // (only those two values, nothing else in the address is touched).
                if (isClient && (sp === '0' || sp === '1')) {
                    try {
                        var kept = location.search.replace(/[?&]split=[01](?=&|$)/, '').replace(/^&/, '?');
                        history.replaceState(history.state, '', location.pathname + kept + location.hash);
                    } catch (e) {}
                }
                if (localStorage.getItem('syncview_split_off') === '1') return false;
                // A client share link gets the parts only when split.json says
                // "clients": true (the way back for clients alone is to set it false).
                if (isClient) return CLIENTS;
                return !!localStorage.getItem('syncview_staff_identity_v1');
            } catch (e) { return false; }
        }
        var list = useParts() ? PARTS : [FULL];
        self.__svLoad = { mode: list === PARTS ? 'parts' : 'full', files: list, lazy: list === PARTS ? LAZY : {}, client: list === PARTS && isClient };
        for (var i = 0; i < list.length; i++) document.write('<script src="/' + list[i] + '"><\\/script>');
        document.write('<script>(' + function () {
            try {
                var want = self.__svLoad.files, ran = self.__svParts || [], key = 'syncview_split_reload';
                for (var i = 0; i < want.length; i++) {
                    if (ran.indexOf(want[i]) === -1) {
                        if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, '1'); location.reload(); }
                        return;
                    }
                }
                sessionStorage.removeItem(key);
            } catch (e) {}
        } + ')();<\\/script>');
    })();
`;
}

module.exports = { CONFIG_FILE, JS_DIR, readSplitConfig, buildOutputs };
