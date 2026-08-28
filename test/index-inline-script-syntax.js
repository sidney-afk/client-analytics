'use strict';

// A syntax error inside index.html's inline <script> blocks is invisible to the
// rest of this suite: nothing else here parses that JavaScript, so the whole
// unit run stays green while the page fails to boot for every user. It is
// caught today only by the Playwright boot check in CI, which needs a browser
// and about 45 seconds, and which reports it as an unrelated-looking timeout
// waiting for the Calendar to settle rather than as a parse failure.
//
// This is that check in milliseconds, with an error message that names the
// actual cause. Added after a real one shipped: an escaped quote inside an
// onclick handler string (`_kadSetCampaign(\'`) lost its backslashes, silently
// terminating the string early.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = path.join(__dirname, '..', 'index.html');

function inlineScripts(html) {
  // Inline only: anything with src= is a separate file and not ours to parse.
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const code = m[1];
    if (!code.trim()) continue;
    out.push({ code, line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

function main() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const scripts = inlineScripts(html);

  assert.ok(
    scripts.length > 0,
    'expected at least one non-empty inline <script> in index.html — if the page ' +
      'stopped using inline scripts this guard needs rewriting, not deleting'
  );

  for (let i = 0; i < scripts.length; i++) {
    const { code, line } = scripts[i];
    try {
      new vm.Script(code, { filename: 'index.html inline #' + (i + 1) });
    } catch (err) {
      assert.fail(
        'index.html inline <script> #' + (i + 1) + ' (opens near line ' + line +
          ') does not parse: ' + err.message +
          '\n  This breaks the page for every user. The Playwright boot check will' +
          '\n  report it as a Calendar settle timeout, which is a symptom, not the cause.'
      );
    }
  }

  console.log(
    'index.html inline script syntax: ' + scripts.length + ' block(s) parse cleanly'
  );
}

main();
