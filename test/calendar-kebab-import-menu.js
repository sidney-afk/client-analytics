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

const menuStart = source.indexOf('<div class="cal-kebab-menu" id="calKebabMenu" hidden>');
ok(menuStart >= 0, 'Calendar kebab menu markup is missing.');

const menuEnd = source.indexOf('</div>\n                </div>`', menuStart);
ok(menuEnd > menuStart, 'Calendar kebab menu template end could not be found.');

const menu = source.slice(menuStart, menuEnd);
const titleReviewIndex = menu.indexOf('YouTube title review');
const importToggleIndex = menu.indexOf('id="calImportToggle"');
const importPanelIndex = menu.indexOf('id="calImportPanel"');

ok(titleReviewIndex >= 0, 'Calendar kebab menu is missing YouTube title review.');
ok(importToggleIndex > titleReviewIndex, 'Import toggle must sit after YouTube title review.');
ok(importPanelIndex > importToggleIndex, 'Import actions must live below the Import toggle.');
ok(menu.includes('<span class="cal-kebab-label">Import</span>'), 'Import toggle should be labeled Import.');
ok(menu.includes('onclick="_calToggleImportActions(event)"'), 'Import toggle should expand in place.');

for (const label of ['Import from Excel', 'Import from Linear', 'Bulk Linear sync']) {
  const labelIndex = menu.indexOf(label);
  ok(labelIndex > importPanelIndex, `${label} should be inside the collapsed Import panel.`);
}

ok(!menu.slice(0, importToggleIndex).includes('Import from Excel'), 'Import from Excel should not be a top-level item.');
ok(!menu.slice(0, importToggleIndex).includes('Import from Linear'), 'Import from Linear should not be a top-level item.');
ok(!menu.slice(0, importToggleIndex).includes('Bulk Linear sync'), 'Bulk Linear sync should not be a top-level item.');

ok(source.includes('.cal-kebab-import-panel { display: none;'), 'Import panel should be collapsed by default.');
ok(source.includes('.cal-kebab-import-panel.is-open { display: block;'), 'Import panel should have an expanded state.');
ok(source.includes('function _calToggleImportActions(e)'), 'Import toggle handler is missing.');
ok(source.includes('_calSetImportActionsOpen(false);'), 'Closing the kebab should collapse the Import group.');

console.log('Calendar kebab import menu wiring is present.');
