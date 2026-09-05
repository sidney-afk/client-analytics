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

const SNAPSHOT_CONTRACT = 'syncview-f42-linkage-repair-snapshot-v1';
// A snapshot older than this cannot be trusted to describe live rows: the CAS
// predicate would be built from stale observed state and refuse every row, and
// worse, a defect repaired by someone else in the meantime would still be
// planned. Six hours matches the Track-B private snapshot cadence.
const MAX_SNAPSHOT_AGE_MS = 6 * 60 * 60 * 1000;

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

// The Linear issue identifier (e.g. VID-123) a value names, from a full issue
// URL or a bare identifier. Returns '' when nothing parseable is present —
// which callers must treat as UNPROVEN, never as a match.
function linearIdentifier(value) {
  const raw = clean(value);
  if (!raw) return '';
  const match = raw.match(/\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)/)
    || raw.match(/^([A-Za-z][A-Za-z0-9]*-\d+)$/);
  return match ? match[1].toUpperCase() : '';
}

function cardLinearIdentity(card, component) {
  return linearIdentifier(component === 'graphic'
    ? card && card.graphic_linear_issue_id
    : card && card.linear_issue_id);
}

function deliverableLinearIdentity(deliverable) {
  return linearIdentifier(deliverable && deliverable.linear_identifier)
    || linearIdentifier(deliverable && deliverable.linear_issue_url);
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
  // Kind does NOT object (owner ruling 2026-09-05, OPEN_REPAIRS 156). `kind`
  // is a regex over the issue title and its parent's title, and it refused 40
  // live slots in which the card and the row named the SAME Linear issue. The
  // identity check below is the proof of "the same work item"; the SQL repair
  // (production_comment_card_bind_and_import) applies the same rule, and the
  // two must not disagree about what counts as the same issue.
  // The card and the deliverable must be talking about the SAME Linear issue.
  // Without this, a card is stamped onto whatever unclaimed deliverable happens
  // to sit in its client+team space. Both sides must name an issue, and the two
  // must be equal; either side missing is unproven, not permission.
  const cardIdentity = cardLinearIdentity(card, component);
  const deliverableIdentity = deliverableLinearIdentity(deliverable);
  if (!cardIdentity || !deliverableIdentity) objections.push('linear_identity_unproven');
  else if (cardIdentity !== deliverableIdentity) objections.push('linear_identity_disagrees');
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

  // EVERY current consumer of every deliverable — each (surface, card,
  // component) slot that names it, whether or not that slot carries comments
  // and whether or not its own crosswalk currently validates. A repair is only
  // safe if it leaves every one of these consumers in an acceptable state:
  // a `team` correction made for a commented graphic slot can silently
  // INVALIDATE a quiet, currently-valid video slot pointing at the same row.
  const consumersById = new Map();
  for (const surface of PUBLIC_SURFACES) {
    for (const card of Array.isArray(cards[surface]) ? cards[surface] : []) {
      const cardId = clean(card && card.id);
      if (!cardId) continue;
      for (const component of ['video', 'graphic', 'caption', 'title']) {
        const targetId = clean(component === 'graphic'
          ? card.graphic_deliverable_id
          : card.video_deliverable_id);
        if (!targetId) continue;
        if (!consumersById.has(targetId)) consumersById.set(targetId, []);
        consumersById.get(targetId).push({ surface, card, component, cardId });
      }
    }
  }

  // Would applying `after` to this deliverable break any current consumer that
  // is acceptable today? "Acceptable today" means crosswalk-clean; a consumer
  // that is already mismatched cannot be made worse by a repair aimed at it.
  function consumersInvalidatedBy(deliverable, after) {
    const proposed = Object.assign({}, deliverable, after);
    const broken = [];
    for (const consumer of consumersById.get(clean(deliverable.id)) || []) {
      const wasClean = !mismatchFields(deliverable, consumer.surface, consumer.card, consumer.component).length;
      if (!wasClean) continue;
      const nowFields = mismatchFields(proposed, consumer.surface, consumer.card, consumer.component);
      if (nowFields.length) broken.push(nowFields.join(','));
    }
    return [...new Set(broken)].sort();
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

        // NULL and '' are DIFFERENT database states and the before-state is a
        // rollback instruction: `clean()` would collapse a NULL card_id to '',
        // and restoring '' where NULL stood would leave the row in a state it
        // was never in — one that still satisfies `card_id IS NOT NULL` in the
        // partial unique index. Preserve the distinction exactly.
        const exact = value => (value === null || value === undefined ? null : String(value));
        const before = key === 'team'
          ? { team: exact(deliverable.team) }
          : { origin: exact(deliverable.origin), card_id: exact(deliverable.card_id) };
        const after = key === 'team'
          ? { team: teamForComponent(component) }
          : { origin: SURFACE_ORIGIN[lower(surface)], card_id: cardId };

        // A repair that fixes this slot must not break a different slot that is
        // fine today — including a quiet, comment-free one, which is invisible
        // to the defect scan but is still a live consumer of this deliverable.
        const collateral = consumersInvalidatedBy(deliverable, after);
        if (collateral.length) {
          skipped.push({
            ...base,
            skip_reason: 'authority_not_clear',
            objections: collateral.map(f => `would_invalidate_consumer:${f}`),
          });
          continue;
        }

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
  const existsSync = deps.existsSync || fs.existsSync;
  // Never overwrite an existing artifact. The file IS the rollback instruction
  // for a previous run; clobbering it would silently destroy the only record of
  // how to reverse writes that already landed.
  if (artifactPath && existsSync(path.resolve(artifactPath))) {
    throw new Error('rollback_artifact_already_exists');
  }
  const attempted = [];
  const record = {
    contract: PLAN_CONTRACT,
    run_id: plan.run_id,
    apply_digest: plan.apply_digest,
    // CRASH RECOVERY READS `planned`, NOT `attempted`. Every entry here is a
    // row the runner intended to write; restoring `before` on a row that was
    // never written is a no-op, because the row is already in that state. So
    // after an uncontrolled crash the safe reversal is to restore `before` for
    // every PLANNED row, in any order. `attempted` is the narrower record of
    // rows the runner actually issued a write for, useful for reconciliation.
    planned: plan.writes.map(write => ({
      deliverable_id: write.deliverable_id,
      repair_class: write.repair_class,
      before: write.before,
      after: write.after,
      target: write.target,
    })),
    attempted,
  };
  const flush = () => {
    if (!artifactPath) return;
    writeFile(path.resolve(artifactPath), JSON.stringify(record, null, 2) + '\n');
  };
  flush();
  return {
    // Called BEFORE the write is issued. Recording after the PATCH loses the
    // row on a crash between the write landing and the note; recording before
    // can only ever over-record, and an over-recorded restore is a no-op.
    note(write) {
      attempted.push({
        deliverable_id: write.deliverable_id,
        restore: write.before,
        applied: write.after,
      });
      flush();
    },
    record,
  };
}

/* Compare-and-swap verification for one PATCH result. The database layer
   filters on the full observed target state, so a row that drifted since the
   plan matches nothing and comes back empty. Exactly one row, carrying exactly
   the intended after-state, is the only accepted outcome. */
function verifyPatchResult(write, rows) {
  const returned = Array.isArray(rows) ? rows : null;
  if (returned === null) return 'patch_returned_no_representation';
  if (returned.length === 0) return 'cas_no_row_matched_observed_state';
  if (returned.length > 1) return 'cas_matched_multiple_rows';
  const row = returned[0] || {};
  for (const field of Object.keys(write.after || {})) {
    const expected = write.after[field];
    const actual = row[field] === null || row[field] === undefined ? null : String(row[field]);
    const wanted = expected === null || expected === undefined ? null : String(expected);
    if (actual !== wanted) return `after_state_mismatch:${field}`;
  }
  return '';
}

async function applyRepairs(plan, deps = {}) {
  const patchOne = deps.patchOne;
  if (typeof patchOne !== 'function') throw new Error('patch_layer_required');
  const journal = makeRollbackJournal(deps.rollbackArtifact, plan, deps);
  const receipts = [];
  const refusals = [];
  let failure = null;
  try {
    for (const write of plan.writes) {
      journal.note(write);
      // eslint-disable-next-line no-await-in-loop
      const rows = await patchOne(write);
      const problem = verifyPatchResult(write, rows);
      if (problem) {
        // A per-row refusal, not a run failure: the CAS predicate did not match,
        // so nothing was written for this row. Record it and keep going; the
        // run still ends as GAPS because the counts will not agree.
        refusals.push({ deliverable_id: write.deliverable_id, reason: problem });
        continue;
      }
      receipts.push(write.deliverable_id);
    }
  } catch (error) {
    failure = clean(error && error.message) || 'patch_failed';
  }
  return {
    receipts,
    refusals,
    applied: receipts.length,
    planned: plan.writes.length,
    failure,
    rollback: journal.record,
  };
}

function verifyApply(plan, applyResult, readback) {
  const gaps = [];
  if (applyResult.failure) gaps.push(`patch_failed:${applyResult.failure}`);
  if (applyResult.applied !== plan.writes.length) gaps.push('applied_count_mismatch');
  for (const refusal of applyResult.refusals || []) gaps.push(`cas_refused:${refusal.reason}`);
  // An absent readback is a GAP, never silence. "We could not check" and
  // "we checked and it was fine" must never render the same.
  if (!readback || typeof readback !== 'object') {
    gaps.push('readback_missing');
    return [...new Set(gaps)];
  }
  const remaining = Number(readback.remaining_defects);
  if (!Number.isFinite(remaining)) {
    gaps.push('readback_missing');
  } else {
    // Success is not "zero defects": the unruled Class C rows are EXPECTED to
    // remain, because this brick deliberately never repairs them. Anything
    // other than exactly that residue means the repair did not land as planned.
    const expected = Number(readback.expected_remaining_defects);
    const target = Number.isFinite(expected) ? expected : 0;
    if (remaining !== target) gaps.push('defects_remain_after_repair');
  }
  return [...new Set(gaps)];
}

/* The manifest the exporter produces independently of the planner: how many
   rows it read per surface, a content hash of exactly what it wrote, and when.
   Verified BEFORE planning, so a truncated, edited or stale export cannot
   become a production write. */
function snapshotContentHash(snapshot) {
  const doc = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const cards = doc.cards && typeof doc.cards === 'object' ? doc.cards : {};
  return sha256({
    cards: Object.fromEntries(PUBLIC_SURFACES.map(surface => [
      surface, Array.isArray(cards[surface]) ? cards[surface] : [],
    ])),
    deliverables: Array.isArray(doc.deliverables) ? doc.deliverables : [],
  });
}

function buildSnapshotManifest(snapshot, generatedAt) {
  const cards = (snapshot && snapshot.cards) || {};
  return {
    contract: SNAPSHOT_CONTRACT,
    generated_at: generatedAt,
    counts: Object.assign(
      { deliverables: Array.isArray(snapshot && snapshot.deliverables) ? snapshot.deliverables.length : 0 },
      Object.fromEntries(PUBLIC_SURFACES.map(surface => [
        surface, Array.isArray(cards[surface]) ? cards[surface].length : 0,
      ])),
    ),
    content_sha256: snapshotContentHash(snapshot),
  };
}

function verifySnapshotManifest(snapshot, nowMs) {
  const problems = [];
  const doc = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const manifest = doc.manifest && typeof doc.manifest === 'object' ? doc.manifest : null;
  if (!manifest) return ['snapshot_manifest_required'];
  if (clean(manifest.contract) !== SNAPSHOT_CONTRACT) problems.push('snapshot_contract_mismatch');

  const cards = doc.cards && typeof doc.cards === 'object' ? doc.cards : {};
  const counts = manifest.counts && typeof manifest.counts === 'object' ? manifest.counts : {};
  for (const surface of PUBLIC_SURFACES) {
    const actual = Array.isArray(cards[surface]) ? cards[surface].length : 0;
    if (Number(counts[surface]) !== actual) problems.push(`snapshot_count_mismatch:${surface}`);
  }
  const actualDeliverables = Array.isArray(doc.deliverables) ? doc.deliverables.length : 0;
  if (Number(counts.deliverables) !== actualDeliverables) problems.push('snapshot_count_mismatch:deliverables');

  if (clean(manifest.content_sha256) !== snapshotContentHash(doc)) problems.push('snapshot_content_hash_mismatch');

  const generatedAt = Date.parse(clean(manifest.generated_at));
  if (!Number.isFinite(generatedAt)) problems.push('snapshot_generated_at_unparseable');
  else if (Number.isFinite(nowMs)) {
    if (generatedAt > nowMs + 60000) problems.push('snapshot_generated_in_the_future');
    else if (nowMs - generatedAt > MAX_SNAPSHOT_AGE_MS) problems.push('snapshot_too_old');
  }
  return problems.sort();
}

/* ------------------------------------------------------------------
   Production database layer (PostgREST + service role).

   Injected everywhere else so tests and rehearsals drive the same apply logic
   without a backend. This is the one place that talks to live Supabase, and it
   is only reachable from the CLI during the owner window.
   ------------------------------------------------------------------ */

// PostgREST filter value: NULL is `is.null`, everything else an exact eq.
function casFilter(column, value) {
  if (value === null || value === undefined) return `${column}=is.null`;
  return `${column}=eq.${encodeURIComponent(String(value))}`;
}

/* Every write is a compare-and-swap against the FULL observed target state.
   The filters below are the plan's observation of the row; if anything about
   it changed since the export, no row matches and PostgREST returns [] — which
   verifyPatchResult treats as a per-row refusal. The row is never blindly
   overwritten on the strength of its id. */
function casPatchUrl(baseUrl, write) {
  const target = write.target || {};
  const filters = [
    casFilter('id', write.deliverable_id),
    casFilter('client_slug', target.client_slug),
    casFilter('team', target.team),
    casFilter('kind', target.kind),
    casFilter('origin', target.origin),
    // A planned NULL card_id must match `is.null`, not `eq.` — the whole point
    // of preserving NULL vs '' in the before-state.
    casFilter('card_id', target.card_id === '' || target.card_id === null || target.card_id === undefined
      ? null
      : target.card_id),
  ];
  return `${baseUrl}/rest/v1/deliverables?${filters.join('&')}`;
}

function productionDeps(config, fetchImpl) {
  const baseUrl = clean(config.url).replace(/\/+$/, '');
  const key = clean(config.serviceKey);
  if (!baseUrl || !key) throw new Error('supabase_configuration_required');
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  return {
    async patchOne(write) {
      const response = await fetchImpl(casPatchUrl(baseUrl, write), {
        method: 'PATCH',
        headers: Object.assign({}, headers, { Prefer: 'return=representation' }),
        body: JSON.stringify(write.after),
      });
      if (!response.ok) {
        // Status and function only. A constraint violation echoes the offending
        // row, which would put card ids and client slugs into a public log.
        throw new Error(`deliverables_patch_${response.status}`);
      }
      const payload = await response.json().catch(() => null);
      return Array.isArray(payload) ? payload : null;
    },
    async readback(plan) {
      // Independent count of the crosswalk defects that remain. Success is not
      // zero — the unruled Class C rows are expected to survive — so the
      // expectation travels with the reading.
      const ids = (plan.writes || []).map(write => write.deliverable_id);
      const list = ids.map(id => '"' + String(id).split('"').join('\\"') + '"').join(',');
      const url = `${baseUrl}/rest/v1/deliverables?select=${PROD_READBACK_SELECT}`
        + (ids.length ? `&id=in.(${encodeURIComponent(list)})` : '&id=eq.__none__');
      const response = await fetchImpl(url, { method: 'GET', headers });
      if (!response.ok) return null;
      const rows = await response.json().catch(() => null);
      if (!Array.isArray(rows)) return null;
      const byId = new Map(rows.map(row => [clean(row && row.id), row]));
      let unrepaired = 0;
      for (const write of plan.writes || []) {
        const row = byId.get(write.deliverable_id);
        if (!row) { unrepaired++; continue; }
        for (const field of Object.keys(write.after || {})) {
          const actual = row[field] === null || row[field] === undefined ? null : String(row[field]);
          const wanted = write.after[field] === null ? null : String(write.after[field]);
          if (actual !== wanted) { unrepaired++; break; }
        }
      }
      return {
        remaining_defects: unrepaired + Number(plan.scope.owner_rulings || 0),
        // The unruled Class C rows this brick deliberately never repairs.
        expected_remaining_defects: Number(plan.scope.owner_rulings || 0),
      };
    },
  };
}

const PROD_READBACK_SELECT = 'id,client_slug,team,kind,origin,card_id';

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

  // Verify the exporter's independent manifest BEFORE planning. A truncated,
  // hand-edited or stale export must never reach a production write.
  const nowMs = typeof deps.now === 'function' ? deps.now() : Date.now();
  const manifestProblems = verifySnapshotManifest(snapshot, nowMs);
  if (manifestProblems.length) {
    const blocked = {
      status: 'BLOCKED',
      plan: { contract: PLAN_CONTRACT, run_id: clean(args['run-id']), scope: {}, apply_digest: '' },
      reasons: manifestProblems,
    };
    return { ...blocked, summary_markdown: renderSummaryMarkdown(blocked) };
  }

  const plan = planLinkageRepair(snapshot, { runId: args['run-id'] });

  if (args.output) {
    (deps.writeFileSync || fs.writeFileSync)(
      path.resolve(String(args.output)), JSON.stringify(plan, null, 2) + '\n',
    );
  }

  const { eligible, reasons } = applyEligibility(plan);

  // Digest pinning is MANDATORY for apply, exactly like the write count. An
  // optional drift guard is not a guard: the one run that forgets the flag is
  // the one that applies a plan nobody reviewed.
  if (args.apply && args['expected-digest'] === undefined) {
    throw new Error('expected_digest_required_for_apply');
  }
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
  // An apply with no way to verify itself is not an apply we are willing to
  // run: without a readback there is no independent evidence the repair landed.
  if (typeof deps.readback !== 'function') throw new Error('readback_layer_required_for_apply');

  const applyResult = await applyRepairs(plan, {
    ...deps,
    rollbackArtifact: args['rollback-artifact'],
  });
  const readback = await deps.readback(plan);
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
  // The live database layer is attached ONLY for a real --apply. A plan run
  // stays source-only and never constructs a service-role client, so a missing
  // key cannot turn a review into a failure.
  const cliDeps = {};
  if (process.argv.includes('--apply')) {
    Object.assign(cliDeps, productionDeps({
      url: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }, globalThis.fetch));
  }
  run(process.argv.slice(2), process.env, cliDeps).then(result => {
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
  MAX_SNAPSHOT_AGE_MS,
  PLAN_CONTRACT,
  REPAIR_CLASSES,
  SCOPE_POLICY,
  SNAPSHOT_CONTRACT,
  applyEligibility,
  applyRepairs,
  buildSnapshotManifest,
  cardExcludedByPolicy,
  casPatchUrl,
  linearIdentifier,
  linearWorkspace,
  makeRollbackJournal,
  mismatchFields,
  planLinkageRepair,
  productionDeps,
  renderSummaryMarkdown,
  repairApplyDigest,
  run,
  snapshotContentHash,
  tallyPublic,
  verifyApply,
  verifyPatchResult,
  verifySnapshotManifest,
};
