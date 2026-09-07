// Staff-only projection. Complete SQL source envelope and stable aliases are
// required; no name/title matching and no provider transport can rescue it.
export function projectNativeSnapshot(value, normalizeClient) {
  const fail = () => { throw new Error('workload_snapshot_incomplete'); };
  if (!value || value.ok !== true || value.complete !== true
      || value.contract !== 'workload-native-snapshot-v1'
      || !Array.isArray(value.rows) || !Array.isArray(value.plans)
      || !Number.isSafeInteger(value.count) || value.count !== value.rows.length
      || value.count > 50000 || value.plans.length > 50000
      || !Array.isArray(value.legacy_teams)
      || !value.authority || !['video','graphics'].every(team =>
        ['syncview','linear'].includes(value.authority[team]))) fail();
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
    if (row.source !== 'native' || !row.is_sub_issue) continue;
    if (!['VID','GRA'].includes(row.team_key)
        || typeof row.client_slug !== 'string' || !row.client_slug
        || typeof row.client_name !== 'string' || !row.client_name
        || typeof row.native_client_active !== 'boolean'
        || typeof row.native_assignee_eligible !== 'boolean'
        || value.authority[row.team_key === 'VID' ? 'video' : 'graphics'] !== 'syncview') fail();
    if (row.linear_id != null) {
      if (typeof row.linear_id !== 'string' || !row.linear_id.trim()
          || (identities.has(row.linear_id) && row.linear_id !== row.id)
          || (aliases.has(row.linear_id) && aliases.get(row.linear_id).id !== row.id)) fail();
      aliases.set(row.linear_id,row);
    }
  }
  const planKeys = new Set(), projectedKeys = new Set(), plans=[];
  for (const plan of value.plans) {
    if (!plan || typeof plan.issue_id !== 'string' || !plan.issue_id
        || planKeys.has(plan.issue_id) || typeof plan.client !== 'string'
        || (plan.plan_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(plan.plan_date))) fail();
    planKeys.add(plan.issue_id);
    const owner = aliases.get(plan.issue_id) || identities.get(plan.issue_id);
    const bound = owner && ((owner.source === 'native' && owner.is_sub_issue) || owner.native_plan_id);
    if (bound && normalizeClient(owner.native_plan_client_name || owner.client_name) !== plan.client) fail();
    const id = bound ? owner.id : plan.issue_id;
    if (projectedKeys.has(id)) fail();
    projectedKeys.add(id);
    plans.push({...plan,issue_id:id,storage_issue_id:plan.issue_id});
  }
  return {...value,plans};
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
