with target as (select * from pg_class where oid=to_regclass('public.batches_parent_claim_backup_20260824'))
select jsonb_build_object(
'observed_at',statement_timestamp(),'server_version_num',current_setting('server_version_num'),
'table','public.batches_parent_claim_backup_20260824',
'relation',(select jsonb_build_object('kind',relkind,'persistence',relpersistence,'rls',relrowsecurity,'force_rls',relforcerowsecurity,'replica_identity',relreplident,'partition',relispartition,'options',reloptions,'tablespace',reltablespace,'access_method',(select amname from pg_am where oid=relam),'owner',pg_get_userbyid(relowner),'comment',obj_description(oid,'pg_class')) from target),
'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'comment',col_description(a.attrelid,a.attnum),'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl,'collation',case when a.attcollation=0 then null else a.attcollation::regcollation::text end,'storage',a.attstorage,'compression',a.attcompression,'options',a.attoptions,'fdw_options',a.attfdwoptions) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=(select oid from target) and a.attnum>0 and not a.attisdropped),
'constraints',(select coalesce(jsonb_agg(pg_get_constraintdef(oid,true)),'[]') from pg_constraint where conrelid=(select oid from target)),
'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(indexrelid)),'[]') from pg_index where indrelid=(select oid from target)),
'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid,true)),'[]') from pg_trigger where tgrelid=(select oid from target) and not tgisinternal),
'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',polname,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid),'roles',polroles,'command',polcmd)),'[]') from pg_policy where polrelid=(select oid from target)),
'inheritance_links',(select count(*) from pg_inherits where inhrelid=(select oid from target) or inhparent=(select oid from target)),
'rules_count',(select count(*) from pg_rewrite where ev_class=(select oid from target)),
'referencing_foreign_keys',(select count(*) from pg_constraint where confrelid=(select oid from target)),
'extension_owned',(select count(*) from pg_depend where classid='pg_class'::regclass and objid=(select oid from target) and deptype='e'),
'publications',(select coalesce(jsonb_agg(pubname order by pubname),'[]') from pg_publication p where p.puballtables or exists(select from pg_publication_rel pr where pr.prpubid=p.oid and pr.prrelid=(select oid from target)) or exists(select from pg_publication_namespace pn where pn.pnpubid=p.oid and pn.pnnspid='public'::regnamespace)),
'grants',(select jsonb_agg(jsonb_build_object('role',case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'grantable',x.is_grantable) order by x.grantee,x.privilege_type) from target c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x)
) as metadata;
