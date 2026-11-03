'use strict';
/* scripts/frameio-list-live-check.js prints only counts and true/false: never an address, an id, a name or a key
   (the repository and its CI logs are public). Offline. */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }

const { summarize } = require(path.join(ROOT, 'scripts', 'frameio-list-live-check.js'));
const list = { ok: true, name: 'Secret folder name', truncated: false, open_url: 'https://f.io/secret-share',
  videos: [
    { file_id: 'secret-file-1', name: 'secret one.mp4', duration_seconds: 12.5, thumbnail_url: 'https://e.example/secret-thumb', processing: false, link: 'https://next.frame.io/share/s/view/secret-file-1' },
    { file_id: 'secret-file-2', name: 'secret two.mp4', duration_seconds: null, thumbnail_url: null, processing: true, link: 'https://next.frame.io/share/s/view/secret-file-2' },
  ] };
const out = summarize({ status: 200, json: list }, { status: 200, json: { ok: true, video: { file_id: 'secret-file-1', url: 'https://cdn.example/secret', duration_seconds: 12.5 } } });
ok(JSON.stringify(out) === JSON.stringify({ list_http_status: 200, list_ok: true, rows: 2, rows_with_duration: 1, rows_with_thumbnail: 1, rows_processing: 1, truncated: false, video_http_status: 200, video_same_file: true, video_has_duration: true }),
  'the summary is counts and true/false only: ' + JSON.stringify(out));
ok(!/secret|https?:|\.mp4/i.test(JSON.stringify(out)), 'no address, id or name reaches the summary');
ok(Object.values(out).every((v) => typeof v === 'number' || typeof v === 'boolean' || v === null), 'every value is a number, a boolean or null');
const wrong = summarize({ status: 200, json: list }, { status: 200, json: { ok: true, video: { file_id: 'secret-other' } } });
ok(wrong.video_same_file === false, 'a lookup that resolves to another file reads false');
ok(wrong.video_has_duration === false, 'a video answer with no length reads video_has_duration false');
const refused = summarize({ status: 404, json: { ok: false, error: 'share_off', message: 'secret words' } }, null);
ok(refused.list_ok === false && refused.list_error === 'share_off' && !('rows' in refused) && !/secret/.test(JSON.stringify(refused)), 'a refusal prints its code only, never its message');
ok(summarize({ status: 200, json: { ok: true, videos: [] } }, null).video_same_file === null, 'with nothing to look up, the video check reads null');

const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/frameio-list-live-check.yml'), 'utf8');
ok(/on:\s*\n\s*workflow_dispatch:/.test(wf) && !/\bpull_request\b|\bpush:|\bschedule:/.test(wf), 'the workflow runs by hand only');
ok(/SYNCVIEW_STAFF_KEY: \$\{\{ secrets\.ROBOT_ROLE_KEY_SMM \}\}/.test(wf) && !/echo[^\n]*(KEY|secrets)/i.test(wf), 'the SMM robot key goes in by env and is never echoed');
ok(/permissions:\s*\n\s*contents: read/.test(wf), 'read-only repository permissions');
const script = fs.readFileSync(path.join(ROOT, 'scripts/frameio-list-live-check.js'), 'utf8');
ok(/LIVE_CHECK_CLIENT: \$\{\{ inputs\.client \}\}/.test(wf) && /process\.env\.LIVE_CHECK_CLIENT/.test(script) && !/TEST_CLIENT\s*=\s*'/.test(script),
  'the client slug comes in at dispatch, never written in the script (Codex on #2546)');

console.log(`\nframeio-list-live-check: ${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
