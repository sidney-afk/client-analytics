// OPEN_REPAIRS 101 release A: the extra fields a browser refusal claim may
// carry. Everything here is coarse or an id; the error message is cleaned
// again in SQL (write_refusal_diagnostics.clean_detail_v1), which is the
// authority, so this only trims and type-checks.
const CARD=/^[A-Za-z0-9_.:-]{1,80}$/,ACTION=/^[a-z0-9_]{1,40}$/,VERSION=/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/;
export function agentFamily(agent){
 const a=String(agent||'');
 const browser=/SamsungBrowser/.test(a)?'samsung':/Edg\//.test(a)?'edge':/Firefox\/|FxiOS/.test(a)?'firefox':/Chrome\/|CriOS/.test(a)?'chrome':/Safari\//.test(a)?'safari':'other';
 const os=/iPhone|iPad|iPod/.test(a)?'ios':/Android/.test(a)?'android':/Windows/.test(a)?'windows':/Mac OS X|Macintosh/.test(a)?'mac':/Linux/.test(a)?'linux':'other';
 return {browser,os};
}
// Card id: the calendar card when the page named one, else the deliverable id.
export function browserDetail(body,agent,staffRole){
 const ids=body&&typeof body.identifiers==='object'&&body.identifiers||{};
 const card=[ids.card,ids.id].find(v=>typeof v==='string'&&CARD.test(v))||null;
 const action=typeof body?.operation==='string'&&ACTION.test(body.operation)?body.operation:null;
 const detail=typeof body?.message==='string'&&body.message.trim()?body.message.slice(0,200):null;
 const version=typeof body?.app_version==='string'&&VERSION.test(body.app_version)?body.app_version:null;
 return {card_ref:card,ui_action:action,detail,...agentFamily(agent),app_version:version,staff_role:['admin','smm','creative'].includes(staffRole)?staffRole:null};
}
