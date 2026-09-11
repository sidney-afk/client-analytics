'use strict';
// JSON numbers remain exact lexemes. Never coerce a captured bigint/decimal to
// Number merely to compare or sign it. Duplicate object keys are rejected.
class ExactNumber {constructor(raw){this.raw=raw;Object.freeze(this);}}
function parse(text) {
  let at=0,depth=0;
  const error=()=>{throw Error('LOSSLESS_JSON_INVALID');};
  const ws=()=>{while(/[\x20\t\r\n]/.test(text[at]||'!'))at++;};
  function string(){const start=at++;while(at<text.length){const c=text[at++];if(c==='"'){try{return JSON.parse(text.slice(start,at));}catch{error();}}if(c==='\\')at++;}error();}
  function value(){ws();if(++depth>100)error();let out;
    if(text[at]==='"')out=string();
    else if(text[at]==='['){at++;out=[];ws();if(text[at]!==']')while(true){out.push(value());ws();if(text[at]!==',')break;at++;}if(text[at++]!==']')error();}
    else if(text[at]==='{'){at++;out=Object.create(null);ws();if(text[at]!=='}')while(true){ws();if(text[at]!=='"')error();const k=string();if(Object.hasOwn(out,k))error();ws();if(text[at++]!==':')error();out[k]=value();ws();if(text[at]!==',')break;at++;}if(text[at++]!=='}')error();}
    else {const rest=text.slice(at),token=rest.match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];if(!token)error();at+=token.length;out=token==='true'?true:token==='false'?false:token==='null'?null:new ExactNumber(token);}
    depth--;return out;
  }
  if(typeof text!=='string')error();const out=value();ws();if(at!==text.length)error();return out;
}
function canonical(value){
  if(value instanceof ExactNumber)return ['number',value.raw];
  if(value===null)return ['null'];
  if(Array.isArray(value))return ['array',value.map(canonical)];
  if(typeof value==='object')return ['object',Object.keys(value).sort().map(k=>[k,canonical(value[k])])];
  return [typeof value,value];
}
function equal(a,b){return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
function stringify(value){
  if(value instanceof ExactNumber)return value.raw;
  if(Array.isArray(value))return '['+value.map(stringify).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).map(k=>JSON.stringify(k)+':'+stringify(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function browserValue(value){
  if(value instanceof ExactNumber){const n=Number(value.raw);if(!Number.isSafeInteger(n)||!/^[-]?\d+$/.test(value.raw))throw Error('UNSAFE_BROWSER_NUMBER');return n;}
  if(Array.isArray(value))return value.map(browserValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='native_sort_key'&&v instanceof ExactNumber?v.raw:browserValue(v)]));
  return value;
}
module.exports={parse,ExactNumber,equal,browserValue,stringify};
