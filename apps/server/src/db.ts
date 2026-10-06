import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database as SqlDatabase, type SqlValue } from 'sql.js';
import { isNewer, seedRecords, type Mutation } from '@lifty/core';

/**
 * Base de datos SQLite (vía sql.js, sin binarios nativos: funciona igual en el
 * servidor, en Docker y dentro del programa de escritorio).
 *
 * Cada escritura se guarda al disco de forma atómica (archivo temporal + rename).
 */

export interface StoredRecord {
  entity: string;
  id: string;
  updatedAt: string;
  deleted: boolean;
  rev: number;
  record: Record<string, unknown> | null;
}

export interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
}

const MIGRATIONS: string[] = [
  `CREATE TABLE records (
     entity TEXT NOT NULL,
     id TEXT NOT NULL,
     data TEXT,
     updated_at TEXT NOT NULL,
     deleted INTEGER NOT NULL DEFAULT 0,
     rev INTEGER NOT NULL,
     PRIMARY KEY (entity, id)
   );
   CREATE INDEX records_rev ON records (rev);
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE devices (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     token_hash TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL,
     last_seen_at TEXT
   );
   CREATE TABLE pairing_codes (code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`,
];

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

function loadSql(wasmPath?: string) {
  sqlPromise ??= initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined);
  return sqlPromise;
}

export class LiftyDb {
  private constructor(
    private readonly db: SqlDatabase,
    readonly file: string | null,
  ) {}

  /** Abre (o crea) la base. `file = null` la deja en memoria (tests). */
  static async open(file: string | null, opts: { wasmPath?: string; backupDir?: string } = {}): Promise<LiftyDb> {
    const SQL = await loadSql(opts.wasmPath);
    let db: SqlDatabase;
    if (file && fs.existsSync(file)) {
      if (opts.backupDir) dailyBackup(file, opts.backupDir);
      db = new SQL.Database(fs.readFileSync(file));
    } else {
      if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
      db = new SQL.Database();
    }
    const instance = new LiftyDb(db, file);
    instance.migrate();
    return instance;
  }

  private migrate() {
    const hasMeta = this.get(`SELECT name FROM sqlite_master WHERE type='table' AND name='meta'`);
    let version = hasMeta ? Number(this.get(`SELECT value FROM meta WHERE key='schema'`)?.value ?? 0) : 0;
    const fresh = version === 0;
    while (version < MIGRATIONS.length) {
      this.db.exec('BEGIN');
      this.db.exec(MIGRATIONS[version]);
      version++;
      this.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema', ?)`, [String(version)]);
      this.db.exec('COMMIT');
    }
    // Datos iniciales. Si la base ya existía, se agregan solo los que faltan y nunca estuvieron
    // (ej: una cuenta que se sumó en una versión nueva); lo que borraste queda borrado.
    const missing = seedRecords().filter(
      ({ entity, record }) => fresh || !this.get(`SELECT 1 AS x FROM records WHERE entity = ? AND id = ?`, [entity, record.id]),
    );
    if (missing.length) {
      this.applyMutations(
        missing.map(({ entity, record }) => ({ entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record })),
      );
    }
    this.save();
  }

  private get(sql: string, params: SqlValue[] = []): Record<string, SqlValue> | undefined {
    return this.all(sql, params)[0];
  }

  private all(sql: string, params: SqlValue[] = []): Record<string, SqlValue>[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: Record<string, SqlValue>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  private run(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params);
  }

  /** Guarda la base al disco de forma atómica. */
  save() {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.file);
  }

  /** Ajustes propios de esta compu (no se sincronizan): carpeta de respaldo, etc. */
  getMeta(key: string): string | null {
    const row = this.get(`SELECT value FROM meta WHERE key = ?`, [`x:${key}`]);
    return row ? String(row.value) : null;
  }

  setMeta(key: string, value: string): void {
    this.run(`INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`, [`x:${key}`, value]);
    this.save();
  }

  get rev(): number {
    return Number(this.get(`SELECT value FROM meta WHERE key='rev'`)?.value ?? 0);
  }

  /**
   * Aplica mutaciones (ya validadas) con "gana el más nuevo". Los borrados quedan
   * como lápida para que otro dispositivo desactualizado no los reviva.
   */
  applyMutations(mutations: Mutation[]): { results: { id: string; status: 'applied' | 'stale' }[]; rev: number } {
    let rev = this.rev;
    const results: { id: string; status: 'applied' | 'stale' }[] = [];
    this.db.exec('BEGIN');
    try {
      for (const m of mutations) {
        const existing = this.get(`SELECT updated_at FROM records WHERE entity = ? AND id = ?`, [m.entity, m.id]);
        if (existing && !isNewer(m.updatedAt, String(existing.updated_at))) {
          results.push({ id: m.id, status: 'stale' });
          continue;
        }
        rev++;
        const data = m.op === 'delete' ? null : JSON.stringify({ ...(m.record as object), id: m.id, updatedAt: m.updatedAt });
        this.run(
          `INSERT INTO records (entity, id, data, updated_at, deleted, rev) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (entity, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at,
             deleted = excluded.deleted, rev = excluded.rev`,
          [m.entity, m.id, data, m.updatedAt, m.op === 'delete' ? 1 : 0, rev],
        );
        results.push({ id: m.id, status: 'applied' });
      }
      this.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('rev', ?)`, [String(rev)]);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.save();
    return { results, rev };
  }

  /** Cambios posteriores a `after`. Con `after = 0` devuelve todo (sin lápidas). */
  changesSince(after: number): StoredRecord[] {
    const rows = this.all(
      after > 0
        ? `SELECT * FROM records WHERE rev > ? ORDER BY rev`
        : `SELECT * FROM records WHERE deleted = 0 AND rev > ? ORDER BY rev`,
      [after],
    );
    return rows.map((r) => ({
      entity: String(r.entity),
      id: String(r.id),
      updatedAt: String(r.updated_at),
      deleted: Number(r.deleted) === 1,
      rev: Number(r.rev),
      record: r.data ? (JSON.parse(String(r.data)) as Record<string, unknown>) : null,
    }));
  }

  // ---- Dispositivos y vinculación ----

  createDevice(name: string): { device: Device; token: string } {
    const token = randomBytes(32).toString('hex');
    const device: Device = { id: randomBytes(8).toString('hex'), name, createdAt: new Date().toISOString(), lastSeenAt: null };
    this.run(`INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)`, [
      device.id,
      device.name,
      sha256(token),
      device.createdAt,
    ]);
    this.save();
    return { device, token };
  }

  deviceByToken(token: string): Device | null {
    const row = this.get(`SELECT * FROM devices WHERE token_hash = ?`, [sha256(token)]);
    return row ? toDevice(row) : null;
  }

  touchDevice(id: string) {
    this.run(`UPDATE devices SET last_seen_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
  }

  listDevices(): Device[] {
    return this.all(`SELECT * FROM devices ORDER BY created_at`).map(toDevice);
  }

  renameDevice(id: string, name: string): boolean {
    const exists = this.get(`SELECT id FROM devices WHERE id = ?`, [id]);
    if (!exists) return false;
    this.run(`UPDATE devices SET name = ? WHERE id = ?`, [name, id]);
    this.save();
    return true;
  }

  deleteDevice(id: string): boolean {
    const exists = this.get(`SELECT id FROM devices WHERE id = ?`, [id]);
    if (!exists) return false;
    this.run(`DELETE FROM devices WHERE id = ?`, [id]);
    this.save();
    return true;
  }

  createPairingCode(ttlMs: number): { code: string; expiresAt: number } {
    const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0');
    const expiresAt = Date.now() + ttlMs;
    this.run(`DELETE FROM pairing_codes WHERE expires_at < ?`, [Date.now()]);
    this.run(`INSERT OR REPLACE INTO pairing_codes (code_hash, expires_at) VALUES (?, ?)`, [sha256(code), expiresAt]);
    this.save();
    return { code, expiresAt };
  }

  /** Consume un código de vinculación. Cada código sirve una sola vez. */
  consumePairingCode(code: string): boolean {
    const row = this.get(`SELECT expires_at FROM pairing_codes WHERE code_hash = ?`, [sha256(code)]);
    if (!row) return false;
    this.run(`DELETE FROM pairing_codes WHERE code_hash = ?`, [sha256(code)]);
    this.save();
    return Number(row.expires_at) >= Date.now();
  }

  close() {
    this.save();
    this.db.close();
  }
}

function toDevice(row: Record<string, SqlValue>): Device {
  return {
    id: String(row.id),
    name: String(row.name),
    createdAt: String(row.created_at),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
  };
}

/** Copia diaria de la base (se guardan las últimas 14). */
function dailyBackup(file: string, dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const target = path.join(dir, `lifty-${day}.db`);
    if (!fs.existsSync(target)) fs.copyFileSync(file, target);
    const old = fs
      .readdirSync(dir)
      .filter((f) => /^lifty-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort()
      .slice(0, -14);
    for (const f of old) fs.rmSync(path.join(dir, f));
  } catch (err) {
    console.warn('[lifty] No se pudo hacer la copia de seguridad:', err);
  }
}
