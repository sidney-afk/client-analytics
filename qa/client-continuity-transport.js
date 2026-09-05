'use strict';
// Independent loopback receivers count actual HTTP delivery, WS upgrades and
// frames. No business endpoint, credentials, content, screenshots or raw logs.
const assert=require('node:assert/strict');
const http=require('node:http'),crypto=require('node:crypto');
const net=require('node:net'),{spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const H=require('./boot/client-entry-sequence');
const {fixture}=require('./client-continuity-fixtures');
const {captureView}=require('../scripts/client-continuity-view');
const {openGuardedContext,denyProxy,DENIAL_REASONS}=require('../scripts/client-continuity-transport');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function socketResetChild(mode,control) {
  let deliveries=0,denied=0,closed=false,proxyServer;
  const sink=net.createServer(socket=>{deliveries++;socket.destroy();});
  await new Promise(resolve=>sink.listen(0,'127.0.0.1',resolve));
  const create=http.createServer;
  http.createServer=(...args)=>{proxyServer=create(...args);return proxyServer;};
  let firewall;
  try{firewall=await denyProxy();}finally{http.createServer=create;}
  firewall.onDenied=()=>{denied++;};
  const deadline=setTimeout(()=>{console.error('socket_reset_fixture_timeout');process.exit(2);},3000);
  try {
    proxyServer.once(mode,(_,socket)=>{
      const handler=socket.listeners('error').find(fn=>fn.name==='onProxySocketError');
      assert.equal(typeof handler,'function','actual proxy socket handler installed');
      if(control)socket.removeListener('error',handler);
      socket.once('close',()=>{closed=true;});
      console.log(JSON.stringify({stage:'reset_injected',mode,guardInstalled:true}));
      // An actual accepted TCP socket emits error asynchronously on destroy.
      // This deterministically reproduces the peer-reset path after HTTP has
      // detached its parser listeners, without relying on OS RST timing.
      socket.destroy(Object.assign(new Error('read ECONNRESET'),{code:'ECONNRESET',errno:-4077,syscall:'read'}));
    });
    const client=net.connect(proxyServer.address().port,'127.0.0.1');
    client.on('error',()=>{});client.resume();
    await new Promise(resolve=>client.once('connect',resolve));
    const target='127.0.0.1:'+sink.address().port;
    client.write(mode==='connect'?`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`:
      `GET http://${target}/synthetic HTTP/1.1\r\nHost: ${target}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    await new Promise(resolve=>client.once('close',resolve));
    await sleep(25);
    assert.equal(closed,true);assert.ok(denied>=2);assert.equal(deliveries,0);
    await firewall.close();firewall=null;
    console.log(JSON.stringify({stage:'reset_survived',mode,denied:true,socketsClosed:true,receiverEscapes:deliveries}));
  }finally{clearTimeout(deadline);if(firewall)await firewall.close();await new Promise(resolve=>sink.close(resolve));}
}
function socketResetRegressions() {
  let passed=0;
  for(const mode of ['connect','upgrade']) {
    for(const control of [true,false]) {
      const child=spawnSync(process.execPath,[__filename,'--socket-reset-child',mode,...(control?['--control']:[])],{encoding:'utf8',timeout:5000,maxBuffer:16384});
      const events=child.stdout.trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
      assert.deepEqual(events[0],{stage:'reset_injected',mode,guardInstalled:true});
      if(control) {
        assert.equal(child.status,1);assert.match(child.stderr,/Unhandled 'error' event/);assert.match(child.stderr,/read ECONNRESET/);
        assert.equal(events.length,1); // An unrelated startup/fixture error is not proof.
      }else {
        assert.equal(child.status,0);assert.equal(child.stderr,'');
        assert.deepEqual(events[1],{stage:'reset_survived',mode,denied:true,socketsClosed:true,receiverEscapes:0});
      }
      passed++;
    }
  }
  return passed;
}
async function receiver() {
  const receipt={http:0,upgrades:0,frames:0},sockets=new Set();let redirect;
  const server=http.createServer((req,res)=>{
    receipt.http++;
    res.writeHead(req.url==='/redirect'?302:200,{'access-control-allow-origin':'*',
      'content-type':'text/plain',...(req.url==='/redirect'?{location:redirect}:{})});res.end('synthetic');
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.on('upgrade',(req,socket)=>{
    receipt.upgrades++;
    const key=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+key+'\r\n\r\n');
    socket.on('data',()=>{receipt.frames++;socket.destroy();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {origin:'http://127.0.0.1:'+server.address().port,receipt,setRedirect:value=>{redirect=value;},
    close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
async function attempt(page,mode,origin) {
  return page.evaluate(async({mode,origin})=>{
    const post={method:'POST',body:'synthetic',keepalive:true};
    if(mode==='beacon')return navigator.sendBeacon(origin+'/business','synthetic');
    if(mode==='popup_beacon'){const child=window.open('about:blank');return child.navigator.sendBeacon(origin+'/business','synthetic');}
    if(mode==='iframe_beacon'){const child=document.createElement('iframe');document.body.append(child);return child.contentWindow.navigator.sendBeacon(origin+'/business','synthetic');}
    if(mode==='keepalive')return fetch(origin+'/business',post).then(()=>true,()=>false);
    if(mode==='request_keepalive')return fetch(new Request(origin+'/business',post)).then(()=>true,()=>false);
    if(mode==='post')return fetch(origin+'/business',{method:'POST',body:'synthetic'}).then(()=>true,()=>false);
    if(mode==='metadata_post')return fetch(origin+'/webhook/linear-issue-statuses',{method:'POST',body:JSON.stringify({issues:['SYN-101']})}).then(()=>true,()=>false);
    if(mode==='worker'){try{new Worker(origin+'/synthetic-worker');return true;}catch{return false;}}
    if(mode==='untrusted_reason'){await window.__continuityTransportBlocked('https://fixture.invalid/private-token');return false;}
    if(mode==='reader')return fetch(origin+'/reader').then(r=>r.ok,()=>false);
    if(mode==='redirect')return fetch(origin+'/redirect').then(()=>true,()=>false);
    if(mode==='websocket')return new Promise(resolve=>{
      try{const ws=new WebSocket(origin.replace('http','ws')+'/business');ws.onopen=()=>{ws.send('synthetic');resolve(true);};ws.onerror=()=>resolve(false);}catch{resolve(false);}
      setTimeout(()=>resolve(false),500);
    });
  },{mode,origin});
}
let stage='startup';
async function main() {
  stage='socket_reset_regression';const resetCases=socketResetRegressions();
  const sink=await receiver(),reader=await receiver(),server=await H.startStreamServer();
  reader.setRedirect(sink.origin+'/business');
  const browser=await chromium.launch({headless:true});let passed=resetCases;
  try {
    // Negative control: without the guard, these same real receivers must see
    // HTTP and WS data. Otherwise zero receipts below could be a broken fixture.
    stage='receiver_negative_control';
    const control=await browser.newContext();const page=await control.newPage();
    await attempt(page,'beacon',sink.origin);await attempt(page,'keepalive',sink.origin);
    await attempt(page,'request_keepalive',sink.origin);await attempt(page,'popup_beacon',sink.origin);
    await attempt(page,'websocket',sink.origin);await sleep(150);
    assert.equal(sink.receipt.http,4);assert.equal(sink.receipt.upgrades,1);assert.ok(sink.receipt.frames>0);
    await control.close();passed++;
    for(const mode of ['blank_beacon','blank_keepalive','blank_request_keepalive','beacon','keepalive','request_keepalive',
      'popup_beacon','iframe_beacon','websocket','worker','untrusted_reason','metadata_post','late_post','late_beacon','late_auth','late_pageerror','redirect','reader','teardown_beacon']) {
      stage=mode;const f=fixture(browser,server,'samples');
      // The sink is allowed for POST cases: method denial, not a missing origin,
      // must prevent delivery. Redirect targets and WS remain unapproved.
      f.config.readOrigins.push(reader.origin);
      if(!['redirect','websocket'].includes(mode))f.config.readOrigins.push(sink.origin);
      let currentPage,census=0;const navigate=f.deps.navigate,read=f.deps.fetchImpl,forward=f.deps.forward;
      f.deps.forward=(route,directRead)=>new URL(route.request().url()).origin===reader.origin
        ?directRead(route.request()):forward(route,directRead);
      f.deps.navigate=async(page,url)=>{
        currentPage=page;
        if(mode.startsWith('blank_'))await attempt(page,mode.slice(6),sink.origin);
        await navigate(page,url);
        if(!mode.startsWith('blank_')&&!mode.startsWith('late_')&&!mode.startsWith('teardown_'))await attempt(page,mode,mode==='metadata_post'?f.config.fallbackOrigin:['redirect','reader'].includes(mode)?reader.origin:sink.origin);
      };
      f.deps.fetchImpl=async(url,init)=>{
        if(++census===2 && mode==='late_post')await attempt(currentPage,'post',sink.origin);
        if(census===2 && mode==='late_beacon')await attempt(currentPage,'beacon',sink.origin);
        if(census===2 && mode==='late_auth') {
          await currentPage.context().route('**/rest/v1/late_auth',route=>route.fulfill({status:403,body:'{}'}));
          await currentPage.evaluate(origin=>fetch(origin+'/rest/v1/late_auth').catch(()=>{}),f.config.backendOrigin);
        }
        if(census===2 && mode==='late_pageerror')await currentPage.evaluate(()=>{setTimeout(()=>{throw new Error('synthetic');},0);});
        return read(url,init);
      };
      if(mode==='teardown_beacon') {
        const configure=f.deps.configureContext;
        f.deps.configureContext=async context=>{await configure(context);const close=context.close.bind(context);
          context.close=async()=>{await attempt(currentPage,'beacon',sink.origin);await close();};};
      }
      const before={...sink.receipt},reads=reader.receipt.http;
      const report=await captureView(browser,f.config,f.deps);await sleep(75);
      assert.deepEqual(sink.receipt,before);
      assert.equal(report.code,mode==='reader'?'healthy':mode==='redirect'?'unexpected_request':mode==='late_auth'?'valid_link_auth':mode==='late_pageerror'?'browser_error':'mutation_blocked');
      assert.ok(report.denialReasons.every(reason=>DENIAL_REASONS.includes(reason)));
      const reason=mode.includes('beacon')?'beacon_transport_blocked':mode.includes('keepalive')?'keepalive_transport_blocked':
        mode==='websocket'?'realtime_transport_blocked':mode==='worker'?'worker_transport_blocked':mode==='untrusted_reason'?'realm_guard_failed':
          mode==='metadata_post'?'metadata_post_blocked':mode==='late_post'?'other_request_blocked':null;
      if(reason)assert.ok(report.denialReasons.includes(reason));
      if(mode==='reader')assert.deepEqual(report.denialReasons,[]);
      if(['reader','redirect'].includes(mode))assert.equal(reader.receipt.http,reads+1);
      passed++;
    }
    // Bypass BOTH injected guards through native isolated-world constructors.
    // Playwright WS routing is itself an init script, not a network firewall.
    // The refusing context proxy must independently prevent actual delivery.
    for(const mode of ['beacon','keepalive','request_keepalive','websocket']) {
      stage='native_'+mode;
      const f=fixture(browser,server,'samples'),{context,guard}=await openGuardedContext(browser,f.config),page2=await context.newPage();
      const cdp=await context.newCDPSession(page2),tree=await cdp.send('Page.getFrameTree');
      const world=await cdp.send('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'synthetic-control'});
      const before={...sink.receipt};
      const inject=(mode,origin)=>{
        const init={method:'POST',body:'synthetic',keepalive:true};
        if(mode==='beacon')navigator.sendBeacon(origin+'/business','synthetic');
        if(mode==='keepalive')void fetch(origin+'/business',init).catch(()=>{});
        if(mode==='request_keepalive')void fetch(new Request(origin+'/business',init)).catch(()=>{});
        if(mode==='websocket')new WebSocket(origin.replace('http','ws')+'/business');
      };
      await cdp.send('Runtime.evaluate',{contextId:world.executionContextId,expression:`(${inject.toString()})(${JSON.stringify(mode)},${JSON.stringify(sink.origin)})`});
      await sleep(150);await guard.close();
      assert.equal(guard.code(),'mutation_blocked');assert.deepEqual(sink.receipt,before);passed++;
      assert.ok(guard.denialReasons().some(reason=>reason.startsWith('proxy_')||reason==='realtime_transport_blocked'));
    }
    stage='bounded_teardown';
    const f=fixture(browser,server,'samples'),{context,guard}=await openGuardedContext(browser,f.config);
    const close=context.close.bind(context);let release;
    context.close=()=>new Promise(resolve=>{release=resolve;});
    const started=Date.now();await guard.close();assert.ok(Date.now()-started<4500);assert.equal(guard.code(),'read_failed');
    await close();release();passed++;
    stage='bounded_partial_setup_cleanup';
    let cleanup,releaseSetup;const setupStarted=Date.now();
    await assert.rejects(openGuardedContext(browser,f.config,{configureContext:async partial=>{
      cleanup=partial.close.bind(partial);partial.close=()=>new Promise(resolve=>{releaseSetup=resolve;});
      throw new Error('synthetic_setup_failure');
    }}),{message:'synthetic_setup_failure'});
    assert.ok(Date.now()-setupStarted<4500);await cleanup();releaseSetup();passed++;
    console.log(JSON.stringify({suite:'client_continuity_transport',passed,receiverEscapes:0,live:false}));
  } finally {await browser.close();await server.close();await reader.close();await sink.close();}
}
if(process.argv[2]==='--socket-reset-child')socketResetChild(process.argv[3],process.argv.includes('--control'))
  .catch(()=>{console.error('socket_reset_fixture_failed');process.exitCode=2;});
else main().catch(()=>{console.error(JSON.stringify({suite:'client_continuity_transport',stage,code:'assertion_or_fixture_failed'}));process.exitCode=1;});
