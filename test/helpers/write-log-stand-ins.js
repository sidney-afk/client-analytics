'use strict';
/* Stand-ins for the two failed-saves helpers (_writeUiTrackSave,
 * _writeUiRecordSaveFailure), for suites that run one function of the page in a
 * sandbox. The real helpers hand back the request's own response and rethrow
 * its own error, and log a refusal; a sandbox has no log, so these do the first
 * part and nothing else. test/write-path-refusal-coverage.js runs the real ones. */
module.exports = {
  _writeUiTrackSave: (surface, operation, context, send) => send(),
  _writeUiRecordSaveFailure: () => {},
  // OPEN_REPAIRS 638: Workload's reports (a dropped second change, a save that landed after a failure, a reload
  // mid-save). They only report; test/workload-reports-browser.js runs the real ones.
  _wlReport: () => {},
  _wlSaveStarted: () => {},
  _wlSaveSettled: () => {},
};
