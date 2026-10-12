'use strict';
/*
 * Dark-mode contrast gate (WCAG 2.x AA).
 *
 * Reads the built index.html, resolves the colour tokens exactly as the browser
 * does for <html data-theme="dark">, and fails when a text or icon colour falls
 * under AA against the background it is declared with:
 *   4.5 : 1 for normal text,  3 : 1 for icons, focus rings and large text.
 *
 * Two layers, so a regression cannot slip in through either door:
 *   1. NAMED PAIRS  - the colour pairs the product is built on (page text on every
 *      surface, status pills in both palettes, the Approve / warning / error
 *      buttons and their hover and disabled states, success / warning / error ink).
 *   2. RULE SCAN    - every CSS rule that sets both `color` and `background` from
 *      tokens, in the dark theme. A rule below AA fails unless it is listed in
 *      KNOWN_RULE_GAPS (a list that may only shrink; see the note by it).
 *
 * Disabled controls are held to the same bar on purpose: WCAG exempts them, but a
 * disabled button the team cannot read is a defect here.
 *
 * Run: node test/dark-contrast.js            (add --report for every number)
 */
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const REPORT = process.argv.includes('--report');

// ---------- CSS extraction ----------
const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
const css = styleBlocks.join('\n').replace(/\/\*[\s\S]*?\*\//g, '');

function parseRules(text) {
  // Flat list of { selector, body, at } ; @media/@supports/@layer nest, others skipped.
  const rules = [];
  let i = 0;
  function block(at) {
    while (i < text.length) {
      const open = text.indexOf('{', i);
      const close = text.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = text.length; return; }
      const head = text.slice(i, open).trim();
      i = open + 1;
      if (head.startsWith('@media') || head.startsWith('@supports') || head.startsWith('@layer') || head.startsWith('@container')) {
        block(at + ' ' + head);
      } else if (head.startsWith('@')) {
        // @keyframes, @font-face ... skip the whole body
        let depth = 1;
        while (i < text.length && depth) { const c = text[i++]; if (c === '{') depth++; else if (c === '}') depth--; }
      } else {
        const end = text.indexOf('}', i);
        rules.push({ selector: head.replace(/\s+/g, ' '), body: text.slice(i, end), at: at.trim() });
        i = end + 1;
      }
    }
  }
  block('');
  return rules;
}
const rules = parseRules(css);

function decls(body) {
  const out = [];
  for (const part of body.split(/;(?![^(]*\))/)) {
    const k = part.indexOf(':');
    if (k < 0) continue;
    out.push([part.slice(0, k).trim().toLowerCase(), part.slice(k + 1).trim()]);
  }
  return out;
}

// ---------- tokens ----------
const isDarkBlock = sel => /^html\[data-theme="dark"\](\s*,\s*html\[data-theme="dark"\])*$/.test(sel);
const isClassicDark = sel => sel === 'html[data-theme="dark"][data-status-palette="classic"]';
const isRootBlock = sel => sel === ':root';
const isClassicLight = sel => sel === 'html[data-status-palette="classic"]';
function tokenMap(theme, palette) {
  const map = {};
  const apply = r => { for (const [k, v] of decls(r.body)) if (k.startsWith('--')) map[k] = v; };
  for (const r of rules) if (isRootBlock(r.selector) && !r.at) apply(r);
  if (palette === 'classic') for (const r of rules) if (isClassicLight(r.selector) && !r.at) apply(r);
  if (theme === 'dark') {
    for (const r of rules) if (isDarkBlock(r.selector) && !r.at) apply(r);
    if (palette === 'classic') for (const r of rules) if (isClassicDark(r.selector) && !r.at) apply(r);
  }
  return map;
}

// ---------- colours ----------
function parseHex(h) {
  h = h.replace('#', '');
  if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}
const NAMED = { white: '#ffffff', black: '#000000' };
function resolve(value, tokens, depth = 0) {
  if (value == null || depth > 12) return null;
  value = value.trim().replace(/\s*!important$/, '');
  const v = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (v) {
    if (tokens[v[1]] !== undefined) return resolve(tokens[v[1]], tokens, depth + 1);
    return v[2] ? resolve(v[2], tokens, depth + 1) : null;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return parseHex(value);
  const f = value.match(/^rgba?\(\s*([^)]+)\)$/i);
  if (f) {
    const p = f[1].split(/[\s,/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const num = (x, scale) => x.endsWith('%') ? parseFloat(x) * scale / 100 : parseFloat(x);
    const nums = [num(p[0], 255), num(p[1], 255), num(p[2], 255)];
    const resolved = p.slice(0, 3).map((x, n) => /^var\(/.test(x) ? NaN : nums[n]);
    if (resolved.some(Number.isNaN)) return null;
    return { r: nums[0], g: nums[1], b: nums[2], a: p[3] != null ? num(p[3], 1) : 1 };
  }
  if (NAMED[value.toLowerCase()]) return parseHex(NAMED[value.toLowerCase()]);
  return null;
}
const over = (top, bottom) => {
  const a = top.a + bottom.a * (1 - top.a);
  return { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a };
};
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const hex = c => '#' + [c.r, c.g, c.b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');

let failures = 0, checks = 0;
const lines = [];
function check(label, fg, bg, min, tokens, base) {
  const f = typeof fg === 'string' ? resolve(fg.startsWith('--') ? `var(${fg})` : fg, tokens) : fg;
  let b = typeof bg === 'string' ? resolve(bg.startsWith('--') ? `var(${bg})` : bg, tokens) : bg;
  if (!f || !b) { failures++; lines.push(`FAIL ${label}: cannot resolve ${!f ? fg : bg}`); return; }
  if (b.a < 1) b = over(b, base);
  const fe = f.a < 1 ? over(f, b) : f;
  const ratio = contrast(fe, b);
  checks++;
  const ok = ratio + 1e-9 >= min;
  if (!ok) failures++;
  if (!ok || REPORT) lines.push(`${ok ? 'ok  ' : 'FAIL'} ${ratio.toFixed(2)} (need ${min}) ${label}  ${hex(fe)} on ${hex(b)}`);
}

// ---------- 1. named pairs ----------
const dark = tokenMap('dark', 'vibrant');
const darkClassic = tokenMap('dark', 'classic');
const pageBase = resolve('var(--white)', dark);
const SURFACES = ['--bg', '--white', '--surface-raised', '--surface-hover', '--surface-subtle', '--field-bg', '--field-bg-hover', '--field-bg-focus'];
for (const s of SURFACES) {
  check(`text-primary on ${s}`, '--text-primary', s, 4.5, dark, pageBase);
  check(`text-secondary on ${s}`, '--text-secondary', s, 4.5, dark, pageBase);
  check(`text-muted on ${s}`, '--text-muted', s, 4.5, dark, pageBase);
  check(`disabled-fg on ${s}`, '--disabled-fg', s, 4.5, dark, pageBase);
  check(`focus-ring on ${s}`, '--focus-ring', s, 3, dark, pageBase);
}
for (const s of ['--field-bg', '--field-bg-hover']) check(`placeholder on ${s}`, '--field-placeholder', s, 4.5, dark, pageBase);
for (const s of ['--white', '--bg', '--surface-raised']) {
  check(`success ink --up on ${s}`, '--up', s, 4.5, dark, pageBase);
  check(`error ink --dn on ${s}`, '--dn', s, 4.5, dark, pageBase);
  for (const t of ['--sv-fg-166534', '--sv-fg-15803d', '--sv-fg-16a34a']) check(`success ink ${t} on ${s}`, t, s, 4.5, dark, pageBase);
  for (const t of ['--sv-fg-991b1b', '--sv-fg-b91c1c', '--sv-fg-dc2626']) check(`error ink ${t} on ${s}`, t, s, 4.5, dark, pageBase);
  for (const t of ['--sv-fg-854d0e', '--sv-fg-b45309', '--sv-fg-d97706']) check(`warning ink ${t} on ${s}`, t, s, 4.5, dark, pageBase);
  for (const t of ['--sv-fg-9a3412', '--sv-fg-c2410c', '--sv-fg-ea580c']) check(`orange ink ${t} on ${s}`, t, s, 4.5, dark, pageBase);
}
check('--up on --up-bg', '--up', '--up-bg', 4.5, dark, pageBase);
check('--dn on --dn-bg', '--dn', '--dn-bg', 4.5, dark, pageBase);
// Same meaning, same colour: the success green of the button, the pill and the up arrow.
if (resolve('var(--ok-solid-bg)', dark) && hex(resolve('var(--ok-solid-bg)', dark)) !== hex(resolve('var(--up)', dark))) { failures++; lines.push('FAIL success green differs: --ok-solid-bg vs --up'); }
// Solid action buttons: rest, hover, disabled.
for (const [name, fg, bgs] of [
  ['success', '--ok-solid-fg', ['--ok-solid-bg', '--ok-solid-bg-hover', '--ok-solid-deep-bg']],
  ['warning', '--warn-solid-fg', ['--warn-solid-bg', '--warn-solid-bg-hover', '--warn-solid-deep-bg', '--warn-solid-deep-bg-hover']],
  ['error', '--err-solid-fg', ['--err-solid-bg']],
]) for (const bg of bgs) check(`${name} button ${fg} on ${bg}`, fg, bg, 4.5, dark, pageBase);
check('success button disabled', '--ok-solid-off-fg', '--ok-solid-off-bg', 4.5, dark, pageBase);
{ // the "Kasper"/"Client" chip inside the Approve button
  const chip = resolve('var(--ok-solid-chip-bg)', dark), btn = resolve('var(--ok-solid-bg)', dark);
  if (chip && btn) check('Approve chip text on chip', resolve('var(--ok-solid-fg)', dark), over(chip, btn), 4.5, dark, pageBase);
}
// Status pills, both palettes.
const STATUSES = ['in-progress', 'for-smm-approval', 'kasper-approval', 'client-approval', 'approved', 'tweaks-needed', 'scheduled', 'posted', 'archived', 'n-a'];
for (const [pal, tokens] of [['vibrant', dark], ['classic', darkClassic]]) {
  for (const s of STATUSES) check(`status pill ${s} (${pal})`, `--cal-status-${s}-fg`, `--cal-status-${s}-bg`, 4.5, tokens, pageBase);
}
for (const t of ['--cal-urgent-bg', '--cal-urgent-hover-bg']) check(`urgent button on ${t}`, '--cal-urgent-fg', t, 4.5, dark, pageBase);
// Workload bands: label on its own section, chip text on its chip, hover included.
for (const band of ['progress', 'overdue', 'tweaks']) {
  check(`workload ${band} label`, `--wl-${band}-label`, `--wl-${band}-section-bg`, 4.5, dark, pageBase);
  for (const c of ['chip-bg', 'chip-hover']) check(`workload ${band} chip text on ${c}`, `--wl-${band}-chip-fg`, `--wl-${band}-${c}`, 4.5, dark, pageBase);
}
for (const k of ['look', 'edit', 'music', 'avoid', 'about', 'asks', 'know']) check(`brief ${k} ink`, `--brief-${k}-ink`, `--brief-${k}-bg`, 4.5, dark, pageBase);
for (const p of ['ig', 'tt', 'yt']) check(`platform ${p}`, `--${p}-dark`, `--${p}-light`, 4.5, dark, pageBase);

// ---------- 2. rule scan ----------
/* KNOWN_RULE_GAPS: rules that were under AA when this gate was added and are not
 * on a screen in scope yet. Each entry is "selector | color | background". The list
 * may only SHRINK: fix a rule, delete its line. A new rule under AA fails the build. */
const KNOWN_RULE_GAPS = new Set([
]);
/* IGNORED_RULES: the scan reads one rule at a time, so it cannot see a bar that flips colour
 * underneath a translucent button. Each entry says why it is safe. */
const IGNORED_RULES = new Map([
  ['.cal-bulk-cap-bar .cal-bulk-cap-cancel', 'translucent button on a bar that is light in dark mode, so the dark label is on a light surface'],
]);
const seen = new Set();
const ruleHits = [];
for (const r of rules) {
  if (r.at && /print/.test(r.at)) continue;
  if (/\[data-theme="light"\]|:not\(\[data-theme="dark"\]\)|html:not\(\[data-theme\]\)/.test(r.selector)) continue;
  if (IGNORED_RULES.has(r.selector)) continue;
  // SyncLinear ("prod-") keeps its own locked light/dark palette and pixel gates
  // (npm run test:prod-polish); it is outside this pass and is not scanned here.
  if (/\.prod-|--prod-/.test(r.selector + r.body)) continue;
  const d = Object.fromEntries(decls(r.body));
  const fgRaw = d['color'];
  const bgRaw = d['background-color'] || (d['background'] && !/gradient|url\(|image/.test(d['background']) ? d['background'] : null);
  if (!fgRaw || !bgRaw) continue;
  if (d['opacity'] && parseFloat(d['opacity']) < 1) continue;
  const f = resolve(fgRaw, dark), b = resolve(bgRaw.replace(/^([^\s]+).*$/, (m, first) => /^(var|#|rgb)/.test(first) && !/\)$/.test(first) && bgRaw.includes(' ') ? bgRaw : first), dark);
  if (!f || !b) continue;
  const bgOver = b.a < 1 ? over(b, pageBase) : b;
  const fe = f.a < 1 ? over(f, bgOver) : f;
  const ratio = contrast(fe, bgOver);
  checks++;
  const key = `${r.selector} | ${fgRaw} | ${bgRaw}`;
  if (seen.has(key)) continue;
  seen.add(key);
  if (ratio + 1e-9 < 4.5 && !KNOWN_RULE_GAPS.has(key)) ruleHits.push({ key, ratio, fg: hex(fe), bg: hex(bgOver), at: r.at });
}
for (const h of ruleHits) { failures++; lines.push(`FAIL rule ${h.ratio.toFixed(2)} ${h.key}  ${h.fg} on ${h.bg}${h.at ? '  @' + h.at : ''}`); }
for (const key of KNOWN_RULE_GAPS) if (!seen.has(key)) { failures++; lines.push(`FAIL KNOWN_RULE_GAPS entry no longer matches a rule (delete it): ${key}`); }

for (const l of lines) console.log(l);
if (failures) { console.error(`dark-contrast: ${failures} failure(s) in ${checks} checks`); process.exit(1); }
console.log(`dark-contrast: OK, ${checks} checks (named pairs + every token-coloured rule), all at AA or better in dark mode`);
