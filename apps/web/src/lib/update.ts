import { useEffect, useState } from 'react';

/**
 * ¿Hay una versión nueva de la app? Pasa cuando actualizás Lifty en la compu y el celular
 * todavía tiene abierta la anterior. Se fija al abrir, al volver a la app y cada 30 minutos.
 */
async function check(): Promise<boolean> {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const { build } = (await res.json()) as { build?: string };
    return !!build && build !== __BUILD_ID__;
  } catch {
    return false;
  }
}

export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let alive = true;
    const run = () => void check().then((v) => alive && v && setAvailable(true));
    run();
    const t = setInterval(run, 30 * 60_000);
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return available;
}
