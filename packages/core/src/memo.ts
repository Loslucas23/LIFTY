import type { LiftyData } from './schema';

/**
 * Recordar un cálculo mientras no cambien los datos de los que depende. Muchas pantallas y
 * tarjetas piden lo mismo (los saldos de hoy, el presupuesto del mes); así se hace una vez.
 * Depende de los mismos objetos y del mismo largo de cada lista, así que una lista nueva
 * (o una a la que se le agregó algo) vuelve a calcular.
 */
const cache = new WeakMap<object, Map<string, { deps: unknown[]; value: unknown }>>();

export function remember<T>(owner: object, key: string, deps: unknown[], make: () => T): T {
  let m = cache.get(owner);
  if (!m) cache.set(owner, (m = new Map()));
  const hit = m.get(key);
  if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.value as T;
  const value = make();
  m.set(key, { deps, value });
  return value;
}

/** Todo lo que puede cambiar en los datos: cada lista (y su largo) y los ajustes. */
export function dataDeps(data: LiftyData): unknown[] {
  const out: unknown[] = [];
  for (const v of Object.values(data)) {
    out.push(v);
    if (Array.isArray(v)) out.push(v.length);
  }
  return out;
}
