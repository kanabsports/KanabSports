// Dismiss only alerts present when the relevant inbox was opened. An alert
// arriving during this operation is left in the tray and keeps its badge.
export async function visitAlerts(workerPath){
  if(document.hidden||!navigator.clearAppBadge||!navigator.serviceWorker)return;
  try{
    const registrations=await navigator.serviceWorker.getRegistrations();
    const own=registrations.find(r=>r.active&&new URL(r.active.scriptURL).pathname===workerPath);
    if(!own)return;
    const shown=await own.getNotifications();
    for(const alert of shown)alert.close();
    await navigator.clearAppBadge();
    const pending=await Promise.all(registrations.map(r=>r.getNotifications()));
    if(pending.some(alerts=>alerts.length))await navigator.setAppBadge();
  }catch{/* Continue to display messages even when the OS disables badging. */}
}
