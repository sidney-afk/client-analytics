'use strict';

const { parseScenarioFilter } = require('./nightly-input.js');

const SCENARIO_LANES = Object.freeze(['flat', 'tree', 'visual']);
const LANE_CATALOG = Object.freeze({ flat: 'flat', tree: 'tree', visual: 'flat' });

class ScenarioSelectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ScenarioSelectionError';
    this.code = code;
  }
}

function uniqueSpecs(specs) {
  const result = [];
  const seen = new Set();
  for (const spec of Array.isArray(specs) ? specs : []) {
    const key = String(spec && spec.key || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(spec);
  }
  return Object.freeze(result);
}

function buildScenarioCatalogs(flatSpecs, treeSpecs) {
  const flat = uniqueSpecs(flatSpecs);
  const tree = uniqueSpecs(treeSpecs);
  const unionKeys = Object.freeze([...new Set([
    ...flat.map(spec => String(spec.key)),
    ...tree.map(spec => String(spec.key)),
  ])]);
  return Object.freeze({ flat, tree, unionKeys });
}

function parseSelectors(rawSelector) {
  let normalized;
  try {
    normalized = parseScenarioFilter(rawSelector);
  } catch (_) {
    throw new ScenarioSelectionError('invalid', 'invalid scenario selector input');
  }
  if (normalized == null) return Object.freeze([]);
  const selectors = normalized.split(',');
  if (new Set(selectors).size !== selectors.length) {
    throw new ScenarioSelectionError('duplicate', 'duplicate scenario selectors are not allowed');
  }
  return Object.freeze(selectors);
}

function validateSelectors(selectors, catalogs) {
  const unionKeys = catalogs && Array.isArray(catalogs.unionKeys) ? catalogs.unionKeys : [];
  if (!selectors.every(selector => unionKeys.some(key => key.includes(selector)))) {
    throw new ScenarioSelectionError('unknown', 'one or more scenario selectors are unknown');
  }
}

function laneSelection(lane, selectors, catalogs) {
  const catalogLane = LANE_CATALOG[lane];
  if (!catalogLane) {
    throw new ScenarioSelectionError('lane', 'unknown scenario lane');
  }
  const source = catalogs && Array.isArray(catalogs[catalogLane]) ? catalogs[catalogLane] : [];
  if (!selectors.length && !source.length) {
    throw new ScenarioSelectionError('empty-catalog', 'approved scenario catalog is empty');
  }
  const localSelectors = selectors.filter(
    selector => source.some(spec => String(spec.key).includes(selector)),
  );
  const specs = selectors.length
    ? source.filter(spec => localSelectors.some(selector => String(spec.key).includes(selector)))
    : [...source];
  return Object.freeze({
    lane,
    catalogLane,
    requestedSelectors: selectors,
    selectors: Object.freeze(localSelectors),
    filter: localSelectors.length ? localSelectors.join(',') : null,
    specs: Object.freeze(specs),
    skipped: selectors.length > 0 && specs.length === 0,
  });
}

function selectScenarioLane(rawSelector, lane, catalogs) {
  const selectors = parseSelectors(rawSelector);
  validateSelectors(selectors, catalogs);
  return laneSelection(lane, selectors, catalogs);
}

function selectScenarioLanes(rawSelector, catalogs) {
  const selectors = parseSelectors(rawSelector);
  validateSelectors(selectors, catalogs);
  return Object.freeze(Object.fromEntries(
    SCENARIO_LANES.map(lane => [lane, laneSelection(lane, selectors, catalogs)]),
  ));
}

module.exports = {
  LANE_CATALOG,
  SCENARIO_LANES,
  ScenarioSelectionError,
  buildScenarioCatalogs,
  selectScenarioLane,
  selectScenarioLanes,
};
