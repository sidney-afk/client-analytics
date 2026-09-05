'use strict';
const vm = require('node:vm');
// Load the actual owner/recovery helpers into existing intercepted writer
// fixtures. Preserve each fixture's writer, pending batch and save locks.
module.exports = function loadSamplesWork(source, context) {
  const storage = new Map();
  const defaults = {
    _sxrSaveTimers: {}, _sxrNoLinearPush: new Set(), _sxrFailedNewCards: new Set(),
    _sxrLocalRecentSaves: new Map(), _sxrRecentSaveFields: new Map(), _sxrConflictNotified: new Set(),
    _prodStripEphemeralCanonicalPosts: rows => rows,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value),
      removeItem: key => storage.delete(key), key: index => [...storage.keys()][index], get length() { return storage.size; } },
  };
  for (const [key,value] of Object.entries(defaults)) if (!(key in context)) context[key] = value;
  const start = source.indexOf('    const SXR_WORK_PREFIX =');
  vm.runInContext(source.slice(start, source.indexOf('    let _sxrLoadSeq =', start)), context);
};
