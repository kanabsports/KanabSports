const $=id=>document.getElementById(id),enable=$('ownerEnablePush'),test=$('ownerTestPush'),disable=$('ownerDisablePush'),status=$('ownerPushStatus');
const tokenKey='ks-owner-push-token';let registration,config,busy=false,installedPrompt;
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const ios=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
async function api(body){const r=await fetch('/api/owner-push',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error((d.error||d.message||'Notifications unavailable.')+(d.code?' ['+d.code+']':''));return d}
function keyBytes(value){const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0))}
function token(){let t=localStorage.getItem(tokenKey);if(!t){t=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem(tokenKey,t)}return t}
async function display(){const sub=await registration.pushManager.getSubscription();enable.disabled=Boolean(sub)||!config;test.disabled=disable.disabled=!sub;status.textContent=sub?'Notifications enabled on this device. Use Send test notification to check delivery.':'Notifications are off. Enable them to hear about new coach signups and submissions needing approval.'}
async function refresh(){
 if(busy||$('app').classList.contains('hidden'))return;
 if(ios()&&!standalone()){status.textContent='On iPhone: use Safari → Share → Add to Home Screen. Then open KS Owner from your Home Screen to enable notifications.';enable.disabled=true;return}
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){status.textContent='Notifications are not supported in this browser. Open this app in an up-to-date Safari or Chrome.';enable.disabled=true;return}
 busy=true;
 try{
  registration=await navigator.serviceWorker.register('/owner-sw.js',{scope:'/admin',updateViaCache:'none'});
  // A specific registration avoids waiting for the family/coach service worker.
  if(!registration.active)await new Promise((resolve,reject)=>{const worker=registration.installing||registration.waiting;if(!worker)return resolve();const timer=setTimeout(()=>reject(Error('App setup timed out. Reload and retry.')),15000);worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timer);resolve()}})});
  config=await api();
  const sub=await registration.pushManager.getSubscription();
  if(sub&&localStorage.getItem(tokenKey))await api({action:'subscribe',endpoint:sub.endpoint,token:token()});
  if(sub&&!localStorage.getItem(tokenKey))await sub.unsubscribe();
  await display();
 }catch(e){status.textContent=e.message;enable.disabled=true;const sub=await registration?.pushManager.getSubscription().catch(()=>null);test.disabled=disable.disabled=!sub}finally{busy=false}
}
enable.onclick=async()=>{
 enable.disabled=true;
 try{
  // Call requestPermission immediately in the user's click handler for iOS.
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw Error('Notifications were not allowed. You can change this in your device notification settings.');
  const sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)});
  try{await api({action:'subscribe',endpoint:sub.endpoint,token:token()})}catch(e){await sub.unsubscribe();throw e}
  await display();
 }catch(e){status.textContent=e.message;enable.disabled=false}
};
test.onclick=async()=>{test.disabled=true;try{const sub=await registration.pushManager.getSubscription();if(!sub)throw Error('Enable notifications first.');const result=await api({action:'test',endpoint:sub.endpoint,token:token()});status.textContent=result.message}catch(e){status.textContent=e.message}finally{test.disabled=false}};
async function disconnect(){
 const reg=registration||await navigator.serviceWorker?.getRegistration('/admin');if(!reg||!reg.scope.endsWith('/admin'))return;
 const sub=await reg.pushManager.getSubscription();if(!sub)return;
 let failure;try{await api({action:'unsubscribe',endpoint:sub.endpoint,token:token()})}catch(e){failure=e}finally{await sub.unsubscribe();localStorage.removeItem(tokenKey)}
 if(failure)throw failure;
}
disable.onclick=async()=>{disable.disabled=true;try{await disconnect();await display()}catch(e){status.textContent='Device unsubscribed. Server cleanup will retry automatically when delivery expires.';enable.disabled=false;test.disabled=true}};
window.ownerNotifications={refresh,disconnect};
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installedPrompt=e;$('ownerInstall').hidden=false});
$('ownerRetryPush').onclick=()=>refresh();
$('ownerInstall').onclick=async()=>{if(!installedPrompt)return;await installedPrompt.prompt();installedPrompt=null;$('ownerInstall').hidden=true};
window.addEventListener('appinstalled',()=>{$('ownerInstall').hidden=true;refresh()});
new MutationObserver(()=>{if(!$('app').classList.contains('hidden'))refresh()}).observe($('app'),{attributes:true,attributeFilter:['class']});
refresh();
