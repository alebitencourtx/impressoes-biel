/* Service worker do Impressao-Biel.
   Estratégia: REDE PRIMEIRO. Sempre tenta a rede (com revalidação) para pegar
   a versão mais nova; o cache só é usado quando não há internet (offline).
   Antes era cache-first: por isso "recarregar" continuava mostrando a versão velha. */

const CACHE_NAME = 'impressao-biel-v6';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())          // assume o controle na hora
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // 'no-cache' força a revalidação com o servidor: chega a versão nova sempre.
      const res = await fetch(req, { cache: 'no-cache' });
      if (res && res.ok) {
        const copy = res.clone();
        cache.put(req, copy);                  // guarda a cópia para uso offline
      }
      return res;
    } catch (err) {
      const cached = await cache.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
