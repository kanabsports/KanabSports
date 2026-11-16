(() => {
 const role=document.currentScript.dataset.role;
 window.pepOwnerDemo=role;
 // Namespace demo browser state; never read or overwrite the owner's real family.
 for(const name of ['localStorage','sessionStorage']){
  const store=window[name],prefix='pepOwnerDemo:';
  const storage={getItem:k=>store.getItem(prefix+k),setItem:(k,v)=>store.setItem(prefix+k,v),removeItem:k=>store.removeItem(prefix+k),clear:()=>{for(let i=store.length-1;i>=0;i--){const k=store.key(i);if(k.startsWith(prefix))store.removeItem(k);}},key:i=>Object.keys(store).filter(k=>k.startsWith(prefix))[i]?.slice(prefix.length)||null};
  Object.defineProperty(storage,'length',{get:()=>Object.keys(store).filter(k=>k.startsWith(prefix)).length});
  Object.defineProperty(window,name,{value:storage});
 }
 const originalFetch=window.fetch.bind(window);
 // Keeps a stale demo tab isolated even after another tab leaves demo mode.
 window.fetch=(input,init)=>{
  const request=new Request(input instanceof Request?input:new URL(input,location.href),init);
  if(new URL(request.url).origin===location.origin && new URL(request.url).pathname.startsWith('/api/')){
   const headers=new Headers(request.headers);headers.set('X-Pep-Demo',role);
   return originalFetch(new Request(request,{headers}));
  }
  return originalFetch(request);
 };
 document.addEventListener('DOMContentLoaded',()=>{
  const banner=document.createElement('aside');banner.setAttribute('aria-label','Owner demo controls');
  banner.style.cssText='position:sticky;top:0;z-index:9999;background:#fff0c2;color:#161616;padding:12px 16px;border-bottom:2px solid #d5a130;font:15px system-ui;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
  banner.innerHTML='<strong>DEMO TEAM · Fictional families</strong><label>View as <select aria-label="Demo role"><option value="head">Head Coach</option><option value="assistant">Assistant Coach</option><option value="parent">Parent</option></select></label><button type="button" data-reset>Reset demo</button><button type="button" data-exit>Return to owner console</button><span role="status">No real messages or notifications are sent. Demo mode applies to this browser.</span>';
  document.body.prepend(banner);
  for(const el of banner.querySelectorAll('button,select'))el.style.cssText='font:inherit;padding:10px;border:1px solid #806000;border-radius:8px;background:white;color:#161616;min-height:44px';
  const select=banner.querySelector('select'),status=banner.querySelector('[role=status]');select.value=role;
  const post=async body=>{const r=await originalFetch('/api/owner-demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
  async function act(body){try{const d=await post(body);location.href=d.url;}catch(e){status.textContent=e.message;}}
  select.onchange=()=>act({role:select.value});
  banner.querySelector('[data-exit]').onclick=()=>act({action:'exit'});
  banner.querySelector('[data-reset]').onclick=async()=>{if(!confirm('Reset only the fictional demo team?'))return;try{await post({action:'reset'});localStorage.clear();sessionStorage.clear();location.reload();}catch(e){status.textContent=e.message;}};
  // Keep copied invitations visibly fictional, rather than creating a usable team invite.
  document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&/^https?:/.test(a.href)&&new URL(a.href).origin!==location.origin){e.preventDefault();status.textContent='External links are disabled in demo mode.';}},true);
 });
})();
