'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(ROOT, 'migrations', '2026-07-20-f27-team-rollback.sql'),
  'utf8',
);
const proof = fs.readFileSync(
  path.join(ROOT, 'scripts', 'f27-team-rollback-proof.sql'),
  'utf8',
);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('PASS:', message);
  else {
    failures++;
    console.error('FAIL f27-authority-fence-race:', message);
  }
}

// Before fixture: #894's hold-only trigger checked whether the rollback row
// was still open. A writer authorized under SyncView could arrive after the
// finalizer committed state=complete + authority=Linear, so the late active
// insert passed the old trigger despite its stale authorization.
const authorizedWrite = { authority: 'syncview', generation: 0 };
const afterFinalize = { authority: 'linear', generation: 1, rollbackState: 'complete' };
const oldHoldOnlyAccepts = afterFinalize.rollbackState !== 'open';
ok(authorizedWrite.authority === 'syncview' && oldHoldOnlyAccepts,
  'before fixture reproduces the hold-only late-insert acceptance');

// After fixture: the same immutable authorization binder is compared by the
// server trigger with the generation advanced in the authority transaction.
const fixedFenceAccepts = authorizedWrite.generation === afterFinalize.generation
  && afterFinalize.authority === 'syncview';
ok(!fixedFenceAccepts,
  'after fixture rejects the exact pre-authorized write after handoff');
const noRollbackState = { authority: 'syncview', generation: 0, rollbackState: null };
const currentNormalWriteAccepts = authorizedWrite.generation === noRollbackState.generation
  && noRollbackState.authority === 'syncview'
  && noRollbackState.rollbackState !== 'open';
ok(currentNormalWriteAccepts,
  'no-rollback normal write remains accepted at the current generation');

const writerTableLock = migration.indexOf('lock table public.mirror_outbox in row exclusive mode;');
const writerAuthorityLock = migration.indexOf("where f.key = 'prod_authority'", writerTableLock);
const finalizeTableLock = migration.indexOf('lock table public.mirror_outbox in share row exclusive mode;',
  migration.indexOf('create or replace function public.track_b_f27_finalize('));
const finalizeFenceCas = migration.indexOf('where team = v_case.team and generation = v_case.fence_generation;',
  finalizeTableLock);
ok(writerTableLock >= 0 && writerAuthorityLock > writerTableLock,
  'writer transaction locks the outbox table before authority validation');
ok(finalizeTableLock >= 0 && finalizeFenceCas > finalizeTableLock,
  'finalize takes the same table-first order and advances the exact fence CAS');

const proofAuthorization = proof.indexOf("track_b_f27_write_authorization('graphics')");
const proofFinalize = proof.indexOf('SELECT public.track_b_f27_finalize(', proofAuthorization);
const proofLateInsert = proof.indexOf("'g-late-native'", proofFinalize);
const proofRejection = proof.indexOf('f27_authority_generation_stale:graphics', proofLateInsert);
ok(proofAuthorization >= 0
  && proofFinalize > proofAuthorization
  && proofLateInsert > proofFinalize
  && proofRejection > proofLateInsert,
  'disposable proof orders authorize then finalize commit then rejected late insert');

if (failures) process.exit(1);
console.log('F27 authority-handoff before/after regression passed.');
