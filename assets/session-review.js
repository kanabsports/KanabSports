(() => {
 const rawLocal=window.localStorage,rawSession=window.sessionStorage;
 const send=window.fetch.bind(window);let dialog,queue=[],busy=false,timer;
 const labels={owner:'owner',coach:'coach',parent:'parent'};
 const ready=new Promise(resolve=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',resolve,{once:true}):resolve());
 async function check(){
  if(busy||document.hidden)return;busy=true;
  try{
   const r=await send('/api/session-review',{cache:'no-store'});if(!r.ok)return;const data=await r.json();queue=(data.sessions||[]).filter(s=>s.due);
   clearTimeout(timer);const upcoming=(data.sessions||[]).filter(s=>!s.due).map(s=>s.reviewAt-Date.now());if(upcoming.length)timer=setTimeout(check,Math.min(Math.max(1000,Math.min(...upcoming)),2147483647));
   if(queue.length){await ready;show();}else if(dialog?.open){dialog.close();location.reload();}
  }catch{}finally{busy=false;}
 }
 function show(){
  if(!dialog){
   dialog=document.createElement('dialog');dialog.setAttribute('aria-labelledby','staySignedInTitle');dialog.style.cssText='width:min(440px,calc(100% - 28px));max-height:90dvh;overflow:auto;border:0;border-radius:18px;padding:24px;font:16px system-ui;color:#111;background:#fff';
   dialog.innerHTML='<h2 id="staySignedInTitle">Still want to stay signed in?</h2><p data-description></p><label for="nextSignInCheck">Ask me again in</label><select id="nextSignInCheck" style="display:block;width:100%;font:inherit;padding:13px;margin:10px 0 18px"><option value="week">1 week</option><option value="month">1 month</option><option value="three_months">3 months</option><option value="six_months">6 months</option></select><p style="font-size:14px">Only choose a longer time on a device you trust. We’ll ask on your next visit after that date.</p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-yes>Yes, keep me signed in</button><button type="button" data-no>No, sign me out</button></div><p role="status"></p>';
   for(const b of dialog.querySelectorAll('button'))b.style.cssText='min-height:46px;padding:12px;border:1px solid #bbb;border-radius:10px;font:inherit;font-weight:700;cursor:pointer';
   dialog.querySelector('[data-yes]').style.background='#e32636';dialog.querySelector('[data-yes]').style.color='white';
   dialog.addEventListener('cancel',e=>e.preventDefault());
   dialog.querySelector('[data-yes]').onclick=()=>act('continue');dialog.querySelector('[data-no]').onclick=()=>act('logout');document.body.append(dialog);
  }
  dialog.querySelector('[data-description]').textContent='Confirm your '+labels[queue[0].role]+' sign-in on this device to continue.';
  if(!dialog.open)dialog.showModal();
 }
 async function act(action){
  const role=queue[0].role,status=dialog.querySelector('[role=status]');dialog.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Saving…';
  try{
   const r=await send('/api/session-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,role,period:dialog.querySelector('select').value})}),d=await r.json();if(!r.ok)throw Error(d.error);
   if(action==='logout'&&role==='parent'){for(const key of ['kanabSportsParentTeamsV1','kanabSportsParentTrashV1','kanabSportsParentProfileV1','ksFamilyOwner'])rawLocal.removeItem(key);rawSession.removeItem('ksFamilyCategory');}
   queue.shift();status.textContent='';if(queue.length)show();else location.reload();
  }catch(e){status.textContent=e.message;}finally{dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
 }
 window.fetch=async(input,init)=>{const r=await send(input,init);if(r.status===428)check();return r;};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});window.addEventListener('pageshow',check);check();
})();
