import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { LiftyDb } from './db';

/**
 * Respaldo automático cifrado: una copia de todo a una carpeta que elijas (un pendrive,
 * OneDrive, Google Drive…), cifrada con tu contraseña (AES-256-GCM, clave derivada con
 * scrypt). Sin la contraseña el archivo no se puede leer, así que se puede guardar en la nube.
 *
 * Formato del archivo .lifty: "LIFTYBK1" + sal (16) + iv (12) + tag (16) + datos cifrados
 * (el JSON de la copia, comprimido con gzip).
 */

const MAGIC = Buffer.from('LIFTYBK1');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DAY_MS = 24 * 60 * 60 * 1000;

export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize('NFC'), salt, 32, SCRYPT);
}

export function encryptWithKey(plain: Buffer, key: Buffer, salt: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function encryptBackup(plain: Buffer, password: string): Buffer {
  const salt = randomBytes(16);
  return encryptWithKey(plain, deriveKey(password, salt), salt);
}

/** Descifra una copia. Si la contraseña no es o el archivo está dañado, tira un error claro. */
export function decryptBackup(file: Buffer, password: string): Buffer {
  if (file.length < 52 || !file.subarray(0, 8).equals(MAGIC)) throw new Error('No es una copia cifrada de Lifty (.lifty).');
  const salt = file.subarray(8, 24);
  const iv = file.subarray(24, 36);
  const tag = file.subarray(36, 52);
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    decipher.setAuthTag(tag);
    return gunzipSync(Buffer.concat([decipher.update(file.subarray(52)), decipher.final()]));
  } catch {
    throw new Error('La contraseña no es correcta (o el archivo está dañado).');
  }
}

/** Todo lo que hay en la base, como la copia .json de la app. */
export function snapshot(db: LiftyDb): Buffer {
  const records: Record<string, unknown[]> = {};
  for (const r of db.changesSince(0)) if (r.record) (records[r.entity] ??= []).push(r.record);
  return Buffer.from(JSON.stringify({ app: 'lifty', version: 1, exportedAt: new Date().toISOString(), records }));
}

export interface BackupConfig {
  folder: string | null;
  keep: number;
  /** Sal y clave derivada de la contraseña (la contraseña no se guarda). */
  salt: string | null;
  key: string | null;
  last: { at: string; file: string | null; error: string | null; rev: number } | null;
}

export interface BackupFile {
  name: string;
  size: number;
  at: string;
}

const FILE_RE = /^lifty-\d{4}-\d{2}-\d{2}-\d{4,6}\.lifty$/;

export class BackupService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly db: LiftyDb) {}

  get config(): BackupConfig {
    const raw = this.db.getMeta('backup');
    const base: BackupConfig = { folder: null, keep: 10, salt: null, key: null, last: null };
    try {
      return raw ? { ...base, ...(JSON.parse(raw) as Partial<BackupConfig>) } : base;
    } catch {
      return base;
    }
  }

  private setConfig(c: BackupConfig) {
    this.db.setMeta('backup', JSON.stringify(c));
  }

  /** Lo que se le muestra a la app (sin la clave). */
  status() {
    const c = this.config;
    return {
      enabled: !!(c.folder && c.key),
      folder: c.folder,
      keep: c.keep,
      hasPassword: !!c.key,
      last: c.last,
      files: this.files(),
      suggestions: suggestFolders(),
    };
  }

  files(): BackupFile[] {
    const folder = this.config.folder;
    if (!folder || !fs.existsSync(folder)) return [];
    try {
      return fs
        .readdirSync(folder)
        .filter((f) => FILE_RE.test(f))
        .sort()
        .reverse()
        .map((name) => {
          const st = fs.statSync(path.join(folder, name));
          return { name, size: st.size, at: st.mtime.toISOString() };
        });
    } catch {
      return [];
    }
  }

  /** Cambia la carpeta, la contraseña y cuántas copias guardar. */
  configure(input: { folder?: string | null; password?: string | null; keep?: number }): void {
    const c = this.config;
    if (input.folder !== undefined) {
      const folder = input.folder?.trim() || null;
      if (folder) {
        if (!path.isAbsolute(folder))
          throw new Error('Poné la ruta completa de la carpeta (ej: E:\\Lifty o C:\\Users\\vos\\OneDrive\\Lifty).');
        const parent = path.dirname(folder);
        if (!fs.existsSync(folder) && !fs.existsSync(parent))
          throw new Error('No encuentro esa carpeta (¿está conectado el pendrive?).');
        fs.mkdirSync(folder, { recursive: true });
        const probe = path.join(folder, `.lifty-prueba-${process.pid}`);
        try {
          fs.writeFileSync(probe, 'ok');
          fs.rmSync(probe);
        } catch {
          throw new Error('No puedo escribir en esa carpeta.');
        }
      }
      c.folder = folder;
    }
    if (input.password !== undefined && input.password !== null) {
      if (input.password.length < 6) throw new Error('La contraseña tiene que tener 6 letras o más.');
      const salt = randomBytes(16);
      c.salt = salt.toString('hex');
      c.key = deriveKey(input.password, salt).toString('hex');
    }
    if (input.keep !== undefined) c.keep = Math.max(1, Math.min(100, Math.round(input.keep) || 10));
    this.setConfig(c);
  }

  /** Hace una copia ahora (si está configurado). */
  run(): { ok: boolean; file: string | null; error: string | null } {
    const c = this.config;
    if (!c.folder || !c.key || !c.salt) return { ok: false, file: null, error: 'Falta elegir la carpeta y la contraseña.' };
    const now = new Date();
    const two = (n: number) => String(n).padStart(2, '0');
    // Fecha y hora de esta compu: lifty-2026-10-06-213005.lifty
    const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
    const name = `lifty-${stamp}.lifty`;
    try {
      fs.mkdirSync(c.folder, { recursive: true });
      const data = encryptWithKey(snapshot(this.db), Buffer.from(c.key, 'hex'), Buffer.from(c.salt, 'hex'));
      const target = path.join(c.folder, name);
      fs.writeFileSync(`${target}.tmp`, data);
      fs.renameSync(`${target}.tmp`, target);
      // Las más viejas se borran (se guardan las últimas `keep`).
      const old = fs
        .readdirSync(c.folder)
        .filter((f) => FILE_RE.test(f))
        .sort()
        .slice(0, -c.keep);
      for (const f of old) fs.rmSync(path.join(c.folder, f), { force: true });
      this.setConfig({ ...c, last: { at: now.toISOString(), file: name, error: null, rev: this.db.rev } });
      return { ok: true, file: name, error: null };
    } catch (err) {
      const error =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'No encuentro la carpeta (¿está conectado el pendrive?).'
          : (err as Error).message;
      this.setConfig({ ...c, last: { at: now.toISOString(), file: null, error, rev: c.last?.rev ?? 0 } });
      return { ok: false, file: null, error };
    }
  }

  /** Copia si hubo cambios y pasó un día (o si la última falló y pasó una hora). */
  tick(now = Date.now()): void {
    const c = this.config;
    if (!c.folder || !c.key) return;
    const last = c.last ? new Date(c.last.at).getTime() : 0;
    const changed = !c.last || this.db.rev !== c.last.rev;
    const wait = c.last?.error ? DAY_MS / 24 : DAY_MS;
    if (changed && now - last >= wait) this.run();
  }

  start(everyMs = 60 * 60 * 1000): void {
    this.stop();
    // Al abrir, a los pocos segundos (para no frenar el arranque) y después cada hora.
    const first = setTimeout(() => this.tick(), 15_000);
    first.unref();
    this.timer = setInterval(() => this.tick(), everyMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Carpetas que conviene ofrecer: OneDrive, Google Drive, Dropbox y pendrives conectados. */
export function suggestFolders(): { label: string; path: string }[] {
  const out: { label: string; path: string }[] = [];
  const add = (label: string, dir: string | undefined) => {
    if (dir && fs.existsSync(dir) && !out.some((x) => x.path === dir))
      out.push({ label, path: path.join(dir, 'Lifty respaldos') });
  };
  const home = os.homedir();
  add('OneDrive', process.env.OneDrive);
  add('OneDrive', process.env.OneDriveConsumer);
  add('OneDrive', path.join(home, 'OneDrive'));
  add('Google Drive', path.join(home, 'Google Drive'));
  add('Google Drive', 'G:\\Mi unidad');
  add('Google Drive', 'G:\\My Drive');
  add('Dropbox', path.join(home, 'Dropbox'));
  if (process.platform === 'win32') {
    // Pendrives y discos externos: las letras de la D a la Z que existen (sin la del sistema).
    const system = (process.env.SystemDrive ?? 'C:').toUpperCase();
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${letter}:\\`;
      if (`${letter}:` !== system && fs.existsSync(root)) add(`Disco ${letter}:`, root);
    }
  } else {
    for (const base of ['/media', `/media/${os.userInfo().username}`, '/Volumes'])
      try {
        for (const d of fs.readdirSync(base)) {
          const full = path.join(base, d);
          if (fs.statSync(full).isDirectory() && d !== os.userInfo().username && d !== 'Macintosh HD') add(d, full);
        }
      } catch {
        /* no existe */
      }
  }
  return out;
}
