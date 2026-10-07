import { describe, expect, it } from 'vitest';
import {
  assetSchema,
  assetValue,
  assetsAt,
  defaultSettings,
  netWorthAt,
  seedRecords,
  applyMutation,
  toLiftyData,
  type RecordStore,
} from '../src';

describe('bienes en el patrimonio', () => {
  const auto = assetSchema.parse({ id: 'a', name: 'Auto', kind: 'auto', value: 20000, date: '2024-10-07', depreciation: 12 });

  it('un auto pierde 12% por año: a los 2 años vale 20.000 × 0,88²', () => {
    const v = assetValue(auto, '2026-10-07', 40)!;
    // (730 días son 1,999 años de 365,25 días)
    expect(v.value).toBeCloseTo(20000 * 0.88 ** 2, -1);
    expect(v.valueUYU).toBeCloseTo(v.value * 40, 0);
    expect(v.from).toBe('purchase');
    // Antes de comprarlo o después de venderlo no cuenta.
    expect(assetValue(auto, '2024-01-01', 40)).toBeNull();
    expect(assetValue({ ...auto, soldDate: '2026-01-01' }, '2026-10-07', 40)).toBeNull();
  });

  it('con una tasación se calcula desde ahí; una casa puede valorizarse', () => {
    const tasado = { ...auto, appraisal: 18000, appraisalDate: '2026-04-07' };
    expect(assetValue(tasado, '2026-10-07', 40)!.value).toBeCloseTo(18000 * 0.88 ** 0.5, -1);
    const casa = assetSchema.parse({ id: 'c', name: 'Casa', kind: 'casa', value: 100000, date: '2025-10-07', depreciation: -3 });
    expect(assetValue(casa, '2026-10-07', 40)!.value).toBeCloseTo(103000, -1);
  });

  it('suma al patrimonio', () => {
    const store: RecordStore = {};
    for (const { entity, record } of seedRecords())
      applyMutation(store, { entity, op: 'upsert', id: record.id, updatedAt: record.updatedAt, record });
    const d = { ...toLiftyData(store), settings: { ...defaultSettings(), usdRate: 40 }, assets: [auto] };
    const goods = assetsAt(d, '2026-10-07').totalUYU;
    expect(netWorthAt(d, '2026-10-07')).toMatchObject({ goods, total: goods });
  });
});
