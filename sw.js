'use strict';
const CACHE = 'pergamin-shell-v32';
const SHELL = ['index.html','book.css','mvp.css','book.js','studio.js','atelier.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
const OPTIONAL = ['ai.js','fonts/CormorantGaramond-Regular.woff2','fonts/CormorantGaramond-Semibold.woff2','fonts/CormorantGaramond-Italic.woff2','fonts/EBGaramond-Regular.woff2','fonts/Caveat-Medium.woff2','fonts/Literata-Regular.ttf','fonts/Lora-Regular.ttf','fonts/Vollkorn-Regular.ttf'];
self.addEventListener('install', event => event.waitUntil((async () => {
 const cache = await caches.open(CACHE); await cache.addAll(SHELL);
 await Promise.allSettled(OPTIONAL.map(async url => { const response = await fetch(url); if (response.ok) await cache.put(url, response); }));
 await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => { for (const key of await caches.keys()) if (key.startsWith('pergamin-shell-') && key !== CACHE) await caches.delete(key); await self.clients.claim(); })()));
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url); if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
 const base = new URL('./', self.location).pathname;
 const path = url.pathname.slice(base.length);
 if (event.request.mode === 'navigate') {
  event.respondWith((async()=>{const cache=await caches.open(CACHE),key=new URL('index.html',self.location).href;try{const response=await fetch(event.request,{cache:'no-cache'});if(response.ok){await cache.put(key,response.clone());return response;}}catch(error){}return await cache.match(key)||Response.error();})());return;
 }
 if (!SHELL.includes(path) && path !== 'ai.js' && !path.startsWith('fonts/') && !path.startsWith('icons/')) return;
 event.respondWith((async () => { const cache=await caches.open(CACHE);try{const response=await fetch(event.request,{cache:'no-cache'});if(response.ok){await cache.put(event.request,response.clone());return response;}}catch(error){}return await cache.match(event.request)||Response.error(); })());
});
