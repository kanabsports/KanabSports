const key='ksCoachPushDeviceToken';
const deviceToken=()=>{let t=localStorage.getItem(key);if(!t){t=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem(key,t)}return t};
const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function api(body){const r=await fetch('/api/coach-push',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Coach notifications unavailable.');return d}
let installPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;window.dispatchEvent(new Event('coachinstallready'))});

async function waitForActive(reg){
 if(reg.active)return reg;
 const worker=reg.installing||reg.waiting;
 if(!worker)return reg;
 await new Promise(resolve=>{
  if(worker.state==='activated')return resolve();
  const done=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',done);resolve()}};
  worker.addEventListener('statechange',done);
 });
 return reg;
}

async function mount(){
 const host=document.getElementById('coachAppPanel');if(!host)return;
 host.innerHTML='<div style="background:#fff;border:1px solid #deded9;border-radius:18px;padding:22px"><div class="eyebrow">COACH APP</div><h2 style="margin:7px 0 8px;font-size:28px">Put Kanab Sports on your Home Screen.</h2><p style="color:#747780;line-height:1.55;margin:0">Install the Coach Portal like an app, then turn on notifications for score approvals and important coach alerts.</p><div id="coachInstallHelp" style="font-size:13px;color:#747780;line-height:1.5;margin-top:12px"></div><div style="display:flex;gap:9px;flex-wrap:wrap;margin-top:14px"><button id="coachInstall" class="button" type="button" hidden>Install Coach App</button><button id="coachPushEnable" class="button" type="button" hidden>Turn On Notifications</button><button id="coachPushTest" class="button" type="button" hidden style="background:#17191d">Send Test</button><button id="coachPushDisable" class="button" type="button" hidden style="background:#fff;color:#9d2028;border:1px solid #d8a8ab">Turn Off</button></div><div id="coachPushState" style="font-size:13px;color:#747780;margin-top:10px;min-height:20px">Checking this device…</div></div>';
 const q=id=>host.querySelector('#'+id),state=q('coachPushState'),help=q('coachInstallHelp');
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 let reg,config,sub,busy=false;

 const showInstall=()=>{
   if(standalone()){q('coachInstall').hidden=true;help.textContent='Coach app installed on this device.';return}
   if(installPrompt){q('coachInstall').hidden=false;help.textContent='Install the Coach Portal for the best notification experience.';return}
   q('coachInstall').hidden=true;
   help.textContent=ios?'On iPhone/iPad: Share → Add to Home Screen → Open as Web App. Then open the new Coach icon and turn on notifications.':'Use your browser menu → Install app / Add to Home Screen. Then reopen the Coach app and turn on notifications.';
 };
 showInstall();window.addEventListener('coachinstallready',showInstall);

 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){state.textContent='This device/browser does not support web app notifications.';return}
 try{
   config=await api();
   reg=await navigator.serviceWorker.register('/coach-sw.js',{scope:'/coaches'});
   await waitForActive(reg);
   sub=await reg.pushManager.getSubscription();
 }catch(e){state.textContent=e.message;return}

 const refresh=async()=>{
   sub=await reg.pushManager.getSubscription();
   q('coachPushEnable').hidden=!!sub;
   q('coachPushTest').hidden=!sub;
   q('coachPushDisable').hidden=!sub;
   if(ios&&!standalone()){q('coachPushEnable').hidden=true;state.textContent='Install the Coach app to your Home Screen first, then open it and enable notifications.';return}
   state.textContent=sub?'Coach notifications are enabled on this device.':Notification.permission==='denied'?'Notifications are blocked in device/browser settings.':'Notifications are off.';
 };
 await refresh();

 q('coachInstall').onclick=async()=>{
   if(!installPrompt)return;
   installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;showInstall();
 };
 const run=async fn=>{if(busy)return;busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn()}catch(e){state.textContent=e.message}finally{busy=false;host.querySelectorAll('button').forEach(b=>b.disabled=false)}};
 q('coachPushEnable').onclick=()=>run(async()=>{
   const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications were not enabled. You can change permission in device settings.');
   const created=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
   try{await api({action:'subscribe',endpoint:created.endpoint,token:deviceToken()})}catch(e){await created.unsubscribe();throw e}
   await refresh();
 });
 q('coachPushDisable').onclick=()=>run(async()=>{if(sub){try{await api({action:'unsubscribe',endpoint:sub.endpoint,token:deviceToken()})}finally{await sub.unsubscribe()}}await refresh()});
 q('coachPushTest').onclick=()=>run(async()=>{if(!sub)return;const d=await api({action:'test',endpoint:sub.endpoint,token:deviceToken()});state.textContent=d.message});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();