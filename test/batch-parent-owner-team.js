'use strict';
/*
 * A batch parent is validated against the team that OWNS it.
 *
 * One Linear issue serves every team a card has. The batch parent map records
 * that issue under each team's key and stamps `owner_team` with the team the
 * issue was actually created in -- mapping.mjs says so in as many words, and
 * says the stamp exists "to validate the parent against the team that owns it
 * rather than against the team that is asking, which are deliberately
 * different now."
 *
 * The append route validated against the asker. So appending a thumbnail to a
 * batch whose only parent is a video issue was refused with
 * batch_parent_mapping_missing -- for the sole reason that a video issue is
 * not a graphics issue. Reported live: a Video+Thumbnail post could not be
 * added to any batch created by the native flow, because that flow makes ONE
 * parent issue serving both teams.
 *
 * An older map with no stamp resolves to "" and validates exactly as before.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const gatewaySrc = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');

let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

// --- the resolver ---------------------------------------------------------
// Imported as a real ES module, the same way every other policy suite does it,
// rather than re-compiled: a rewritten copy is not the code that ships.
const { pathToFileURL } = require('url');

(async () => {
const policy = await import(pathToFileURL(path.join(
  ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs',
)).href);
const { parentOwnerTeamFor, parentIdsForTeam } = policy;

// The exact shape the native flow writes: one video issue under both keys.
const sharedParent = {
  video: { uuid: 'u-vid', identifier: 'VID-13400', owner_team: 'video' },
  graphics: { uuid: 'u-vid', identifier: 'VID-13400', owner_team: 'video' },
};

ok(parentIdsForTeam(sharedParent, 'graphics').length === 1,
'a shared parent still resolves an id for graphics');
ok(parentOwnerTeamFor(sharedParent, 'graphics') === 'video',
'the graphics entry reports video as its owner, so validation targets the video team');
ok(parentOwnerTeamFor(sharedParent, 'video') === 'video',
'the video entry reports video too');

// A genuinely per-team map keeps validating per team.
const perTeam = {
  video: { uuid: 'u-vid', owner_team: 'video' },
  graphics: { uuid: 'u-gra', owner_team: 'graphics' },
};
ok(parentOwnerTeamFor(perTeam, 'graphics') === 'graphics',
'a real graphics parent still validates as graphics');

// Older maps carry no stamp; callers must fall back to the asking team.
ok(parentOwnerTeamFor({ graphics: { uuid: 'g1' } }, 'graphics') === '',
'an unstamped legacy entry yields no owner, so behaviour is unchanged');
ok(parentOwnerTeamFor(null, 'graphics') === '' && parentOwnerTeamFor({}, 'graphics') === '',
'a missing or empty map yields no owner');
ok(parentOwnerTeamFor(sharedParent, '') === '',
'an unknown asking team yields no owner');

// Array and parents[] shapes are accepted the same way parentIdsForTeam does.
ok(parentOwnerTeamFor([{ team: 'graphics', uuid: 'u-vid', owner_team: 'video' }], 'graphics') === 'video',
'an array-shaped map resolves the owner');
ok(parentOwnerTeamFor({ parents: [{ team: 'graphics', uuid: 'u', owner_team: 'video' }] }, 'graphics') === 'video',
'a parents[] map resolves the owner');
ok(parentOwnerTeamFor({ graphics: { uuid: 'u', owner_team: 'gra' } }, 'graphics') === 'graphics',
'the short team spelling normalises');

// --- the gateway actually uses it ----------------------------------------
ok(/parentOwnerTeamFor,/.test(gatewaySrc),
'the gateway imports the resolver');
ok(/const ownerTeam = parentOwnerTeamFor\(batch\.linear_parent_ids, team\) \|\| team;/.test(gatewaySrc),
'the append route resolves the owner team, falling back to the asker');
ok(/await validateLinearBatchParent\(directIds\[0\], ownerTeam, projectId\);/.test(gatewaySrc),
'the direct-parent validation is given the owner team');
ok(!/await validateLinearBatchParent\(directIds\[0\], team, projectId\);/.test(gatewaySrc),
'the direct-parent validation no longer uses the asking team');

// The dependency route is per-team by construction (the outbox row is looked
// up with .eq("team", ...)), so it must keep validating against that team.
ok(/await validateLinearBatchParent\(writtenParentId, team, projectId\);/.test(gatewaySrc),
'the dependency route still validates against its own team, which is already exact');

if (failures) process.exit(1);
console.log('\nBatch parent owner-team validation checks passed');
})();
