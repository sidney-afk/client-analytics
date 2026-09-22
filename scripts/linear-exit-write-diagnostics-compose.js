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

/* Each entry is a fragment that must appear an EXACT number of times in the
   released gateway. The count is checked in both directions: too few means an
   integration point was removed, too many means a refactor duplicated a seam
   and one refusal would be recorded twice.

   The principal capture sits on `authenticate`'s three success returns rather
   than in a wrapper around a renamed resolver, which is what the September 12
   preparation did. Renaming it broke two unrelated suites --
   `public-intake-open-submission` and `production-write-gateway` -- that
   extract that resolver by the name `authenticate` and bound it on its own
   final `credentials_required` refusal. The capture had to move to where it
   does not disturb the shape those suites read. */
const GATEWAY_INTEGRATION_POINTS = Object.freeze([
  Object.freeze({ fragment: 'import { captureRefusalContext, captureVerifiedPrincipal, reportGatewayRefusal } from "../_shared/write-refusal-diagnostics.mjs";', count: 1 }),
  Object.freeze({ fragment: 'captureRefusalContext(req, body);', count: 1 }),
  // One per success return of authenticate(): the TEST principal, the staff
  // principal and the client principal. A refusal can then say WHICH kind of
  // principal hit it.
  Object.freeze({ fragment: 'captureVerifiedPrincipal(req, testPrincipal);', count: 1 }),
  Object.freeze({ fragment: 'captureVerifiedPrincipal(req, principal);', count: 2 }),
  Object.freeze({ fragment: 'return await reportGatewayRefusal(supabase, req, error, json({ ok: false, error: error.code, ...(error.detail || {}) }, error.status));', count: 1 }),
]);

function gateway() {
  const source = fs.readFileSync(path.join(root, GATEWAY), 'utf8');
  for (const point of GATEWAY_INTEGRATION_POINTS) {
    const found = source.split(point.fragment).length - 1;
    if (found !== point.count) {
      throw new Error(`WR101_GATEWAY_INTEGRATION_DRIFT: expected ${point.count} occurrence(s), found ${found}: ${point.fragment.slice(0, 72)}`);
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
