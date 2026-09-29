'use strict';
/* split-switch.js -- the split's way back and its housekeeping (plan step 4):
 * scripts/split-switch.js writes split.json in exactly the committed shape,
 * scripts/prune-split-js.js only ever lists files no recent index.html names,
 * and the loader carries the per-browser opt-out. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { render, read } = require('../scripts/split-switch');
const { namedIn, prunable } = require('../scripts/prune-split-js');

const ROOT = path.join(__dirname, '..');
let checks = 0;
const ok = (c, m) => { assert(c, m); checks++; };

// 1. split.json is written in exactly the shape it is committed in, both ways.
const cfg = read();
const onDisk = fs.readFileSync(path.join(ROOT, 'src', 'index', 'split.json'), 'utf8');
ok(render(cfg, cfg.enabled) === onDisk, 'render() reproduces the committed split.json byte for byte');
ok(JSON.parse(render(cfg, false)).enabled === false && JSON.parse(render(cfg, true)).enabled === true, 'off and on flip only "enabled"');
ok(JSON.stringify(JSON.parse(render(cfg, false)).lazy) === JSON.stringify(cfg.lazy), 'the on-demand list survives a switch off and on');
ok(render({ enabled: true }, false) === '{\n  "enabled": false\n}\n', 'a config with no on-demand list renders without one');
// Step 5: "clients" is its own switch, and neither switch disturbs the other.
ok(cfg.clients === true, 'split.json has clients on (client share links get the parts)');
ok(JSON.parse(render(cfg, false)).clients === true, 'switching the split off leaves the clients setting as it was');
ok(JSON.parse(render(cfg, true, false)).clients === false && JSON.parse(render(cfg, true, false)).enabled === true, 'clients off flips only "clients"');
ok(JSON.stringify(JSON.parse(render(cfg, true, false)).lazy) === JSON.stringify(cfg.lazy), 'the on-demand list survives clients off');
ok(render({ enabled: true, lazy: ['a'] }, true) === '{\n  "enabled": true,\n  "lazy": ["a"]\n}\n', 'a config without "clients" renders without one');

// 2. The prune lists only files no recent index.html names.
const page = '<script>var P=["js/sv-01-core-0123456789ab.js","js/sv-02-templates-abcdef012345.js"];var L={"kasper":"js/sv-16-kasper-aaaaaaaaaaaa.js"}</script>';
const named = namedIn(page);
ok(named.size === 3 && named.has('js/sv-16-kasper-aaaaaaaaaaaa.js'), 'namedIn finds every js file a page names');
const keep = new Set([...named, 'js/sv-full-111111111111.js']);
ok(JSON.stringify(prunable(['sv-01-core-0123456789ab.js', 'sv-01-core-ffffffffffff.js', 'sv-full-111111111111.js'], keep)) === JSON.stringify(['sv-01-core-ffffffffffff.js']), 'only the file no page names is listed');
ok(prunable([], keep).length === 0, 'nothing to prune in an empty folder');

// 3. Every js file the committed index.html names exists, so a deploy cannot ship a loader that 404s.
if (cfg.enabled) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const missing = [...namedIn(html)].filter(f => !fs.existsSync(path.join(ROOT, f)));
  ok(missing.length === 0, 'every js file index.html names is committed' + (missing.length ? ': ' + missing.join(', ') : ''));
}

// 4. The loader honours the per-browser opt-out and its way to clear it.
const loader = fs.readFileSync(path.join(ROOT, 'scripts', 'index-split.js'), 'utf8');
ok(/syncview_split_off/.test(loader) && /sp === '0'/.test(loader) && /sp === '1'/.test(loader), 'the loader carries the sticky ?split=0 / ?split=1 opt-out');

console.log(`split-switch: ${checks} checks passed`);
