'use strict';
// The team handbook options of client_brain and brain_change: page names,
// the reply wording, the open-versus-Sidney rule, and that the code reads and
// files only company/handbook-*.md. Fictional text only; no network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

(async () => {
  const h = await import(path.join(ROOT, 'supabase/functions/higgsfield-mcp/handbook.mjs'));

  for (const [input, want] of [
    ['team', 'team'], ['Handbook Team', 'team'], ['handbook-team.md', 'team'], ['company/handbook-team.md', 'team'],
    ['start', 'start'], ['', 'start'], ['list', 'start'], ['true', 'start'], ['  Videographers ', 'videographers'],
    ['../clients/x/money', ''], ['team/../../x', ''], ['a b/c', ''],
  ]) assert.strictEqual(h.handbookPageName(input), want, `page name for ${JSON.stringify(input)}`);
  assert.strictEqual(h.handbookPath('team'), 'company/handbook-team.md');
  assert.deepStrictEqual(h.handbookPagesIn(['people.md', 'handbook-work.md', 'handbook-start.md', 'handbook-x.txt', 'handbook-.md']), ['start', 'work']);

  const page = '# Team\n\n## Hours\n<!-- brain\nid: company.x\nstatus: written\n-->\nNine to five.\n';
  const cleaned = h.cleanPage(page);
  assert.ok(!cleaned.includes('<!--') && cleaned.includes('Nine to five.'), 'brain blocks are stripped, text kept');

  const reply = h.handbookReply('team', page, ['start', 'team', 'work']);
  assert.ok(reply.includes('Nine to five.') && /Other pages[^\n]*start, work/.test(reply), 'page text and the other pages');
  assert.ok(/index/.test(h.handbookReply('start', 'x', ['start', 'team'])), 'the index says how to reach a page');
  const big = h.handbookReply('team', 'word '.repeat(20000), ['team']);
  assert.ok(/left out/.test(big) && big.length < h.HANDBOOK_MAX_CHARS + 600, 'a long page names what was left out, never a bare cut');

  assert.ok(h.handbookChangeText('videographers', ' new number ').includes('Anyone may change this page') && h.handbookChangeText('videographers', 'x').endsWith('\n\nx'), 'videographers: apply');
  const other = h.handbookChangeText('team', 'x');
  assert.ok(/do not apply it until he says yes/.test(other), 'other pages: a suggestion that waits for Sidney');
  assert.ok(/Sidney has to say yes/.test(h.handbookChangeReply('team', true)) && !/Saved/.test(h.handbookChangeReply('team', true).replace('instead of "Saved"', '')), 'other pages: reply is a suggestion');
  assert.ok(/filed in the handbook page "videographers"/.test(h.handbookChangeReply('videographers', true)), 'videographers: filed');

  // Wiring.
  const info = read('supabase/functions/higgsfield-mcp/clientinfo.ts');
  const hb = info.slice(info.indexOf('export async function handbookRead'));
  assert.ok(!/clients\//.test(hb.replace(/folders: \[folder\]/, '')) && !/inputs\/handbook/.test(hb), 'handbook code touches company/handbook pages only');
  assert.ok(/handbookPageName\(page\)/.test(hb) && (hb.match(/handbookPageName\(page\)/g) || []).length === 2, 'both calls validate the page name');
  assert.ok(/pages\.includes\(name\)/.test(hb) && (hb.match(/pages\.includes\(name\)/g) || []).length === 2, 'both calls check the page exists');
  const idx = read('supabase/functions/higgsfield-mcp/index.ts');
  const bc = idx.slice(idx.indexOf('name: "client_brain"'), idx.indexOf('name: "import_file"'));
  assert.ok(/handbook: \{ type: "string"/.test(bc) && /handbook_page: \{ type: "string"/.test(bc), 'both tools offer the handbook option');
  assert.ok(!/required: \["client"/.test(bc), 'client is no longer required on either tool');
  assert.ok(/name === "client_brain" && String\(args\.handbook/.test(idx) && /handbookRead\(String\(args\.handbook\)\)/.test(idx), 'client_brain dispatches the handbook option');
  assert.ok(/name === "brain_change" && String\(args\.handbook_page/.test(idx) && /handbookChange\(/.test(idx), 'brain_change dispatches the handbook option');
  const guide = read('docs/ops/HANDBOOK_GUIDE_ROW.md');
  assert.ok(/'handbook'/.test(guide) && /needs Sidney|Sidney's to decide/.test(guide), 'guide row text exists');

  console.log('higgsfield-handbook: page names safe, reads and filings stay on company/handbook pages, videographers open, others wait for Sidney ✅');
})().catch((e) => { console.error(e); process.exit(1); });
