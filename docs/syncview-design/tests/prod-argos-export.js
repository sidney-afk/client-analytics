'use strict';

const fs = require('fs');
const path = require('path');
const { root, formatFailures } = require('./prod-test-utils');
const { validatePacket } = require('./prod-review-packet-validate');

const sourceDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, '.codex-tmp', 'prod-review-packet');

const outDir = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(root, '.codex-tmp', 'prod-argos-snapshots');

const includeMobile = process.env.SYNCVIEW_ARGOS_INCLUDE_MOBILE === '1';

function pkgVersion(name) {
  try {
    return require(path.join(root, 'node_modules', name, 'package.json')).version || 'unknown';
  } catch (err) {
    try {
      return require(path.join(root, 'package.json')).devDependencies[name] || 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }
}

function cleanOutDir() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
}

function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(sourceDir, 'review-manifest.json'), 'utf8'));
}

function metadataFor(shot, sourceFile) {
  const viewport = shot.viewport || {};
  const tags = [
    'production',
    viewport.isMobile ? 'mobile' : 'desktop',
    shot.theme || 'light',
    shot.surface || shot.name,
  ].filter(Boolean);

  return {
    $schema: 'https://api.argos-ci.com/v2/screenshot-metadata.json',
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
    colorScheme: shot.theme === 'dark' ? 'dark' : 'light',
    mediaType: 'screen',
    tags: [...new Set(tags)],
    test: {
      title: shot.label || shot.name,
      titlePath: ['Production review packet', shot.label || shot.name],
      location: {
        file: 'docs/syncview-design/tests/prod-review-packet.js',
        line: 1,
        column: 1,
      },
      annotations: [
        {
          type: 'route',
          description: shot.route || 'production',
        },
        {
          type: 'source',
          description: sourceFile,
        },
        {
          type: 'inspection-note',
          description: shot.note || '',
        },
      ],
      tags,
    },
    automationLibrary: {
      name: 'playwright',
      version: pkgVersion('playwright'),
    },
    sdk: {
      name: '@argos-ci/cli',
      version: pkgVersion('@argos-ci/cli'),
    },
  };
}

function assertMetadata(name, metadata, failures) {
  if (!metadata.viewport || !Number.isFinite(metadata.viewport.width) || !Number.isFinite(metadata.viewport.height)) {
    failures.push(`${name} metadata missing numeric viewport`);
  }
  if (!metadata.automationLibrary || !metadata.automationLibrary.name || !metadata.automationLibrary.version) {
    failures.push(`${name} metadata missing automationLibrary`);
  }
  if (!metadata.sdk || metadata.sdk.name !== '@argos-ci/cli' || !metadata.sdk.version) {
    failures.push(`${name} metadata missing @argos-ci/cli sdk`);
  }
  if (!metadata.test || !metadata.test.title || !Array.isArray(metadata.test.titlePath)) {
    failures.push(`${name} metadata missing test title/titlePath`);
  }
}

function exportArgosSnapshots() {
  const packetFailures = validatePacket(sourceDir);
  if (packetFailures.length) {
    throw new Error(formatFailures('prod-argos-export source packet failures', packetFailures));
  }

  cleanOutDir();
  const manifest = readManifest();
  const shots = (manifest.screenshots || []).filter(shot => includeMobile || !shot.viewport || !shot.viewport.isMobile);
  const failures = [];
  const exported = [];

  shots.forEach(shot => {
    const sourceFile = shot.file;
    const sourcePath = path.join(sourceDir, sourceFile);
    const targetName = `${shot.name}.png`;
    const targetPath = path.join(outDir, targetName);
    const metadata = metadataFor(shot, sourceFile);
    if (!fs.existsSync(sourcePath)) {
      failures.push(`Missing source screenshot ${sourceFile}`);
      return;
    }
    fs.copyFileSync(sourcePath, targetPath);
    fs.writeFileSync(`${targetPath}.argos.json`, JSON.stringify(metadata, null, 2) + '\n');
    assertMetadata(targetName, metadata, failures);
    exported.push({
      name: shot.name,
      file: targetName,
      metadata: `${targetName}.argos.json`,
      label: shot.label,
      route: shot.route,
      surface: shot.surface,
      theme: shot.theme,
      viewport: shot.viewport,
    });
  });

  if (!exported.length) failures.push('No screenshots exported for Argos');
  if (!includeMobile && exported.some(item => item.viewport && item.viewport.isMobile)) {
    failures.push('Mobile screenshots should not be exported unless SYNCVIEW_ARGOS_INCLUDE_MOBILE=1');
  }
  if (failures.length) throw new Error(formatFailures('prod-argos-export failures', failures));

  fs.writeFileSync(path.join(outDir, 'argos-manifest.json'), JSON.stringify({
    schema: 'syncview.productionArgosSnapshots.v1',
    source: path.relative(root, sourceDir).replace(/\\/g, '/'),
    includeMobile,
    count: exported.length,
    screenshots: exported,
  }, null, 2) + '\n');

  console.log(`prod-argos-export: wrote ${exported.length} Argos screenshot(s) to ${outDir}${includeMobile ? '' : ' (desktop only)'}`);
}

if (require.main === module) {
  try {
    exportArgosSnapshots();
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(1);
  }
}

module.exports = { exportArgosSnapshots };
