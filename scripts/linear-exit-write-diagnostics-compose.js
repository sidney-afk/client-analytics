'use strict';
/* WR-101 gateway composition.

   Until 2026-09-22 this module did two things, and both were built on a stored
   sha256 of a file it then patched in memory: the production-write gateway, and
   `index.html`.

   The `index.html` half is gone. `index.html` is a build output, so pinning it
   guaranteed the pin went stale on every merge that touched any `src/index/`
   fragment -- 38 of them between the September 12 preparation and this release
   -- and a stale pin fails the browser suite for a reason that has nothing to
   do with the diagnostics. The browser beacon now lives in its real source,
   `src/index/120-calendar-flags-write-repair.js.part`, and reaches the page
   through `npm run build:index` like every other browser change.

   The gateway half stays, but it no longer patches anything either: the four
   integration points are COMMITTED in `supabase/functions/production-write/index.ts`,
   because that committed file is what the Section 4 deploy lane uploads. An
   in-memory composition could never have been deployed. What remains here is
   the structure check -- each integration point present exactly once -- so a
   refactor that silently drops one is a failing test rather than a gateway that
   deploys and quietly records nothing. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const GATEWAY = 'supabase/functions/production-write/index.ts';

// Each entry is a fragment that must appear EXACTLY once in the released
// gateway. Exactly-once matters in both directions: zero means the integration
// point was removed, and more than one means a refactor duplicated a seam and
// a single refusal would be recorded twice.
const GATEWAY_INTEGRATION_POINTS = Object.freeze([
  'import { captureRefusalContext, captureVerifiedPrincipal, reportGatewayRefusal } from "../_shared/write-refusal-diagnostics.mjs";',
  'async function authenticateWithoutDiagnostics(',
  'captureVerifiedPrincipal(req, principal);',
  'captureRefusalContext(req, body);',
  'return await reportGatewayRefusal(supabase, req, error, json({ ok: false, error: error.code, ...(error.detail || {}) }, error.status));',
]);

function gateway() {
  const source = fs.readFileSync(path.join(root, GATEWAY), 'utf8');
  for (const fragment of GATEWAY_INTEGRATION_POINTS) {
    const count = source.split(fragment).length - 1;
    if (count !== 1) {
      throw new Error(`WR101_GATEWAY_INTEGRATION_DRIFT: expected exactly one occurrence, found ${count}: ${fragment.slice(0, 72)}`);
    }
  }
  return {
    source,
    file: GATEWAY,
    integration_points: GATEWAY_INTEGRATION_POINTS.length,
    // Committed in the repository, but NOT live: production-write deploys only
    // through the dispatch-only Section 4 lane, never on merge.
    separate_release_required: true,
  };
}

module.exports = { gateway, GATEWAY, GATEWAY_INTEGRATION_POINTS };
