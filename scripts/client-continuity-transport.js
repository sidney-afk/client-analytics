'use strict';
const http=require('node:http');
const DENIAL_REASONS=Object.freeze(['metadata_post_blocked','realtime_transport_blocked',
  'worker_transport_blocked','beacon_transport_blocked','keepalive_transport_blocked',
  'realm_guard_failed','proxy_http_blocked','proxy_tunnel_blocked','proxy_socket_error','other_request_blocked']);
function requestDenialReason(request,config) {
  const url=new URL(request.url());
  return request.method()==='POST'&&url.origin===new URL(config.fallbackOrigin).origin&&
    url.pathname==='/webhook/linear-issue-statuses'&&!url.search&&!request.redirectedFrom()
    ?'metadata_post_blocked':'other_request_blocked';
}
// Browser instrumentation only. This does not change product writers or access.
function requestPolicy(request, config) {
  const url=new URL(request.url()), backend=new URL(config.backendOrigin).origin;
  const fallback=new URL(config.fallbackOrigin).origin;
  const verify=url.origin===backend && url.pathname==='/functions/v1/client-token-verify' && !url.search;
  if(!['GET','HEAD','OPTIONS'].includes(request.method()) &&
      !(request.method()==='POST' && verify && !request.redirectedFrom()))return 'mutation_blocked';
  if(!new Set([new URL(config.shareLink).origin,backend,fallback,...(config.readOrigins||[])]).has(url.origin))return 'unexpected_request';
  if(url.origin===backend && !verify && !/^\/rest\/v1\/[a-z][a-z0-9_]*$/.test(url.pathname))return 'mutation_blocked';
  if(url.origin===fallback && !['/webhook/calendar-get','/webhook/sample-review-get','/webhook/templates-get','/webhook/caption-prompts-get'].includes(url.pathname))return 'mutation_blocked';
  if(request.redirectedFrom())return 'unexpected_request';
  return null;
}

// Init scripts alone do not cover every inherited about:blank realm before a
// synchronous caller can use it. Guard the initial page explicitly, and guard
// same-origin popup/iframe realms synchronously when their handles are returned.
function installRealmGuard() {
  function protect(w) {
    try {
      if(w.__continuityTransportGuard)return;
      Object.defineProperty(w,'__continuityTransportGuard',{value:true});
      let denied=false;const reasons=new Set();
      Object.defineProperty(w,'__continuityTransportDenied',{get:()=>denied});
      Object.defineProperty(w,'__continuityTransportDeniedReasons',{get:()=>[...reasons]});
      const deny=reason=>{
        denied=true;reasons.add(reason);
        // A blank child may inherit its parent's binding only after initialization.
        const notify=w.__continuityTransportBlocked || window.__continuityTransportBlocked;
        if(notify)void notify(reason).catch(()=>{});
      };
      const replace=(target,key,value)=>Object.defineProperty(target,key,{value,writable:false,configurable:false});
      replace(w.Navigator.prototype,'sendBeacon',function(){deny('beacon_transport_blocked');return false;});
      const nativeFetch=w.fetch;
      replace(w,'fetch',function(input,init){
        const request=new w.Request(input,init);
        if(request.keepalive){deny('keepalive_transport_blocked');return w.Promise.reject(new w.TypeError('monitor_transport_blocked'));}
        return nativeFetch.call(this,request);
      });
      for(const name of ['WebSocket','WebTransport','Worker','SharedWorker']) {
        if(name in w)replace(w,name,function(){deny(name==='Worker'||name==='SharedWorker'?'worker_transport_blocked':'realtime_transport_blocked');throw new w.TypeError('monitor_transport_blocked');});
      }
      const nativeOpen=w.open;
      replace(w,'open',function(...args){const child=nativeOpen.apply(this,args);if(child)protect(child);return child;});
      const proto=w.HTMLIFrameElement.prototype;
      const descriptor=Object.getOwnPropertyDescriptor(proto,'contentWindow');
      Object.defineProperty(proto,'contentWindow',{...descriptor,configurable:false,get(){const child=descriptor.get.call(this);if(child)protect(child);return child;}});
    } catch {
      // Cross-origin realms receive the context init script before their scripts.
      // A same-origin installation error is reported and cannot yield healthy.
      try {void window.__continuityTransportBlocked('realm_guard_failed').catch(()=>{});} catch {}
    }
  }
  protect(window);
}

async function installTransportGuard(context,config,deps={}) {
  let code=null,closing=false;
  const active=new Set(),reasons=new Set();
  const latch=(value,reason)=>{if(reason)reasons.add(DENIAL_REASONS.includes(reason)?reason:'realm_guard_failed');if(!code || value==='mutation_blocked')code=value;};
  if(deps.firewall) {
    deps.firewall.onDenied=reason=>latch('mutation_blocked',reason);
    for(const reason of deps.firewall.deniedReasons)latch('mutation_blocked',reason);
  }
  await context.exposeBinding('__continuityTransportBlocked',(_,reason)=>latch('mutation_blocked',DENIAL_REASONS.includes(reason)?reason:'realm_guard_failed'));
  await context.addInitScript(installRealmGuard);
  context.on('page',page=>{
    page.on('pageerror',()=>latch('browser_error'));
    page.on('websocket',()=>latch('mutation_blocked','realtime_transport_blocked'));
  });
  context.on('request',request=>{const violation=requestPolicy(request,config);if(violation)latch(violation,requestDenialReason(request,config));});
  context.on('response',response=>{
    if([401,403].includes(response.status()) && new URL(response.url()).origin===new URL(config.backendOrigin).origin)latch('valid_link_auth');
  });
  await context.routeWebSocket('**/*',socket=>{latch('mutation_blocked','realtime_transport_blocked');socket.close();});
  await context.route('**/*',route=>{
    const work=(async()=>{
      try {
        const violation=requestPolicy(route.request(),config);
        if(violation){latch(violation,requestDenialReason(route.request(),config));await route.abort();return;}
        if(closing){await route.abort();return;}
        // Never continue/fallback: Playwright does not re-route automatic hops.
        // Fixture forwarding returns the same response contract, without live I/O.
        const response=await (deps.forward ? deps.forward(route,deps.directRead) : deps.directRead(route.request()));
        if([401,403].includes(response.status()) && new URL(route.request().url()).origin===new URL(config.backendOrigin).origin)latch('valid_link_auth');
        if(response.status()>=300 && response.status()<400){latch('unexpected_request');await route.abort();return;}
        if(closing){await route.abort();return;}
        await route.fulfill({status:response.status(),headers:response.headers(),body:await response.body()});
      } catch {if(!closing)latch('read_failed');await route.abort().catch(()=>{});}
    })();
    active.add(work);void work.finally(()=>active.delete(work));return work;
  });
  return {
    code:()=>code,
    denialReasons:()=>[...reasons].sort(),
    async prepare(page){await page.evaluate(installRealmGuard);},
    async close(){
      closing=true;
      // Keep every denial layer in place during close. Never return healthy on
      // teardown timeout; remaining requests still cannot be forwarded anew.
      let timer;
      try {
        await Promise.race([
          (async()=>{
            for(const page of context.pages())for(const frame of page.frames()) {
              try {
                const state=await frame.evaluate(()=>({denied:!!window.__continuityTransportDenied,reasons:window.__continuityTransportDeniedReasons}));
                if(state.denied) {
                  latch('mutation_blocked');
                  for(const reason of Array.isArray(state.reasons)?state.reasons:['realm_guard_failed'])latch('mutation_blocked',reason);
                }
              } catch {}
            }
            await Promise.all([context.close(),deps.disposeRead?.()]);
            await Promise.allSettled([...active]);
          })(),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('teardown_timeout')),3000);}),
        ]);
      } catch {latch('read_failed');}
      finally {clearTimeout(timer);if(deps.firewall)await deps.firewall.close();}
    },
  };
}

async function denyProxy() {
  // Independent network boundary: this endpoint never forwards a byte. It also
  // covers inherited/isolated realms missed by Playwright's injected WS routing.
  const sockets=new Set(),firewall={onDenied:()=>{},deniedReasons:new Set()};
  const deny=reason=>{firewall.deniedReasons.add(reason);firewall.onDenied(reason);};
  const server=http.createServer((_,response)=>{deny('proxy_http_blocked');response.writeHead(403);response.end();});
  const refuse=(_,socket)=>{deny('proxy_tunnel_blocked');socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');};
  server.on('connect',refuse);server.on('upgrade',refuse);
  server.on('connection',socket=>{
    sockets.add(socket);
    // CONNECT/upgrade detaches Node's HTTP parser error handling. A peer reset
    // must remain a denied transport, not become an unhandled process error.
    socket.on('error',function onProxySocketError(){deny('proxy_socket_error');socket.destroy();});
    socket.on('close',()=>sockets.delete(socket));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  firewall.proxy={server:'http://127.0.0.1:'+server.address().port,bypass:'<-loopback>'};
  firewall.close=async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));};
  return firewall;
}

async function openGuardedContext(browser,config,deps={}) {
  const firewall=await denyProxy();let context,reader;
  try {
    const options={serviceWorkers:'block',proxy:firewall.proxy};
    context=await browser.newContext(options);
    // Fixtures may supply responses/init data, never replace the protected
    // context or silently discard its mandatory proxy/service-worker options.
    if(deps.configureContext)await deps.configureContext(context);
    // Browser-context API requests inherit its proxy. Use a separate anonymous
    // Node request client for approved reads only, never browser fallback/continue.
    reader=await require('playwright').request.newContext();
    const guard=await installTransportGuard(context,config,{...deps,firewall,
      directRead:request=>reader.fetch(request,{maxRedirects:0,maxRetries:0,timeout:10000}),
      disposeRead:()=>reader.dispose()});
    return {context,guard};
  } catch(error) {
    let timer;
    try {
      await Promise.race([Promise.allSettled([context?.close(),reader?.dispose()]),
        new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);
    } finally {clearTimeout(timer);await firewall.close();}
    throw error;
  }
}
module.exports={requestPolicy,requestDenialReason,DENIAL_REASONS,installRealmGuard,openGuardedContext,denyProxy};
