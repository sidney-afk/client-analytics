'use strict';
// Observation only: delegates the real SDK calls and never opens a transport.
// Only synchronous WebSocket construction inside an exact read subscription can
// be attributed. Any other channel, method, endpoint or asynchronous attempt is
// unsupported, even when it happens to share the same WebSocket class.
function installReadSubscriptionObserver({scope,backendOrigin}) {
  let sdk,active=null;
  const clients=new WeakMap(),channels=new WeakMap();
  const state={known:0,unknown:0,matched:0,unmatched:0,labels:new Set()};
  const flag=filter=>({event:'*',schema:'public',table:'syncview_runtime_flags',filter:'key=eq.'+filter});
  const expected={
    ['sxr-'+scope]:{label:'samples_rows',bindings:[{event:'*',schema:'public',table:'sample_reviews',filter:'client=eq.'+scope}]},
    'syncview-sample-runtime-flags':{label:'sample_flags',bindings:[flag('sample_review_ef_clients')]},
    'syncview-runtime-flags':{label:'routing_flags',bindings:[flag('calendar_upsert_ef_clients'),flag('write_ui_reroute_clients'),flag('client_comment_gateway_enabled')]},
    'syncview-settings-runtime-flags':{label:'settings_flags',bindings:[flag('settings_ef_clients')]},
    'syncview-templates':{label:'templates',bindings:[{event:'*',schema:'public',table:'templates'}]},
  };
  const same=(a,b)=>!!a&&Object.keys(a).length===Object.keys(b).length&&Object.keys(b).every(k=>a[k]===b[k]);
  const snapshot=()=>({known:state.known,unknown:state.unknown,matched:state.matched,unmatched:state.unmatched,labels:[...state.labels].sort()});
  Object.defineProperty(window,'__continuityReadSubscriptionState',{get:snapshot,configurable:false});
  Object.defineProperty(window,'__continuityAttributeReadSocket',{value:args=>{
    let matched=false;
    try {
      const url=new URL(args[0]),origin=new URL(backendOrigin);
      matched=!!active&&typeof args[0]==='string'&&args.length<=2&&args[1]===undefined&&url.protocol==='wss:'&&url.host===origin.host&&
        url.pathname==='/realtime/v1/websocket'&&!url.hash&&!url.username&&!url.password&&
        url.searchParams.get('apikey')===active.key&&url.searchParams.get('vsn')==='2.0.0'&&
        [...url.searchParams.keys()].every(k=>['apikey','vsn','eventsPerSecond'].includes(k))&&
        url.searchParams.getAll('apikey').length===1&&url.searchParams.getAll('vsn').length===1&&
        url.searchParams.getAll('eventsPerSecond').length===1&&url.searchParams.get('eventsPerSecond')===String(active.rate);
    }catch{}
    state[matched?'matched':'unmatched']++;
    return matched;
  },configurable:false,writable:false});
  function wrapClient(client,key,validClient,rate) {
    if(clients.has(client))return clients.get(client);
    const wrapped=new Proxy(client,{get(target,property){
      if(property!=='channel') {const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;}
      return (name,options)=>{
        const channel=target.channel(name,options);if(channels.has(channel))return channels.get(channel);
        const binding=[],spec=expected[name];let valid=validClient&&!!spec&&options===undefined;
        const proxy=new Proxy(channel,{get(t,p){
          if(p==='on')return (type,filter,callback)=>{
            valid=valid&&type==='postgres_changes'&&typeof callback==='function';binding.push(filter&&{...filter});
            t.on(type,filter,callback);return proxy;
          };
          if(p==='subscribe')return (...args)=>{
            const known=valid&&rate===(spec.label==='samples_rows'?5:2)&&binding.length===spec.bindings.length&&binding.every((b,i)=>same(b,spec.bindings[i]));
            state[known?'known':'unknown']++;if(known)state.labels.add(spec.label);
            const previous=active;active=known?{key,label:spec.label,rate}:null;
            try{t.subscribe(...args);return proxy;}finally{active=previous;}
          };
          // Calling any channel capability beyond declaring read bindings and
          // subscribing invalidates attribution, including send/track/presence.
          const value=Reflect.get(t,p,t);
          return typeof value==='function'?(...args)=>{state.unknown++;valid=false;return value.apply(t,args);}:value;
        }});
        channels.set(channel,proxy);return proxy;
      };
    }});
    clients.set(client,wrapped);return wrapped;
  }
  function wrapSdk(value) {
    if(!value||typeof value!=='object')return value;
    return new Proxy(value,{get(target,property){
      const fn=Reflect.get(target,property,target);if(property!=='createClient'||typeof fn!=='function')return fn;
      return (...args)=>wrapClient(fn.apply(target,args),args[1],args.length===3&&args[0]===backendOrigin&&typeof args[1]==='string'&&
        args[2]?.auth?.persistSession===false&&args[2]?.auth?.autoRefreshToken===false&&
        Object.keys(args[2]).every(k=>['auth','realtime'].includes(k))&&Object.keys(args[2].auth).length===2&&
        args[2].realtime&&Object.keys(args[2].realtime).length===1&&Object.keys(args[2].realtime.params||{}).length===1,
        args[2]?.realtime?.params?.eventsPerSecond);
    }});
  }
  sdk=wrapSdk(window.supabase);
  Object.defineProperty(window,'supabase',{get:()=>sdk,set:value=>{sdk=wrapSdk(value);},configurable:false});
}
module.exports={installReadSubscriptionObserver};
