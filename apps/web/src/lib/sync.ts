import { get as idbGet, set as idbSet } from 'idb-keyval';
import { applyMutation, compactOutbox, type EntityName, type EntityTypes, type Mutation, type RecordStore } from '@lifty/core';

/**
 * Motor de sincronización "primero local":
 *  - Los datos viven en el dispositivo (IndexedDB), así la app abre al instante y
 *    funciona sin conexión.
 *  - Cada cambio se aplica enseguida en pantalla y se encola en la "bandeja de salida".
 *  - Cuando hay conexión, se manda la bandeja al servidor y se traen los cambios de
 *    los otros dispositivos (desde la última revisión vista).
 *  - "En vivo": una conexión abierta con el servidor avisa al instante cuando otro
 *    dispositivo cambia algo (si se corta, se reintenta y mientras tanto se consulta cada 20 s).
 *  - Si falla el envío, se reintenta solo cada vez más espaciado (2 s, 5 s, 15 s… hasta 1 min).
 *  - Varias pestañas o ventanas del mismo dispositivo se pasan los cambios entre sí.
 */

export type SyncStatus = 'loading' | 'synced' | 'syncing' | 'offline' | 'unauthorized' | 'error';

export interface SyncState {
  records: RecordStore;
  rev: number;
  outbox: Mutation[];
  status: SyncStatus;
  lastSync: string | null;
  error: string | null;
  /** true en la compu donde corre el servidor (no necesita vincularse). */
  local: boolean;
  /** Conectado "en vivo" (se entera al instante de los cambios de otros dispositivos). */
  live: boolean;
}

const STORAGE_KEY = 'lifty-state-v1';
const TOKEN_KEY = 'lifty-token';

let state: SyncState = {
  records: {},
  rev: 0,
  outbox: [],
  status: 'loading',
  lastSync: null,
  error: null,
  local: false,
  live: false,
};
const listeners = new Set<() => void>();
const errorListeners = new Set<(message: string) => void>();

export function getState(): SyncState {
  return state;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function onSyncError(fn: (message: string) => void): () => void {
  errorListeners.add(fn);
  return () => {
    errorListeners.delete(fn);
  };
}

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const { records, rev, outbox, lastSync } = state;
    idbSet(STORAGE_KEY, { records, rev, outbox, lastSync }).catch(() => {
      /* sin IndexedDB (modo privado): la app sigue funcionando en memoria */
    });
  }, 150);
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignorar */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(`./api${path}`, { ...init, headers, cache: 'no-store' });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = (body as { message?: string } | null)?.message ?? `Error ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

/** Copia "superficial" del store para que React detecte el cambio. */
function cloneStore(store: RecordStore): RecordStore {
  const out: RecordStore = {};
  for (const [k, v] of Object.entries(store)) out[k] = { ...v };
  return out;
}

export function mutate<E extends EntityName>(entity: E, op: 'upsert', record: EntityTypes[E]): void;
export function mutate(entity: EntityName, op: 'delete', id: string): void;
export function mutate(entity: EntityName, op: 'upsert' | 'delete', value: unknown): void {
  const updatedAt = new Date().toISOString();
  const m: Mutation =
    op === 'delete'
      ? { entity, op, id: value as string, updatedAt }
      : { entity, op, id: (value as { id: string }).id, updatedAt, record: { ...(value as object), updatedAt } };
  mutateMany([m]);
}

/** Aplica varias mutaciones juntas (por ejemplo, una importación). */
export function mutateMany(mutations: Mutation[]) {
  applyLocal(mutations);
  tabs?.postMessage({ type: 'mutations', mutations });
}

function applyLocal(mutations: Mutation[]) {
  const records = cloneStore(state.records);
  for (const m of mutations) applyMutation(records, m);
  setState({ records, outbox: compactOutbox([...state.outbox, ...mutations]) });
  persist();
  scheduleSync(250);
}

/**
 * Pestañas y ventanas del mismo dispositivo: cada una avisa sus cambios a las demás, que los
 * muestran y también los encolan (mandar dos veces el mismo cambio no hace nada en el servidor),
 * así no se pierde nada si la pestaña que lo cargó se cierra sin conexión.
 */
const tabs: BroadcastChannel | null = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('lifty-sync');
if (tabs)
  tabs.onmessage = (e: MessageEvent<{ type: string; mutations?: Mutation[] }>) => {
    if (e.data?.type === 'mutations' && Array.isArray(e.data.mutations)) applyLocal(e.data.mutations);
  };

let syncTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleSync(delay = 0) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void sync(), delay);
}

interface ChangesResponse {
  rev: number;
  full: boolean;
  changes: { entity: string; id: string; updatedAt: string; deleted: boolean; record: Record<string, unknown> | null }[];
}

let running: Promise<void> | null = null;
/** Reintentos cuando falla: cada vez más espaciados. */
const RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
let failures = 0;

export function sync(): Promise<void> {
  running ??= doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync() {
  if (state.status === 'unauthorized' && !getToken()) return;
  setState({ status: 'syncing' });
  try {
    // 1) Mandar la bandeja de salida.
    const batch = state.outbox.slice(0, 500);
    if (batch.length) {
      const res = await api<{ rev: number; rejected: { id: string; error: string }[] }>('/mutations', {
        method: 'POST',
        body: JSON.stringify({ mutations: batch }),
      });
      // Se sacan justo los que se mandaron (mientras tanto pudo cambiar la bandeja).
      const sent = new Set(batch);
      setState({ outbox: state.outbox.filter((m) => !sent.has(m)) });
      if (res.rejected.length) {
        for (const fn of errorListeners) fn(`El servidor rechazó ${res.rejected.length} cambio(s): ${res.rejected[0].error}`);
      }
      persist();
    }

    // 2) Traer lo nuevo.
    const changes = await api<ChangesResponse>(`/changes?after=${state.rev}`);
    let records: RecordStore;
    if (changes.full) {
      records = {};
      for (const c of changes.changes) {
        if (c.record) (records[c.entity] ??= {})[c.id] = c.record as never;
      }
    } else {
      records = cloneStore(state.records);
      for (const c of changes.changes) {
        const table = (records[c.entity] ??= {});
        if (c.deleted || !c.record) delete table[c.id];
        else table[c.id] = c.record as never;
      }
    }
    // Lo que todavía no se mandó sigue viéndose en pantalla.
    for (const m of state.outbox) applyMutation(records, m);

    me ??= await api<{ local: boolean; device: { id: string; name: string } | null }>('/auth/me');
    setState({ records, rev: changes.rev, status: 'synced', lastSync: new Date().toISOString(), error: null, local: me.local });
    persist();
    failures = 0;
    if (state.outbox.length) scheduleSync(0);
    if (!liveCtrl) startLive();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      me = null;
      stopLive();
      setState({ status: 'unauthorized', error: err.message });
      return;
    }
    if (err instanceof ApiError) setState({ status: 'error', error: err.message });
    else setState({ status: 'offline', error: null });
    // Si quedó algo sin mandar, reintentar solo (sin esperar al próximo ciclo).
    if (state.outbox.length) scheduleSync(RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
    failures++;
  }
}

/** Quién soy para el servidor (se pregunta una vez por sesión). */
let me: { local: boolean; device: { id: string; name: string } | null } | null = null;
export const currentDevice = () => me?.device ?? null;

// ---------------- En vivo ----------------

let liveCtrl: AbortController | null = null;
let liveRetry: ReturnType<typeof setTimeout> | null = null;
let liveFailures = 0;

/** Lee los avisos del servidor (Server-Sent Events) con fetch, para poder mandar el token. */
function startLive() {
  if (liveCtrl || typeof ReadableStream === 'undefined') return;
  if (liveRetry) clearTimeout(liveRetry);
  liveRetry = null;
  const ctrl = new AbortController();
  liveCtrl = ctrl;
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  void (async () => {
    try {
      const res = await fetch('./api/live', { headers, signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error(`live ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      setState({ live: true });
      liveFailures = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = event
            .split('\n')
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice(6))
            .join('');
          if (!data) continue;
          try {
            const msg = JSON.parse(data) as { rev?: number };
            if (typeof msg.rev === 'number' && msg.rev > state.rev) scheduleSync(50);
          } catch {
            /* aviso raro: se ignora */
          }
        }
      }
    } catch {
      /* se cortó: se reintenta abajo */
    }
    if (liveCtrl !== ctrl) return; // se cerró a propósito
    liveCtrl = null;
    setState({ live: false });
    if (state.status === 'unauthorized') return;
    liveRetry = setTimeout(startLive, RETRY_MS[Math.min(liveFailures++, RETRY_MS.length - 1)]);
  })();
}

function stopLive() {
  if (liveRetry) clearTimeout(liveRetry);
  liveRetry = null;
  const ctrl = liveCtrl;
  liveCtrl = null;
  ctrl?.abort();
  if (state.live) setState({ live: false });
}

export async function initSync() {
  try {
    const saved = await idbGet<Pick<SyncState, 'records' | 'rev' | 'outbox' | 'lastSync'>>(STORAGE_KEY);
    if (saved) setState({ ...saved });
  } catch {
    /* sin IndexedDB */
  }
  await sync();
  // Sin "en vivo", se consulta cada 20 s; con "en vivo", cada 2 min por las dudas.
  let last = Date.now();
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (state.live && Date.now() - last < 120_000) return;
    last = Date.now();
    void sync();
  }, 20_000);
  window.addEventListener('online', () => {
    failures = 0;
    liveFailures = 0;
    void sync();
  });
  window.addEventListener('offline', () => setState({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void sync();
    // El celular corta las conexiones cuando la app queda en segundo plano.
    if (!liveCtrl) {
      liveFailures = 0;
      startLive();
    }
  });
}

/** Vincula este dispositivo con un código de 6 dígitos (o una contraseña). */
export async function pairDevice(input: { code?: string; password?: string; name: string }) {
  const path = input.password !== undefined ? '/auth/login' : '/auth/pair';
  const { token } = await api<{ token: string }>(path, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  setToken(token);
  me = null;
  stopLive();
  // Si había una sincronización en curso (sin token), esperar a que termine y empezar de cero.
  if (running) await running;
  setState({ status: 'syncing', rev: 0, error: null });
  await sync();
  if (getState().status === 'unauthorized') throw new ApiError(401, 'El servidor no aceptó este dispositivo.');
}

export function forgetDevice() {
  setToken(null);
  me = null;
  stopLive();
  setState({ records: {}, rev: 0, outbox: [], status: 'unauthorized', lastSync: null });
  persist();
}
