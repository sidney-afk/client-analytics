// Internal worker adapter. query must use ONE already-open PostgreSQL transaction;
// neither this adapter nor its caller may reconnect or fall back to REST writes.
const ident = value => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw Error('FOLLOWUP_IDENTIFIER');
  return '"' + value + '"';
};
const fail = code => { throw Error('FOLLOWUP_' + code); };
const TABLES = new Set(['clients','syncview_runtime_flags','calendar_posts','sample_reviews','thumbnail_media_revisions']);
const RPCS = new Set(['syncview_thumbnail_revision_backfill','syncview_thumbnail_revision_rotate']);

export function createTransactionClient({ query, scope, storage, alive = () => true }) {
  if (typeof query !== 'function' || !['calendar','samples'].includes(scope?.surface)
      || typeof scope.client !== 'string' || !scope.client || typeof scope.sourceId !== 'string' || !scope.sourceId) fail('SCOPE');
  let poisoned = false;
  const effects = [];
  async function run(sql, params) {
    if (poisoned || !alive()) fail('TRANSACTION_EXPIRED');
    try {
      const rows = await query(sql, params);
      if (!Array.isArray(rows) || !alive()) fail('TRANSACTION_EXPIRED');
      return rows;
    } catch (_) { poisoned = true; fail('DATABASE_REFUSED'); }
  }
  class Builder {
    constructor(table) { this.table=table; this.op='select'; this.columns='*'; this.filters=[]; this.orders=[]; this.limitN=null; this.mode='many'; }
    select(columns='*') { this.columns=columns; return this; }
    eq(col,value) { this.filters.push([col,'=',value]); return this; }
    neq(col,value) { this.filters.push([col,'<>',value]); return this; }
    lte(col,value) { this.filters.push([col,'<=',value]); return this; }
    is(col,value) { if(value!==null)fail('IS_FILTER'); this.filters.push([col,'is',null]); return this; }
    order(col,options={}) { this.orders.push([col,options]); return this; }
    limit(n) { if(!Number.isInteger(n)||n<1||n>50)fail('LIMIT'); this.limitN=n; return this; }
    maybeSingle() { this.mode='maybeSingle'; return this; }
    single() { this.mode='single'; return this; }
    insert(row) { this.op='insert'; this.payload=row; return this; }
    update(row) { this.op='update'; this.payload=row; return this; }
    async execute() {
      const params=[], param=v=>{params.push(v);return '$'+params.length;};
      const table='public.'+ident(this.table);
      const cols=this.columns==='*'?'t.*':String(this.columns).split(',').map(c=>'t.'+ident(c.trim())).join(',');
      const filters=this.filters.slice();
      if(this.table==='thumbnail_media_revisions') filters.push(['surface','=',scope.surface],['client','=',scope.client],['source_id','=',scope.sourceId]);
      if(['calendar_posts','sample_reviews'].includes(this.table)) {
        if(this.table!==(scope.surface==='calendar'?'calendar_posts':'sample_reviews'))fail('SOURCE_TABLE');
        filters.push(['client','=',scope.client],['id','=',scope.sourceId]);
      }
      const where=()=>filters.length?' where '+filters.map(([col,op,value])=>'t.'+ident(col)+(value===null?(op==='is'||op==='='?' is null':fail('NULL_FILTER')):' '+op+' '+param(value))).join(' and '):'';
      let sql;
      if(this.op==='select') {
        sql='select '+cols+' from '+table+' t'+where();
        if(this.orders.length)sql+=' order by '+this.orders.map(([col,o])=>'t.'+ident(col)+(o.ascending===false?' desc':' asc')+(o.nullsFirst===true?' nulls first':o.nullsFirst===false?' nulls last':'')).join(',');
        if(this.limitN!==null)sql+=' limit '+this.limitN;
      } else {
        if(this.table!=='thumbnail_media_revisions')fail('WRITE_TABLE');
        const row=this.payload;
        if(!row||Array.isArray(row)||typeof row!=='object'||!Object.keys(row).length)fail('ROW');
        for(const [key,value] of Object.entries({surface:scope.surface,client:scope.client,source_id:scope.sourceId}))
          if((this.op==='insert'||Object.hasOwn(row,key))&&row[key]!==value)fail('ROW_SCOPE');
        const keys=Object.keys(row).sort(); keys.forEach(ident);
        const body=param(row)+'::jsonb';
        if(this.op==='insert') {
          const list=keys.map(ident).join(',');
          sql='insert into '+table+' as t ('+list+') select '+list+' from jsonb_populate_record(null::'+table+','+body+') returning '+cols;
        } else {
          sql='update '+table+' t set '+keys.map(k=>ident(k)+'=r.'+ident(k)).join(',')+' from jsonb_populate_record(null::'+table+','+body+') r'+where()+' returning '+cols;
        }
      }
      const rows=await run(sql,params);
      if(this.op!=='select')effects.push({table:this.table,operation:this.op,rows:rows.length});
      if(this.mode==='single'&&rows.length!==1||this.mode==='maybeSingle'&&rows.length>1) { poisoned=true;fail('CARDINALITY'); }
      return {data:this.mode==='many'?rows:rows[0]??null,error:null};
    }
    then(resolve,reject) { this.promise??=this.execute(); return this.promise.then(resolve,reject); }
  }
  return {
    from(table) { if(!TABLES.has(table))fail('TABLE');return new Builder(table); },
    async rpc(name,args={}) {
      if(!RPCS.has(name))fail('RPC');
      if(args.p_surface!==scope.surface||args.p_client!==scope.client||args.p_source_id!==scope.sourceId)fail('RPC_SCOPE');
      const params=[];
      const named=Object.entries(args).map(([key,value])=>{params.push(value);return ident(key)+' => $'+params.length;}).join(',');
      const rows=await run('select to_jsonb(public.'+ident(name)+'('+named+')) as result',params);
      if(rows.length!==1) { poisoned=true; fail('RPC_RESULT'); }
      effects.push({rpc:name});
      return {data:rows[0].result,error:null};
    },
    storage,
    assertHealthy() { if(poisoned||!alive())fail('TRANSACTION_EXPIRED'); },
    effectSummary() { return effects.map(x=>({...x})); }
  };
}

// A stale attempt may leave an unreferenced immutable object, but cannot replace
// existing bytes. The helper composer uses the returned path, not its old name.
export function createImmutableSnapshotStorage({ upload, download, digest, alive=()=>true, maxBytes=6*1024*1024 }) {
  if(![upload,download,digest].every(x=>typeof x==='function'))fail('STORAGE_ADAPTER');
  return {from(bucket) {
    if(bucket!=='syncview-thumbnail-revisions')fail('STORAGE_BUCKET');
    return {async upload(_oldPath,bytes,options={}) {
      if(!alive()||!(bytes instanceof Uint8Array)||bytes.byteLength>maxBytes||bytes.byteLength===0)fail('STORAGE_BYTES');
      // Copy before awaiting; the caller cannot alter the content after hashing.
      const stable=new Uint8Array(bytes), sha=await digest(stable);
      if(!/^[a-f0-9]{64}$/.test(sha))fail('STORAGE_DIGEST');
      const objectPath='immutable-sha256/'+sha;
      if(!alive())fail('TRANSACTION_EXPIRED');
      const result=await upload(bucket,objectPath,stable,{...options,upsert:false});
      if(result?.error && !['409','Duplicate'].includes(String(result.error.statusCode??result.error.code)))fail('STORAGE_UPLOAD');
      if(!alive())fail('TRANSACTION_EXPIRED');
      const actual=await download(bucket,objectPath);
      if(!(actual instanceof Uint8Array)||actual.byteLength!==stable.byteLength||await digest(actual)!==sha)fail('STORAGE_READBACK');
      if(!alive())fail('TRANSACTION_EXPIRED');
      return {data:{path:objectPath,sha256:sha},error:null};
    }};
  }};
}

export function verifyHelperOutcome(kind,outcome) {
  if(!outcome||typeof outcome!=='object')fail('HELPER_OUTCOME');
  if(kind==='graphic_baseline') {
    if(outcome.captured===true)return;
    if(outcome.captured===false&&['not_graphic_tweaks_needed_transition','feature_disabled','missing_thumbnail_url','folder_link','not_drive_file','pending_exists'].includes(outcome.reason))return;
  } else if(kind==='graphic_resolution') {
    if(['not_graphic_tweaks_resolved_transition','feature_disabled'].includes(outcome.reason))return;
    if(['checked','changed','unchanged','failed','skipped'].every(k=>Number.isSafeInteger(outcome[k])&&outcome[k]>=0)
      &&outcome.failed===0&&outcome.checked===outcome.changed+outcome.unchanged+outcome.skipped
      &&Array.isArray(outcome.items)&&outcome.items.length===outcome.checked
      &&outcome.items.every(x=>['initialized','skipped','stale_source','unchanged','changed'].includes(x.status)))return;
  }
  fail('HELPER_UNRESOLVED');
}
