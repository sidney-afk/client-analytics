'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const {splitSqlStatements}=require('../../scripts/track-b-recovery-package');
const OWNERS=[
  {
    "path": "migrations/ai-onboarding-supabase-migration.sql",
    "sha256": "f0a8f67f79d3552907499d257fefaaa357c8f4a3b3e4717714bd8b631bd405b0"
  },
  {
    "path": "migrations/onboarding-supabase-migration.sql",
    "sha256": "d3a47fb24506d78686c43c8fdca743f288ba363ac319c99d9abf0c9ebc159d08"
  },
  {
    "path": "migrations/legacy-onboarding-migration.sql",
    "sha256": "e976199b489589a4902e2f9b2295d944b59b86e6c50c6cacf45c35a81b3e5e4e"
  },
  {
    "path": "migrations/onboarding-fallback-supabase-migration.sql",
    "sha256": "4178f4db388de512c8115cc4933f4529b4981331e4d6260914b8165ee3d174c1"
  },
  {
    "path": "migrations/sales-intake-migration.sql",
    "sha256": "f54146414a694f57213519ef012a60f4a3cbc4aa137b82f0eb39ba99ef580bb7"
  },
  {
    "path": "migrations/2026-08-24-hiring-applications.sql",
    "sha256": "24356a2835beeb685c09fc097c0653532cf1756546310105a2bf822ca107798a"
  },
  {
    "path": "migrations/2026-08-24-quiz-responses.sql",
    "sha256": "44cbf318e12876b667329acd5f1a84d94246f16157d0357ed9a89484b7b5ad0a"
  },
  {
    "path": "migrations/2026-08-24-kasper-ad-performance.sql",
    "sha256": "ec8ae90d08de1f3986e5e3e9df771d50eb153e84218c2a483c11c113a229fe27"
  },
  {
    "path": "migrations/2026-08-24-kasper-ad-performance-v2.sql",
    "sha256": "3cda6662ecfb21bb97c9e7904be530a56e2f937e42cb242a60eedef52ed157ea"
  },
  {
    "path": "migrations/2026-08-24-kasper-ad-performance-unfinished-leads.sql",
    "sha256": "7ef9551af1a47bfad3b64c720d80feb48398a713d305d4ab5fb36b7ca3ccae99"
  },
  {
    "path": "migrations/2026-08-27-kasper-ad-performance-multi-campaign.sql",
    "sha256": "5f0026d471fe64cb4f46478e2419341124be33078c84d0b746cf0cec38fa4514"
  },
  {
    "path": "migrations/2026-07-10-smm-weekly-reports.sql",
    "sha256": "9afe00014f428bbc8ccfdc41cc9b252ffba3030e402365028a054e536014a272"
  },
  {
    "path": "migrations/ttpilot-schema-migration.sql",
    "sha256": "da2322afb5209de4a2b3e5b5643e78dbc396b581f2878d0c4cfb84e30db7afa8"
  }
];
const TABLES=['ai_client_onboarding','caption_prompts','client_onboarding','hiring_applications','hiring_invite_jobs','hiring_application_events','kasper_ad_performance_daily','kasper_ad_performance_by_ad_daily','kasper_ad_leads','kasper_ad_unfinished_leads','kasper_ad_campaign_daily','legacy_onboarding','onboarding_fallback','quiz_responses','quiz_intake_log','sales_intakes','social_media_managers','smm_weekly_reports','templates','tiktok_accounts','tiktok_oauth_state','tiktok_pilot_posts'];
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";const ident=s=>{assert.match(s,/^[a-z_][a-z0-9_]*$/);return '"'+s+'"';};
async function installAndPopulate({query}){
 const executed=[];
 for(const owner of OWNERS){const bytes=fs.readFileSync(path.join(__dirname,'../..',owner.path));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),owner.sha256);let source=bytes.toString('utf8');if(owner.path.endsWith('/legacy-onboarding-migration.sql'))source=source.slice(0,source.search(/^insert into /mi));
 const parts=splitSqlStatements(source).filter(x=>x.kind==='statement');
 // Explicit schema-only supplement: retain exact DDL statements, exclude all
 // top-level data/backfill operations. This is not the owner's full installation.
 const selected=parts.filter(x=>/^(?:create|alter|grant|revoke|comment|drop policy|drop trigger)\b/i.test(x.text));
 if(!selected.length)throw Error('REMAINING_OWNER_NO_SCHEMA');
 const sql=selected.map(x=>x.text+';').join('\n');await query(sql);executed.push({...owner,selection:'schema DDL only; all top-level data operations excluded',executed_sha256:crypto.createHash('sha256').update(sql).digest('hex')});
 }
 for(const table of TABLES){
 const raw=await query(`select coalesce(json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,'has_default',d.oid is not null,'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum),'[]'::json) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=${quote('public.'+table)}::regclass and a.attnum>0 and not a.attisdropped`);
 const columns=JSON.parse(String(raw).trim());assert.ok(columns.length);
 const required=columns.filter(c=>(c.required&&!c.has_default&&!c.identity&&!c.generated)||(table==='hiring_applications'&&c.name==='id'));
 // The interview URL is a fixed CHECK-domain literal from the pinned owner,
 // stored only in isolated rows; this helper never requests or opens it.
 const value=c=>{const fixed={interview_event_url:'https://app.iclosed.io/e/synchrosocial/client-success-content-manager-interview',source_event_slug:'client-success-content-manager-application',event_type:'received',overall_status:'On track',obstacle_support_status:'Handling it',client_mood:'Fine',deliverables_schedule_status:'On track',performance_signal:'Flat'};if(fixed[c.name])return quote(fixed[c.name]);if(c.type==='uuid')return "'00000000-0000-4000-8000-000000000022'::uuid";if(c.type==='date')return "'2026-09-12'::date";if(c.type.startsWith('timestamp'))return "'2026-09-12T00:00:00Z'";if(c.type==='boolean')return 'false';if(/^(integer|bigint|smallint|numeric|double precision)/.test(c.type))return '1';if(c.type==='jsonb'||c.type==='json')return "'{}'::"+c.type;if(c.type.endsWith('[]'))return "'{}'::"+c.type;return quote(c.name.includes('email')?'synthetic@example.invalid':'synthetic-remaining');};
 await query(`insert into public.${ident(table)} ${required.length?'('+required.map(c=>ident(c.name)).join(',')+') values ('+required.map(value).join(',')+')':'default values'};`);
 const count=JSON.parse(String(await query(`select to_json(count(*)) from public.${ident(table)}`)).trim());assert.ok(count>0);
 }
 return {tables:TABLES,source_owners:executed,populated_tables:TABLES.length,scope:'source schema-only supplement and synthetic rows; no hosted schema equivalence'};
}
module.exports={installAndPopulate,TABLES,OWNERS};
