'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const QA = path.join(ROOT, 'qa');

function jsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.isFile() && /\.(?:c?js|mjs)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

const detectors = Object.freeze({
  shellCurl: source => /["'`]curl(?:\.exe)?\s+(?:-[A-Za-z]|https?:)/.test(source),
  protectedHeaderArg: source => /(?:-H|--header)\s+[^\r\n]{0,240}(?:authorization|apikey|x-api-key)\b/i.test(source),
  curlFileBody: source => /(?:--data-binary|-d|--data)\s+@(?:\$?\{|[/\\A-Za-z_])/i.test(source),
  curlFileOutput: source => /(?:-D|--dump-header|-o|--output)\s+(?:[/\\]|[A-Za-z]:|\$?\{?(?:TMP|tmp))/i.test(source),
  protectedTempStem: source => /(?:[/\\]|["'`])_(?:p94h?|restore_prompt|vision_req|pd|resp|up|sup)(?:_|\.)/i.test(source),
});

// Prove the census is capable of detecting every historical shape. This keeps
// the repository scan from becoming a vacuous regex that always passes.
const historicalFixtures = Object.freeze({
  shellCurl: "execSync(`curl -s ${url} -H ${header}`)",
  protectedHeaderArg: "curl -s -H 'Authorization: Bearer protected' https://fixture.invalid",
  curlFileBody: 'curl --data-binary @/tmp/qa/_pd_secret.bin https://fixture.invalid',
  curlFileOutput: 'curl -D /tmp/qa/_headers.txt https://fixture.invalid',
  protectedTempStem: "fs.writeFileSync('/tmp/qa/_vision_req_1.json', body)",
});
for (const [name, fixture] of Object.entries(historicalFixtures)) {
  assert.equal(detectors[name](fixture), true, `${name} detector does not recognize its historical unsafe shape`);
}

const files = jsFiles(QA);
assert.ok(files.length >= 25, `QA census unexpectedly scanned only ${files.length} JavaScript files`);
const findings = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [name, detects] of Object.entries(detectors)) {
    if (detects(source)) findings.push(`${path.relative(ROOT, file)}: ${name}`);
  }
}
assert.deepEqual(findings, [], `protected HTTP source census found forbidden transports:\n${findings.join('\n')}`);

const transports = [
  path.join(QA, 'ef-writepath', 'lib.js'),
  path.join(QA, 'sxr_courier_lib.js'),
  path.join(QA, 'vision_judge.js'),
];
for (const file of transports) {
  const source = fs.readFileSync(file, 'utf8');
  const invocations = [...source.matchAll(/\bspawn(?:Sync)?\s*\(\s*_CURL/g)];
  assert.ok(invocations.length >= 1, `${path.relative(ROOT, file)} has no curl transport invocation`);
  for (const match of invocations) {
    const callHead = source.slice(match.index, match.index + 120);
    assert.match(
      callHead,
      /^spawn(?:Sync)?\s*\(\s*_CURL\s*,\s*\[\s*['"]--config['"]\s*,\s*['"]-['"]\s*\]/,
      `${path.relative(ROOT, file)} curl invocation does not use exact fixed config-stdin argv`,
    );
  }
}

const routeAnchors = [
  ['qa/probes/p94_nav_full_quota.js', /lib\.filelessHttpRequest\(method, url, headers, postData\)/],
  ['qa/ef-writepath/21-drift-check.js', /L\.supaGet\(/],
  ['qa/ef-writepath/13-settings.js', /L\.filelessHttpRequest\(/],
  ['qa/vision_judge.js', /_visionApiRequest\(/],
];
for (const [relative, anchor] of routeAnchors) {
  const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  assert.match(source, anchor, `${relative} is no longer wired to its fileless protected HTTP helper`);
}

console.log(`QA protected HTTP census: ${files.length} files clean; 3 fixed-argv transports pinned`);
