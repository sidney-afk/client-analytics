'use strict';
const SQL=`begin read only;
set local statement_timeout='30s';
select jsonb_build_object('bucket_count',(select count(*) from storage.buckets),'disabled_buckets',(select count(*) from storage.buckets where versioning_status='DISABLED'),'object_count',(select count(*) from storage.objects),'archived_objects',(select count(*) from storage.objects where archived_at is not null),'delete_markers',(select count(*) from storage.objects where is_delete_marker),'versioned_objects',(select count(*) from storage.objects where is_versioned),'null_flags',(select count(*) from storage.objects where is_delete_marker is null or is_versioned is null),'version_listing_migrations',(select count(*) from storage.migrations where name='list-objects-with-versions'));
commit;`;
const KEYS=['bucket_count','disabled_buckets','object_count','archived_objects','delete_markers','versioned_objects','null_flags','version_listing_migrations'];
function validate(value){if(!value||Object.keys(value).sort().join(',')!==[...KEYS].sort().join(',')||KEYS.some(k=>!Number.isSafeInteger(value[k])||value[k]<0))throw Error('STORAGE_VERSION_CAPABILITY_SHAPE');if(value.disabled_buckets!==value.bucket_count||value.archived_objects||value.delete_markers||value.versioned_objects||value.null_flags||value.version_listing_migrations>1)throw Error('STORAGE_VERSION_HISTORY_UNSUPPORTED');return value;}
async function observe(query){if(typeof query!=='function')throw Error('STORAGE_VERSION_QUERY_REQUIRED');return structuredClone(validate(await query(SQL)));}
module.exports={SQL,validate,observe};
