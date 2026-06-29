'use strict';
// ============================================================================
// scenario_tree.js — the BRANCHING scenario tree.
//
// `scenarios.js` is a FLAT list of ~51 independent linear paths: every variation
// re-states the whole flow from the seed, and shared prefixes (SMM approves →
// Kasper approves → …) are copy-pasted across many scenarios. That is exactly the
// "tree with branches of possible scenarios" the goal asked for — modelled as a
// tree instead of a flat list.
//
// A node is one beat of the flow:
//   { key, title, seed?, steps?, shots?, children? }
//     key      — filename-safe path segment (snake/word; NO hyphens — shot files
//                are `${key}-NN-label.png` and the parser anchors on `-\d\d-`)
//     title    — human label for this beat
//     seed      — optional seed overrides, merged top-down along the path
//     steps     — verb tuples run at this beat (same verbs as scenarios.js /
//                 scenario_engine.js: ['smm.approve','video','primary'],
//                 ['expect','video_status','Kasper Approval'], …)
//     shots     — if true, paths through here capture screenshots
//     children  — branch points; a node with no children is a LEAF
//
// compile(root) walks root→leaf (DFS) and emits ONE flat scenario per leaf —
// exactly the { key, title, seed, steps, shots } shape `runScenario` already
// consumes — so the proven engine runs each path unchanged. Shared prefixes are
// authored ONCE at the branch point and reused by every leaf beneath it.
// ============================================================================

// Merge seed objects down a path (later/deeper overrides shallower).
function mergeSeed(a, b) { return Object.assign({}, a || {}, b || {}); }

// DFS the tree → array of flat specs { key, title, seed, steps, shots }.
function compile(root) {
  const specs = [];
  (function walk(node, keyPath, titlePath, seed, steps, shots) {
    const k = [...keyPath, node.key];
    const t = node.title ? [...titlePath, node.title] : titlePath;
    const s = mergeSeed(seed, node.seed);
    const st = [...steps, ...(node.steps || [])];
    const sh = shots || !!node.shots;
    if (!node.children || node.children.length === 0) {
      specs.push({ key: k.join('__'), title: t.join(' → '), seed: s, steps: st, shots: sh });
    } else {
      for (const c of node.children) walk(c, k, t, s, st, sh);
    }
  })(root, [], [], {}, [], false);

  // Guard: leaf keys must be unique (they become scenario ids + shot filenames).
  const seen = new Set();
  for (const sp of specs) {
    if (seen.has(sp.key)) throw new Error('scenario_tree: duplicate leaf key ' + sp.key);
    seen.add(sp.key);
  }
  return specs;
}

// ---------------------------------------------------------------------------
// The Samples review tree. Models the real decision points of the review
// lifecycle for the VIDEO component (graphic pinned Approved so the lower-wins
// overall status tracks video — the same simplification the golden probes use).
// Each fork is a real user choice; shared prefixes are written once.
// ---------------------------------------------------------------------------
function samplesReviewTree() {
  return {
    key: 'video',
    title: 'Sample at For SMM Approval (video; thumbnail pre-approved)',
    seed: { video_status: 'For SMM Approval', graphic_status: 'Approved', status: 'For SMM Approval' },
    shots: true,
    children: [
      // ---- SMM decides ----
      {
        key: 'smm_approve', title: 'SMM approves video → Kasper',
        steps: [['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Kasper Approval']],
        children: [
          // ---- Kasper decides (shared SMM-approve prefix above) ----
          {
            key: 'kasper_approve', title: 'Kasper approves → Client',
            steps: [['kasper.approve', 'video'], ['expect', 'video_status', 'Client Approval']],
            children: [
              {
                key: 'client_approve', title: 'Client approves → Approved',
                steps: [['client.approve', 'video'], ['expect', 'video_status', 'Approved'], ['expect', 'status', 'Approved']],
              },
              {
                key: 'client_request', title: 'Client requests change → Tweaks Needed',
                steps: [['client.request', 'video', 'Client: please adjust'], ['expect', 'video_status', 'Tweaks Needed'], ['expectComment', 'video', { role: 'client', is_tweak: true }]],
              },
            ],
          },
          {
            key: 'kasper_request', title: 'Kasper requests change → Tweaks Needed',
            steps: [['kasper.request', 'video', 'Kasper: needs a tweak'], ['expect', 'video_status', 'Tweaks Needed'], ['expectComment', 'video', { role: 'kasper', is_tweak: true }]],
          },
          {
            key: 'kasper_aat', title: 'Kasper approve-after-tweaks → back to SMM',
            steps: [['kasper.aat', 'video', 'Kasper: fix then send to SMM'], ['expect', 'video_status', 'For SMM Approval'], ['expect', 'kasper_approved_after_tweaks', 'video']],
          },
        ],
      },
      // ---- SMM alternate routes (siblings of smm_approve) ----
      {
        key: 'smm_alt', title: 'SMM alt-route → straight to Client',
        steps: [['smm.approve', 'video', 'alt'], ['expect', 'video_status', 'Client Approval']],
      },
      {
        key: 'smm_request', title: 'SMM requests change → Tweaks Needed',
        steps: [['smm.request', 'video', 'Please tighten this'], ['expect', 'video_status', 'Tweaks Needed'], ['expectComment', 'video', { role: 'smm', is_tweak: true }]],
      },
    ],
  };
}

// The runner sources its specs from here when invoked with --tree.
function base() { return compile(samplesReviewTree()); }

module.exports = { compile, samplesReviewTree, base, mergeSeed };

// CLI: `node qa/scenario_tree.js` prints the compiled leaves (no browser) so the
// tree expansion can be validated deterministically.
if (require.main === module) {
  const specs = base();
  console.log(`Samples review tree → ${specs.length} leaf scenarios:\n`);
  for (const s of specs) console.log(`  ${s.key.padEnd(48)} ${s.steps.length} steps   ${s.title}`);
  console.log(`\npass=${specs.length} fail=0  (compiled ${specs.length} root→leaf paths)`);
}
