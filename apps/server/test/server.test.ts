import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { LiftyDb } from '../src/db';
import { importWorkbook } from '../src/excel';

let db: LiftyDb;
let app: FastifyInstance;

beforeEach(async () => {
  db = await LiftyDb.open(null);
  app = await buildApp({ db, trustLocalhost: true, password: 'secreta' });
});

afterEach(async () => {
  await app.close();
});

const remote = { remoteAddress: '192.168.1.50' };

describe('API', () => {
  it('arranca con datos iniciales', async () => {
    const res = await app.inject({ url: '/api/changes' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.full).toBe(true);
    expect(body.changes.some((c: { entity: string }) => c.entity === 'category')).toBe(true);
    expect(body.changes.find((c: { entity: string }) => c.entity === 'settings').record.usdRate).toBe(41);
  });

  it('pide vincular a los dispositivos de la red', async () => {
    const res = await app.inject({ url: '/api/changes', ...remote });
    expect(res.statusCode).toBe(401);
    const health = await app.inject({ url: '/api/health', ...remote });
    expect(health.json()).toMatchObject({ app: 'lifty', password: true });
  });

  it('no confía en pedidos reenviados por un proxy local', async () => {
    const res = await app.inject({ url: '/api/changes', headers: { 'x-forwarded-for': '100.64.0.2' } });
    expect(res.statusCode).toBe(401);
  });

  it('vincula un celular con el código y lo usa una sola vez', async () => {
    const pairing = (await app.inject({ method: 'POST', url: '/api/pairing' })).json();
    expect(pairing.code).toMatch(/^\d{6}$/);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/pair',
      payload: { code: pairing.code, name: 'Mi celu' },
      ...remote,
    });
    expect(ok.statusCode).toBe(200);
    const { token } = ok.json();
    const again = await app.inject({ method: 'POST', url: '/api/auth/pair', payload: { code: pairing.code }, ...remote });
    expect(again.statusCode).toBe(400);

    const me = await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${token}` }, ...remote });
    expect(me.json().device.name).toBe('Mi celu');

    const devices = (await app.inject({ url: '/api/devices' })).json().devices;
    await app.inject({ method: 'DELETE', url: `/api/devices/${devices[0].id}` });
    const revoked = await app.inject({ url: '/api/auth/me', headers: { authorization: `Bearer ${token}` }, ...remote });
    expect(revoked.statusCode).toBe(401);
  });

  it('entra con contraseña', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'x' }, ...remote });
    expect(bad.statusCode).toBe(401);
    const good = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'secreta' }, ...remote });
    expect(good.json().token).toHaveLength(64);
  });

  it('sincroniza mutaciones con "gana el más nuevo" y lápidas', async () => {
    const tx = { date: '2026-02-02', kind: 'expense', amount: 633.2, categoryId: 'cat-transporte', description: 'Cabify' };
    const send = (mutations: unknown[]) =>
      app.inject({ method: 'POST', url: '/api/mutations', payload: { mutations } }).then((r) => r.json());

    const first = await send([{ entity: 'transaction', op: 'upsert', id: 't1', updatedAt: '2026-02-02T10:00:00Z', record: tx }]);
    expect(first.results[0].status).toBe('applied');
    const rev = first.rev;

    const invalid = await send([
      { entity: 'transaction', op: 'upsert', id: 't2', updatedAt: '2026-02-02T10:00:00Z', record: { ...tx, amount: 0 } },
    ]);
    expect(invalid.rejected).toHaveLength(1);
    const unknown = await send([{ entity: 'hackeo', op: 'upsert', id: 'x', updatedAt: 'z', record: {} }]);
    expect(unknown.rejected).toHaveLength(1);

    await send([{ entity: 'transaction', op: 'delete', id: 't1', updatedAt: '2026-02-02T12:00:00Z' }]);
    const stale = await send([{ entity: 'transaction', op: 'upsert', id: 't1', updatedAt: '2026-02-02T11:00:00Z', record: tx }]);
    expect(stale.results[0].status).toBe('stale');

    const changes = (await app.inject({ url: `/api/changes?after=${rev}` })).json();
    expect(changes.changes).toEqual([expect.objectContaining({ entity: 'transaction', id: 't1', deleted: true })]);
    const full = (await app.inject({ url: '/api/changes' })).json();
    expect(full.changes.find((c: { id: string }) => c.id === 't1')).toBeUndefined();
  });
});

describe('importar Excel', () => {
  async function workbook(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const fijos = wb.addWorksheet('Fijos');
    fijos.addRow(['', 'Sueldo nominal', 'Aporte jubilatorio', 'IRPF', 'SUELDO LIQUIDO', 'Desde', 'Hasta']);
    fijos.addRow([
      'Sueldo Equim',
      50400,
      { formula: 'B2*0.15', result: 7560 },
      240,
      { formula: 'B2-C2', result: 40176.6 },
      new Date(Date.UTC(2026, 4, 6)),
      new Date(Date.UTC(2026, 8, 6)),
    ]);
    fijos.addRow([]);
    fijos.addRow(['', 'Gastos', 'Monto', 'Desde', 'desdenro', 'hasta', 'Dólar', 40]);
    fijos.addRow(['', 'Alquiler', 16000, new Date(Date.UTC(2026, 1, 1)), 2, new Date(Date.UTC(2026, 11, 31))]);
    fijos.addRow([
      '',
      'antel2',
      { formula: '626+900', result: 1526 },
      new Date(Date.UTC(2026, 3, 14)),
      4,
      new Date(Date.UTC(2026, 11, 31)),
    ]);
    const movs = wb.addWorksheet('movimientos');
    movs.addRow(['fecha', 'Monto', 'Ahorros', 'Categoria', 'subcategoria', 'Moneda', 'Banco', 'Descripcion']);
    movs.addRow([new Date(Date.UTC(2026, 0, 15)), 9000, 'Ingresos', 'Ingresos', 'Cumpleaños', 'UYU', 'BROU', null]);
    movs.addRow([new Date(Date.UTC(2026, 0, 16)), 326, 'Gastos', 'Otros', 'Comida Basura', 'UYU', 'BROU', null]);
    movs.addRow([new Date(Date.UTC(2026, 2, 6)), 50, 'Ahorros', 'DÓLARES', 'ahorro', 'USD', 'BROU', null]);
    const card = wb.addWorksheet('Tarjeta');
    card.addRow(['Fecha', 'Gasto', 'Monto', 'Moneda', 'Cuota', 'de']);
    card.addRow([new Date(Date.UTC(2026, 2, 3)), 'Pytho', 934, 'UYU', 1, 6]);
    card.addRow([new Date(Date.UTC(2026, 3, 3)), 'Pytho', 934, 'UYU', 2, 6]);
    card.addRow([new Date(Date.UTC(2026, 2, 5)), 'Youtube music', 3.49, 'USD', 3, 12]);
    const res = wb.addWorksheet('RESUMEN');
    res.addRow(['Mes', 'mesnro', 'TERMINO MES', 'Total real']);
    res.addRow(['Enero', 1, 'Si', 23595.5]);
    res.addRow(['Febrero', 2, 'NO', 0]);
    res.addRow(['Julio', 7, 'Si', 0]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('convierte las hojas en registros de Lifty', async () => {
    const result = await importWorkbook(await workbook());
    const of = (entity: string) =>
      result.records.filter((r) => r.entity === entity).map((r) => r.record as Record<string, unknown>);

    expect(of('income')).toEqual([
      expect.objectContaining({
        name: 'Sueldo Equim',
        gross: 50400,
        netOverride: null,
        startMonth: '2026-05',
        endMonth: '2026-09',
      }),
    ]);
    expect(of('fixed').map((f) => [f.name, f.amount, f.categoryId])).toEqual([
      ['Alquiler', 16000, 'cat-casa'],
      ['Antel2', 1526, 'cat-servicios'],
    ]);
    const txs = of('transaction');
    expect(txs.find((t) => t.description === 'Cumpleaños')).toMatchObject({ kind: 'income', accountId: 'acc-brou' });
    expect(txs.find((t) => t.kind === 'saving')).toMatchObject({ currency: 'USD', goalId: 'goal-usd', fxRate: 40 });
    expect(txs.find((t) => t.description === 'Pytho')).toMatchObject({
      amount: 5604,
      installments: 6,
      firstInstallmentMonth: '2026-03',
    });
    expect(txs.find((t) => String(t.description).startsWith('Youtube music'))).toMatchObject({
      description: 'Youtube music (cuotas 3 a 12 de 12)',
      installments: 10,
      firstInstallmentMonth: '2026-03',
    });
    expect(of('closing')).toEqual([expect.objectContaining({ id: '2026-01', realBalance: 23595.5 })]);
    expect(result.settings).toMatchObject({ usdRate: 40, startMonth: '2026-01' });
    expect(result.warnings.some((w) => w.includes('2026-07'))).toBe(true);

    // Importar dos veces da los mismos ids.
    const again = await importWorkbook(await workbook());
    expect(again.records.map((r) => r.record.id)).toEqual(result.records.map((r) => r.record.id));
  });

  const real = process.env.LIFTY_EXCEL;
  it.skipIf(!real || !fs.existsSync(real))('lee la planilla real (LIFTY_EXCEL)', async () => {
    const result = await importWorkbook(fs.readFileSync(real!));
    console.log(result.summary, result.warnings);
    expect(result.records.length).toBeGreaterThan(10);
  });
});
