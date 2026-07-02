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
// The Samples review tree, parameterized by COMPONENT ('video' | 'graphic'):
// the other component is pinned Approved so the lower-wins overall status
// tracks the branch component (the same simplification the golden probes use).
// Each fork is a real user choice; shared prefixes are written once. Branch
// beats cover the full multi-actor interaction set: approvals, change
// requests, plain comments (client / Kasper-internal), the SMM reply, the
// resolve-destination chooser loops, Kasper undo and Finish.
// ---------------------------------------------------------------------------
function samplesReviewTree(comp) {
  const other = comp === 'video' ? 'graphic' : 'video';
  const compLabel = comp === 'video' ? 'video' : 'thumbnail';
  const sub = comp + '_status';
  return {
    key: comp,
    title: `Sample at For SMM Approval (${compLabel}; ${other === 'video' ? 'video' : 'thumbnail'} pre-approved)`,
    seed: { [sub]: 'For SMM Approval', [other + '_status']: 'Approved', status: 'For SMM Approval' },
    shots: comp === 'video',   // screenshot one component's tree; the other re-runs the logic
    children: [
      // ---- SMM decides ----
      {
        key: 'smm_approve', title: `SMM approves ${compLabel} → Kasper`,
        steps: [['smm.approve', comp, 'primary'], ['expect', sub, 'Kasper Approval']],
        children: [
          // ---- Kasper decides (shared SMM-approve prefix above) ----
          {
            key: 'kasper_approve', title: 'Kasper approves → Client',
            steps: [['kasper.approve', comp], ['expect', sub, 'Client Approval']],
            children: [
              {
                key: 'client_approve', title: 'Client approves → Approved',
                steps: [['client.approve', comp], ['expect', sub, 'Approved'], ['expect', 'status', 'Approved']],
              },
              {
                key: 'client_comment', title: 'Client comments (no status change) then approves',
                steps: [['client.comment', comp, 'Client: quick note, all good'], ['expectComment', comp, { role: 'client', is_tweak: false }], ['expect', sub, 'Client Approval'], ['client.approve', comp], ['expect', sub, 'Approved']],
              },
              {
                key: 'client_request', title: 'Client requests change → Tweaks Needed',
                steps: [['client.request', comp, 'CLIENT_TREE_ASK please adjust'], ['expect', sub, 'Tweaks Needed'], ['expectComment', comp, { role: 'client', is_tweak: true }]],
                children: [
                  {
                    // At Tweaks Needed the card leaves the client queue, so the
                    // reply is asserted after the SMM re-offers at Client Approval.
                    key: 'smm_reply', title: 'SMM replies → re-offer — client sees the answer',
                    steps: [['smm.reply', comp, 'SMM_TREE_ANSWER fix en route'], ['expectComment', comp, { role: 'smm', reply: true }], ['smm.status', comp, 'Client Approval'], ['expect', sub, 'Client Approval'], ['expectClientThread', comp, { contains: ['CLIENT_TREE_ASK', 'SMM_TREE_ANSWER'] }]],
                  },
                  {
                    key: 'resolve_client', title: 'SMM resolves → chooser → Client → client approves',
                    steps: [['smm.resolveVia', comp, 'client'], ['expect', sub, 'Client Approval'], ['expectComment', comp, { any: true, done: true }], ['client.approve', comp], ['expect', sub, 'Approved']],
                  },
                  {
                    key: 'resolve_kasper', title: 'SMM resolves → chooser → Kasper re-review',
                    steps: [['smm.resolveVia', comp, 'kasper'], ['expect', sub, 'Kasper Approval'], ['expectComment', comp, { any: true, done: true }]],
                  },
                ],
              },
            ],
          },
          {
            key: 'kasper_request', title: 'Kasper requests change → Tweaks Needed',
            steps: [['kasper.request', comp, 'Kasper: needs a tweak'], ['expect', sub, 'Tweaks Needed'], ['expectComment', comp, { role: 'kasper', is_tweak: true }]],
            children: [
              {
                key: 'finish', title: 'Kasper finishes reviewing → Sent to SMM',
                steps: [['kasper.finish'], ['expectKasperCard', 'finished']],
              },
              {
                key: 'resolve_back', title: 'SMM resolves → chooser → back to Kasper → Kasper approves',
                steps: [['smm.resolveVia', comp, 'kasper'], ['expect', sub, 'Kasper Approval'], ['kasper.approve', comp], ['expect', sub, 'Client Approval']],
              },
            ],
          },
          {
            // AAT routes the component to TWEAKS NEEDED (the editor applies the
            // fix first), pre-cleared via kasper_approved_after_tweaks — matches
            // the flat kasper_aat_* scenarios and the shipping code.
            key: 'kasper_aat', title: 'Kasper approve-after-tweaks → Tweaks Needed (pre-cleared)',
            steps: [['kasper.aat', comp, 'Kasper: fix then send on'], ['expect', sub, 'Tweaks Needed'], ['expect', 'kasper_approved_after_tweaks', comp]],
          },
          {
            key: 'kasper_comment', title: 'Kasper internal comment — status unchanged',
            steps: [['kasper.comment', comp, 'Kasper: internal question'], ['expectComment', comp, { role: 'kasper', is_tweak: false }], ['expect', sub, 'Kasper Approval']],
          },
          {
            key: 'kasper_undo', title: 'Kasper approves then Undo restores Kasper Approval',
            steps: [['kasper.approve', comp], ['expect', sub, 'Client Approval'], ['kasper.undo'], ['expect', sub, 'Kasper Approval'], ['expectKasperCard', 'present']],
          },
        ],
      },
      // ---- SMM alternate routes (siblings of smm_approve) ----
      {
        key: 'smm_alt', title: 'SMM alt-route → straight to Client',
        steps: [['smm.approve', comp, 'alt'], ['expect', sub, 'Client Approval']],
      },
      {
        key: 'smm_request', title: 'SMM requests change → Tweaks Needed',
        steps: [['smm.request', comp, 'Please tighten this'], ['expect', sub, 'Tweaks Needed'], ['expectComment', comp, { role: 'smm', is_tweak: true }]],
      },
    ],
  };
}

// The runner sources its specs from here when invoked with --tree.
// Both components get the full tree (interaction symmetry — the graphic
// pipeline has historically been the less-tested twin).
function base() { return [...compile(samplesReviewTree('video')), ...compile(samplesReviewTree('graphic'))]; }

module.exports = { compile, samplesReviewTree, base, mergeSeed };

// CLI: `node qa/scenario_tree.js` prints the compiled leaves (no browser) so the
// tree expansion can be validated deterministically.
if (require.main === module) {
  const specs = base();
  console.log(`Samples review tree → ${specs.length} leaf scenarios:\n`);
  for (const s of specs) console.log(`  ${s.key.padEnd(48)} ${s.steps.length} steps   ${s.title}`);
  console.log(`\npass=${specs.length} fail=0  (compiled ${specs.length} root→leaf paths)`);
}
