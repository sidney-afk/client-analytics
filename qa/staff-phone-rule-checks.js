'use strict';
// Shared, real-layout assertions. Screenshots are private and optional.
const assert = require('node:assert/strict');

async function inspect(page, root = 'body') {
  return page.evaluate(selector => {
    const scope = document.querySelector(selector);
    if (!scope) throw Error('Missing phone inspection surface: ' + selector);
    const visible = el => el.checkVisibility({checkVisibilityCSS:true}) && !el.closest('[hidden], dialog:not([open])')
      && getComputedStyle(el).opacity !== '0' && getComputedStyle(el).pointerEvents !== 'none';
    const nodes = [...scope.querySelectorAll('button, a[href], [role=button], [data-prod-cmd], input:not([type=hidden]):not([type=file]), textarea, select')].filter(visible);
    const name = el => el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).trim().replace(/\s+/g,'.');
    // A scroller clips offscreen rows before painting. Their un-clipped DOM
    // boxes can extend through a sheet header/footer without covering it.
    const painted = (el, r) => {
      let left=Math.max(0,r.left),right=Math.min(innerWidth,r.right),top=Math.max(0,r.top),bottom=Math.min(innerHeight,r.bottom);
      let fixed=getComputedStyle(el).position==='fixed';
      for(let p=el.parentElement;p;p=p.parentElement){
        const css=getComputedStyle(p),b=p.getBoundingClientRect();
        // Viewport-fixed surfaces escape ordinary ancestor overflow. A
        // transform/paint containing block makes them local again.
        const containingBlock=css.transform!=='none'||css.perspective!=='none'||css.filter!=='none'||/transform|perspective|filter/.test(css.willChange)||/layout|paint|strict|content/.test(css.contain);
        if(fixed&&!containingBlock)continue;
        if(containingBlock)fixed=false;
        if(/auto|scroll|hidden|clip/.test(css.overflowX)){left=Math.max(left,b.left+p.clientLeft);right=Math.min(right,b.left+p.clientLeft+p.clientWidth);}
        if(/auto|scroll|hidden|clip/.test(css.overflowY)){top=Math.max(top,b.top+p.clientTop);bottom=Math.min(bottom,b.top+p.clientTop+p.clientHeight);}
        if(css.position==='fixed')fixed=true;
      }
      return {left,right,top,bottom};
    };
    const boxes = nodes.map(el => {const r=el.getBoundingClientRect();return {el,name:name(el),r,paint:painted(el,r)};});
    const small = boxes.filter(({el,r}) => !el.matches('input[type=checkbox],input[type=radio]') && (r.width < 43.5 || r.height < 43.5)).map(({name,r})=>({name,w:r.width,h:r.height}));
    const overlaps = [];
    const inView = r => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    for (let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) {
      const a=boxes[i], b=boxes[j];
      if(a.el.contains(b.el)||b.el.contains(a.el)||!inView(a.r)||!inView(b.r))continue;
      const w=Math.min(a.paint.right,b.paint.right)-Math.max(a.paint.left,b.paint.left), h=Math.min(a.paint.bottom,b.paint.bottom)-Math.max(a.paint.top,b.paint.top);
      if(w>1 && h>1)overlaps.push({a:a.name,b:b.name,w,h});
    }
    // Text warnings on image cards count too; parent/child containment is
    // intentional, while independent controls covering a warning are a defect.
    for(const warning of scope.querySelectorAll('.cal-smm-warn-overlay, .cal-thumb-drive-warn')) {
      if(!visible(warning))continue;const r=painted(warning,warning.getBoundingClientRect());
      for(const b of boxes) {
        if(warning.contains(b.el)||b.el.contains(warning)||!inView(r)||!inView(b.r))continue;
        const w=Math.min(r.right,b.paint.right)-Math.max(r.left,b.paint.left), h=Math.min(r.bottom,b.paint.bottom)-Math.max(r.top,b.paint.top);
        if(w>1&&h>1)overlaps.push({a:name(warning),b:b.name,w,h});
      }
    }
    const misalignedActions=[];
    for(const wrap of scope.querySelectorAll('.cal-cap-wrap')) {
      const field=wrap.querySelector('textarea');
      if(!field||!visible(field))continue;
      const r=field.getBoundingClientRect();
      const actions=[...wrap.querySelectorAll('.cal-cap-gen, .cal-cap-gen-x, .cal-cap-toggle')].filter(visible)
        .map(button=>{const b=button.getBoundingClientRect();return {name:name(button),gap:b.top-r.bottom,center:b.top+b.height/2};});
      if(actions.some(a=>a.gap < -1 || a.gap > 24) || actions.length>1 && Math.max(...actions.map(a=>a.center))-Math.min(...actions.map(a=>a.center))>1)
        misalignedActions.push(actions);
    }
    const fields=nodes.filter(el=>el.matches('input:not([type=checkbox]):not([type=radio]),textarea,select')).filter(el=>parseFloat(getComputedStyle(el).fontSize)<16).map(name);
    return {width:innerWidth,pageWidth:document.documentElement.scrollWidth,small,overlaps,misalignedActions,fields,controls:nodes.length};
  },root);
}

async function scrollLock(page, overlay) {
  const snapshot = () => page.evaluate(selector => {
    const surface=document.querySelector(selector);
    return {x:scrollX,y:scrollY,background:[...document.querySelectorAll('body *')].filter(el=> !surface?.contains(el) && /auto|scroll/.test(getComputedStyle(el).overflowY+getComputedStyle(el).overflowX)).map(el=>[el.id||el.className,el.scrollLeft,el.scrollTop])};
  },overlay);
  const before=await snapshot();
  await page.mouse.move(3,3);await page.mouse.wheel(0,500);await page.waitForTimeout(60);
  assert.deepEqual(await snapshot(),before,'background moved under '+overlay+' (wheel)');
  const cdp=await page.context().newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:3,y:180}]});
    for(const y of [150,110,70,30])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:3,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(100);
    assert.deepEqual(await snapshot(),before,'background moved under '+overlay+' (touch)');
  } finally {await cdp.detach();}
}

async function assertLayout(page, label, root='body') {
  const result=await inspect(page,root);
  assert(result.pageWidth<=result.width+1,label+': horizontal overflow');
  assert.deepEqual(result.small,[],label+': targets below 44px');
  assert.deepEqual(result.overlaps,[],label+': independent controls overlap');
  assert.deepEqual(result.misalignedActions,[],label+': caption actions detached or misaligned');
  assert.deepEqual(result.fields,[],label+': fields below 16px');
  return result;
}
async function activeSurface(page) {
  // Measure after the native opening class and ownership sync have painted.
  // Both are queued with requestAnimationFrame; measuring between them sees
  // a closed prior sheet and a not-yet-open picker as a false phantom lock.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const surface = await page.evaluate(() => {
    const selector=".cal-lightbox.open, .kasper-lightbox.open, dialog[open], [aria-modal=\"true\"], [role=\"dialog\"], [role=\"alertdialog\"], [role=\"menu\"], [role=\"listbox\"], [class*=\"-overlay\"], [class*=\"-popup\"], [class*=\"-popover\"], [class*=\"-menu\"], [class*=\"-dropdown\"], .prod-pop, .prod-cmd-bd, .cal-card-color-picker, .sv-client-pop, #svJump:not([hidden])";
    // Video paint and card selection layers are inline content, not popups.
    let visible=[...document.querySelectorAll(selector)].filter(el=>!el.matches('.cal-review-video-overlay, .cal-card-select-overlay, .kasper-hero-poster-overlay')&&el.checkVisibility({checkVisibilityCSS:true})&&(getComputedStyle(el).opacity!=='0'||el.matches('.open, .active, .is-open, dialog[open]'))&&getComputedStyle(el).pointerEvents!=='none'&&el.getBoundingClientRect().width>0&&(el.matches('dialog[open]')||/fixed|absolute/.test(getComputedStyle(el).position)));
    const modal=visible.filter(el=>el.matches('dialog[open]')).at(-1);
    if(modal)visible=visible.filter(el=>el===modal||modal.contains(el));
    const leaves=visible.filter(el=>!visible.some(other=>el!==other&&el.contains(other)));
    const el=leaves.sort((a,b)=>(parseInt(getComputedStyle(b).zIndex)||0)-(parseInt(getComputedStyle(a).zIndex)||0))[0];
    if(el?.matches('dialog[open]'))return 'dialog[open]';
    return el ? (el.id ? '#'+CSS.escape(el.id) : el.tagName.toLowerCase()+[...el.classList].map(c=>'.'+CSS.escape(c)).join('')) : 'body';
  });
  if (surface === 'body') assert.equal(await page.locator('html').evaluate(el=>el.classList.contains('sv-phone-locked')), false, 'normal screen retained a phantom popup scroll lock');
  return surface;
}
module.exports={inspect,scrollLock,assertLayout,activeSurface};
