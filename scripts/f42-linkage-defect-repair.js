#!/usr/bin/env node
'use strict';

// F42 Brick 1 — LINK-DEFECT REPAIR planner + apply runner.
//
// A `deliverable_crosswalk_mismatch` defect is a card whose deliverable EXISTS
// but does not describe that card, so `production_comment_card_import` refuses
// the row. Unlike a deferral it does NOT resolve itself: something has to
// repair the bad link. This is that repair, and it is deliberately the smallest
// possible one — it writes ONLY the `deliverables` table, never a card column,
// never `production_comments`.
//
// Authority, per docs/independence/F42_CARD_DELIVERABLE_LINKAGE_REPORT.md §3:
//
//   Class A  crosswalk_fields:card_id,origin
//            The deliverable is still sitting at its origin='manual',
//            card_id=NULL default while a card points at it. Live evidence:
//            ZERO of the origin='manual' deliverables carry a card_id, which is
//            exactly what a card-side-only link write leaves behind
//            (scripts/b3-linkage-backfill.js patches only the card tables and
//            says so in its header). The CARD is authoritative: it names the
//            deliverable it intends, and the deliverable was simply never
//            stamped. Repair = finish the half-done link.
//
//   Class B  crosswalk_fields:team
//            origin, card_id and client_slug all match, so the deliverable was
//            genuinely born from this card, but `team` disagrees with the
//            component. Cause: deliverables whose `kind` and `team` are
//            inconsistent. The crosswalk validates `team`; the card slot and
//            `kind` imply the truth. KIND + THE CARD SLOT are authoritative.
//            Repair = correct the one wrong field.
//
//   Class C  crosswalk_fields:card_id (alone)
//            A correctly-formed deliverable is bound to a DIFFERENT card.
//            Authority is genuinely ambiguous: repointing orphans the other
//            card (which may already have imported comments), clearing the
//            pointing card returns its rows to the deferral bucket. This runner
//            NEVER repairs Class C. It reports each one with the specifics the
//            owner needs to rule, in the runner-local plan only.
//
// Every other mismatch shape is UNCLASSIFIED and never repaired.
//
// Ordering: the apply must not run until the canonical gate requires a
// crosswalk-VALID link (PR "Canonical comment gate: require a crosswalk-VALID
// link"). Repairing a defect makes its card canonical-valid, which flips the
// card to the canonical render path; before that fix, a card whose comments are
// not yet imported would render an empty canonical thread over its real legacy
// comments and persist the emptied *_tweaks string on the next save.
//
// Public-safety: the rendered summary carries classification x surface x reason
// COUNTS ONLY. Card ids, client slugs, deliverable ids and comment bodies stay
// in the runner-local plan and the private rollback artifact, and never reach a
// public Actions log.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CONFIRM_ENV = 'F42_CONFIRM_LINKAGE_REPAIR';
const CONFIRM_TOKEN = 'REPAIR_LINK_DEFECTS';
const REPAIR_TAG = 'f42-linkage-repair';
const PLAN_CONTRACT = 'syncview-f42-linkage-repair-plan-v1';

// Mirrors scripts/f42-card-comment-import.js.
const SURFACE_ORIGIN = Object.freeze({ calendar: 'calendar', sxr: 'samples' });
const PUBLIC_SURFACES = Object.freeze(['calendar', 'sxr']);

// The repair classes this runner is willing to act on, keyed by the planner's
// exact sorted `crosswalk_fields:` reason string.
const REPAIR_CLASSES = Object.freeze({
  'card_id,origin': 'class_a_unstamped_deliverable',
  team: 'class_b_team_disagrees_with_kind',
});
const OWNER_RULING_CLASS = 'card_id';

// QA-fixture Linear workspaces. Cards whose Linear link points at one of these
// are QA fixtures, not client work: they account for a large share of the
// deferred comment population and must never be imported or repaired. Owner
// ruling is PROVISIONAL pending final sign-off at the window; the policy is
// part of the plan and therefore part of the apply digest, so changing it moves
// the digest and refuses a stale apply.
const EXCLUDED_LINEAR_WORKSPACES = Object.freeze(['x', 'sidtest', 'syn', 'acme']);
const SCOPE_POLICY = 'defect-repair-clear-authority-only';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value === undefined ? null : value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function teamForComponent(component) {
  return component === 'graphic' ? 'graphics' : 'video';
}

function kindForComponent(component) {
  return component === 'graphic' ? 'thumbnail' : 'video';
}

function cardSlug(card) {
  return clean(card && (card.client_slug || card.client));
}

// The Linear workspace segment of a card link, used only to apply the
// fixture-exclusion policy. Returns '' when there is no parseable link.
function linearWorkspace(value) {
  const raw = clean(value);
  if (!raw) return '';
  const match = raw.match(/^https?:\/\/[^/]+\/([^/]+)/i);
  return match ? lower(match[1]) : '';
}

function cardExcludedByPolicy(card) {
  const links = [card && card.linear_issue_id, card && card.graphic_linear_issue_id];
  for (const link of links) {
    const workspace = linearWorkspace(link);
    if (workspace && EXCLUDED_LINEAR_WORKSPACES.includes(workspace)) return workspace;
  }
  return '';
}

// Mirrors deliverableCrosswalkIssues() in scripts/f42-card-comment-import.js
// exactly: origin/team case-insensitive, client_slug/card_id exact after trim.
function mismatchFields(deliverable, surface, card, component) {
  const expectedOrigin = SURFACE_ORIGIN[lower(surface)] || '';
  const fields = [];
  if (lower(deliverable && deliverable.origin) !== expectedOrigin) fields.push('origin');
  if (lower(deliverable && deliverable.team) !== teamForComponent(component)) fields.push('team');
  if (clean(deliverable && deliverable.client_slug) !== cardSlug(card)) fields.push('client_slug');
  if (clean(deliverable && deliverable.card_id) !== clean(card && card.id)) fields.push('card_id');
  return fields.sort();
}

// A Class A repair is only safe when the deliverable is genuinely unclaimed and
// the two facts the crosswalk does NOT dispute already agree. Anything else is
// escalated rather than guessed.
function classAObjections(deliverable, surface, card, component, byCardSlot) {
  const objections = [];
  if (clean(deliverable.client_slug) !== cardSlug(card)) objections.push('client_slug_disagrees');
  if (lower(deliverable.team) !== teamForComponent(component)) objections.push('team_disagrees');
  if (clean(deliverable.card_id)) objections.push('deliverable_already_claims_a_card');
  if (!['manual', ''].includes(lower(deliverable.origin))) objections.push('origin_is_not_manual');
  // deliverables_card_slot_unique (client_slug, origin, card_id, kind) WHERE
  // card_id IS NOT NULL AND origin IN ('calendar','samples'). Stamping this row
  // must not collide with a row already occupying that slot.
  const slot = [
    lower(deliverable.client_slug),
    SURFACE_ORIGIN[lower(surface)] || '',
    clean(card && card.id),
    lower(deliverable.kind),
  ].join('|');
  const occupant = byCardSlot.get(slot);
  if (occupant && clean(occupant.id) !== clean(deliverable.id)) {
    objections.push('card_slot_unique_would_collide');
  }
  return objections.sort();
}

function classBObjections(deliverable, component) {
  const objections = [];
  const expectedKind = kindForComponent(component);
  if (lower(deliverable.kind) !== expectedKind) objections.push('kind_does_not_imply_the_repair');
  if (lower(deliverable.team) === teamForComponent(component)) objections.push('team_already_correct');
  return objections.sort();
}

/* Builds the repair plan from a private snapshot of the shape
   { cards: { calendar: [], sxr: [] }, deliverables: [] } — the same projection
   scripts/f42-card-comment-export.js already produces, plus the two Linear link
   columns needed to apply the fixture-exclusion policy.

   Only (card, component) pairs that CARRY COMMENTS are considered: a defect on
   a comment-free card blocks nothing and is not worth a production write. */
function planLinkageRepair(snapshot, options = {}) {
  const doc = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const cards = doc.cards && typeof doc.cards === 'object' ? doc.cards : {};
  const deliverables = Array.isArray(doc.deliverables) ? doc.deliverables : [];
  const runId = clean(options.runId) || `${REPAIR_TAG}-dry-run`;

  const byId = new Map();
  const byCardSlot = new Map();
  for (const row of deliverables) {
    const id = clean(row && row.id);
    if (!id) continue;
    byId.set(id, row);
    if (clean(row.card_id) && ['calendar', 'samples'].includes(lower(row.origin))) {
      byCardSlot.set([
        lower(row.client_slug), lower(row.origin), clean(row.card_id), lower(row.kind),
      ].join('|'), row);
    }
  }

  const repairs = [];
  const ownerRulings = [];
  const skipped = [];
  const conflicts = [];

  for (const surface of PUBLIC_SURFACES) {
    const rows = Array.isArray(cards[surface]) ? cards[surface] : [];
    rows.forEach((card, rowIndex) => {
      const cardId = clean(card && card.id);
      if (!cardId) {
        conflicts.push({ classification: 'missing_card_id', surface, row_index: rowIndex });
        return;
      }
      const excludedWorkspace = cardExcludedByPolicy(card);
      for (const component of ['video', 'graphic', 'caption', 'title']) {
        const commentCount = Number(
          (card.comment_counts && card.comment_counts[component]) || 0,
        );
        if (!commentCount) continue;
        const targetId = clean(component === 'graphic'
          ? card.graphic_deliverable_id
          : card.video_deliverable_id);
        if (!targetId) continue;
        const deliverable = byId.get(targetId);
        if (!deliverable) continue;
        const fields = mismatchFields(deliverable, surface, card, component);
        if (!fields.length) continue;

        const base = {
          surface,
          card_id: cardId,
          client_slug: cardSlug(card),
          component,
          deliverable_id: targetId,
          classification: 'deliverable_crosswalk_mismatch',
          fields,
          reason: `crosswalk_fields:${fields.join(',')}`,
          comment_rows: commentCount,
        };

        if (excludedWorkspace) {
          skipped.push({ ...base, skip_reason: 'excluded_fixture_workspace' });
          continue;
        }

        const key = fields.join(',');
        if (key === OWNER_RULING_CLASS) {
          ownerRulings.push({
            ...base,
            repair_class: 'class_c_bound_to_another_card',
            // The specifics the owner needs to rule. Runner-local only.
            deliverable_currently_bound_to_card_id: clean(deliverable.card_id),
            deliverable_kind: lower(deliverable.kind),
            deliverable_origin: lower(deliverable.origin),
            options: [
              'repoint_deliverable_to_this_card',
              'clear_this_card_pointer',
            ],
          });
          continue;
        }

        const repairClass = REPAIR_CLASSES[key];
        if (!repairClass) {
          skipped.push({ ...base, skip_reason: 'unclassified_mismatch_shape' });
          continue;
        }

        const objections = key === 'team'
          ? classBObjections(deliverable, component)
          : classAObjections(deliverable, surface, card, component, byCardSlot);
        if (objections.length) {
          skipped.push({
            ...base,
            skip_reason: 'authority_not_clear',
            objections,
          });
          continue;
        }

        const before = key === 'team'
          ? { team: clean(deliverable.team) }
          : { origin: clean(deliverable.origin), card_id: clean(deliverable.card_id) };
        const after = key === 'team'
          ? { team: teamForComponent(component) }
          : { origin: SURFACE_ORIGIN[lower(surface)], card_id: cardId };

        // The full observed state of the target row, so the drift guard covers
        // the whole deliverable and not just the two fields being written. Any
        // change to the row between plan and apply moves the digest.
        const target = {
          client_slug: clean(deliverable.client_slug),
          team: lower(deliverable.team),
          kind: lower(deliverable.kind),
          origin: lower(deliverable.origin),
          card_id: clean(deliverable.card_id),
        };
        repairs.push({ ...base, repair_class: repairClass, before, after, target });
      }
    });
  }

  // One deliverable can back several components (video_deliverable_id governs
  // video, caption and title). Collapse to one write per deliverable and refuse
  // if two components demand DIFFERENT after-states for the same row.
  const writesById = new Map();
  for (const repair of repairs) {
    const existing = writesById.get(repair.deliverable_id);
    if (!existing) {
      writesById.set(repair.deliverable_id, {
        deliverable_id: repair.deliverable_id,
        repair_class: repair.repair_class,
        before: repair.before,
        after: repair.after,
        target: repair.target,
        components: [repair.component],
        surface: repair.surface,
      });
      continue;
    }
    if (JSON.stringify(stable(existing.after)) !== JSON.stringify(stable(repair.after))) {
      conflicts.push({
        classification: 'contradictory_repair_for_one_deliverable',
        surface: repair.surface,
        reason: `repair_classes:${[existing.repair_class, repair.repair_class].sort().join(',')}`,
      });
      writesById.delete(repair.deliverable_id);
      continue;
    }
    existing.components.push(repair.component);
  }

  const writes = [...writesById.values()]
    .sort((a, b) => a.deliverable_id.localeCompare(b.deliverable_id));

  const plan = {
    contract: PLAN_CONTRACT,
    run_id: runId,
    scope: {
      policy: SCOPE_POLICY,
      excluded_linear_workspaces: [...EXCLUDED_LINEAR_WORKSPACES],
      excluded_workspaces_ruling: 'provisional_pending_owner_signoff_at_window',
      repairs: repairs.length,
      writes: writes.length,
      owner_rulings: ownerRulings.length,
      skipped: skipped.length,
      comment_rows_unblocked: repairs.reduce((sum, row) => sum + row.comment_rows, 0),
    },
    repairs,
    writes,
    owner_rulings: ownerRulings,
    skipped,
    conflicts,
    complete: conflicts.length === 0,
  };
  plan.apply_digest = repairApplyDigest(plan);
  return plan;
}

// Deterministic fingerprint of exactly what would be written, plus the scope
// policy that decided it. A deliverable re-pointed between plan and apply, or a
// change to the fixture-exclusion ruling, moves the digest and the drift guard
// refuses before any write.
function repairApplyDigest(plan) {
  return sha256({
    contract: plan.contract,
    scope_policy: plan.scope.policy,
    excluded_linear_workspaces: [...EXCLUDED_LINEAR_WORKSPACES].sort(),
    writes: (plan.writes || []).map(write => ({
      deliverable_id: write.deliverable_id,
      repair_class: write.repair_class,
      before: write.before,
      after: write.after,
      // Pinning the whole observed target row — not just the fields being
      // written — is what makes this a real drift guard: a deliverable
      // re-pointed, re-teamed or re-kinded between plan and apply moves the
      // digest and the apply refuses before touching anything.
      target: write.target,
    })),
  });
}

function applyEligibility(plan) {
  const reasons = [];
  if (!plan || clean(plan.contract) !== PLAN_CONTRACT) reasons.push('plan_contract_mismatch');
  if (plan && plan.complete !== true) reasons.push('plan_incomplete');
  if (plan && Array.isArray(plan.conflicts) && plan.conflicts.length) reasons.push('plan_has_conflicts');
  if (plan && clean(plan.scope && plan.scope.policy) !== SCOPE_POLICY) reasons.push('unrecognized_scope_policy');
  if (plan && (!Array.isArray(plan.writes) || !plan.writes.length)) reasons.push('no_writes_planned');
  return { eligible: reasons.length === 0, reasons };
}

/* Public run summary: classification x surface x reason COUNTS ONLY.
   Never a card id, client slug, deliverable id or comment body. */
function tallyPublic(rows) {
  const tally = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const classification = clean(row && (row.repair_class || row.skip_reason || row.classification))
      || 'unclassified';
    const surface = PUBLIC_SURFACES.includes(lower(row && row.surface))
      ? lower(row.surface)
      : 'unspecified';
    const reason = clean(row && row.reason)
      || (Array.isArray(row && row.objections) && row.objections.length
        ? `objections:${row.objections.join(',')}`
        : 'unspecified');
    const key = [classification, surface, reason].join('|');
    const existing = tally.get(key);
    if (existing) existing.count += 1;
    else tally.set(key, { classification, surface, reason, count: 1 });
  }
  return [...tally.values()].sort((a, b) =>
    b.count - a.count
    || a.classification.localeCompare(b.classification)
    || a.surface.localeCompare(b.surface)
    || a.reason.localeCompare(b.reason));
}

function renderSummaryMarkdown(result) {
  const plan = result.plan || {};
  const scope = plan.scope || {};
  const lines = [];
  lines.push('## F42 Brick 1 — link-defect repair');
  lines.push('');
  lines.push(`- status: **${result.status}**`);
  lines.push(`- run id: \`${clean(plan.run_id)}\``);
  lines.push(`- apply digest: \`${clean(plan.apply_digest)}\``);
  lines.push(`- scope policy: \`${clean(scope.policy)}\``);
  lines.push(`- excluded fixture workspaces: \`${(scope.excluded_linear_workspaces || []).join(', ')}\``
    + ` (${clean(scope.excluded_workspaces_ruling)})`);
  lines.push(`- planned deliverable writes: **${scope.writes || 0}**`);
  lines.push(`- defect rows repaired: **${scope.repairs || 0}**`);
  lines.push(`- comment rows unblocked: **${scope.comment_rows_unblocked || 0}**`);
  lines.push(`- awaiting owner ruling: **${scope.owner_rulings || 0}**`);
  lines.push(`- skipped: **${scope.skipped || 0}**`);
  if (result.reasons && result.reasons.length) {
    lines.push(`- blocked by: ${result.reasons.map(r => `\`${r}\``).join(', ')}`);
  }
  const sections = [
    ['Repairs (classification x surface x reason)', tallyPublic(plan.repairs)],
    ['Awaiting owner ruling', tallyPublic(plan.owner_rulings)],
    ['Skipped', tallyPublic(plan.skipped)],
    ['Conflicts', tallyPublic(plan.conflicts)],
  ];
  for (const [title, rows] of sections) {
    if (!rows.length) continue;
    lines.push('');
    lines.push(`### ${title}`);
    lines.push('');
    lines.push('| classification | surface | reason | count |');
    lines.push('| --- | --- | --- | ---: |');
    for (const row of rows) {
      lines.push(`| ${row.classification} | ${row.surface} | ${row.reason} | ${row.count} |`);
    }
  }
  lines.push('');
  lines.push('_Counts only. Per-row card, client and deliverable identities stay in the'
    + ' runner-local plan and the private rollback artifact._');
  return lines.join('\n');
}

/* The private rollback artifact is written BEFORE the first write and flushed
   after every write, so a mid-run failure still leaves an artifact that
   reverses exactly the writes that landed. It carries per-row identities and
   must never be uploaded to a public log. */
function makeRollbackJournal(artifactPath, plan, deps = {}) {
  const writeFile = deps.writeFileSync || fs.writeFileSync;
  const applied = [];
  const record = {
    contract: PLAN_CONTRACT,
    run_id: plan.run_id,
    apply_digest: plan.apply_digest,
    planned: plan.writes.map(write => ({
      deliverable_id: write.deliverable_id,
      repair_class: write.repair_class,
      before: write.before,
      after: write.after,
    })),
    applied,
  };
  const flush = () => {
    if (!artifactPath) return;
    writeFile(path.resolve(artifactPath), JSON.stringify(record, null, 2) + '\n');
  };
  flush();
  return {
    note(write) {
      applied.push({
        deliverable_id: write.deliverable_id,
        restore: write.before,
        applied: write.after,
      });
      flush();
    },
    record,
  };
}

async function applyRepairs(plan, deps = {}) {
  const patchOne = deps.patchOne;
  if (typeof patchOne !== 'function') throw new Error('patch_layer_required');
  const journal = makeRollbackJournal(deps.rollbackArtifact, plan, deps);
  const receipts = [];
  let failure = null;
  try {
    for (const write of plan.writes) {
      // eslint-disable-next-line no-await-in-loop
      await patchOne(write);
      journal.note(write);
      receipts.push(write.deliverable_id);
    }
  } catch (error) {
    failure = clean(error && error.message) || 'patch_failed';
  }
  return {
    receipts,
    applied: receipts.length,
    planned: plan.writes.length,
    failure,
    rollback: journal.record,
  };
}

function verifyApply(plan, applyResult, readback = {}) {
  const gaps = [];
  if (applyResult.failure) gaps.push(`patch_failed:${applyResult.failure}`);
  if (applyResult.applied !== plan.writes.length) gaps.push('applied_count_mismatch');
  const remaining = Number(readback && readback.remaining_defects);
  if (Number.isFinite(remaining) && remaining !== 0) gaps.push('defects_remain_after_repair');
  return gaps;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

async function run(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parseArgs(argv);
  const readFile = deps.readFileSync || fs.readFileSync;
  if (!args.input) throw new Error('--input <private-snapshot.json> is required');
  const snapshot = JSON.parse(readFile(path.resolve(String(args.input)), 'utf8'));
  const plan = planLinkageRepair(snapshot, { runId: args['run-id'] });

  if (args.output) {
    (deps.writeFileSync || fs.writeFileSync)(
      path.resolve(String(args.output)), JSON.stringify(plan, null, 2) + '\n',
    );
  }

  const { eligible, reasons } = applyEligibility(plan);

  if (args['expected-digest'] && clean(args['expected-digest']) !== clean(plan.apply_digest)) {
    return {
      status: 'BLOCKED',
      plan,
      reasons: ['apply_digest_drift'],
      summary_markdown: renderSummaryMarkdown({
        status: 'BLOCKED', plan, reasons: ['apply_digest_drift'],
      }),
    };
  }

  // A mandatory expected-write count, checked before the confirm token. The
  // F42/B3 lanes had only a blanket cap far above any real plan; a plan that
  // silently grew from 26 writes to 599 would have proceeded.
  const expectedWrites = args['expected-writes'];
  if (args.apply && expectedWrites === undefined) throw new Error('expected_writes_required_for_apply');
  if (expectedWrites !== undefined && Number(expectedWrites) !== plan.writes.length) {
    const blocked = { status: 'BLOCKED', plan, reasons: ['expected_writes_mismatch'] };
    return { ...blocked, summary_markdown: renderSummaryMarkdown(blocked) };
  }

  if (!args.apply) {
    const status = eligible ? 'READY' : 'BLOCKED';
    return { status, plan, reasons, summary_markdown: renderSummaryMarkdown({ status, plan, reasons }) };
  }

  if (!eligible) {
    return { status: 'BLOCKED', plan, reasons, summary_markdown: renderSummaryMarkdown({ status: 'BLOCKED', plan, reasons }) };
  }
  if (clean(env[CONFIRM_ENV]) !== CONFIRM_TOKEN) throw new Error('owner_confirmation_required');
  if (!args['rollback-artifact']) throw new Error('rollback_artifact_required_for_apply');

  const applyResult = await applyRepairs(plan, {
    ...deps,
    rollbackArtifact: args['rollback-artifact'],
  });
  const readback = deps.readback ? await deps.readback(plan) : {};
  const gaps = verifyApply(plan, applyResult, readback);
  const status = gaps.length ? 'GAPS' : 'APPLIED';
  return {
    status,
    plan,
    reasons: gaps,
    applied: applyResult.applied,
    summary_markdown: renderSummaryMarkdown({ status, plan, reasons: gaps }),
  };
}

if (require.main === module) {
  run().then(result => {
    process.stdout.write(result.summary_markdown + '\n');
    if (result.status === 'BLOCKED' || result.status === 'GAPS') process.exitCode = 1;
  }).catch(error => {
    process.stderr.write(`${JSON.stringify({ status: 'FAIL', code: clean(error && error.message) || 'repair_failed' })}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIRM_ENV,
  CONFIRM_TOKEN,
  EXCLUDED_LINEAR_WORKSPACES,
  PLAN_CONTRACT,
  REPAIR_CLASSES,
  SCOPE_POLICY,
  applyEligibility,
  applyRepairs,
  cardExcludedByPolicy,
  linearWorkspace,
  makeRollbackJournal,
  mismatchFields,
  planLinkageRepair,
  renderSummaryMarkdown,
  repairApplyDigest,
  run,
  tallyPublic,
  verifyApply,
};
