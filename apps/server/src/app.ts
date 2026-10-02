import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import QRCode from 'qrcode';
import { ENTITY_SCHEMAS, isEntityName, mutationSchema, type Mutation } from '@lifty/core';
import { LiftyDb, type Device } from './db';
import { importWorkbook } from './excel';
import { isLoopback, lanAddresses } from './network';

export const VERSION = '0.1.0';

export interface AppOptions {
  db: LiftyDb;
  /** Carpeta con la app web compilada. */
  webDir?: string | null;
  /** Confiar en pedidos desde esta misma compu (lo usa el programa de escritorio). */
  trustLocalhost?: boolean;
  /** Contraseña para entrar desde otro dispositivo sin código (modo nube). */
  password?: string | null;
  /** URL pública (Tailscale, dominio propio...). Si no, se usa la IP de la red local. */
  publicUrl?: string | null;
  port?: number;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    device: Device | 'local' | null;
  }
}

const PUBLIC_ROUTES = new Set(['/api/health', '/api/auth/pair', '/api/auth/login']);
const PAIRING_TTL_MS = 10 * 60 * 1000;

/** Freno simple contra adivinar códigos o contraseñas. */
class AttemptLimiter {
  private failures: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  blocked() {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    return this.failures.length >= this.max;
  }
  fail() {
    this.failures.push(Date.now());
  }
}

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  return null;
}

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const { db } = opts;
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 10 * 1024 * 1024 });
  const limiter = new AttemptLimiter(10, 10 * 60 * 1000);

  app.decorateRequest('device', null);
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const token = bearer(req);
    if (token) {
      const device = db.deviceByToken(token);
      if (device) {
        req.device = device;
        db.touchDevice(device.id);
        return;
      }
    }
    // Un proxy local (por ejemplo `tailscale serve`) también llega desde 127.0.0.1:
    // si el pedido viene reenviado, no es "esta compu".
    const proxied = !!(req.headers['x-forwarded-for'] || req.headers.forwarded);
    if (opts.trustLocalhost && !proxied && isLoopback(req.socket.remoteAddress)) {
      req.device = 'local';
      return;
    }
    const route = req.url.split('?')[0];
    if (!PUBLIC_ROUTES.has(route)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Este dispositivo no está vinculado.' });
    }
  });

  const baseUrl = () => {
    if (opts.publicUrl) return [opts.publicUrl.replace(/\/$/, '')];
    const port = opts.port ?? 4321;
    return lanAddresses().map((ip) => `http://${ip}:${port}`);
  };

  // ---- Público ----

  app.get('/api/health', async () => ({ app: 'lifty', version: VERSION, password: !!opts.password }));

  app.post<{ Body: { code?: string; name?: string } }>('/api/auth/pair', async (req, reply) => {
    if (limiter.blocked()) return tooMany(reply);
    const code = String(req.body?.code ?? '').replace(/\D/g, '');
    if (code.length !== 6 || !db.consumePairingCode(code)) {
      limiter.fail();
      return reply.code(400).send({ error: 'invalid_code', message: 'El código no es válido o ya venció.' });
    }
    const { device, token } = db.createDevice(cleanName(req.body?.name));
    return { token, device };
  });

  app.post<{ Body: { password?: string; name?: string } }>('/api/auth/login', async (req, reply) => {
    if (!opts.password) return reply.code(404).send({ error: 'disabled', message: 'El acceso con contraseña está desactivado.' });
    if (limiter.blocked()) return tooMany(reply);
    if (req.body?.password !== opts.password) {
      limiter.fail();
      return reply.code(401).send({ error: 'wrong_password', message: 'Contraseña incorrecta.' });
    }
    const { device, token } = db.createDevice(cleanName(req.body?.name));
    return { token, device };
  });

  // ---- Con sesión ----

  app.get('/api/auth/me', async (req) => ({
    device: req.device === 'local' ? { id: 'local', name: 'Esta compu' } : req.device,
    local: req.device === 'local',
  }));

  app.get<{ Querystring: { after?: string } }>('/api/changes', async (req) => {
    const after = Math.max(0, Number(req.query.after ?? 0) || 0);
    const rev = db.rev;
    return { rev, full: after === 0, changes: db.changesSince(after) };
  });

  app.post<{ Body: { mutations?: unknown[] } }>('/api/mutations', async (req, reply) => {
    const raw = req.body?.mutations;
    if (!Array.isArray(raw)) return reply.code(400).send({ error: 'bad_request', message: 'Faltan mutaciones.' });
    const valid: Mutation[] = [];
    const rejected: { id: string; error: string }[] = [];
    for (const item of raw) {
      const parsed = mutationSchema.safeParse(item);
      if (!parsed.success) {
        rejected.push({ id: String((item as { id?: unknown })?.id ?? '?'), error: 'Mutación inválida' });
        continue;
      }
      const m = parsed.data;
      if (!isEntityName(m.entity)) {
        rejected.push({ id: m.id, error: `Entidad desconocida: ${m.entity}` });
        continue;
      }
      if (m.op === 'delete') {
        valid.push(m);
        continue;
      }
      const record = ENTITY_SCHEMAS[m.entity].safeParse({ ...(m.record as object), id: m.id, updatedAt: m.updatedAt });
      if (!record.success) {
        rejected.push({ id: m.id, error: record.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
        continue;
      }
      valid.push({ ...m, record: record.data });
    }
    const { results, rev } = db.applyMutations(valid);
    return { rev, results, rejected };
  });

  app.post('/api/pairing', async () => {
    const { code, expiresAt } = db.createPairingCode(PAIRING_TTL_MS);
    const urls = baseUrl().map((u) => `${u}/#/vincular/${code}`);
    const qr = urls[0] ? await QRCode.toString(urls[0], { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) : null;
    return { code, expiresAt, urls, qr };
  });

  app.get('/api/devices', async () => ({ devices: db.listDevices() }));

  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    if (!db.deleteDevice(req.params.id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  app.post('/api/import/excel', async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) {
      return reply.code(400).send({ error: 'bad_request', message: 'Mandá el archivo como application/octet-stream.' });
    }
    try {
      return await importWorkbook(req.body);
    } catch (err) {
      req.log.warn(err);
      return reply.code(422).send({ error: 'bad_file', message: `No pude leer la planilla: ${(err as Error).message}` });
    }
  });

  app.get('/api/server-info', async () => ({ version: VERSION, urls: baseUrl(), dataFile: db.file }));

  app.all('/api/*', async (_req, reply) => reply.code(404).send({ error: 'not_found' }));

  // ---- App web ----

  if (opts.webDir && fs.existsSync(path.join(opts.webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: opts.webDir,
      setHeaders(res, file) {
        const name = path.basename(file);
        if (name === 'index.html' || name === 'sw.js' || name.endsWith('.webmanifest')) {
          res.header('Cache-Control', 'no-cache');
        } else if (file.includes(`${path.sep}assets${path.sep}`)) {
          res.header('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    });
  } else {
    app.get('/', async (_req, reply) =>
      reply.type('text/plain; charset=utf-8').send('Lifty API funcionando. La app web no está compilada (npm run build).'),
    );
  }

  return app;
}

function cleanName(name: unknown): string {
  const value = String(name ?? '')
    .trim()
    .slice(0, 60);
  return value || 'Dispositivo';
}

function tooMany(reply: FastifyReply) {
  return reply.code(429).send({ error: 'too_many', message: 'Demasiados intentos. Esperá unos minutos.' });
}
