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

  it('al abrir una base vieja agrega las cuentas nuevas que falten, pero no revive lo borrado', async () => {
    const dir = fs.mkdtempSync('/tmp/lifty-db-');
    const file = `${dir}/lifty.db`;
    const first = await LiftyDb.open(file);
    // Simula una base de antes: sin BROU dólares, y con Itaú borrada por el usuario.
    first.applyMutations([{ entity: 'account', op: 'delete', id: 'acc-itau', updatedAt: '2030-01-01T00:00:00Z' }]);
    (first as unknown as { db: { exec: (s: string) => void } }).db.exec(
      `DELETE FROM records WHERE entity = 'account' AND id = 'acc-brou-usd'`,
    );
    first.save();
    const again = await LiftyDb.open(file);
    const accounts = again.changesSince(0).filter((c) => c.entity === 'account');
    expect(accounts.find((c) => c.id === 'acc-brou-usd')?.record).toMatchObject({ currency: 'USD', reserved: true });
    // Lo borrado no vuelve (queda como lápida, que no aparece en la lista completa).
    expect(accounts.some((c) => c.id === 'acc-itau')).toBe(false);
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
      'Sueldo Empresa',
      48000,
      { formula: 'B2*0.15', result: 7200 },
      240,
      { formula: 'B2-C2', result: 40800 },
      new Date(Date.UTC(2026, 4, 6)),
      new Date(Date.UTC(2026, 8, 6)),
    ]);
    fijos.addRow([]);
    fijos.addRow(['', 'Gastos', 'Monto', 'Desde', 'desdenro', 'hasta', 'Dólar', 40]);
    fijos.addRow(['', 'Alquiler', 15000, new Date(Date.UTC(2026, 1, 1)), 2, new Date(Date.UTC(2026, 11, 31))]);
    fijos.addRow([
      '',
      'celular2',
      { formula: '600+900', result: 1500 },
      new Date(Date.UTC(2026, 3, 14)),
      4,
      new Date(Date.UTC(2026, 11, 31)),
    ]);
    const movs = wb.addWorksheet('movimientos');
    movs.addRow(['fecha', 'Monto', 'Ahorros', 'Categoria', 'subcategoria', 'Moneda', 'Banco', 'Descripcion']);
    movs.addRow([new Date(Date.UTC(2026, 0, 15)), 5000, 'Ingresos', 'Ingresos', 'Cumpleaños', 'UYU', 'BROU', null]);
    movs.addRow([new Date(Date.UTC(2026, 0, 16)), 300, 'Gastos', 'Otros', 'Comida rápida', 'UYU', 'BROU', null]);
    movs.addRow([new Date(Date.UTC(2026, 2, 6)), 50, 'Ahorros', 'DÓLARES', 'ahorro', 'USD', 'BROU', null]);
    const card = wb.addWorksheet('Tarjeta');
    card.addRow(['Fecha', 'Gasto', 'Monto', 'Moneda', 'Cuota', 'de', 'monto UYU']);
    const toUYU = (row: number, result: number) => ({ formula: `IF(D${row}="UYU",C${row},C${row}*39)`, result });
    card.addRow([new Date(Date.UTC(2026, 2, 3)), 'Curso online', 900, 'UYU', 1, 6, toUYU(2, 900)]);
    card.addRow([new Date(Date.UTC(2026, 3, 3)), 'Curso online', 900, 'UYU', 2, 6, toUYU(3, 900)]);
    card.addRow([new Date(Date.UTC(2026, 2, 5)), 'Spotify', 4.49, 'USD', 3, 12, toUYU(4, 175.11)]);
    // Totales de la planilla: marzo con la fórmula, abril con la tarjeta escrita a mano.
    const gastos = wb.addWorksheet('Gastos');
    gastos.addRow(['Mes', 'Mesnro', 'Monto fijo', 'Monto Variable', 'Tarjeta']);
    gastos.addRow([
      'Marzo',
      3,
      { formula: 'SUMIFS(x)', result: 15000 },
      { formula: 'SUMIFS(y)', result: 0 },
      { formula: 'SUMIF(z)', result: 1075.11 },
    ]);
    gastos.addRow(['Abril', 4, { formula: 'SUMIFS(x)', result: 16500 }, { formula: 'SUMIFS(y)', result: 0 }, 5000]);
    const res = wb.addWorksheet('RESUMEN');
    res.addRow(['Mes', 'mesnro', 'TERMINO MES', 'Total real']);
    res.addRow(['Enero', 1, 'Si', 20500.5]);
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
        name: 'Sueldo Empresa',
        gross: 48000,
        netOverride: null,
        startMonth: '2026-05',
        endMonth: '2026-09',
      }),
    ]);
    expect(of('fixed').map((f) => [f.name, f.amount, f.categoryId])).toEqual([
      ['Alquiler', 15000, 'cat-casa'],
      ['Celular2', 1500, 'cat-servicios'],
    ]);
    const txs = of('transaction');
    expect(txs.find((t) => t.description === 'Cumpleaños')).toMatchObject({ kind: 'income', accountId: 'acc-brou' });
    expect(txs.find((t) => t.kind === 'saving')).toMatchObject({ currency: 'USD', goalId: 'goal-usd', fxRate: 40 });
    expect(txs.find((t) => t.description === 'Curso online')).toMatchObject({
      amount: 5400,
      installments: 6,
      firstInstallmentMonth: '2026-03',
    });
    expect(txs.find((t) => String(t.description).startsWith('Spotify'))).toMatchObject({
      description: 'Spotify (cuotas 3 a 12 de 12)',
      installments: 10,
      firstInstallmentMonth: '2026-03',
    });
    expect(of('closing')).toEqual([expect.objectContaining({ id: '2026-01', realBalance: 20500.5 })]);
    expect(result.settings).toMatchObject({ usdRate: 40, startMonth: '2026-01' });
    expect(result.warnings.some((w) => w.includes('2026-07'))).toBe(true);

    // Importar dos veces da los mismos ids.
    const again = await importWorkbook(await workbook());
    expect(again.records.map((r) => r.record.id)).toEqual(result.records.map((r) => r.record.id));
  });

  it('usa la cotización de la hoja Tarjeta y compara los totales con la planilla', async () => {
    const result = await importWorkbook(await workbook());
    const yt = result.records.find((r) => (r.record as { description?: string }).description?.startsWith('Spotify'));
    expect(yt?.record).toMatchObject({ currency: 'USD', fxRate: 39 });
    expect(result.warnings.some((w) => w.includes('a 39'))).toBe(true);
    const march = result.comparison.find((m) => m.month === '2026-03')!;
    // Curso 900 + Spotify US$ 4,49 × 39 = 1075,11: igual que la planilla.
    expect(march.parts.find((p) => p.label === 'Tarjeta')).toMatchObject({ excel: 1075.11, lifty: 1075.11, note: null });
    expect(march.parts.find((p) => p.label === 'Gastos fijos')).toMatchObject({ lifty: 15000, note: null });
    const april = result.comparison.find((m) => m.month === '2026-04')!;
    expect(april.parts.find((p) => p.label === 'Tarjeta')).toMatchObject({ excel: 5000, explained: true });
    expect(april.parts.find((p) => p.label === 'Tarjeta')!.note).toContain('a mano');
  });

  // Prueba con tu planilla real (nunca se sube al repositorio): LIFTY_EXCEL=ruta\finanzas.xlsm npm test
  const real = process.env.LIFTY_EXCEL;
  it.skipIf(!real || !fs.existsSync(real))('lee la planilla real y explica cada diferencia con sus totales', async () => {
    const result = await importWorkbook(fs.readFileSync(real!));
    expect(result.records.length).toBeGreaterThan(10);
    expect(result.comparison.length).toBe(12);
    const unexplained = result.comparison.flatMap((m) =>
      m.parts.filter((p) => !p.explained).map((p) => `${m.month} ${p.label}: ${p.note}`),
    );
    expect(unexplained).toEqual([]);
  });
});

describe('en vivo', () => {
  it('avisa al instante a los otros dispositivos cuando cambia algo', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/live`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const next = async () => decoder.decode((await reader.read()).value);
    const first = await next();
    const startRev = JSON.parse(first.replace(/^data: /, '')).rev;
    expect(startRev).toBeGreaterThan(0);

    const devices = await (await fetch(`http://127.0.0.1:${port}/api/devices`)).json();
    expect(devices.localOnline).toBe(true);

    await fetch(`http://127.0.0.1:${port}/api/mutations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mutations: [
          {
            entity: 'transaction',
            op: 'upsert',
            id: 'live1',
            updatedAt: '2026-02-02T10:00:00Z',
            record: { date: '2026-02-02', kind: 'expense', amount: 100 },
          },
        ],
      }),
    });
    const msg = JSON.parse((await next()).replace(/^data: /, ''));
    expect(msg).toEqual({ rev: startRev + 1, from: 'local' });
    ctrl.abort();
  });

  it('se puede renombrar un dispositivo', async () => {
    const { code } = (await app.inject({ method: 'POST', url: '/api/pairing' })).json();
    const { device } = (
      await app.inject({ method: 'POST', url: '/api/auth/pair', payload: { code, name: 'Celular' }, ...remote })
    ).json();
    const r = await app.inject({ method: 'PATCH', url: `/api/devices/${device.id}`, payload: { name: 'Celu nuevo' } });
    expect(r.statusCode).toBe(200);
    const list = (await app.inject({ url: '/api/devices' })).json();
    expect(list.devices[0]).toMatchObject({ name: 'Celu nuevo', online: false });
  });
});

describe('exportar Excel', () => {
  it('genera una planilla con resumen y movimientos', async () => {
    const tx = { date: '2026-02-02', kind: 'expense', amount: 633.2, categoryId: 'cat-transporte', description: 'Cabify' };
    await app.inject({
      method: 'POST',
      url: '/api/mutations',
      payload: {
        mutations: [
          { entity: 'transaction', op: 'upsert', id: 't1', updatedAt: '2026-02-02T10:00:00Z', record: tx },
          {
            entity: 'weight',
            op: 'upsert',
            id: 'w1',
            updatedAt: '2026-02-02T10:00:00Z',
            record: { date: '2026-02-02', kg: 80.5 },
          },
          {
            entity: 'habit',
            op: 'upsert',
            id: 'h1',
            updatedAt: '2026-02-02T10:00:00Z',
            record: { name: 'Agua', target: 2, unit: 'L' },
          },
          {
            entity: 'habitLog',
            op: 'upsert',
            id: 'h1:2026-02-02',
            updatedAt: '2026-02-02T10:00:00Z',
            record: { habitId: 'h1', date: '2026-02-02', value: 2 },
          },
          {
            entity: 'journal',
            op: 'upsert',
            id: '2026-02-02',
            updatedAt: '2026-02-02T10:00:00Z',
            record: { date: '2026-02-02', sleepHours: 7, mood: 4 },
          },
        ],
      },
    });
    const res = await app.inject({ url: '/api/export/excel' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Resumen',
      'Movimientos',
      'Sueldos',
      'Gastos fijos',
      'Cuentas',
      'Metas',
      'Peso',
      'Rutinas',
      'Diario',
    ]);
    const rutinas = wb.getWorksheet('Rutinas')!;
    expect([rutinas.getRow(2).getCell(2).value, rutinas.getRow(2).getCell(6).value]).toEqual(['Agua', 'Sí']);
    expect(wb.getWorksheet('Diario')!.getRow(2).getCell(2).value).toBe(7);
    const movs = wb.getWorksheet('Movimientos')!;
    expect(movs.getRow(2).getCell(9).value).toBe('Cabify');
    expect(movs.getRow(2).getCell(11).value).toBe('Sí');
    expect(movs.getRow(2).getCell(6).value).toBe('Transporte');
    expect(wb.getWorksheet('Resumen')!.rowCount).toBeGreaterThan(1);
    // Las cuentas (BROU, Itaú, efectivo…) aparecen con su saldo.
    expect(wb.getWorksheet('Cuentas')!.rowCount).toBeGreaterThan(3);
  });
});

describe('respaldo automático cifrado', () => {
  it('copia cifrada a la carpeta elegida, que solo se abre con la contraseña', async () => {
    const dir = fs.mkdtempSync('/tmp/lifty-bk-');
    // Solo desde la compu se elige la carpeta.
    const code = (await app.inject({ method: 'POST', url: '/api/pairing' })).json().code;
    const { token } = (
      await app.inject({ method: 'POST', url: '/api/auth/pair', payload: { code, name: 'Celu' }, ...remote })
    ).json();
    const fromPhone = await app.inject({
      method: 'PUT',
      url: '/api/backup',
      payload: { folder: dir, password: 'clave-segura' },
      headers: { authorization: `Bearer ${token}` },
      ...remote,
    });
    expect(fromPhone.statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/backup', payload: { folder: 'relativa' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: '/api/backup', payload: { password: '123' } })).statusCode).toBe(400);

    const set = await app.inject({
      method: 'PUT',
      url: '/api/backup',
      payload: { folder: `${dir}/Lifty`, password: 'clave-segura', keep: 2 },
    });
    expect(set.json()).toMatchObject({ enabled: true, hasPassword: true, keep: 2, canConfigure: true });
    expect(JSON.stringify(set.json())).not.toContain('clave-segura');

    const run = (await app.inject({ method: 'POST', url: '/api/backup/run' })).json();
    expect(run.result.ok).toBe(true);
    const file = fs.readFileSync(`${dir}/Lifty/${run.result.file}`);
    // Cifrado: no se ve nada adentro.
    expect(file.subarray(0, 8).toString()).toBe('LIFTYBK1');
    expect(file.toString('latin1')).not.toContain('Supermercado');

    const open = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/backup/open',
        payload: file,
        headers: { 'content-type': 'application/octet-stream', 'x-backup-password': encodeURIComponent(password) },
      });
    expect((await open('otra')).statusCode).toBe(422);
    const ok = (await open('clave-segura')).json();
    expect(ok.records.category.some((c: { name: string }) => c.name === 'Supermercado')).toBe(true);
    expect(ok.records.settings).toHaveLength(1);

    // Se guardan solo las últimas `keep`.
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(`${dir}/Lifty/lifty-2020-01-0${i + 1}-1200.lifty`, 'x');
    }
    (await app.inject({ method: 'POST', url: '/api/backup/run' })).json();
    const left = fs.readdirSync(`${dir}/Lifty`).filter((f) => f.endsWith('.lifty'));
    expect(left).toHaveLength(2);
    expect(left).not.toContain('lifty-2020-01-01-1200.lifty');
    expect(left).not.toContain('lifty-2020-01-02-1200.lifty');
  });
});

describe('extracto del banco', () => {
  const parse = (body: Buffer) =>
    app.inject({ method: 'POST', url: '/api/statement/parse', headers: { 'content-type': 'application/octet-stream' }, body });

  it('lee CSV en Latin-1 con ; y comillas', async () => {
    const csv =
      'Fecha;Descripción;Débito;Crédito;Saldo\r\n02/09/2026;"COMPRA; TATA";1.250,50;;8.749,50\r\n05/09/2026;SUELDO;;50.000,00;58.749,50\r\n';
    const res = await parse(Buffer.from(csv, 'latin1'));
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toEqual([
      ['Fecha', 'Descripción', 'Débito', 'Crédito', 'Saldo'],
      ['02/09/2026', 'COMPRA; TATA', '1.250,50', null, '8.749,50'],
      ['05/09/2026', 'SUELDO', null, '50.000,00', '58.749,50'],
    ]);
  });

  it('lee la tabla HTML que algunos bancos bajan como .xls', async () => {
    const html =
      '<html><body><table><tr><th>Fecha</th><th>Concepto</th><th>Importe</th></tr><tr><td>03/09/2026</td><td>UTE&nbsp;Factura</td><td>-2.300,00</td></tr></table></body></html>';
    const res = await parse(Buffer.from(html));
    expect(res.json().rows).toEqual([
      ['Fecha', 'Concepto', 'Importe'],
      ['03/09/2026', 'UTE Factura', '-2.300,00'],
    ]);
  });

  it('lee .xlsx (la hoja con más filas) y avisa con el .xls viejo', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Info').addRow(['Banco']);
    const ws = wb.addWorksheet('Movimientos');
    ws.addRow(['Fecha', 'Descripción', 'Importe']);
    ws.addRow([new Date(Date.UTC(2026, 8, 4)), 'Farmacia', -450]);
    const res = await parse(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(res.json().rows).toEqual([
      ['Fecha', 'Descripción', 'Importe'],
      ['2026-09-04', 'Farmacia', -450],
    ]);
    const old = await parse(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]));
    expect(old.statusCode).toBe(422);
    expect(old.json().message).toMatch(/guardalo como .xlsx/);
  });
});
