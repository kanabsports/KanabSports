const key='ksPushDeviceToken';
const token=()=>{let t=localStorage.getItem(key);if(!t){t=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem(key,t);}return t;};
async function api(body){const r=await fetch('/api/push',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Notifications unavailable.');return d;}
const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export function mountPush(host,getCodes){
 host.innerHTML='<details open><summary style="font-weight:900;cursor:pointer;min-height:44px">App notifications</summary><p class="note" id="pushHelp">Get coach messages and important team updates for the teams saved in My Family. SMS is separate and completely optional.</p><p id="pushState" class="note" role="status">Checking this device…</p><div class="team-actions"><button class="btn primary small" id="pushEnable" hidden>Turn On Notifications</button><button class="btn ghost small" id="pushTest" hidden>Send this device a test</button><button class="btn ghost small" id="pushDisable" hidden>Turn off</button></div></details>';
 const $=id=>host.querySelector('#'+id),state=$('pushState');let registration,config,sub,busy=false;
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
 if(ios&&!standalone){state.textContent='On iPhone or iPad: Share → Add to Home Screen → Open as Web App. Open the new icon, then enable notifications here.';return;}
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){state.textContent='This browser does not support app notifications. Use a supported browser or the installed app.';return;}
 const refresh=async()=>{sub=await registration.pushManager.getSubscription();$('pushEnable').hidden=!!sub;$('pushTest').hidden=!sub;$('pushDisable').hidden=!sub;state.textContent=sub?'Notifications enabled on this device.':Notification.permission==='denied'?'Notifications are blocked. Allow them in your device/browser settings, then reopen the app.':'Notifications are off. Enable them when you’re ready.';};
 const run=async fn=>{if(busy)return;busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){state.textContent=e.message;}finally{busy=false;host.querySelectorAll('button').forEach(b=>b.disabled=false);}};
 $('pushEnable').onclick=()=>run(async()=>{
  const codes=[...new Set(getCodes().map(x=>String(x||'').trim().toUpperCase()).filter(Boolean))];
  if(!codes.length)throw Error('Add at least one team before enabling notifications.');
  // Request permission immediately in the user click, before network work.
  const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications weren’t enabled. You can change permission in device settings.');
  const deviceToken=token();const created=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
  try{await api({action:'subscribe',endpoint:created.endpoint,token:deviceToken,codes});}catch(e){await created.unsubscribe();throw e;}
  await refresh();
 });
 $('pushDisable').onclick=()=>run(async()=>{if(sub){try{await api({action:'unsubscribe',endpoint:sub.endpoint,token:token()});}finally{await sub.unsubscribe();}}await refresh();});
 $('pushTest').onclick=()=>run(async()=>{if(!sub)return;const result=await api({action:'test',endpoint:sub.endpoint,token:token()});state.textContent=result.message;});
 const reconcile=async()=>{if(!registration||busy)return;sub=await registration.pushManager.getSubscription();const codes=[...new Set(getCodes().map(x=>String(x||'').trim().toUpperCase()).filter(Boolean))];if(sub&&!codes.length){await api({action:'unsubscribe',endpoint:sub.endpoint,token:token()});await sub.unsubscribe();await refresh();}else if(sub){await api({action:'subscribe',endpoint:sub.endpoint,token:token(),codes});}};
 document.addEventListener('familyconnectionschanged',()=>reconcile().catch(e=>state.textContent=e.message));
 (async()=>{registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;config=await api();await refresh();await reconcile();await refresh();})().catch(e=>state.textContent=e.message);
}
