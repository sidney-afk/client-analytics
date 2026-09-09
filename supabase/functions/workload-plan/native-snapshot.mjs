// Staff-only projection. Complete SQL source envelope and stable aliases are
// required; no name/title matching and no provider transport can rescue it.
export function projectNativeSnapshot(value, normalizeClient) {
  const fail = () => { throw new Error('workload_snapshot_incomplete'); };
  if (!value || value.ok !== true || value.complete !== true
      || value.contract !== 'workload-native-snapshot-v1'
      || !Array.isArray(value.rows) || !Array.isArray(value.plans)
      || !Number.isSafeInteger(value.count) || value.count !== value.rows.length
      || value.count > 50000 || value.plans.length > 50000
      || !Array.isArray(value.legacy_teams) || !Array.isArray(value.roster)
      || value.roster.length > 1000
      || !value.authority || !['video','graphics'].every(team =>
        ['syncview','linear'].includes(value.authority[team]))) fail();
  const rosterIds = new Set();
  for (const member of value.roster) {
    if (!member || typeof member.id !== 'string' || !member.id.trim()
        || rosterIds.has(member.id) || typeof member.native_id !== 'string' || !member.native_id.trim()
        || typeof member.name !== 'string' || !member.name.trim()
        || !['video','graphics'].includes(member.team)) fail();
    rosterIds.add(member.id);
  }
  const identities = new Map(), aliases = new Map();
  for (const row of value.rows) {
    if (!row || typeof row.id !== 'string' || !row.id.trim()
        || identities.has(row.id) || !['native','legacy'].includes(row.source)
        || typeof row.is_sub_issue !== 'boolean') fail();
    identities.set(row.id,row);
  }
  for (const row of value.rows) {
    if (row.source === 'legacy' && row.native_plan_id != null) {
      if (typeof row.native_plan_id !== 'string' || !row.native_plan_id
          || identities.has(row.native_plan_id) || aliases.has(row.native_plan_id)
          || typeof row.native_plan_client_name !== 'string'
          || normalizeClient(row.native_plan_client_name) !== normalizeClient(row.client_name)) fail();
      aliases.set(row.native_plan_id,row);
    }
    if (!row.is_sub_issue) continue;
    if (['VID','GRA'].includes(row.team_key) && typeof row.native_assignee_eligible !== 'boolean') fail();
    if (row.source !== 'native') continue;
    if (!['VID','GRA'].includes(row.team_key)
        || typeof row.client_slug !== 'string' || !row.client_slug
        || typeof row.client_name !== 'string' || !row.client_name
        || typeof row.native_client_active !== 'boolean'
        || typeof row.native_assignee_eligible !== 'boolean'
        || (row.native_assignee_eligible && (!rosterIds.has(row.assignee_id)
          || !value.roster.some(member => member.id === row.assignee_id
            && member.team === (row.team_key === 'VID' ? 'video' : 'graphics'))))
        || value.authority[row.team_key === 'VID' ? 'video' : 'graphics'] !== 'syncview') fail();
    if (row.linear_id != null) {
      if (typeof row.linear_id !== 'string' || !row.linear_id.trim()
          || (identities.has(row.linear_id) && row.linear_id !== row.id)
          || (aliases.has(row.linear_id) && aliases.get(row.linear_id).id !== row.id)) fail();
      aliases.set(row.linear_id,row);
    }
  }
  const planKeys = new Set(), projectedKeys = new Set(), plans=[], dropped=[];
  for (const plan of value.plans) {
    if (!plan || typeof plan.issue_id !== 'string' || !plan.issue_id
        || planKeys.has(plan.issue_id) || typeof plan.client !== 'string'
        || (plan.plan_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(plan.plan_date))) fail();
    planKeys.add(plan.issue_id);
    const owner = aliases.get(plan.issue_id) || identities.get(plan.issue_id);
    const bound = owner && ((owner.source === 'native' && owner.is_sub_issue) || owner.native_plan_id);
    // A stored plan whose client no longer matches its owner's must NOT be
    // re-keyed onto that owner -- that would move a saved work day onto another
    // client's card, which is the thing this check exists to prevent. But it
    // must not take the board down for everyone either, and failing here did:
    // on 2026-09-08 six drifted rows -- saved under one client slug, owners
    // since moved to two others -- threw away a 5,241-row snapshot, and every
    // pill on every editor's board fell back to its raw due date with editing
    // disabled. Ordinary historical drift, total outage. See OPEN_REPAIRS 177.
    // So: drop the row, count it, and let every other plan project. The safety
    // property is unchanged -- a mismatched plan is still never attached to an
    // owner -- and the blast radius stops at the row that actually drifted.
    if (bound && normalizeClient(owner.native_plan_client_name || owner.client_name) !== plan.client) {
      // COUNTED ONLY WHEN THERE WAS A WORK DAY TO LOSE. A row with a null
      // plan_date is a day somebody deliberately CLEARED, retained here as
      // history -- the card is already on automatic placement and that is
      // correct, so nothing is missing from the board. Counting it would make
      // the board state, permanently and untruthfully, that a saved work day is
      // not being shown. A standing false warning is how a true one stops being
      // read, which would undo the whole point of surfacing this at all.
      //
      // The row is still DROPPED rather than projected either way: the safety
      // property -- a mismatched plan is never attached to an owner -- does not
      // depend on plan_date and is not being relaxed here.
      if (plan.plan_date !== null) dropped.push(plan.issue_id);
      continue;
    }
    const id = bound ? owner.id : plan.issue_id;
    if (projectedKeys.has(id)) fail();
    projectedKeys.add(id);
    plans.push({...plan,issue_id:id,storage_issue_id:plan.issue_id});
  }
  // Surfaced, not silent: a dropped plan is a saved work day the board stops
  // showing, so the count has to be observable by whoever reads the response.
  return {...value,plans,plans_dropped:dropped.length};
}

export function legacyPlanAliases(snapshot) {
  const rows = new Map(snapshot.rows.filter(row=>(row.source==='native' && row.is_sub_issue) || row.native_plan_id)
    .map(row=>[row.id,row]));
  return snapshot.plans.flatMap(plan=>{
    const owner=rows.get(plan.issue_id);
    const alternate=owner && (owner.source==='native'?owner.linear_id:owner.native_plan_id);
    return alternate && alternate!==plan.issue_id ? [plan,{...plan,issue_id:alternate}] : [plan];
  });
}
