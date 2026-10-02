import { useSyncExternalStore } from 'react';

/** Router mínimo por hash (#/ruta): funciona igual en el servidor, Electron y como app instalada. */

function current(): string {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/';
}

function subscribe(fn: () => void) {
  window.addEventListener('hashchange', fn);
  return () => window.removeEventListener('hashchange', fn);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribe, current);
}

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) window.location.replace(`#${path}`);
  else window.location.hash = path;
}

/** Compara la ruta con un patrón tipo "/presupuesto/:mes". */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('?')[0].split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}
