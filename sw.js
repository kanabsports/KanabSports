self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Deliberately no fetch handler: never cache private portals or stale schedules.
self.addEventListener('push',event=>event.waitUntil(self.registration.showNotification('Kanab Sports · PepTalk',{body:'A team notification is ready. Open My Family to check your coach updates.',icon:'/assets/kanab-sports-icon.png',badge:'/assets/kanab-sports-icon.png',tag:'peptalk-team-update',data:{url:'/family/?view=messages&category=rec'}})));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.openWindow(new URL('/family/?view=messages&category=rec',self.location.origin).href));});
