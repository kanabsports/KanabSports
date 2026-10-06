self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Deliberately no fetch handler: never cache private portals or stale schedules.
self.addEventListener('push',event=>event.waitUntil(self.registration.showNotification('Kanab Sports · Coach Update',{body:'A new coach message or important team update is ready. Open My Family to see it.',icon:'/assets/kanab-sports-icon.png',badge:'/assets/kanab-sports-icon.png',tag:'kanab-sports-team-update',data:{url:'/family/?view=messages'}})));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.openWindow(new URL(event.notification.data?.url||'/family/?view=messages',self.location.origin).href));});
