'use strict';
require('./helpers/single-file-index');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const {isStaffPhoneFile}=require('../scripts/staff-phone-changed');
for(const file of ['src/index/020-styles-surfaces.css.part','qa/staff-phone-design-browser.js','docs/syncview-design/staff-phone-rules.css','docs/syncview-design/tests/staff-calendar-expanded-browser.js','index.html'])assert(isStaffPhoneFile(file),'phone change skipped: '+file);
for(const file of ['docs/ops/OPEN_REPAIRS.md','docs/audits/report.md','supabase/functions/example/index.ts','src/indexer.js'])assert(!isStaffPhoneFile(file),'unrelated change runs phone matrix: '+file);
const workflow=fs.readFileSync(path.join(root,'.github/workflows/calendar-unit-tests.yml'),'utf8');
assert(workflow.includes('needs: staff-phone-files')&&workflow.includes("if: needs.staff-phone-files.outputs.changed == 'true'"),'phone job missing file gate');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const marker=/\/\* STAFF-PHONE-RULES:BEGIN[\s\S]*?\/\* STAFF-PHONE-RULES:END \*\//g;
for(const [artifact,target] of [['docs/syncview-design/staff-phone-rules.css','src/index/020-styles-surfaces.css.part'],['docs/syncview-design/staff-phone-rules.js','src/index/099-staff-phone-bar.js.part']]) {
  const expected=read(artifact).trim();
  assert.deepEqual(read(target).match(marker),[expected],artifact+': transplant drift');
  assert(read('index.html').includes(expected),'assembled app dropped the artifact');
}
const css=read('docs/syncview-design/staff-phone-rules.css').replace(/\/\*[\s\S]*?\*\//g,'').trim();
assert(css.startsWith('@media (max-width: 767px) {') && css.endsWith('}'),'phone cap missing');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
assert(rules.length>10,'no phone rules');
for(const [,selectors] of rules)for(const selector of selectors.split(','))assert(selector.trim().startsWith('html.sv-staff-phone ' )||selector.trim().startsWith('html.sv-staff-phone.'),'unscoped phone selector '+selector);
console.log('staff-phone-rules-source: artifact CSS/JS transplanted byte-identically; '+rules.length+' rules phone-capped and staff-scoped');
