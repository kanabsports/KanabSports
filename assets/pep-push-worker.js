// Push payloads deliberately contain no names or message text. The badge is
// an attention indicator. Each notification remains individually available.
async function showPepAlert(title,options){
  await self.registration.showNotification(title,options);
  try{await self.navigator.setAppBadge?.();}catch{/* The platform controls badge permission. */}
}
