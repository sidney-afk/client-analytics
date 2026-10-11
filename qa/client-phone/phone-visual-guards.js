'use strict';
// Native computed geometry complements the screenshot review. These selectors
// cover the repaired classes of mistakes, including sheets mounted under body.
const assert = require('node:assert/strict');
async function check(page) {
  if (page.viewportSize()?.width >= 768 || process.argv.some(a => /^--(before-root|capture-before)/.test(a)) || process.env.PRISM_MOCKUP === '1') return;
  const failures = await page.evaluate(() => {
    const failures = [];
    const visible = node => node.checkVisibility({checkVisibilityCSS:true}) && node.getBoundingClientRect().height > 0;
    const nodes = selector => [...document.querySelectorAll(selector)].filter(visible);
    const minimum = (selector, property, expected) => nodes(selector).forEach(node => {
      const actual = property === 'height' ? node.getBoundingClientRect().height : parseFloat(getComputedStyle(node)[property]);
      if (actual < expected - .1) failures.push(`${selector}: ${property} ${actual}, expected >= ${expected}`);
    });
    const calendarHelp='html.sv-staff-phone .cal-import-head p,html.sv-staff-phone :is(.cal-import-drop-sub,.cal-native-name-optional,.cal-org-sec,.cal-org-toggle .cal-org-toggle-sub,.sv-jump-empty)';
    minimum(calendarHelp,'fontSize',13);
    nodes(calendarHelp).forEach(node=>{
      const probe=document.createElement('span');probe.style.color='var(--text-secondary)';node.appendChild(probe);
      if(getComputedStyle(node).color!==getComputedStyle(probe).color) failures.push('Phone Calendar helper text must use readable secondary color');probe.remove();
    });
    if(nodes('html.sv-staff-phone .sv-jump-foot').length) failures.push('Phone Quick jump must hide desktop keyboard-only instructions');
    if(document.querySelector('#calView[data-pocket-staff-phone]')) {
      minimum('.cal-prompt-head-text h3','fontSize',18);
      minimum('.cal-prompt-head-text p,.cal-prompt-hint,.cal-prompt-banner,.cal-cap-tx','fontSize',13);
      nodes('.cal-prompt-textarea').forEach(node=>{
        const style=getComputedStyle(node,'::placeholder');
        if(style.color!==getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim()) {
          const probe=document.createElement('span');probe.style.color='var(--text-secondary)';node.parentElement.appendChild(probe);
          if(style.color!==getComputedStyle(probe).color) failures.push('Prompt placeholder must use the readable secondary text color');probe.remove();
        }
        if(Number(style.opacity)!==1) failures.push('Prompt placeholder must not fade its text');
      });
    }
    if(document.documentElement.matches('html.fph-on[data-fph="production"]')) {
      minimum('.prod-composer-input','height',96);
      minimum('.prod-composer-actions .prod-write-state:not(.is-error)','fontSize',13);
      minimum('.prod-composer-submit,.prod-composer-audience','fontSize',14);
      if(nodes('[data-prod-keyboard-hint],html.fph-on[data-fph=production] .prod-mi .kbd').length) failures.push('Desktop keyboard hint must be hidden on a phone');
      nodes('#prodRoot').forEach(node=>{if(node.getBoundingClientRect().bottom>innerHeight-11)failures.push('Native card container must fit below the phone title bar');});
    }
    nodes('html.fph-on[data-fph="production"] .prod-composer-input,html.fph-on[data-fph="home"] .search-bar-input').forEach(node=>{
      const style=getComputedStyle(node,'::placeholder');
      const rgb=value=>value.match(/[\d.]+/g).map(Number);
      const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
      let back=[255,255,255,1];for(let p=node;p;p=p.parentElement){const color=rgb(getComputedStyle(p).backgroundColor);if(color.length===3||color[3]===1){back=color;break;}}
      const a=lum(rgb(style.color)),b=lum(back);if(Number(style.opacity)!==1||(Math.max(a,b)+.05)/(Math.min(a,b)+.05)<4.5)failures.push('Comment and Analytics placeholders require unfaded readable contrast');
    });
    minimum('html.fph-on #pinDropCloseBtn svg','width',18);
    minimum('html.fph-on[data-fph="home"] .card-head [title] svg','width',18);
    minimum('html.fph-on[data-fph="home"] :is(.card-date,.pin-add-btn>span,[data-analytics-period])','fontSize',13);
    nodes('html.fph-on[data-fph="home"] .card-head a[href]').forEach(node=>{if(node.getBoundingClientRect().height<44)failures.push('Analytics card links need a complete 44px hit target');});
    minimum('html.sv-staff-phone :is(.cal-altcap-add,.cal-cap-tab), html.boot-client .cal-review-cap-head, html.fph-on[data-fph="tiktok-upload"] .tk-help','fontSize',13);
    minimum('html.sv-staff-phone :is(.cal-altcap-add,.cal-cap-tab,.cal-cap-tab-x)','height',44);
    minimum('html.sv-staff-phone .cal-cap-tab-x','width',44);
    nodes('#calView[data-pocket-staff-phone] .cal-fld-name, #sxrView[data-pocket-staff-samples] .cal-fld-name').forEach(node => {
      if (node.tagName !== 'TEXTAREA' || !node.hasAttribute('data-pocket-title') || node.scrollHeight > node.clientHeight + 1) failures.push('Phone title must wrap without hiding its final line');
    });
    minimum('html.sv-staff-phone .tdy-cl-lab, html.fph-on[data-fph="workload"] :is(.wl-loose-client-name,.wl-loose-parent-ident,.wl-loose-parent-title), html.fph-on[data-fph="production"] :is(.prod-assets-label,.prod-assets-state), html.boot-client [data-analytics-pending]','fontSize',13);
    if (document.querySelector('#calView[data-pocket-staff-phone],#sxrView[data-pocket-staff-samples],.pocket-client-calendar,#sxrView[data-pocket-client-phone="samples"]')) {
      minimum('.cal-preview-overlay :is(.cal-preview-label,.cal-preview-meta,.cal-client-comp-pill)','fontSize',13);
      minimum('.cal-preview-val a','height',44);
      minimum('.cal-preview-val a','fontSize',14);
    }
    nodes('#calView[data-pocket-staff-phone] .pocket-cal-timeline-loading').forEach(node => {
      if (node.querySelectorAll('.pocket-cal-timeline-loading-row').length !== 3) failures.push('Calendar loading needs three native timeline rows');
      const pseudo=getComputedStyle(node,'::before');
      if (pseudo.display !== 'none' && !['none','normal'].includes(pseudo.content)) failures.push('Timeline loading must not display a duplicate or false empty-state heading');
    });
    nodes('html.fph-on[data-fph="production"] .prod-detail-skeleton, html.fph-on[data-fph="workload"] .workload-skeleton-grid, html.sv-staff-phone .tdy-skel, html.boot-client [data-pocket-client-phone="analytics"] .analytics-detail-skeleton').forEach(node => {
      const label=getComputedStyle(node,'::before');
      if (!/Loading/.test(label.content) || parseFloat(label.fontSize)<14) failures.push('Loading shell needs a readable loading label: '+node.className);
    });
    nodes('html.boot-client [data-pocket-client-phone="analytics"] .analytics-skel-metrics').forEach(node => {
      if (getComputedStyle(node).gridTemplateColumns.split(' ').length !== 2) failures.push('Client analytics loading metrics need two columns');
    });
    nodes('html.fph-on[data-fph="tiktok-upload"] .tk-profile-line:has(.tk-warn-chip)').forEach(node => {
      if (!node.textContent.includes('Clients, Publishing') || /Sheet|Connection ID/.test(node.textContent)) failures.push('Disconnected account guidance must name the native phone action');
    });
    minimum('html.fph-on[data-fph="tiktok-upload"] :is(.tk-q-day,.tk-q-meta,.tk-queue-title), html.boot-client :is(.cal-org-sec,.cal-org-toggle .cal-org-toggle-sub), html.sv-staff-phone .arx-row-meta','fontSize',13);
    nodes('html.fph-on[data-fph="tiktok-upload"] .tk-q-meta').forEach(node=>{if(getComputedStyle(node).whiteSpace!=='normal'||getComputedStyle(node).flexWrap!=='wrap')failures.push('Queue metadata must wrap without clipping');});
    nodes('html.fph-on[data-fph="tiktok-upload"] .tk-queue-item').forEach(node=>{const date=node.querySelector('.tk-q-day'),meta=node.querySelector('.tk-q-meta');if(date&&meta&&date.getBoundingClientRect().right>meta.getBoundingClientRect().left+1)failures.push('Queue date must not overlap client metadata');});
    if(document.documentElement.matches('html.sv-staff-phone') && /^Archive/.test(document.querySelector('#confirmTitle')?.textContent||'')) {
      const message=document.querySelector('#confirmMsg')?.textContent||'';
      if(!message.includes('Archived cards')||/Google Sheet|server/.test(message))failures.push('Phone archive confirmation must name the native recovery action');
    }
    return failures;
  });
  assert.deepEqual(failures, [], 'Phone visual regression guards');
}
module.exports = {check};
