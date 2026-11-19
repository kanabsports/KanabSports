export async function setAppBadgeCount(unread){
  const count=Number(unread);
  if(!Number.isSafeInteger(count)||count<0)return;
  try{if(count)await navigator.setAppBadge?.(count);else await navigator.clearAppBadge?.()}catch{/* The platform controls badge permission. */}
}

export async function syncFamilyBadge(){
  try{
    const response=await fetch('/api/family-unread',{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)return null;
    const data=await response.json(),count=Number(data.unread);
    if(!Number.isSafeInteger(count)||count<0)return null;
    await setAppBadgeCount(count);return count;
  }catch{return null}
}

// Dismiss only alerts present when the relevant inbox was opened. An alert
// arriving during this operation is left in the tray. The My Family server
// count remains authoritative even after the notification tray is cleared.
export async function visitAlerts(workerPath){
  if(document.hidden||!navigator.clearAppBadge||!navigator.serviceWorker)return;
  try{
    const registrations=await navigator.serviceWorker.getRegistrations();
    const own=registrations.find(r=>r.active&&new URL(r.active.scriptURL).pathname===workerPath);
    if(!own)return;
    const shown=await own.getNotifications();
    for(const alert of shown)alert.close();
    if(await syncFamilyBadge()!==null)return;
    await navigator.clearAppBadge();
    const pending=await Promise.all(registrations.map(r=>r.getNotifications()));
    if(pending.some(alerts=>alerts.length))await navigator.setAppBadge();
  }catch{/* Continue to display messages even when the OS disables badging. */}
}
