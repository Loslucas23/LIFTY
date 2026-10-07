import { useSyncExternalStore } from 'react';
import { local } from './local';

/**
 * Modo privado: oculta los montos en pantalla (para usar Lifty en el ómnibus o mostrando
 * la pantalla). Solo afecta a este dispositivo; los datos no cambian.
 */
let hidden = local.get('lifty-privacy') === '1';
const listeners = new Set<() => void>();

export const isPrivate = () => hidden;

export function togglePrivacy() {
  hidden = !hidden;
  local.set('lifty-privacy', hidden ? '1' : null);
  listeners.forEach((fn) => fn());
}

export function usePrivacy(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => hidden,
  );
}
