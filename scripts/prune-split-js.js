'use strict';
/*
 * prune-split-js.js -- list (and, with --delete, remove) the js/ files that no
 * recent index.html names. Plan step 4.
 *
 * With the split on, every code change writes new content-hashed files under
 * js/ and index.html names the current ones. Older files stay so that a browser
 * still holding an older index.html can fetch the files that page was built
 * with. This keeps every file named by index.html at HEAD or in the last N
 * commits that changed it (default 6, --keep=N) and lists the rest.
 *
 *   node scripts/prune-split-js.js            # list what would go
 *   node scripts/prune-split-js.js --delete   # remove it, then commit
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const JS = path.join(ROOT, 'js');
const NAME = /js\/sv-[a-z0-9-]+-[0-9a-f]{12}\.js/g;

const namedIn = html => new Set(String(html).match(NAME) || []);

function keepSet(keep) {
  const shas = execFileSync('git', ['-C', ROOT, 'log', `-n${keep}`, '--format=%H', '--', 'index.html'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const out = namedIn(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
  for (const sha of shas) {
    try { for (const n of namedIn(execFileSync('git', ['-C', ROOT, 'show', `${sha}:index.html`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))) out.add(n); } catch (e) {}
  }
  return out;
}

function prunable(existing, keepNames) { return existing.filter(f => !keepNames.has('js/' + f)); }

if (require.main === module) {
  const keep = Number((process.argv.find(a => a.startsWith('--keep=')) || '--keep=6').split('=')[1]) || 6;
  const existing = fs.existsSync(JS) ? fs.readdirSync(JS).filter(f => /^sv-.*\.js$/.test(f)) : [];
  const drop = prunable(existing, keepSet(keep));
  for (const f of drop) console.log((process.argv.includes('--delete') ? 'delete ' : 'would delete ') + 'js/' + f);
  if (process.argv.includes('--delete')) drop.forEach(f => fs.unlinkSync(path.join(JS, f)));
  console.log(`prune-split-js: ${existing.length} file(s) in js/, ${drop.length} ${process.argv.includes('--delete') ? 'deleted' : 'not named by the last ' + keep + ' index.html versions'}`);
}

module.exports = { namedIn, prunable };
