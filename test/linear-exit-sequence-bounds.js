'use strict';
// Focused numeric/coverage validator controls; actual SQL path runs separately.
const assert=require('node:assert/strict');const bounds=require('../scripts/linear-exit-sequence-bounds');
const tables=['calendar_post_events','card_change_journal','client_access_events','deliverable_events','flag_flips','mirror_outbox','production_card_provenance','production_comment_import_conflicts','production_comment_read_audit','production_notification_delivery_receipts','production_notification_reconciliations','public_intake_log','sample_review_events','settings_events','syncview_auth_events'];
const states=tables.map(t=>({name:t+'_id_seq',last_value:'1',is_called:true,start_value:'1',increment_by:'1',min_value:'1',max_value:'9223372036854775807',data_type:'bigint'}));
const proof={version:1,consumer_closure_proven:false,sequences:tables.map(t=>({name:t+'_id_seq',increment:'1',minimum:'1',maximum:'9223372036854775807',start:'1',cache:'1',cycle:false,type:'bigint',consumers:[{schema:'public',table:t,column:'id',type:'bigint',identity:'d',default:null,edge_kinds:['owned_or_identity'],maximum_value:'1'}]}))};
const copy=x=>JSON.parse(JSON.stringify(x));let checks=0;function check(fn){fn();checks++;}
check(()=>assert.equal(bounds.validate(proof,states),proof));
check(()=>{const p=copy(proof);p.sequences.pop();assert.throws(()=>bounds.validate(p,states),/SEQUENCE_COVERAGE/);});
check(()=>{const p=copy(proof);p.sequences.reverse();assert.throws(()=>bounds.validate(p,states),/SEQUENCE_COVERAGE/);});
check(()=>{const p=copy(proof);p.sequences[0].consumers=[];assert.throws(()=>bounds.validate(p,states),/CONSUMER_COVERAGE/);});
check(()=>{const p=copy(proof);p.sequences[0].consumers[0].maximum_value='2';assert.throws(()=>bounds.validate(p,states),/UNSAFE_MAXIMUM/);});
check(()=>{const p=copy(proof),s=copy(states);p.sequences[0].consumers[0].type='integer';s[0].last_value='2147483647';assert.throws(()=>bounds.validate(p,s),/CONSUMER_TYPE_RANGE/);});
check(()=>{const p=copy(proof);p.sequences[0].cycle=true;assert.throws(()=>bounds.validate(p,states),/CONFIGURATION/);});
check(()=>{const p=copy(proof);Object.assign(p.sequences[0].consumers[0],{identity:'',default:"nextval('calendar_post_events_id_seq'::regclass)",edge_kinds:['default_dependency']});assert.equal(bounds.validate(p,states),p);});
check(()=>{const p=copy(proof);Object.assign(p.sequences[0].consumers[0],{identity:'',default:"nextval('public.calendar_post_events_id_seq'::regclass)",edge_kinds:['default_dependency']});assert.equal(bounds.validate(p,states),p);});
check(()=>{const p=copy(proof);Object.assign(p.sequences[0].consumers[0],{identity:'',default:"(nextval('calendar_post_events_id_seq'::regclass) - 100)",edge_kinds:['default_dependency']});assert.throws(()=>bounds.validate(p,states),/NON_DIRECT_CONSUMER/);});
check(()=>{const p=copy(proof);p.sequences[0].consumers[0].identity='';assert.throws(()=>bounds.validate(p,states),/NON_DIRECT_CONSUMER/);});
console.log(JSON.stringify({marker:'LINEAR_EXIT_SEQUENCE_BOUNDS_UNIT_OK',checks,offline_validator_only:true}));
