// Service worker de Lifty: guarda la app para abrirla sin conexión.
// Los datos no pasan por acá: viven en IndexedDB y se sincronizan por la API.
const CACHE = 'lifty-shell-v2';
// Lo que te compartieron (Compartir → Lifty) hasta que la app lo lee.
const SHARE = 'lifty-share';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Compartir → Lifty: el celular manda el texto y la foto acá; se guardan y se abre el formulario.
async function receiveShare(request) {
  const scope = self.registration.scope;
  try {
    const form = await request.formData();
    const cache = await caches.open(SHARE);
    const text = ['title', 'text']
      .map((k) => form.get(k))
      .filter((v) => typeof v === 'string' && v.trim())
      .join('\n');
    await cache.put(new URL('./compartido/texto', scope).href, new Response(text));
    const photo = form.getAll('ticket').find((f) => f && typeof f !== 'string' && f.size > 0);
    if (photo) {
      await cache.put(new URL('./compartido/foto', scope).href, new Response(photo, { headers: { 'Content-Type': photo.type } }));
    } else await cache.delete(new URL('./compartido/foto', scope).href);
  } catch {
    // Si no se pudo leer, igual se abre la pantalla (que explica cómo probar de nuevo).
  }
  return Response.redirect(new URL('./#/compartir', scope).href, 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/compartir')) {
    event.respondWith(receiveShare(event.request));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  // La versión siempre se pregunta a la compu (si no hay conexión, no hay nada que actualizar).
  if (url.pathname.endsWith('/version.json')) return;
  // Red primero (para tener siempre la última versión), caché si no hay conexión.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html'))),
  );
});
