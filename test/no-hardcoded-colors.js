'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'index.html');
const source = fs.readFileSync(file, 'utf8');
const lines = source.split(/\r?\n/);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const COLOR_FN = /\b(?:rgb|rgba|hsl|hsla)\(\s*(?:[-+]?\d|#[0-9a-fA-F])/gi;
const REGION_START = /no-hardcoded-colors:\s*allow-start\b/i;
const REGION_END = /no-hardcoded-colors:\s*allow-end\b/i;

const ALLOWLIST = [
  {
    label: 'CSS custom-property definition blocks',
    test: line => /^\s*--[a-z0-9_-]+\s*:/i.test(line),
  },
  {
    label: 'production preview locked dual-theme UI',
    test: line => /--prod-|\bprod-[a-z0-9-]+/i.test(line),
  },
  {
    label: 'color validation regexes',
    test: line => /#\[0-9a-fA-F\]|replace\(\s*\/\^#\//.test(line),
  },
  {
    label: 'computed color values from variables',
    test: line => /\b(?:rgb|rgba|hsl|hsla)\(\s*(?:var\(|\$\{)/i.test(line),
  },
];

function allowed(line, inAllowedRegion) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return true;
  if (inAllowedRegion) return true;
  return ALLOWLIST.some(entry => entry.test(line));
}

const violations = [];
let inAllowedRegion = false;
let allowedRegionStart = 0;
lines.forEach((line, idx) => {
  if (REGION_START.test(line)) {
    if (inAllowedRegion) {
      violations.push({
        line: idx + 1,
        hits: ['region'],
        text: 'Nested no-hardcoded-colors allow-start marker.',
      });
    }
    inAllowedRegion = true;
    allowedRegionStart = idx + 1;
    return;
  }
  if (REGION_END.test(line)) {
    if (!inAllowedRegion) {
      violations.push({
        line: idx + 1,
        hits: ['region'],
        text: 'no-hardcoded-colors allow-end marker without a matching allow-start.',
      });
    }
    inAllowedRegion = false;
    allowedRegionStart = 0;
    return;
  }
  if (allowed(line, inAllowedRegion)) return;
  const hits = [];
  for (const match of line.matchAll(HEX)) hits.push(match[0]);
  for (const match of line.matchAll(COLOR_FN)) hits.push(match[0]);
  if (hits.length) {
    violations.push({
      line: idx + 1,
      hits: Array.from(new Set(hits)),
      text: line.trim().slice(0, 180),
    });
  }
});

if (inAllowedRegion) {
  violations.push({
    line: allowedRegionStart,
    hits: ['region'],
    text: 'Unclosed no-hardcoded-colors allow-start marker.',
  });
}

if (violations.length) {
  console.error('Hardcoded color literals must use CSS variables outside variable-definition blocks.');
  for (const v of violations.slice(0, 80)) {
    console.error(`index.html:${v.line}: ${v.hits.join(', ')} :: ${v.text}`);
  }
  if (violations.length > 80) {
    console.error(`...and ${violations.length - 80} more violation(s).`);
  }
  process.exit(1);
}

console.log('No hardcoded color literals outside allowed variable/validation blocks.');
