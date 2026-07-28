'use strict';

// Read-only onboarding viewer regression test. Subtitle media must reflect the
// submitted subtitle choice, not be confused with the separate thumbnail style.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function grabFunction(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  assert(at >= 0, 'missing function ' + name);
  let depth = 0;
  for (let i = INDEX.indexOf('{', at); i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}' && --depth === 0) return INDEX.slice(at, i + 1);
  }
  throw new Error('unbalanced function ' + name);
}

function grabObject(name) {
  const at = INDEX.indexOf('const ' + name + ' = {');
  assert(at >= 0, 'missing object ' + name);
  let depth = 0;
  for (let i = INDEX.indexOf('{', at); i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}' && --depth === 0) return INDEX.slice(at, i + 1) + ';';
  }
  throw new Error('unbalanced object ' + name);
}

const sandbox = {};
vm.runInNewContext([
  grabObject('OBV_SUB'),
  grabObject('OBV_SUB_PREVIEW'),
  grabFunction('_obvEsc'),
  grabFunction('_obvText'),
  grabFunction('_obvSubtitle'),
].join('\n'), sandbox);

const elegant = sandbox._obvSubtitle({ subtitle_style: 'elegant' });
assert(elegant.includes('<video'), 'Elegant must render a video preview');
assert(elegant.includes('onboarding-video/sub-elegant.mp4'), 'Elegant must use its standard clip');
assert(elegant.includes('<button') && elegant.includes('data-obv-preview') && elegant.includes('onclick="_obvOpenPreview(this)"'),
  'subtitle preview must use the same click-to-zoom interaction as the onboarding form');
assert(!elegant.includes('controls') && elegant.includes('muted') && elegant.includes('playsinline'),
  'compact subtitle preview must not expose the native fullscreen player');

const highlighted = sandbox._obvSubtitle({ subtitle_style: 'elegant', subtitle_highlight: true });
assert(highlighted.includes('onboarding-video/sub-elegant-hl.mp4'),
  'highlighted Elegant must use the highlighted clip');
assert(highlighted.includes('highlighted keywords'), 'highlighted preview must be labelled');

const legacy = sandbox._obvSubtitle({ subtitle_style: 'banner' });
assert.strictEqual(legacy, 'Banner', 'unsupported legacy subtitle styles must remain text-only');
assert(/_obvRow\('Subtitles', _obvSubtitle\(a\)\)/.test(INDEX),
  'the Style section must use the subtitle preview helper');
assert(/\.obv-sub-preview video\{[^}]*aspect-ratio:9\/16/.test(INDEX),
  'subtitle video must retain the compact 9:16 onboarding-preview layout');
assert(/function _obvOpenPreview\(button\)\{[\s\S]*?_obZoom\(src\);/.test(INDEX),
  'viewer preview must open the shared contained zoom player');
assert(/\.ob-zoom-ov video\{[^}]*max-height:88vh/.test(INDEX),
  'standalone viewer must include the contained zoom-player styles');

for (const asset of [
  'onboarding-video/sub-elegant.mp4',
  'onboarding-video/sub-elegant-hl.mp4',
  'onboarding-video/sub-native.mp4',
  'onboarding-video/sub-native-hl.mp4',
  'onboarding-video/sub-bold.mp4',
  'onboarding-video/sub-bold-hl.mp4',
]) {
  assert(fs.existsSync(path.join(ROOT, asset)), 'missing subtitle preview asset: ' + asset);
}

console.log('Onboarding viewer subtitle-style previews passed');
