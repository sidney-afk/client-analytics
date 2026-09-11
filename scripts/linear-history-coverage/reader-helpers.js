'use strict';

// Extract only named pure functions. Never load the rescue/backup CLI or app boot.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { extractFunction } = require('../../test/helpers/extract-function');
const ROOT = path.resolve(__dirname, '../..');
const APP = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const RESCUE = fs.readFileSync(path.join(ROOT, 'scripts/f34-linear-asset-rescue.js'), 'utf8');

function readerHelpers() {
  const ctx = vm.createContext({ URL, _isClientLink: true, SXR_COMPONENTS: ['video', 'graphic'] });
  const names = ['_sxrMsgAudience', '_calMsgAudience', '_prodRootAudienceClientRows',
    '_calCommentRoots', '_calCommentReplies', '_prodCommentTruthy', '_prodHashText',
    '_prodCommentNormalize', '_prodCanonicalCardComment', '_calLoadCommentsField',
    '_prodCanonicalCommentGate', '_sxrMigrateShape'];
  vm.runInContext(names.map(name => extractFunction(APP, name)).join('\n'), ctx);
  vm.runInContext('function _prodMarkLegacyReadIncomplete(post, component, incomplete) { post._incompleteByComponent = post._incompleteByComponent || {}; post._incompleteByComponent[component] = !!incomplete; }', ctx);
  // Reuse the exact F34 pattern and extraction helper; its narrow grammar is
  // supplementary evidence, not the scanner's entire discovery universe.
  const pattern = RESCUE.match(/^const UPLOAD_RE = .+;$/m);
  if (!pattern) throw new Error('helper_source_changed');
  vm.runInContext(pattern[0] + '\n' + extractFunction(RESCUE, 'urlsFromText'), ctx);
  return ctx;
}

module.exports = { ROOT, APP, readerHelpers };
