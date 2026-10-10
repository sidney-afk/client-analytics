'use strict';

const NIGHTLY_PROBES_ENV = 'SYNCVIEW_NIGHTLY_PROBES';
const NIGHTLY_SCENARIO_ENV = 'SYNCVIEW_NIGHTLY_SCN';
// Probes a workflow step leaves out of its run (same name rules as the selection).
const NIGHTLY_SKIP_ENV = 'SYNCVIEW_NIGHTLY_SKIP';
// The only probes a workflow step runs, out of whatever was selected.
const NIGHTLY_ONLY_ENV = 'SYNCVIEW_NIGHTLY_ONLY';
const MAX_DISPATCH_INPUT = 4096;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function dispatchText(value) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > MAX_DISPATCH_INPUT) throw new Error('Nightly dispatch input is too long');
  return text;
}

function parseProbeSelection(value) {
  const text = dispatchText(value);
  if (!text) return [];
  return text.split(/\s+/).map(rawName => {
    const name = rawName.endsWith('.js') ? rawName.slice(0, -3) : rawName;
    if (!SAFE_NAME.test(name)) throw new Error('Invalid nightly probe selection');
    return `${name}.js`;
  });
}

function parseScenarioFilter(value) {
  const text = dispatchText(value);
  if (!text) return null;
  const names = text.split(',').map(name => name.trim()).filter(Boolean);
  if (!names.length || names.some(name => !SAFE_NAME.test(name))) {
    throw new Error('Invalid nightly scenario filter');
  }
  return names.join(',');
}

module.exports = {
  NIGHTLY_PROBES_ENV,
  NIGHTLY_SCENARIO_ENV,
  NIGHTLY_SKIP_ENV,
  NIGHTLY_ONLY_ENV,
  parseProbeSelection,
  parseScenarioFilter,
};
