/**
 * «Compartir → Lifty» desde WhatsApp, la galería o el aviso del banco. El celular manda lo
 * compartido a ./compartir; el service worker (sw.js) lo guarda en la caché «lifty-share» y abre
 * #/compartir, que lo lee acá. También sirve ?text=… en la dirección (para probar o enlazar).
 */
export const SHARE_CACHE = 'lifty-share';

const base = () => window.location.href.split('#')[0].split('?')[0];
const key = (name: string) => new URL(`./compartido/${name}`, base()).href;

export interface Shared {
  text: string;
  /** La foto como dirección local (blob:), para mostrarla mientras cargás. */
  photo: string | null;
}

export async function readShared(hashQuery: URLSearchParams): Promise<Shared> {
  const search = new URLSearchParams(window.location.search);
  const pick = (k: string) => search.get(k) ?? hashQuery.get(k) ?? '';
  // El título y el texto (un link solo no dice cuánto gastaste).
  let text = [pick('title'), pick('text')]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
  let photo: string | null = null;
  if ('caches' in window) {
    try {
      const cache = await caches.open(SHARE_CACHE);
      const t = await cache.match(key('texto'));
      if (t && !text) text = (await t.text()).trim();
      const f = await cache.match(key('foto'));
      if (f) photo = URL.createObjectURL(await f.blob());
      await Promise.all([cache.delete(key('texto')), cache.delete(key('foto'))]);
    } catch {
      // Sin caché (navegador viejo o modo privado): queda lo que vino en la dirección.
    }
  }
  if (window.location.search) window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  return { text, photo };
}
