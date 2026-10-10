'use strict';
// Keep mobile screenshots at the device's real viewport. Native scroll stops
// expose the bottom of long pages and independently scrolling sheets while
// preserving the same fixed-overlay dimensions a person sees on their phone.
const assert=require('node:assert/strict');
const {activeSurface}=require('../staff-phone-rule-checks');
const {check}=require('./phone-visual-guards');
async function anonymizePlaceholders(page) {
  // Fixture captures also anonymize names inside placeholder attributes.
  await page.evaluate(()=>{
    const last=document.querySelector('#headerNav > .header-nav-btn:last-child');
    const label=window.__phoneFixtureReviewerLabel || last?.textContent.trim();
    if(label && label!=='Reviewer') {
      window.__phoneFixtureReviewerLabel=label;
      const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){const node=walker.currentNode;if(!node.parentElement.closest('script,style') && node.textContent.includes(label))node.textContent=node.textContent.replaceAll(label,'Reviewer');}
      document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(node=>{for(const name of ['placeholder','title','aria-label']){const value=node.getAttribute(name);if(value?.includes(label))node.setAttribute(name,value.replaceAll(label,'Reviewer'));}});
    }
    const prompts=[
      typeof _calComposePlaceholder==='function' && typeof _calComposeAudience!=='undefined' && _calComposeAudience!=='client' ? _calComposePlaceholder('smm') : null,
      typeof _sxrComposePlaceholder==='function' && typeof _sxrComposeAudience!=='undefined' && _sxrComposeAudience!=='client' ? _sxrComposePlaceholder('smm') : null,
    ].filter(Boolean);
    document.querySelectorAll('textarea[placeholder]').forEach(node=>{
      if(prompts.includes(node.placeholder)) node.placeholder='Message to the reviewer / team...';
    });
  });
}
async function capture(page,options) {
  const viewport=page.viewportSize();
  if(!viewport||viewport.width>=768)return page.screenshot(options);
  await page.evaluate(()=>document.fonts.ready);
  await anonymizePlaceholders(page);
  await check(page);
  const png=await page.screenshot({...options,fullPage:false});
  assert.equal(png.readUInt32BE(16),viewport.width,'Native phone capture width');
  assert.equal(png.readUInt32BE(20),viewport.height,'Native phone capture height');
  if(!options.path)return png;
  const surface=await activeSurface(page);
  const count=await page.evaluate(({surface,fullPage})=>{
    let root=document.querySelector(surface);
    if(surface!=='body') {
      for(let parent=root?.parentElement;parent&&parent!==document.body;parent=parent.parentElement)
        if(parent.matches('dialog[open],[aria-modal=true],[class*="-overlay"]'))root=parent;
    }
    const nodes=surface==='body'&&!fullPage?[]:[root,...root.querySelectorAll('*')].filter(node=>node&&node.checkVisibility({checkVisibilityCSS:true})&&!node.matches('textarea,input')&&node.clientHeight>40&&node.scrollHeight>node.clientHeight+1&&/auto|scroll/.test(getComputedStyle(node).overflowY));
    if(surface==='body'&&fullPage&&document.scrollingElement.scrollHeight>innerHeight+1)nodes.unshift(document.scrollingElement);
    window.__phoneCaptureScrollers=[...new Set(nodes)].map(node=>({node,top:node.scrollTop,left:node.scrollLeft}));
    return window.__phoneCaptureScrollers.length;
  },{surface,fullPage:options.fullPage});
  try {
    for(let index=0;index<count;index++) {
      const max=await page.evaluate(index=>{const node=window.__phoneCaptureScrollers[index].node;return node.scrollHeight-node.clientHeight;},index);
      const step=await page.evaluate(index=>Math.max(40,Math.min(innerHeight,window.__phoneCaptureScrollers[index].node.clientHeight)-80),index);
      for(let position=0,stop=0;;position=Math.min(max,position+step),stop++) {
        await page.evaluate(({index,position})=>window.__phoneCaptureScrollers[index].node.scrollTo({top:position,behavior:'instant'}),{index,position});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await page.screenshot({...options,path:options.path.replace(/\.png$/,`-scroll-${index}-${stop}.png`),fullPage:false});
        if(position===max)break;
      }
      await page.evaluate(index=>{const saved=window.__phoneCaptureScrollers[index];saved.node.scrollTo({top:saved.top,left:saved.left,behavior:'instant'});},index);
    }
    // Timeline columns are a native horizontal scroll surface. Capture every
    // stop as well as the ordinary vertical page so no weekday is left unseen.
    const timelines=page.locator('.workload-timeline-wrap:visible');
    for(let index=0;index<await timelines.count();index++) {
      const timeline=timelines.nth(index);
      const saved=await page.evaluate(()=>({x:scrollX,y:scrollY}));
      const left=await timeline.evaluate(node=>node.scrollLeft);
      await timeline.scrollIntoViewIfNeeded();
      const bounds=await timeline.evaluate(node=>({max:node.scrollWidth-node.clientWidth,step:Math.max(80,node.clientWidth-112)}));
      try {
        for(let position=0,stop=0;;position=Math.min(bounds.max,position+bounds.step),stop++) {
          await timeline.evaluate((node,x)=>node.scrollTo({left:x,behavior:'instant'}),position);
          await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          await page.screenshot({...options,path:options.path.replace(/\.png$/,`-horizontal-${index}-${stop}.png`),fullPage:false});
          if(position===bounds.max)break;
        }
      } finally {
        await timeline.evaluate((node,x)=>node.scrollTo({left:x,behavior:'instant'}),left);
        await page.evaluate(position=>scrollTo(position.x,position.y),saved);
      }
    }
  } finally {
    await page.evaluate(()=>{for(const saved of window.__phoneCaptureScrollers||[])saved.node.scrollTo({top:saved.top,left:saved.left,behavior:'instant'});delete window.__phoneCaptureScrollers;});
  }
  return png;
}
// Require a settled browser paint, as well as settled DOM geometry. Keep any
// changing frames as diagnostic evidence instead of silently discarding them.
function prepareCaptures(page) {
  const screenshot=page.screenshot.bind(page);
  page.screenshot=async options=>{
    if((page.viewportSize()?.width||Infinity)>=768)return screenshot(options);
    await anonymizePlaceholders(page);
    await page.evaluate(()=>document.fonts.ready);
    const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await frame();
    let previous=await screenshot({...options,path:undefined});
    for(let attempt=0;attempt<5;attempt++) {
      await frame();
      const current=await screenshot({...options,path:undefined});
      if(previous.equals(current)) {
        if(options?.path)require('node:fs').writeFileSync(options.path,current);
        return current;
      }
      if(options?.path)require('node:fs').writeFileSync(options.path.replace(/\.png$/,`-settling-${attempt}.png`),previous);
      previous=current;
    }
    throw new Error('Phone capture did not reach two byte-identical consecutive paints: '+(options?.path||'buffer'));
  };
}
module.exports={capture,anonymizePlaceholders,prepareCaptures};
