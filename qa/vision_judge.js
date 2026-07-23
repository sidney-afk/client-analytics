'use strict';
// ============================================================================
// qa/vision_judge.js — OPTIONAL automated "eyes" for the master tester.
//
// The visual lane CAPTURES screenshots; by default a human (or Claude via the
// /master-test skill) reviews them. This module lets that review run
// automatically when you opt in, via one of two backends:
//
//   MASTER_VISION=off   (default)  — no auto-judging. Capture only. Nothing bills.
//   MASTER_VISION=cli              — shell out to the Claude Code CLI (`claude -p`),
//                                    which runs on whatever auth Claude Code is
//                                    logged into (your Pro/Max SUBSCRIPTION on a
//                                    dev machine). No API key, no per-call charge.
//   MASTER_VISION=api              — call the Anthropic Messages API. Requires
//                                    ANTHROPIC_API_KEY. Per-token billing. The
//                                    clean path for unattended CI.
//   MASTER_VISION=auto             — cli if `claude` is on PATH, else api if a key
//                                    is set, else off.
//
// Either backend looks at each screenshot and returns a structured verdict on
// two axes: does it LOOK right, and did it DO the right thing — focused by the
// change note (MASTER_CHANGE_NOTE). The API path uses `curl` (not fetch) so it
// tunnels through the same egress proxy the courier relies on.
//
// Model: MASTER_VISION_MODEL (default claude-opus-4-8 — most capable). For
// high-volume runs set it to claude-sonnet-4-6 or claude-haiku-4-5 to cut cost.
// ============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { clientEntrySafeChildEnv } = require('./test-client-entry.js');

const ANTHROPIC_VERSION = '2023-06-01';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = process.env.MASTER_VISION_MODEL || 'claude-opus-4-8';

// The verdict every backend returns. Kept flat + simple so the json_schema
// output config is happy (no unsupported constraints).
const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['ok', 'warn', 'broken'] },
    looks_right: { type: 'boolean' },
    does_right_thing: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['verdict', 'looks_right', 'does_right_thing', 'issues', 'summary'],
};

function selectBackend() {
  const v = (process.env.MASTER_VISION || 'off').toLowerCase();
  if (v === 'off' || v === 'api' || v === 'cli') return v;
  if (v === 'auto') {
    if (hasClaudeCli()) return 'cli';
    if (process.env.ANTHROPIC_API_KEY) return 'api';
    return 'off';
  }
  return 'off';
}

function hasClaudeCli() {
  try {
    const result = spawnSync('claude', ['--version'], {
      stdio: 'ignore',
      timeout: 15000,
      windowsHide: true,
      env: _visionSafeChildEnv(),
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function buildPrompt(shot, changeNote) {
  return [
    'You are a QA reviewer looking at a SCREENSHOT of the SyncView app captured during an automated test.',
    changeNote ? `What the developer changed (focus here): ${changeNote}` : 'No specific change was named — review broadly.',
    `Flow: ${shot.scenario}. Step ${shot.step} — the action just performed was "${shot.label}".`,
    '',
    'Judge TWO things:',
    '1. Does it LOOK right? layout, alignment, overlap, clipping, broken/missing images, wrong colors, empty-where-it-should-have-content, ugly/unfinished states.',
    `2. Did it DO the right thing? does the screen reflect what "${shot.label}" should have produced?`,
    '',
    'Reply with the verdict object: verdict (ok|warn|broken), looks_right (bool), does_right_thing (bool), issues (array of short strings — empty if none), summary (one sentence).',
  ].join('\n');
}

const _CURL = process.platform === 'win32' ? 'curl.exe' : 'curl';
const _VISION_CURL_OPTIONS = Object.freeze({
  timeout: 120000,
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
});
function _visionSafeChildEnv() {
  const env = clientEntrySafeChildEnv();
  delete env.ANTHROPIC_API_KEY;
  return env;
}

function _curlConfigValue(value) {
  const text = String(value == null ? '' : value);
  if (/[\u0000-\u0008\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new Error('unsupported control byte in vision request');
  }
  return '"' + text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\v/g, '\\v') + '"';
}
function _visionMarker() {
  return `__SYNCVIEW_VISION_META_${crypto.randomBytes(18).toString('hex')}__`;
}
function _visionCurlConfig(url, headers, body, marker) {
  const lines = [
    'silent',
    'show-error',
    `max-time = ${_curlConfigValue(String(_VISION_CURL_OPTIONS.timeout / 1000))}`,
    `request = ${_curlConfigValue('POST')}`,
    `url = ${_curlConfigValue(url)}`,
  ];
  for (const [name, value] of Object.entries(headers || {})) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\u0000\r\n]/.test(String(value))) {
      throw new Error('invalid vision request header');
    }
    lines.push(`header = ${_curlConfigValue(`${name}: ${value}`)}`);
  }
  lines.push(`data-raw = ${_curlConfigValue(body)}`);
  lines.push(`write-out = ${_curlConfigValue(`${marker}%{http_code}\t%{content_type}${marker}`)}`);
  return lines.join('\n') + '\n';
}
function _visionCurlResult(output, marker) {
  const bytes = Buffer.isBuffer(output) ? output : Buffer.from(output || '');
  const markerBytes = Buffer.from(marker, 'utf8');
  const close = bytes.lastIndexOf(markerBytes);
  const open = close < 0 ? -1 : bytes.lastIndexOf(markerBytes, close - 1);
  if (open < 0 || close + markerBytes.length !== bytes.length) throw new Error('vision response metadata missing');
  const metadata = bytes.subarray(open + markerBytes.length, close).toString('utf8');
  const separator = metadata.indexOf('\t');
  const statusText = separator < 0 ? '' : metadata.slice(0, separator);
  if (!/^\d{3}$/.test(statusText)) throw new Error('vision response status missing');
  return { status: Number(statusText), body: Buffer.from(bytes.subarray(0, open)) };
}
function _visionApiRequest(url, headers, body) {
  try {
    const marker = _visionMarker();
    const config = _visionCurlConfig(url, headers, body, marker);
    const result = spawnSync(_CURL, ['--config', '-'], Object.assign({}, _VISION_CURL_OPTIONS, {
      input: config,
      env: _visionSafeChildEnv(),
    }));
    if (result.error || result.status !== 0) throw new Error('vision api request failed');
    return _visionCurlResult(result.stdout, marker);
  } catch {
    throw new Error('vision api request failed');
  }
}

// ---- API backend (fileless curl → Anthropic Messages API) -----------------
function judgeViaApi(shot, changeNote, model) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { verdict: 'warn', looks_right: false, does_right_thing: false, issues: ['ANTHROPIC_API_KEY not set'], summary: 'api backend selected but no key' };
  let b64;
  try { b64 = fs.readFileSync(shot.path).toString('base64'); }
  catch (e) { return { verdict: 'warn', looks_right: false, does_right_thing: false, issues: ['cannot read ' + shot.path], summary: 'shot missing' }; }
  const body = {
    model,
    max_tokens: 1024,
    output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } },
        { type: 'text', text: buildPrompt(shot, changeNote) },
      ],
    }],
  };
  let out = '';
  try {
    out = _visionApiRequest(
      MESSAGES_URL,
      {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      JSON.stringify(body),
    ).body.toString('utf8');
  } catch {
    return { verdict: 'warn', looks_right: false, does_right_thing: false, issues: ['vision api request failed'], summary: 'api call failed' };
  }
  try {
    const resp = JSON.parse(out);
    if (resp.type === 'error') return { verdict: 'warn', looks_right: false, does_right_thing: false, issues: ['vision api returned an error'], summary: 'api error' };
    const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return coerceVerdict(JSON.parse(text));
  } catch (e) {
    return { verdict: 'warn', looks_right: false, does_right_thing: false, issues: ['unparseable api response'], summary: 'parse failed' };
  }
}

// ---- CLI backend (claude -p → runs on the Claude Code subscription) --------
// Headless print mode; allow only the Read tool (to open the image) so it never
// blocks on a permission prompt; ask for the verdict as JSON and parse it out of
// the --output-format json envelope's `result` field.
function judgeViaCli(shot, changeNote, model) {
  const prompt = buildPrompt(shot, changeNote) +
    `\n\nRead the screenshot at: ${shot.path}\nRespond with ONLY a single-line JSON object: {"verdict":"ok|warn|broken","looks_right":bool,"does_right_thing":bool,"issues":[..],"summary":".."}`;
  const r = spawnSync('claude', [
    '-p', prompt,
    '--output-format', 'json',
    '--allowedTools', 'Read',
    '--permission-mode', 'acceptEdits',
    '--model', model,
  ], {
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: _visionSafeChildEnv(),
  });
  if (r.status !== 0 && !r.stdout) {
    return { verdict: 'warn', looks_right: false, does_right_thing: false, issues: ['vision cli request failed'], summary: 'cli call failed' };
  }
  let resultText = r.stdout || '';
  try { const env = JSON.parse(r.stdout); if (env && typeof env.result === 'string') resultText = env.result; } catch {}
  const obj = extractJson(resultText);
  return obj ? coerceVerdict(obj) : { verdict: 'warn', looks_right: false, does_right_thing: false, issues: ['no JSON in cli output'], summary: 'parse failed' };
}

// Pull the first {...} JSON object out of arbitrary text.
function extractJson(s) {
  if (!s) return null;
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
function coerceVerdict(o) {
  o = o || {};
  return {
    verdict: ['ok', 'warn', 'broken'].includes(o.verdict) ? o.verdict : 'warn',
    looks_right: !!o.looks_right,
    does_right_thing: !!o.does_right_thing,
    issues: Array.isArray(o.issues) ? o.issues.map(String) : [],
    summary: typeof o.summary === 'string' ? o.summary : '',
  };
}
// Judge one shot via the active backend.
function judgeShot(shot, backend, changeNote, model) {
  if (backend === 'api') return judgeViaApi(shot, changeNote, model || DEFAULT_MODEL);
  if (backend === 'cli') return judgeViaCli(shot, changeNote, model || DEFAULT_MODEL);
  return null;
}

// Judge every shot in a manifest (flows → shots). Returns flat verdict rows.
function judgeManifest(manifest, opts = {}) {
  const backend = opts.backend || selectBackend();
  if (backend === 'off') return { backend, rows: [] };
  const changeNote = opts.changeNote || process.env.MASTER_CHANGE_NOTE || '';
  const model = opts.model || DEFAULT_MODEL;
  const rows = [];
  for (const flow of manifest) {
    for (const sh of flow.shots) {
      const verdict = judgeShot({ scenario: flow.scenario, ...sh }, backend, changeNote, model);
      rows.push({ scenario: flow.scenario, step: sh.step, label: sh.label, path: sh.path, verdict });
    }
  }
  return { backend, model, rows };
}

function renderVerdictDoc(result) {
  const L = [];
  L.push('# Vision verdict — master tester');
  L.push('');
  L.push(`- backend: \`${result.backend}\`${result.model ? ` · model: \`${result.model}\`` : ''}`);
  const broken = result.rows.filter(r => r.verdict.verdict === 'broken');
  const warn = result.rows.filter(r => r.verdict.verdict === 'warn');
  L.push(`- result: ${broken.length} ❌ broken · ${warn.length} ⚠️ warn · ${result.rows.length - broken.length - warn.length} ✅ ok`);
  L.push('');
  for (const r of result.rows) {
    const tag = r.verdict.verdict === 'broken' ? '❌' : r.verdict.verdict === 'warn' ? '⚠️' : '✅';
    L.push(`## ${tag} ${r.scenario} · step ${String(r.step).padStart(2, '0')} · ${r.label}`);
    L.push(`${r.verdict.summary}`);
    if (r.verdict.issues && r.verdict.issues.length) for (const i of r.verdict.issues) L.push(`- ${i}`);
    L.push(`\`${r.path}\``);
    L.push('');
  }
  return L.join('\n');
}

// Judge + persist VISION_VERDICT.md. Returns {backend, rows, broken, warn}.
function judgeAndWrite(manifest, outDir, opts = {}) {
  const result = judgeManifest(manifest, opts);
  if (result.backend !== 'off' && result.rows.length) {
    try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'VISION_VERDICT.md'), renderVerdictDoc(result)); } catch {}
  }
  const broken = result.rows.filter(r => r.verdict.verdict === 'broken').length;
  const warn = result.rows.filter(r => r.verdict.verdict === 'warn').length;
  return { ...result, broken, warn };
}

module.exports = {
  selectBackend, judgeShot, judgeManifest, judgeAndWrite, renderVerdictDoc, VERDICT_SCHEMA,
  __test: Object.freeze({ visionApiRequest: _visionApiRequest }),
};
