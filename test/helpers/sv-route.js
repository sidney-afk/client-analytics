'use strict';
// The real clean-address router (src/index/003-sv-route.html.part), loaded at
// the site root, for suites that run app functions in a sandbox: they read the
// address through svRoute.search()/hash() and build links with svRoute.clean().
const { routeTable } = require('../../scripts/build-route-stubs.js');

// A router bound to a fake location, so svRoute.search()/hash() answer from it.
function svRouteFor(location) {
  const r = routeTable();
  const loc = () => (typeof location === 'function' ? location() : location) || {};
  return Object.assign({}, r, {
    search() { const l = loc(); const t = r.toLegacy(l.pathname || '/', l.search || ''); return t ? t.search : (l.search || ''); },
    hash() { const l = loc(); const t = r.toLegacy(l.pathname || '/', l.search || ''); return t ? t.hash : (l.hash || ''); },
  });
}

module.exports = { svRoute: routeTable(), svRouteFor };
