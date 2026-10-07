self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Never cache owner HTML, sessions or financial data.
self.addEventListener('push',event=>event.waitUntil(self.registration.showNotification('Kanab Sports · Owner',{
  body:'A new coach signup or submission needs your attention. Open the Owner Console to review.',
  icon:'/assets/kanab-sports-icon.png',badge:'/assets/kanab-sports-icon.png',
  tag:'kanab-owner-review',renotify:true,
  data:{url:'/admin?workspace=kanab&tab=approvals'}
})));
self.addEventListener('notificationclick',event=>{
 event.notification.close();event.waitUntil((async()=>{
  const url=new URL('/admin?workspace=kanab&tab=approvals',self.location.origin).href;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const current=windows.find(w=>new URL(w.url).origin===self.location.origin&&new URL(w.url).pathname.startsWith('/admin'));
  if(current){await current.navigate(url);await current.focus()}else await self.clients.openWindow(url);
 })());
});
