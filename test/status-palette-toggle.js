'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function ok(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

function blockFor(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\s*\\}', 'm');
  const match = source.match(re);
  ok(match, `Missing CSS block for ${selector}`);
  return match[1];
}

ok(source.includes("const SYNCVIEW_STATUS_PALETTE_KEY = 'syncview_status_palette';"), 'Missing status palette storage key.');
ok(source.includes('id="statusPaletteToggle"'), 'Missing status palette header button.');
ok(source.includes('function toggleSyncViewStatusPalette()'), 'Missing status palette toggle function.');
ok(source.includes("de.setAttribute('data-status-palette', 'classic');"), 'Missing pre-paint classic palette application.');

const classic = blockFor('html[data-status-palette="classic"]');
ok(classic.includes('--cal-status-for-smm-approval-bg: var(--sv-bg-fce7f3);'), 'Classic SMM approval color should match the original light palette.');
ok(classic.includes('--cal-status-kasper-approval-bg: var(--sv-bg-ffe4cc);'), 'Classic Kasper approval color should match the original light palette.');
ok(classic.includes('--cal-status-client-approval-bg: var(--sv-bg-fee2e2);'), 'Classic client approval color should match the original light palette.');
ok(classic.includes('--cal-urgent-bg: var(--sv-bg-dc2626);'), 'Classic urgent color should match the original urgent button.');
ok(classic.includes('--wl-status-fg: var(--sv-fg-fff);'), 'Classic workload badges should keep the original white text.');

const classicDark = blockFor('html[data-theme="dark"][data-status-palette="classic"]');
ok(classicDark.includes('--cal-status-for-smm-approval-bg: #4b1730;'), 'Classic dark SMM approval color should match the original dark palette.');
ok(classicDark.includes('--cal-status-kasper-approval-bg: #4a2413;'), 'Classic dark Kasper approval color should match the original dark palette.');
ok(classicDark.includes('--cal-status-client-approval-bg: #4b1717;'), 'Classic dark client approval color should match the original dark palette.');
ok(classicDark.includes('--cal-status-posted-bg: #0f3f2a; --cal-status-posted-fg: #6ee7b7;'), 'Classic dark posted color should match the original dark palette.');

console.log('Status palette toggle wiring is present.');
