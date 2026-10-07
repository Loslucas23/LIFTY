import { fxRateSchema, settingsSchema, todayISO, type Mutation } from '@lifty/core';
import type { LiftyDb } from './db';

/**
 * Cotización del dólar automática: si está activada en Ajustes, la compu la consulta en internet
 * al arrancar y cada 6 horas, guarda la del día y actualiza la cotización de Lifty. Sin internet,
 * no pasa nada (queda la última).
 */
export const RATE_URL = process.env.LIFTY_RATE_URL ?? 'https://open.er-api.com/v6/latest/USD';
const EVERY = 6 * 60 * 60 * 1000;

export type FetchRate = () => Promise<number>;

/** Pesos uruguayos por dólar, desde la API pública (sin clave). */
export const fetchUsdRate: FetchRate = async () => {
  const res = await fetch(RATE_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`La cotización respondió ${res.status}`);
  const body = (await res.json()) as { rates?: Record<string, number>; UYU?: number };
  const rate = body.rates?.UYU ?? body.UYU;
  if (typeof rate !== 'number' || !(rate > 10 && rate < 500)) throw new Error('La cotización no trajo un valor razonable');
  return Math.round(rate * 100) / 100;
};

export class RateService {
  private timer: NodeJS.Timeout | null = null;
  lastError: string | null = null;
  lastRun: string | null = null;

  constructor(
    private db: LiftyDb,
    private fetchRate: FetchRate = fetchUsdRate,
    private onChange: (rev: number) => void = () => undefined,
  ) {}

  /** Si está activada: trae la cotización y la guarda. Devuelve la nueva o null. */
  async run(force = false): Promise<number | null> {
    const stored = this.db.changesSince(0).find((r) => r.entity === 'settings' && r.id === 'main')?.record;
    const settings = settingsSchema.parse({ ...(stored ?? {}), id: 'main' });
    if (!settings.autoRate && !force) return null;
    try {
      const rate = await this.fetchRate();
      const now = new Date().toISOString();
      const date = todayISO();
      const muts: Mutation[] = [
        {
          entity: 'fxRate',
          op: 'upsert',
          id: date,
          updatedAt: now,
          record: fxRateSchema.parse({ id: date, updatedAt: now, date, rate, source: 'open.er-api.com' }),
        },
      ];
      if (settings.usdRate !== rate)
        muts.push({
          entity: 'settings',
          op: 'upsert',
          id: 'main',
          updatedAt: now,
          record: { ...settings, usdRate: rate, updatedAt: now },
        });
      const before = this.db.rev;
      const { rev } = this.db.applyMutations(muts);
      if (rev !== before) this.onChange(rev);
      this.lastError = null;
      this.lastRun = now;
      return rate;
    } catch (err) {
      this.lastError = (err as Error).message;
      return null;
    }
  }

  start() {
    setTimeout(() => void this.run(), 10_000).unref?.();
    this.timer = setInterval(() => void this.run(), EVERY);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
