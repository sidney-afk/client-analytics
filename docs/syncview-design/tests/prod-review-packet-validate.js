'use strict';

const fs = require('fs');
const path = require('path');
const { root, formatFailures } = require('./prod-test-utils');

const packetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, '.codex-tmp', 'prod-review-packet');

const requiredNames = [
  'desktop-list',
  'selected-actions-menu',
  'combined-filters',
  'project-board',
  'project-detail',
  'parent-detail',
  'subissue-detail',
  'dark-list',
  'mobile-list',
  'mobile-detail',
];

function readText(dir, file, failures) {
  try {
    return fs.readFileSync(path.join(dir, file), 'utf8');
  } catch (err) {
    failures.push(`Missing ${file}: ${err.message}`);
    return '';
  }
}

function readJson(dir, file, failures) {
  const text = readText(dir, file, failures);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    failures.push(`${file} is not valid JSON: ${err.message}`);
    return null;
  }
}

function readPngSize(dir, file, failures) {
  const full = path.join(dir, file);
  let buf;
  try {
    buf = fs.readFileSync(full);
  } catch (err) {
    failures.push(`Missing screenshot ${file}: ${err.message}`);
    return null;
  }
  const signature = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.slice(0, 8).toString('hex') !== signature) {
    failures.push(`${file} is not a PNG screenshot`);
    return null;
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function validatePacket(dir = packetDir) {
  const failures = [];
  if (!fs.existsSync(dir)) {
    return [`Review packet directory does not exist: ${dir}`];
  }

  const manifest = readJson(dir, 'review-manifest.json', failures);
  const markdown = readText(dir, 'manifest.md', failures);
  const checklist = readText(dir, 'review-checklist.md', failures);
  const gallery = readText(dir, 'index.html', failures);
  if (!manifest) return failures;

  if (manifest.schema !== 'syncview.productionReviewPacket.v1') {
    failures.push(`Unexpected review-manifest schema: ${manifest.schema || '(missing)'}`);
  }
  if (manifest.queryGate !== '?prod=1') {
    failures.push(`Unexpected query gate: ${manifest.queryGate || '(missing)'}`);
  }
  if (!manifest.readOnlyInvariant || manifest.readOnlyInvariant.passed !== true) {
    failures.push('Read-only invariant did not pass in review-manifest.json');
  }
  if (manifest.readOnlyInvariant && manifest.readOnlyInvariant.writeLikeRequests !== 0) {
    failures.push(`Expected 0 write-like requests, saw ${manifest.readOnlyInvariant.writeLikeRequests}`);
  }
  if (manifest.readOnlyInvariant && manifest.readOnlyInvariant.pageOrConsoleErrors !== 0) {
    failures.push(`Expected 0 page/console errors, saw ${manifest.readOnlyInvariant.pageOrConsoleErrors}`);
  }
  if (!manifest.files || manifest.files.gallery !== 'index.html' || manifest.files.markdown !== 'manifest.md' || manifest.files.checklist !== 'review-checklist.md') {
    failures.push('review-manifest.json must point to index.html, manifest.md, and review-checklist.md');
  }

  const shots = Array.isArray(manifest.screenshots) ? manifest.screenshots : [];
  if (shots.length !== requiredNames.length) {
    failures.push(`Expected ${requiredNames.length} screenshots, found ${shots.length}`);
  }

  const names = new Set(shots.map(shot => shot && shot.name));
  requiredNames.forEach(name => {
    if (!names.has(name)) failures.push(`Missing required screenshot metadata: ${name}`);
  });

  shots.forEach((shot, index) => {
    const label = shot && (shot.file || shot.name || `screenshot-${index + 1}`);
    if (!shot || typeof shot !== 'object') {
      failures.push(`Screenshot ${index + 1} metadata is missing`);
      return;
    }
    ['file', 'name', 'label', 'note', 'surface', 'route', 'theme'].forEach(field => {
      if (!shot[field]) failures.push(`${label} missing ${field}`);
    });
    if (!shot.route || !shot.route.startsWith('production')) {
      failures.push(`${label} route must start with production`);
    }
    if (!shot.viewport || !Number.isFinite(shot.viewport.width) || !Number.isFinite(shot.viewport.height)) {
      failures.push(`${label} missing numeric viewport metadata`);
    }
    if (!Array.isArray(shot.checks) || shot.checks.length === 0) {
      failures.push(`${label} missing inspection checks`);
    }
    if (shot.file) {
      const size = readPngSize(dir, shot.file, failures);
      if (size && shot.viewport) {
        if (size.width <= 0 || size.height <= 0) {
          failures.push(`${shot.file} has invalid PNG dimensions ${size.width}x${size.height}`);
        }
        if (Number.isFinite(shot.viewport.width) && Math.abs(size.width - shot.viewport.width) > 2) {
          failures.push(`${shot.file} width ${size.width} does not match viewport ${shot.viewport.width}`);
        }
        if (Number.isFinite(shot.viewport.height) && Math.abs(size.height - shot.viewport.height) > 2) {
          failures.push(`${shot.file} height ${size.height} does not match viewport ${shot.viewport.height}`);
        }
      }
      if (markdown && !markdown.includes(shot.file)) failures.push(`manifest.md does not reference ${shot.file}`);
      if (checklist && !checklist.includes(shot.file)) failures.push(`review-checklist.md does not reference ${shot.file}`);
      if (gallery && !gallery.includes(shot.file)) failures.push(`index.html does not reference ${shot.file}`);
    }
  });

  const mobileShots = shots.filter(shot => shot.viewport && shot.viewport.isMobile);
  const darkShots = shots.filter(shot => shot.theme === 'dark');
  if (mobileShots.length < 2) failures.push('Expected at least two mobile screenshots');
  if (darkShots.length < 1) failures.push('Expected at least one dark theme screenshot');
  if (!gallery.includes('Production Review Packet')) failures.push('index.html missing gallery heading');
  if (!markdown.includes('Production Review Packet')) failures.push('manifest.md missing heading');
  if (!checklist.includes('Production Review Checklist')) failures.push('review-checklist.md missing heading');
  if ((checklist.match(/- \[ \]/g) || []).length < shots.length + 5) {
    failures.push('review-checklist.md does not include enough checklist items');
  }

  return failures;
}

if (require.main === module) {
  const failures = validatePacket();
  if (failures.length) {
    console.error(formatFailures('prod-review-packet-validate failures', failures));
    process.exit(1);
  }
  console.log(`prod-review-packet-validate: ${requiredNames.length} screenshots, JSON manifest, gallery, Markdown manifest, and checklist passed`);
}

module.exports = { validatePacket };
