const VERSION='portal38-v1';
const BUILD_ASSETS=[];
const ROOT=new URL('./',self.location.href).pathname;
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(c=>c.addAll([ROOT,ROOT+'icon-192.png',ROOT+'notification-badge-96.png',...BUILD_ASSETS.map(p=>ROOT+p)])));self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('portal38-')&&k!==VERSION).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(ROOT)||url.pathname.includes('/api/'))return;
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(VERSION).then(c=>c.put(ROOT,copy));}return r;}).catch(()=>caches.match(ROOT)));
  else if(url.pathname.startsWith(ROOT+'assets/')||/(?:icon-\d+|notification-badge-96)\.png$/.test(url.pathname))event.respondWith(caches.match(event.request).then(r=>r||fetch(event.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(VERSION).then(c=>c.put(event.request,copy));}return r;})));
});
self.addEventListener('push',event=>{let data;try{data=event.data.json();}catch{return;}event.waitUntil(self.registration.showNotification(data.title||'Portal38',{body:data.body,tag:data.tag,icon:ROOT+'icon-192.png',badge:ROOT+'notification-badge-96.png',data:{url:ROOT}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{const target=new URL(ROOT,self.location.origin).href;for(const c of clients)if(c.url.startsWith(target)){await c.focus();return;}await self.clients.openWindow(target);}));});
