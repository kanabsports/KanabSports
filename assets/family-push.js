import {notificationPanel} from '/assets/notification-panel.js?v=1';
const key='ksPushDeviceToken';
const token=()=>{let t=localStorage.getItem(key);if(!t){t=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');localStorage.setItem(key,t);}return t;};
async function api(body){const r=await fetch('/api/push',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Notifications unavailable.');return d;}
const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));

export function mountPush(host,getCodes){
 if(window.pepOwnerDemo){host.textContent='Demo mode: device notifications are disabled.';return;}
 host.innerHTML='<details open><summary style="font-weight:900;cursor:pointer;min-height:44px">App notifications</summary><p class="note" id="pushHelp">Get coach messages and team updates on this device. On iPhone, install My Family from Safari’s Share menu first. SMS is separate and optional.</p><p id="pushState" class="note" role="status" aria-live="polite">Checking notification support…</p><p id="pushApproval" class="note" role="status" aria-live="polite"></p><div class="team-actions"><button type="button" class="btn primary small" id="pushEnable" hidden>Turn On Notifications</button><button type="button" class="btn ghost small" id="pushTest" hidden>Send this device a test</button><button type="button" class="btn ghost small" id="pushConfirm" hidden>Yes, I got it</button><button type="button" class="btn ghost small" id="pushDisable" hidden>Turn off</button></div></details>';
 const panel=notificationPanel(host,{portal:'family',title:'App notifications',bottom:document.getElementById('pane-settings')});
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
 const refresh=async()=>{
  sub=await registration.pushManager.getSubscription();
  panel.sync(sub);
  const permitted=Notification.permission==='granted';
  $('pushEnable').hidden=!!sub;
  $('pushTest').hidden=!sub||!permitted;
  $('pushDisable').hidden=!sub;
  $('pushConfirm').hidden=true;
  state.textContent=sub&&permitted?'Notifications enabled on this device. Send a test to check delivery.':!permitted&&Notification.permission==='denied'?'iPhone notifications are blocked. Allow them in iOS Settings for Kanab Sports, then reopen My Family.':'Notifications are off. Tap Turn On Notifications.';
 };
 const testResult=result=>{
  if(result.status==='accepted'){
   state.textContent='Test sent through the push service. Look for a “Kanab Sports · Coach Update” alert on this device. Did you receive it?';
   $('pushConfirm').hidden=false;
  }else{
   state.textContent=result.message||'The test was not accepted. Please retry.';
   $('pushConfirm').hidden=true;
   panel.error();
  }
 };
 const run=async fn=>{
  if(busy)return;
  busy=true;host.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await fn()}catch(e){state.textContent=e.message||'Notification setup failed. Please try again.';panel.error()}
  finally{busy=false;host.querySelectorAll('button').forEach(b=>b.disabled=false)}
 };
 $('pushEnable').onclick=()=>run(async()=>{
  if(!registration||!config)throw Error('Notification service is still connecting. Reopen My Family and try again.');
  state.textContent='Requesting notification permission…';
  // Must run directly from the tap: iOS requires a real user gesture here.
  const permission=await Notification.requestPermission();
  if(permission!=='granted')throw Error('Notifications are not permitted. Allow them in iPhone Settings, then retry.');
  state.textContent='Connecting your device…';
  const existing=await registration.pushManager.getSubscription();
  const created=existing||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
  const deviceToken=token();
  let saved;
  try{saved=await api({action:'subscribe',endpoint:created.endpoint,token:deviceToken,codes:codes()})}
  catch(error){if(!existing)await created.unsubscribe().catch(()=>{});throw error}
  await refresh();
  showApproval(saved);
  state.textContent='Notifications are on. Sending a test to this device…';
  try{testResult(await api({action:'test',endpoint:created.endpoint,token:deviceToken}))}
  catch(error){state.textContent='Notifications are on, but the test could not be sent: '+error.message;panel.error()}
 });
 $('pushTest').onclick=()=>run(async()=>{
  if(!sub)throw Error('Turn notifications on before sending a test.');
  state.textContent='Sending your test…';
  testResult(await api({action:'test',endpoint:sub.endpoint,token:token()}));
 });
 $('pushConfirm').onclick=()=>{if(!sub)return;$('pushConfirm').hidden=true;state.textContent='Confirmed! App notifications are working on this device.';panel.tested(sub)};
 $('pushDisable').onclick=()=>run(async()=>{
  if(sub){try{await api({action:'unsubscribe',endpoint:sub.endpoint,token:token()})}
   finally{await sub.unsubscribe()}}
  approval.textContent='';
  panel.reset();
  await refresh();
 });
 const reconcile=async()=>{
  if(!registration||busy)return;
  const current=await registration.pushManager.getSubscription();
  if(!current)return;
  // Keep a signed-in parent's device subscribed even if their team list is empty
  // or a new private team still needs school approval. The API filters access.
  const saved=await api({action:'subscribe',endpoint:current.endpoint,token:token(),codes:codes()});
  showApproval(saved);
 };
 document.addEventListener('familyconnectionschanged',()=>reconcile().catch(e=>{approval.textContent=e.message;panel.error()}));
 (async()=>{
  registration=await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  config=await api();
  await refresh();
  await reconcile();
 })().catch(error=>{state.textContent='Could not connect notifications: '+error.message;panel.error()});
}
