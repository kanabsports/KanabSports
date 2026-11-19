async function syncPepBadge(countUrl){
  if(countUrl){
    try{
      const response=await fetch(countUrl,{credentials:'same-origin',cache:'no-store'});
      if(response.ok){const data=await response.json(),count=Number(data.unread);if(Number.isSafeInteger(count)&&count>=0){if(count)await self.navigator.setAppBadge?.(count);else await self.navigator.clearAppBadge?.();return;}}
    }catch{/* Fall back to the existing attention badge when the count is temporarily unavailable. */}
  }
  await self.navigator.setAppBadge?.();
}
// Push payloads deliberately contain no names or message text. Each
// notification remains individually available while the app badge uses the
// signed-in parent's authoritative unread count when available.
async function showPepAlert(title,options,countUrl){
  await self.registration.showNotification(title,options);
  try{await syncPepBadge(countUrl)}catch{/* The platform controls badge permission. */}
}
