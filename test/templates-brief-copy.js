'use strict';
// The Templates page "Copy" button: the whole editor brief plus Audience as plain text.
// Runs the real _tplBriefPlainText from the page source (src/index fragment) on fictional data.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.join(__dirname, '../src/index/060-templates-filming.js.part'), 'utf8');
const m = /\/\/ TPL_BRIEF_PLAIN_TEXT_START([\s\S]*?)\/\/ TPL_BRIEF_PLAIN_TEXT_END/.exec(INDEX);
assert.ok(m, 'copy-text function is in the page source');
const plain = new Function(m[1] + '\nreturn _tplBriefPlainText;')();

const bullets = Array.from({ length: 40 }, (_, i) => ({
  text: `**Label ${i}:** line number ${i} <!-- fact: client.fixture.editing.f${i} --> with <b>tag</b>`,
  facts: [`client.fixture.editing.f${i}`],
}));
const brief = [
  { heading: 'Look and feel', bullets: bullets.slice(0, 20) },
  { heading: 'Avoid', bullets: bullets.slice(20) },
];
const audience = [
  { heading: 'Who is watching', id: 'client.fixture.audience.who', body: 'Busy parents.\n\n- **Short on time.** Most say so.', sure: 'medium. Their own words.' },
];
const text = plain('Fixture Client', brief, audience);

assert.ok(text.includes('## Look and feel') && text.includes('## Avoid'), 'brief headings kept');
for (let i = 0; i < 40; i++) assert.ok(text.includes(`- Label ${i}: line number ${i} with tag`), `bullet ${i} present and clean`);
assert.strictEqual((text.match(/^- Label /gm) || []).length, 40, 'a 40-bullet brief is copied whole');
assert.ok(!/<!--|-->/.test(text), 'no comments');
assert.ok(!/client\.fixture/.test(text), 'no fact ids');
assert.ok(!/<[a-z\/][^>]*>/i.test(text), 'no HTML');
assert.ok(!text.includes('**'), 'no markdown bold markers');
assert.ok(text.includes('# Audience') && text.includes('## Who is watching') && text.includes('- Short on time. Most say so.'), 'audience included');
assert.ok(text.includes('How sure we are: medium. Their own words.'), 'audience sure line included');
assert.ok(text.indexOf('# Audience') > text.indexOf('## Avoid'), 'audience comes after the brief');
assert.ok(!plain('Fixture Client', brief, []).includes('Audience'), 'no audience heading when there is none');

// Wiring: a visible confirmation, and a plain message when copying is blocked.
assert.ok(INDEX.includes("say('Copied')"), 'shows Copied');
assert.ok(INDEX.includes('Your browser blocked copying'), 'says so when the browser blocks copying');
assert.ok(INDEX.includes('onclick="tplBriefCopyAll(this)"'), 'Copy button wired');
assert.ok(INDEX.includes('${_tplAudienceView(name, b)}'), 'Audience section rendered');
assert.ok(INDEX.includes('Where does this come from') && INDEX.includes('Send a change'), 'audience source and change buttons');
console.log('templates-brief-copy checks passed');
