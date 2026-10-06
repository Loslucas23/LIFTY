import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyMutation,
  budgetReview,
  buildWordIndex,
  computeMonth,
  computeMonths,
  defaultSettings,
  detectRecurring,
  fixedSchema,
  median,
  percentile,
  possibleDuplicate,
  seedRecords,
  suggestCategory,
  toLiftyData,
  transactionSchema,
  unusualExpenses,
  weekdayForecast,
  type LiftyData,
  type RecordStore,
  type Transaction,
} from '../src';

function data(partial: Partial<LiftyData>, settings: Partial<LiftyData['settings']> = {}): LiftyData {
  const store: RecordStore = {};
  for (const { entity, record } of seedRecords())
    applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
  return { ...toLiftyData(store), ...partial, settings: { ...defaultSettings(), startMonth: '2026-01', ...settings } };
}

let n = 0;
const tx = (date: string, amount: number, extra: Partial<Transaction> = {}): Transaction =>
  transactionSchema.parse({ id: `t${++n}`, date, kind: 'expense', amount, categoryId: 'cat-otros', ...extra });

describe('estadística básica', () => {
  it('mediana y percentil', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile([0, 10, 20, 30, 40], 0.9)).toBe(36);
  });
});

describe('pronóstico por día de la semana', () => {
  it('usa lo típico de cada día y recorta los días fuera de lo común', () => {
    // 12 semanas: los sábados se gastan 1000, el resto de los días 100. Un sábado, además, una compra de 50.000.
    const today = '2026-10-14'; // miércoles
    const txs: Transaction[] = [];
    for (let d = addDays(today, -84); d < today; d = addDays(d, 1)) {
      const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
      txs.push(tx(d, dow === 6 ? 1000 : 100));
    }
    txs.push(tx('2026-09-05', 50000)); // un sábado
    const d = data({ transactions: txs, incomes: [] });
    const b = computeMonth(d, '2026-10', today);
    const f = weekdayForecast(d, b, today)!;
    expect(f).not.toBeNull();
    // Del 15 al 31 de octubre: 2 sábados (17, 24, 31 → 3) y 14 días comunes.
    const sat = f.rest.find((r) => r.weekday === 'sábado')!;
    expect(sat.days).toBe(3);
    expect(sat.typical).toBe(1000);
    expect(f.rest.find((r) => r.weekday === 'lunes')!.typical).toBe(100);
    // Hoy (miércoles, sin gastos todavía) cuenta lo típico: 100.
    expect(f.expectedRest).toBe(100 + 3 * 1000 + 14 * 100);
    // La compra de 50.000 se recorta al tope del 10% más alto.
    expect(f.cap).toBe(1000);
    expect(f.forecastEnd).toBe(Math.round((b.daily!.base - f.spentSoFar - f.expectedRest) * 100) / 100);
  });

  it('sin historia suficiente no pronostica (se usa el promedio simple)', () => {
    const today = '2026-10-14';
    const d = data({ transactions: [tx('2026-10-10', 500), tx('2026-10-12', 200)] });
    expect(weekdayForecast(d, computeMonth(d, '2026-10', today), today)).toBeNull();
  });
});

describe('categoría sugerida', () => {
  const d = data({
    transactions: [
      tx('2026-09-01', 300, { description: 'Uber al centro', categoryId: 'cat-transporte' }),
      tx('2026-09-02', 250, { description: 'Uber casa', categoryId: 'cat-transporte' }),
      tx('2026-09-03', 2000, { description: 'Compra Disco', categoryId: 'cat-super' }),
      tx('2026-09-04', 1500, { description: 'Disco', categoryId: 'cat-super' }),
      tx('2026-09-05', 900, { description: 'Pizza con amigos', categoryId: 'cat-comida' }),
    ],
  });
  const index = buildWordIndex(d, 'expense');
  const valid = new Set(d.categories.map((c) => c.id));

  it('aprende de lo que ya cargaste', () => {
    expect(suggestCategory(index, 'uber a lo de mamá', valid)).toMatchObject({
      categoryId: 'cat-transporte',
      word: 'uber',
      count: 2,
      source: 'history',
    });
    // A medio escribir (desde 4 letras) también sirve.
    expect(suggestCategory(index, 'Disc', valid)?.categoryId).toBe('cat-super');
  });

  it('si no hay historia usa palabras comunes, y si hay duda no adivina', () => {
    expect(suggestCategory(index, 'Farmacia', valid)).toMatchObject({ categoryId: 'cat-salud', source: 'keywords' });
    expect(suggestCategory(index, 'pizza uber', valid)).toBeNull();
    expect(suggestCategory(index, 'xyz', valid)).toBeNull();
  });
});

describe('¿ya lo cargaste?', () => {
  it('encuentra el mismo gasto cargado dos veces', () => {
    const first = tx('2026-10-10', 500, { description: 'Súper', categoryId: 'cat-super' });
    const d = data({ transactions: [first] });
    expect(possibleDuplicate(d, { ...first, id: 'new', date: '2026-10-11' })?.id).toBe(first.id);
    expect(possibleDuplicate(d, { ...first, id: 'new', date: '2026-10-13' })).toBeNull();
    expect(possibleDuplicate(d, { ...first, id: 'new', amount: 600 })).toBeNull();
    expect(possibleDuplicate(d, first)).toBeNull();
  });
});

describe('gastos que parecen fijos', () => {
  it('detecta lo que se repite todos los meses con monto parecido', () => {
    const d = data({
      transactions: [
        tx('2026-07-12', 490, { description: 'Netflix', categoryId: 'cat-suscripciones' }),
        tx('2026-08-12', 490, { description: 'Netflix', categoryId: 'cat-suscripciones' }),
        tx('2026-09-13', 520, { description: 'Netflix', categoryId: 'cat-suscripciones' }),
        // Varias veces por mes: es una costumbre, no un fijo.
        tx('2026-08-01', 300, { description: 'Uber' }),
        tx('2026-08-05', 300, { description: 'Uber' }),
        tx('2026-09-01', 300, { description: 'Uber' }),
        tx('2026-10-01', 300, { description: 'Uber' }),
        // Montos muy distintos: no.
        tx('2026-07-03', 1000, { description: 'Ropa' }),
        tx('2026-08-03', 5000, { description: 'Ropa' }),
        tx('2026-09-03', 2000, { description: 'Ropa' }),
        // Ya está como fijo.
        tx('2026-07-05', 1200, { description: 'Gimnasio' }),
        tx('2026-08-05', 1200, { description: 'Gimnasio' }),
        tx('2026-09-05', 1200, { description: 'Gimnasio' }),
      ],
      fixed: [fixedSchema.parse({ id: 'gym', name: 'Gimnasio', amount: 1200, startMonth: '2026-01' })],
    });
    const r = detectRecurring(d, '2026-10-05');
    expect(r.map((x) => x.name)).toEqual(['Netflix']);
    expect(r[0]).toMatchObject({ amount: 490, dayOfMonth: 12, categoryId: 'cat-suscripciones', min: 490, max: 520 });
    expect(r[0].months.map((m) => m.month)).toEqual(['2026-07', '2026-08', '2026-09']);
  });
});

describe('gastos fuera de lo común', () => {
  it('marca un gasto mucho más grande que lo normal en su categoría', () => {
    const today = '2026-10-14';
    const hist = [800, 900, 1000, 950, 850, 1100, 900, 1000, 950].map((a, i) =>
      tx(addDays('2026-08-01', i * 5), a, { categoryId: 'cat-comida' }),
    );
    const big = tx('2026-10-12', 4500, { categoryId: 'cat-comida', description: 'Cumpleaños' });
    const normal = tx('2026-10-13', 1200, { categoryId: 'cat-comida' });
    const r = unusualExpenses(data({ transactions: [...hist, big, normal] }), today);
    expect(r.map((x) => x.tx.id)).toEqual([big.id]);
    expect(r[0]).toMatchObject({ median: 950, samples: 9 });
  });
});

describe('revisión del presupuesto', () => {
  it('sugiere subir lo que siempre se pasa y bajar lo que sobra', () => {
    const d0 = data({
      transactions: [
        ...['2026-07', '2026-08', '2026-09'].map((m) => tx(`${m}-10`, 6200, { categoryId: 'cat-comida' })),
        ...['2026-07', '2026-08', '2026-09'].map((m, i) => tx(`${m}-10`, [1000, 1500, 1200][i], { categoryId: 'cat-ocio' })),
      ],
    });
    const d = {
      ...d0,
      categories: d0.categories.map((c) =>
        c.id === 'cat-comida' ? { ...c, monthlyLimit: 5000 } : c.id === 'cat-ocio' ? { ...c, monthlyLimit: 4000 } : c,
      ),
    };
    // Salud con presupuesto pero sin gastos: puede ser una reserva, no se toca.
    d.categories = d.categories.map((c) => (c.id === 'cat-salud' ? { ...c, monthlyLimit: 3000 } : c));
    const months = computeMonths(d, '2026-07', '2026-10', '2026-10-05');
    const r = budgetReview(d, months);
    expect(r).toEqual([
      expect.objectContaining({ categoryId: 'cat-ocio', kind: 'lower', current: 4000, suggested: 1700 }),
      expect.objectContaining({ categoryId: 'cat-comida', kind: 'raise', current: 5000, suggested: 6200 }),
    ]);
  });
});
