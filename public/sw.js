'use strict';
// Кэшируем только оболочку приложения, чтобы иконка открывалась быстро. Данные (/api, /cal) всегда берутся с сервера.
const CACHE = 'dom-shell-v3';
const SHELL = ['/', '/style.css', '/app.js', '/icon-192.png', '/apple-touch-icon.png', '/manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/cal/')) return;
  // Сначала сеть (чтобы после обновления сразу была новая версия), при отсутствии связи — кэш
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
