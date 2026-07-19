'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
const VISUAL_VERDICTS = new Set(['ok', 'warning', 'broken', 'pending_visual_review']);
const REVIEW_INPUT_VERDICTS = new Set(['ok', 'warning', 'broken']);
const REVIEW_ENTRY_KEYS = ['note', 'sha256', 'verdict'];

function canonicalSourceText(value) {
  return String(value).replace(/\r\n?/g, '\n');
}

// index.html is one ~44k-line file, so fingerprinting the WHOLE of it made the
// PTO public-evidence guard go stale on any edit anywhere (F141 reorder,
// analytics, workload — none of them PTO), which turned it permanently red and
// therefore meaningless. ptoSourceSlice keeps only the PTO-bearing lines, so the
// guard trips when PTO code changes and stays quiet for unrelated edits. Tokens
// are PTO-specific — never bare "pto" — so "crypto"/"adaptor" never match. If PTO
// grows a new identifier shape, add it here AND regenerate the manifest;
// test/pto-fingerprint-slice.js pins the anchors and the exclusions.
const PTO_SOURCE_TOKEN = /_pto|pto-|pto_|ptoRoot|ptoRefresh|ptoV1|'pto'|"pto"|\[PTO\]|PTO \/|Time Off/;
function ptoSourceSlice(indexText) {
  return canonicalSourceText(indexText)
    .split('\n')
    .filter(line => PTO_SOURCE_TOKEN.test(line))
    .join('\n');
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function relativeFromRoot(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function grouped(shots) {
  const flows = new Map();
  for (const shot of shots) {
    if (!flows.has(shot.scenario)) flows.set(shot.scenario, []);
    flows.get(shot.scenario).push(shot);
  }
  return [...flows.entries()].map(([scenario, entries]) => ({
    scenario,
    shots: entries.sort((a, b) => a.step - b.step),
  }));
}

function reviewKeyForShot(shot) {
  return path.basename(String(shot.file || ''));
}

function validateVisualReviewSchema(value) {
  if (!isPlainObject(value)) {
    throw new Error('PTO visual review must be a JSON object keyed by screenshot filename');
  }
  for (const [file, entry] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9.-]*\.jpg$/i.test(file) || path.basename(file) !== file) {
      throw new Error(`Invalid PTO visual review screenshot key: ${file}`);
    }
    if (!isPlainObject(entry)) {
      throw new Error(`Visual review for ${file} must be an object with sha256, verdict, and note`);
    }
    const keys = Object.keys(entry).sort();
    if (keys.length !== REVIEW_ENTRY_KEYS.length
      || !keys.every((key, index) => key === REVIEW_ENTRY_KEYS[index])) {
      throw new Error(`Visual review for ${file} must contain exactly sha256, verdict, and note`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`Visual review for ${file} has an invalid sha256`);
    }
    if (!REVIEW_INPUT_VERDICTS.has(entry.verdict)) {
      throw new Error(`Visual review for ${file} has an invalid verdict`);
    }
    if (typeof entry.note !== 'string') {
      throw new Error(`Visual review for ${file} must include a string note`);
    }
    if (['warning', 'broken'].includes(entry.verdict) && !entry.note.trim()) {
      throw new Error(`Visual review for ${file} requires a note for ${entry.verdict}`);
    }
  }
  return value;
}

function readVisualReviewFile(file) {
  if (!fs.existsSync(file)) return {};
  assertPublicTextSafe([file]);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    throw new Error(`${relativeFromRoot(file)} must contain valid JSON`);
  }
  return validateVisualReviewSchema(value);
}

function assertNoOrphanReviews(shots, verdicts) {
  const current = new Set(shots.map(reviewKeyForShot));
  for (const file of Object.keys(verdicts)) {
    if (!current.has(file)) {
      throw new Error(`Orphan PTO visual review entry does not match a current screenshot: ${file}`);
    }
  }
}

function publicShot(shot, artifactDir, verdicts) {
  const reviewed = verdicts && verdicts[reviewKeyForShot(shot)];
  const hashMatches = !!reviewed && reviewed.sha256 === shot.sha256;
  const visualVerdict = shot.verdict === 'broken'
    ? 'broken'
    : (hashMatches ? reviewed.verdict : shot.verdict);
  if (!VISUAL_VERDICTS.has(visualVerdict)) {
    throw new Error(`Invalid visual verdict for ${shot.file}: ${String(visualVerdict)}`);
  }
  return {
    scenario: shot.scenario,
    step: shot.step,
    action: shot.action,
    expected_visible_result: shot.expected,
    persona: shot.persona,
    profile: shot.profile,
    viewport: shot.viewport,
    file: path.relative(artifactDir, shot.path).replace(/\\/g, '/'),
    sha256: shot.sha256,
    visual_verdict: visualVerdict,
    visual_note: hashMatches ? reviewed.note : '',
  };
}

function renderGallery(flows) {
  const sections = flows.map(flow => `
    <section>
      <h2>${escapeHtml(flow.scenario)}</h2>
      <div class="grid">${flow.shots.map(shot => `
          <figure>
            <a href="${escapeHtml(shot.file)}"><img src="${escapeHtml(shot.file)}" loading="lazy" alt="${escapeHtml(`${flow.scenario}, step ${shot.step}, ${shot.action}`)}"></a>
            <figcaption><strong>${String(shot.step).padStart(2, '0')} · ${escapeHtml(shot.action)}</strong><span>${escapeHtml(shot.expected_visible_result)}</span><small>${escapeHtml(`${shot.profile} · ${shot.viewport.width}×${shot.viewport.height} · ${shot.visual_verdict}`)}</small></figcaption>
          </figure>`).join('')}
      </div>
    </section>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>PTO lifecycle simulation · synthetic visual evidence</title>
  <style>
    :root{color-scheme:light dark;font-family:Inter,system-ui,sans-serif}
    body{margin:0;background:#101114;color:#f8fafc}
    header{position:sticky;top:0;z-index:2;padding:22px 28px;background:rgba(16,17,20,.95);border-bottom:1px solid #30333a;backdrop-filter:blur(12px)}
    h1,h2,p{margin:0} h1{font-size:20px} header p{margin-top:7px;color:#aeb5c2;font-size:13px}
    main{padding:28px} section+section{margin-top:38px} h2{margin-bottom:15px;font-size:16px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}
    figure{margin:0;overflow:hidden;border:1px solid #30333a;border-radius:14px;background:#17191e}
    img{display:block;width:100%;height:auto;max-height:760px;object-fit:contain;object-position:top;background:#fff}
    figcaption{display:grid;gap:5px;padding:12px 14px} figcaption span,small{color:#aeb5c2;font-size:12px;line-height:1.4}
    @media(max-width:600px){main{padding:16px}.grid{grid-template-columns:1fr}header{padding:18px}}
  </style>
</head>
<body>
  <header><h1>PTO lifecycle simulation</h1><p>Synthetic-only screenshots. Every frame follows an action and a visible-result assertion.</p></header>
  <main>${sections}</main>
</body>
</html>`;
}

function renderChecklist(flows) {
  const lines = [
    '# PTO lifecycle simulation — visual review',
    '',
    '> All screenshots contain synthetic TEST personas and values only. Lane B live screenshots are never written here.',
    '',
    'Review each frame on two axes: (1) does it look intentional and usable, and (2) does the visible screen show the result the action should have produced?',
    '',
  ];
  for (const flow of flows) {
    lines.push(`## ${flow.scenario}`, '');
    for (const shot of flow.shots) {
      const reviewed = !['pending_visual_review', 'broken'].includes(shot.visual_verdict);
      const note = shot.visual_note ? `; note: ${shot.visual_note}` : '';
      lines.push(`- [${reviewed ? 'x' : ' '}] **${String(shot.step).padStart(2, '0')} · ${shot.action}** — expected: ${shot.expected_visible_result}; verdict: \`${shot.visual_verdict}\`${note}; [screenshot](${shot.file})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function assertPublicTextSafe(files) {
  const failures = [];
  const forbidden = [
    { label: 'email address', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i },
    { label: 'UUID', pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i },
    { label: 'role-key literal', pattern: /\b(?:eyJ[A-Za-z0-9_-]{20,}|sb_(?:secret|publishable)_[A-Za-z0-9_-]{12,})\b/ },
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const rule of forbidden) {
      if (rule.pattern.test(text)) failures.push(`${relativeFromRoot(file)} contains a ${rule.label}`);
    }
  }
  if (failures.length) throw new Error(`Public PTO lifecycle artifacts failed privacy validation:\n${failures.join('\n')}`);
}

function validatePublicEvidence(artifactDir, options = {}) {
  const resolvedArtifactDir = path.resolve(artifactDir);
  const manifestFile = path.join(resolvedArtifactDir, 'manifest.json');
  const galleryFile = path.join(resolvedArtifactDir, 'gallery.html');
  const checklistFile = path.join(resolvedArtifactDir, 'VISUAL_REVIEW.md');
  const screenshotsDir = path.join(resolvedArtifactDir, 'screenshots');
  const visualReviewFile = options.visualReviewFile
    || path.join(ROOT, 'qa', 'pto-lifecycle', 'visual-review.json');
  for (const required of [manifestFile, galleryFile, checklistFile, screenshotsDir, visualReviewFile]) {
    if (!fs.existsSync(required)) {
      throw new Error(`Missing PTO public evidence path: ${relativeFromRoot(required)}`);
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (_) {
    throw new Error(`${relativeFromRoot(manifestFile)} must contain valid JSON`);
  }
  if (!isPlainObject(manifest)) throw new Error('PTO public manifest must be a JSON object');
  if (!/^[0-9a-f]{64}$/.test(String(manifest.source_tree_sha256 || ''))) {
    throw new Error('PTO public manifest has an invalid source_tree_sha256');
  }
  if (options.sourceTreeSha256
    && manifest.source_tree_sha256 !== options.sourceTreeSha256) {
    throw new Error('PTO public evidence is stale for the current source tree');
  }
  if (!Array.isArray(manifest.flows)) throw new Error('PTO public manifest flows must be an array');
  const shots = manifest.flows.flatMap(flow => {
    if (!isPlainObject(flow) || !Array.isArray(flow.shots)) {
      throw new Error('Every PTO public manifest flow must contain a shots array');
    }
    return flow.shots;
  });
  if (!Number.isInteger(manifest.screenshot_count)
    || manifest.screenshot_count <= 0
    || manifest.screenshot_count !== shots.length) {
    throw new Error('PTO public manifest screenshot_count does not match its shots');
  }
  if (manifest.visual_review_complete !== true) {
    throw new Error('PTO public evidence visual review is not complete');
  }

  const screenshotRoot = path.resolve(screenshotsDir);
  const seenFiles = new Set();
  const verdictCounts = {};
  for (const shot of shots) {
    if (!isPlainObject(shot)) throw new Error('Every PTO public screenshot entry must be an object');
    const relativeFile = String(shot.file || '').replace(/\\/g, '/');
    const full = path.resolve(resolvedArtifactDir, relativeFile);
    if (!relativeFile.startsWith('screenshots/')
      || relativeFile !== `screenshots/${path.posix.basename(relativeFile)}`
      || !full.startsWith(screenshotRoot + path.sep)
      || !/\.jpg$/i.test(relativeFile)) {
      throw new Error(`Unsafe PTO public screenshot path: ${relativeFile}`);
    }
    if (seenFiles.has(relativeFile)) {
      throw new Error(`Duplicate PTO public screenshot path: ${relativeFile}`);
    }
    seenFiles.add(relativeFile);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new Error(`Missing PTO public screenshot: ${relativeFile}`);
    }
    if (!/^[0-9a-f]{64}$/.test(String(shot.sha256 || '')) || sha256(full) !== shot.sha256) {
      throw new Error(`PTO public screenshot hash mismatch: ${relativeFile}`);
    }
    if (!['ok', 'warning'].includes(shot.visual_verdict)) {
      throw new Error(`PTO public screenshot is pending or broken: ${relativeFile}`);
    }
    if (typeof shot.visual_note !== 'string'
      || (shot.visual_verdict === 'warning' && !shot.visual_note.trim())) {
      throw new Error(`PTO public screenshot has an invalid visual note: ${relativeFile}`);
    }
    verdictCounts[shot.visual_verdict] = (verdictCounts[shot.visual_verdict] || 0) + 1;
  }

  const diskScreenshots = fs.readdirSync(screenshotsDir, { withFileTypes: true });
  if (diskScreenshots.some(entry => !entry.isFile() || !/\.jpg$/i.test(entry.name))
    || diskScreenshots.length !== seenFiles.size
    || diskScreenshots.some(entry => !seenFiles.has(`screenshots/${entry.name}`))) {
    throw new Error('PTO public screenshots directory does not exactly match the manifest');
  }
  const expectedCounts = isPlainObject(manifest.visual_verdict_counts)
    ? manifest.visual_verdict_counts
    : {};
  const countKeys = new Set([...Object.keys(expectedCounts), ...Object.keys(verdictCounts)]);
  if ([...countKeys].some(key => Number(expectedCounts[key] || 0) !== Number(verdictCounts[key] || 0))) {
    throw new Error('PTO public manifest visual verdict counts do not match its shots');
  }

  const reviews = readVisualReviewFile(visualReviewFile);
  assertNoOrphanReviews(shots, reviews);
  if (Object.keys(reviews).length !== shots.length) {
    throw new Error('PTO public evidence requires one hash-bound visual review per screenshot');
  }
  for (const shot of shots) {
    const file = reviewKeyForShot(shot);
    const reviewed = reviews[file];
    if (!reviewed
      || reviewed.sha256 !== shot.sha256
      || reviewed.verdict !== shot.visual_verdict
      || reviewed.note !== shot.visual_note) {
      throw new Error(`PTO public visual review does not match the screenshot manifest: ${file}`);
    }
  }

  const gallery = fs.readFileSync(galleryFile, 'utf8');
  const checklist = fs.readFileSync(checklistFile, 'utf8');
  for (const [label, text] of [['gallery', gallery], ['checklist', checklist]]) {
    const references = new Set(text.match(/screenshots\/[a-z0-9._-]+\.jpg/gi) || []);
    if (references.size !== seenFiles.size
      || [...references].some(file => !seenFiles.has(file))
      || [...seenFiles].some(file => !references.has(file))) {
      throw new Error(`PTO public ${label} screenshot inventory does not match the manifest`);
    }
  }
  const findingsFile = path.join(resolvedArtifactDir, 'FINDINGS.md');
  assertPublicTextSafe([
    visualReviewFile,
    manifestFile,
    galleryFile,
    checklistFile,
    ...(fs.existsSync(findingsFile) ? [findingsFile] : []),
  ]);
  return {
    screenshotCount: shots.length,
    sourceTreeSha256: manifest.source_tree_sha256,
    verdictCounts,
  };
}

function writeReviewArtifacts(shots, artifactDir, metadata = {}) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const verdicts = validateVisualReviewSchema(metadata.visualVerdicts || {});
  assertNoOrphanReviews(shots, verdicts);
  const publicFlows = grouped(shots).map(flow => ({
    scenario: flow.scenario,
    shots: flow.shots.map(shot => publicShot(shot, artifactDir, verdicts)),
  }));
  const flatShots = publicFlows.flatMap(flow => flow.shots);
  const verdictCounts = flatShots.reduce((counts, shot) => {
    counts[shot.visual_verdict] = (counts[shot.visual_verdict] || 0) + 1;
    return counts;
  }, {});
  const manifest = {
    generated_for: 'PTO lifecycle simulation',
    source_commit: metadata.sourceCommit || '',
    source_tree_sha256: metadata.sourceTreeSha256 || '',
    backend: 'stateful synthetic mock using the production PTO policy module',
    privacy: 'synthetic TEST data only; no live identities, dates, balances, notes, keys, or responses',
    screenshot_count: flatShots.length,
    visual_review_complete: flatShots.length > 0
      && flatShots.every(shot => !['pending_visual_review', 'broken'].includes(shot.visual_verdict)),
    visual_verdict_counts: verdictCounts,
    coverage: Array.isArray(metadata.coverage) ? metadata.coverage : [],
    flows: publicFlows,
  };
  const manifestFile = path.join(artifactDir, 'manifest.json');
  const galleryFile = path.join(artifactDir, 'gallery.html');
  const reviewFile = path.join(artifactDir, 'VISUAL_REVIEW.md');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(galleryFile, renderGallery(publicFlows));
  fs.writeFileSync(reviewFile, renderChecklist(publicFlows));
  const findingsFile = path.join(artifactDir, 'FINDINGS.md');
  assertPublicTextSafe([manifestFile, galleryFile, reviewFile]
    .concat(fs.existsSync(findingsFile) ? [findingsFile] : []));
  return { manifest, manifestFile, galleryFile, reviewFile };
}

module.exports = {
  canonicalSourceText,
  ptoSourceSlice,
  grouped,
  writeReviewArtifacts,
  assertPublicTextSafe,
  readVisualReviewFile,
  validateVisualReviewSchema,
  validatePublicEvidence,
};
