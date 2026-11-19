const key='ksPushDeviceToken';
const token=()=>{let t=localStorage.getItem(key);if(!t){t=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem(key,t);}return t;};
async function api(body){const r=await fetch('/api/push',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw Error(d.error||'Notifications unavailable.');return d;}
const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));

export function mountPush(host,getCodes){
 if(window.pepOwnerDemo){host.textContent='Demo mode: device notifications are disabled.';return;}
 host.innerHTML='<details open><summary style="font-weight:900;cursor:pointer;min-height:44px">App notifications</summary><p class="note" id="pushHelp">Get coach messages and team updates on this device. On iPhone, install My Family from Safari’s Share menu first. SMS is separate and optional.</p><p id="pushState" class="note" role="status" aria-live="polite">Checking notification support…</p><p id="pushApproval" class="note" role="status" aria-live="polite"></p><div class="team-actions"><button type="button" class="btn primary small" id="pushEnable" hidden>Turn On Notifications</button><button type="button" class="btn ghost small" id="pushTest" hidden>Send this device a test</button><button type="button" class="btn ghost small" id="pushConfirm" hidden>Yes, I got it</button><button type="button" class="btn ghost small" id="pushDisable" hidden>Turn off</button></div></details>';
 const deviceStatus=document.createElement('p');deviceStatus.className='note';deviceStatus.setAttribute('role','status');host.querySelector('#pushState').before(deviceStatus);
 const $=id=>host.querySelector('#'+id),state=$('pushState'),approval=$('pushApproval');
 let registration,config,sub,busy=false;
 const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1),standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
 if(ios&&!standalone){state.textContent='On iPhone or iPad: open this site in Safari, tap Share → Add to Home Screen, then open My Family from that icon to enable notifications.';return;}
 if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){state.textContent='This browser does not support app notifications. Use a supported browser or the installed app.';return;}

 const codes=()=>[...new Set(getCodes().map(x=>String(x||'').trim().toUpperCase()).filter(Boolean))];
 const showApproval=result=>{
  const count=Number(result?.awaitingApproval)||0;
  approval.textContent=count?`${count} saved team${count===1?' is':'s are'} still awaiting guardian approval. Private alerts for ${count===1?'that team':'those teams'} stay off, but your device can receive a test now.`:'';
 };
 let registered=false;
 function controls(){
  const permission=Notification.permission;
  deviceStatus.textContent='Permission: '+permission+'. Device registration: '+(registered?'confirmed.':'unconfirmed.');
  $('pushEnable').hidden=registered||permission==='denied';
  $('pushTest').hidden=permission==='denied';
  $('pushDisable').hidden=!sub;
 }
 async function save(){
  registered=false;
  const saved=await api({action:'subscribe',endpoint:sub.endpoint,token:token(),codes:codes()});
  registered=saved.success===true;
  if(!registered)throw Error('Device registration failed. Retry Turn On Notifications.');
  showApproval(saved);
 }
 async function setupAndTest(){
  $('pushConfirm').hidden=true;
  // Ask inside the tap handler, before waiting on the worker or network.
  if(Notification.permission!=='granted'){
   state.textContent='Requesting permission…';
   if(await Notification.requestPermission()!=='granted')throw Error('Allow notifications for My Family in iPhone Settings, then reopen the app.');
  }
  state.textContent='Registering this device…';
  sub=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
  await save();
  controls();
  state.textContent='Sending this device a test…';
  const result=await api({action:'test',endpoint:sub.endpoint,token:token(),keys:sub.toJSON().keys});
  if(result.status==='expired'){
   registered=false;
   await sub.unsubscribe();sub=null;
   throw Error('This subscription expired. Tap Turn On Notifications to reconnect.');
  }
  if(result.status!=='accepted')throw Error(result.message||'Test rejected. Retry the device test.');
  state.textContent='Push service accepted the test. Check for “My Family · Notification test” on this phone.';
  $('pushConfirm').hidden=false;
 }
 let pending=false;
 async function run(action){
  if(busy)return;
  busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await action()}catch(e){state.textContent=(e.message||'Setup failed.')+' If needed, reopen My Family and retry.'}
  finally{busy=false;controls();host.querySelectorAll('button').forEach(b=>b.disabled=false);if(pending){pending=false;reconcile()}}
 }
 $('pushEnable').onclick=$('pushTest').onclick=()=>run(setupAndTest);
 $('pushConfirm').onclick=()=>{$('pushConfirm').hidden=true;state.textContent='You confirmed receipt on this phone.'};
 $('pushDisable').onclick=()=>run(async()=>{
  try{await api({action:'unsubscribe',endpoint:sub.endpoint,token:token()})}finally{await sub.unsubscribe();sub=null;registered=false}
  approval.textContent='';$('pushConfirm').hidden=true;state.textContent='Device notifications are off.';
 });
 function reconcile(){
  if(!config||!sub)return;
  if(busy){pending=true;return}
  run(save);
 }
 document.addEventListener('familyconnectionschanged',reconcile);
 (async()=>{
  const script='/sw.js?v=family-unread-badge-v1';
  registration=await navigator.serviceWorker.register(script,{scope:'/',updateViaCache:'none'});
  const worker=registration.installing||registration.waiting||registration.active;
  if(!worker||new URL(worker.scriptURL).search!==new URL(script,location.href).search)throw Error('Reopen My Family to finish updating notifications.');
  if(worker.state!=='activated')await new Promise((resolve,reject)=>{
   const finish=error=>{clearTimeout(timer);worker.removeEventListener('statechange',changed);error?reject(error):resolve()};
   const changed=()=>{if(worker.state==='activated')finish();else if(worker.state==='redundant')finish(Error('Reopen My Family to retry the update.'))};
   const timer=setTimeout(()=>finish(Error('Worker update timed out. Reopen My Family.')),15000);
   worker.addEventListener('statechange',changed);changed();
  });
  config=await api();
  await run(async()=>{
   sub=await registration.pushManager.getSubscription();
   if(sub&&Notification.permission==='granted')await save();
   state.textContent=registered?'Notifications enabled. Send this device a test to check receipt.':Notification.permission==='denied'?'Allow notifications in iPhone Settings, then reopen My Family.':'Turn on notifications to register this device and send a test.';
  });
 })().catch(error=>{state.textContent='Could not connect notifications. Reopen My Family and retry. '+error.message});
}
