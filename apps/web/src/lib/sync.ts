import { get as idbGet, set as idbSet } from 'idb-keyval';
import { applyMutation, type EntityName, type EntityTypes, type Mutation, type RecordStore } from '@lifty/core';

/**
 * Motor de sincronización "primero local":
 *  - Los datos viven en el dispositivo (IndexedDB), así la app abre al instante y
 *    funciona sin conexión.
 *  - Cada cambio se aplica enseguida en pantalla y se encola en la "bandeja de salida".
 *  - Cuando hay conexión, se manda la bandeja al servidor y se traen los cambios de
 *    los otros dispositivos (desde la última revisión vista).
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
}

const STORAGE_KEY = 'lifty-state-v1';
const TOKEN_KEY = 'lifty-token';

let state: SyncState = { records: {}, rev: 0, outbox: [], status: 'loading', lastSync: null, error: null, local: false };
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
  const records = cloneStore(state.records);
  for (const m of mutations) applyMutation(records, m);
  setState({ records, outbox: [...state.outbox, ...mutations] });
  persist();
  scheduleSync(250);
}

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
      setState({ outbox: state.outbox.slice(batch.length) });
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

    const me = await api<{ local: boolean }>('/auth/me');
    setState({ records, rev: changes.rev, status: 'synced', lastSync: new Date().toISOString(), error: null, local: me.local });
    persist();
    if (state.outbox.length) scheduleSync(0);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setState({ status: 'unauthorized', error: err.message });
    } else if (err instanceof ApiError) {
      setState({ status: 'error', error: err.message });
    } else {
      setState({ status: 'offline', error: null });
    }
  }
}

export async function initSync() {
  try {
    const saved = await idbGet<Pick<SyncState, 'records' | 'rev' | 'outbox' | 'lastSync'>>(STORAGE_KEY);
    if (saved) setState({ ...saved });
  } catch {
    /* sin IndexedDB */
  }
  await sync();
  setInterval(() => {
    if (document.visibilityState === 'visible') void sync();
  }, 20_000);
  window.addEventListener('online', () => void sync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync();
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
  // Si había una sincronización en curso (sin token), esperar a que termine y empezar de cero.
  if (running) await running;
  setState({ status: 'syncing', rev: 0, error: null });
  await sync();
  if (getState().status === 'unauthorized') throw new ApiError(401, 'El servidor no aceptó este dispositivo.');
}

export function forgetDevice() {
  setToken(null);
  setState({ records: {}, rev: 0, outbox: [], status: 'unauthorized', lastSync: null });
  persist();
}
