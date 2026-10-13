// Toolbar: theme, device, state. State shows elements with data-state matching.
(function(){
  function setOn(group,val){document.querySelectorAll('[data-'+group+']').forEach(b=>b.classList.toggle('on',b.dataset[group]===val))}
  window.mockTheme=v=>{document.documentElement.dataset.theme=v;setOn('theme',v)};
  window.mockDevice=v=>{document.body.classList.toggle('phone',v==='phone');setOn('device',v);if(window.onDevice)onDevice(v)};
  window.mockState=v=>{document.querySelectorAll('[data-show]').forEach(e=>{e.hidden=!e.dataset.show.split(' ').includes(v)});setOn('state',v)};
  document.addEventListener('DOMContentLoaded',()=>{
    const q=new URLSearchParams(location.search);
    mockTheme(q.get('theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
    mockDevice(q.get('device')||(innerWidth<700?'phone':'desktop'));
    const first=document.querySelector('[data-state]');if(first)mockState(q.get('state')||first.dataset.state);
  });
})();
