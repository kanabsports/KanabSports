self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Generic no-payload alerts reuse the existing VAPID transport. Never cache messages.
self.addEventListener('push',event=>event.waitUntil(self.registration.showNotification('Pep · Private messages',{body:'Open your parent or coach inbox to check your messages.',icon:'/assets/kanab-sports-icon.png',tag:'pep-private-messages'})));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const existing=windows.find(w=>new URL(w.url).pathname==='/messages/');if(existing){await existing.focus();return;}await self.clients.openWindow('/messages/');})());});
