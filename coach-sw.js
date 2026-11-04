importScripts('/assets/pep-push-worker.js');
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>event.waitUntil(showPepAlert('Kanab Sports · Coach',{
  body:'A coach action needs your attention. Open the Coach Portal to review it.',
  icon:'/assets/kanab-sports-icon.png',
  badge:'/assets/kanab-sports-icon.png',
  data:{url:'/coaches#quick-scores'}
})));
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL(event.notification.data?.url||'/coaches',self.location.origin).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(w=>w.url.startsWith(self.location.origin+'/coaches'));
    if(existing){await existing.focus();await existing.navigate(url);return}
    await self.clients.openWindow(url);
  })());
});