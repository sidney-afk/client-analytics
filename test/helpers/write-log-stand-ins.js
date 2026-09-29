'use strict';
/* Stand-ins for the two failed-saves helpers (_writeUiTrackSave,
 * _writeUiRecordSaveFailure), for suites that run one function of the page in a
 * sandbox. The real helpers hand back the request's own response and rethrow
 * its own error, and log a refusal; a sandbox has no log, so these do the first
 * part and nothing else. test/write-path-refusal-coverage.js runs the real ones. */
module.exports = {
  _writeUiTrackSave: (surface, operation, context, send) => send(),
  _writeUiRecordSaveFailure: () => {},
};
