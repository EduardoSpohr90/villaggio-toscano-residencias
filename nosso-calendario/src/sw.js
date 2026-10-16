/* Service worker do Nosso Calendário.
 * - Precache versionado do shell (HTML, JS, CSS, ícones, manifest).
 * - Navegação: responde com o index.html do cache (abre sem internet).
 * - /api/* NUNCA passa pelo cache: dados autenticados ficam fora do
 *   Cache Storage; o app guarda o necessário para o modo offline.
 * - Nova versão espera a confirmação do usuário (SKIP_WAITING).
 */
const VERSION = '__VERSION__';
const CACHE = `nc-shell-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nc-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'VERSION' && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // rede, sempre
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match('/index.html').then((hit) => hit || fetch(req)),
      ),
    );
    return;
  }
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req);
      }),
    ),
  );
});
