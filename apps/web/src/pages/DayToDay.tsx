import { useState } from 'react';
import {
  antExpenses,
  cardChoices,
  cardCloseDate,
  daysBetween,
  cashVsInstallments,
  costPerUse,
  formatNumber,
  monthLabel,
  monthOf,
  moneyRate,
  suggestUseLinks,
  workHour,
} from '@lifty/core';
import { openExplain, openFixedForm, openPrompt } from '../components/Editors';
import { Empty, Field, PageHeader, Section, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { cached, useData, useMonth, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

const ddmm = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
const pct = (v: number) => `${formatNumber(v, 2, 0)}%`;

/** La plata del día a día: con qué tarjeta pagar hoy, gastos hormiga, contado o cuotas y cuánto te sale cada uso. */
export function DayToDay() {
  return (
    <div className="page narrow">
      <PageHeader title="Día a día" subtitle="Decisiones chicas que suman: tarjetas, hormiga, cuotas y lo que pagás por mes" />
      <CardsToday />
      <Ants />
      <CashOrInstallments />
      <UseCosts />
    </div>
  );
}

/** ¿Con qué tarjeta conviene pagar hoy? */
function CardsToday() {
  const data = useData();
  const today = useToday();
  const choices = cardChoices(data, today);
  if (!choices.length) return null;
  const best = choices[0];
  const missing = choices.filter((c) => !c.known);
  // Si ya cerró este mes, una compra de hoy va al resumen que viene: cuánto hace que cerró.
  const closedAgo =
    best.card.closingDay && best.statement > monthOf(today)
      ? daysBetween(cardCloseDate(best.card, monthOf(today))!, today)
      : null;
  return (
    <Section title="¿Con qué tarjeta pago hoy?">
      <div className="card pad daytoday-hero">
        <p>
          {choices.length > 1 ? (
            <>
              Hoy conviene <strong>{best.card.name}</strong>.{' '}
            </>
          ) : (
            <>
              <strong>{best.card.name}</strong>:{' '}
            </>
          )}
          {(() => {
            const when =
              closedAgo !== null
                ? `Cerró ${closedAgo === 1 ? 'ayer' : `hace ${closedAgo} días`}: si comprás hoy, `
                : best.known
                  ? `Cierra el ${ddmm(best.closes!)}: si comprás hoy, `
                  : 'Si comprás hoy, ';
            // Después de "Visa:" va en minúscula; después de "Hoy conviene OCA." en mayúscula.
            return choices.length > 1 ? when : when.charAt(0).toLowerCase() + when.slice(1);
          })()}
          lo pagás el <strong>{ddmm(best.pays)}</strong>, dentro de <strong>{best.days} días</strong>.
        </p>
        {choices.length > 1 && (
          <ul className="plain-list small">
            {choices.slice(1).map((c) => (
              <li key={c.card.id}>
                {c.card.icon} {c.card.name}: lo pagás el {ddmm(c.pays)} ({c.days} días)
                {c.closes && c.statement === monthOf(today) ? ` · cierra el ${ddmm(c.closes)}` : ''}
              </li>
            ))}
          </ul>
        )}
        {missing.length > 0 && (
          <p className="muted small">
            {missing.map((c) => c.card.name).join(', ')}: cargá el día de cierre y el de pago en <a href="#/cuentas">Cuentas</a>{' '}
            para que sea exacto (y los resúmenes también).
          </p>
        )}
      </div>
    </Section>
  );
}

/** Gastos hormiga: lo chico que se repite. */
function Ants() {
  const data = useData();
  const today = useToday();
  const b = useMonth(monthOf(today));
  const hour = workHour(data, b);
  const r = cached(data, `ants:${today}`, () => antExpenses(data, today, hour));
  const weekly = data.settings.weeklyHours || 40;
  const changeHours = () =>
    openPrompt({
      title: 'Horas de trabajo',
      label: '¿Cuántas horas trabajás por semana?',
      initial: String(weekly),
      hint: 'Para pasar los gastos a horas de tu trabajo (sueldo líquido ÷ horas del mes).',
      onSubmit: (v) => {
        if (!v || v < 1 || v > 100) return 'Entre 1 y 100';
        mutate('settings', 'upsert', { ...data.settings, weeklyHours: v });
      },
    });
  const explain = () =>
    openExplain({
      title: 'Gastos hormiga',
      intro: `Lo chico (hasta ${money(r.max)}) que se repite 2 o más veces por mes, en los últimos ${r.days} días. Se agrupa por la descripción (sin números) o, si no tiene, por categoría.`,
      rows: [
        ...r.groups.map((g) => ({
          label: g.name,
          value: g.monthly,
          raw: `${money(g.monthly)} por mes`,
          note: `${g.count} veces · ${money(Math.round(g.average))} en promedio`,
        })),
      ],
      result: { label: 'Por mes', value: r.monthly },
      footnote: `Por año: ${money(r.monthly)} × 12 = ${money(r.yearly)}.${
        hour
          ? ` En horas: ${money(r.yearly)} ÷ ${money(hour.value)} por hora (tu sueldo de ${money(hour.salary)} ÷ ${formatNumber(hour.hoursPerMonth, 1, 0)} h del mes) = ${formatNumber(r.hours ?? 0, 0)} h.`
          : ''
      }`,
    });
  return (
    <Section
      title="Gastos hormiga"
      action={
        <button className="link small" onClick={changeHours}>
          {weekly} h por semana
        </button>
      }
    >
      {r.groups.length === 0 ? (
        <Empty icon="info" title="No hay gastos hormiga">
          Nada chico que se repita seguido en los últimos {r.days} días. ¡Bien ahí!
        </Empty>
      ) : (
        <div className="card pad">
          <button className="daytoday-hero link-block" onClick={explain}>
            <span>
              {r.groups
                .slice(0, 2)
                .map((g) => g.name)
                .join(' y ')}
              {r.groups.length > 2 ? ` y ${r.groups.length - 2} más` : ''} te salen
            </span>
            <strong className="big">{money(Math.round(r.monthly))} por mes</strong>
            <span className="muted">
              {money(Math.round(r.yearly))} por año
              {r.hours !== null ? ` · ${formatNumber(r.hours, 0)} horas de tu trabajo` : ''}
            </span>
          </button>
          <ul className="plain-list ant-list">
            {r.groups.map((g) => (
              <li key={g.key}>
                <span>
                  <strong>{g.name}</strong>
                  <span className="muted small">
                    {' '}
                    · {formatNumber(g.perMonth, 0)} veces por mes · {money(Math.round(g.average))} c/u
                    {g.thisMonth.count ? ` · este mes ${g.thisMonth.count}` : ''}
                  </span>
                </span>
                <span>{money(Math.round(g.monthly))}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Si los bajás a la mitad, te ahorrás <strong>{money(Math.round(r.halfSaving))}</strong> por año. Son el{' '}
            {Math.round(r.share * 100)}% de lo que gastás en el día a día.
          </p>
        </div>
      )}
    </Section>
  );
}

/** ¿Contado con descuento o en cuotas? */
function CashOrInstallments() {
  const data = useData();
  const def = moneyRate(data);
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('10');
  const [count, setCount] = useState('12');
  const [surcharge, setSurcharge] = useState('0');
  const [rate, setRate] = useState(String(def.rate).replace('.', ','));
  const p = parseAmount(price) ?? 0;
  const r =
    p > 0
      ? cashVsInstallments({
          price: p,
          discount: parseAmount(discount) ?? 0,
          count: Math.max(1, Math.round(parseAmount(count) ?? 1)),
          surcharge: parseAmount(surcharge) ?? 0,
          annualRate: parseAmount(rate) ?? 0,
        })
      : null;
  const explain = () =>
    r &&
    openExplain({
      title: '¿Contado o cuotas?',
      intro: `Con ${pct(parseAmount(rate) ?? 0)} por año, la plata pierde (o rinde) ${pct(r.monthlyRate)} por mes. Cada cuota se pasa a plata de hoy dividiéndola por (1 + ${pct(r.monthlyRate)}) elevado al mes en que la pagás (la primera, el mes que viene).`,
      rows: r.rows.map((x) => ({
        label: `Cuota ${x.n}`,
        value: x.today,
        raw: money(x.today),
        note: `${money(x.amount)} en ${x.n} mes${x.n === 1 ? '' : 'es'}`,
      })),
      result: { label: 'Las cuotas, en plata de hoy', value: r.presentValue },
      footnote: `Contado: ${money(r.cash)}. Da lo mismo con ${pct(r.breakEven)} de descuento: con más, conviene contado; con menos, cuotas.`,
    });
  return (
    <Section title="¿Contado o en cuotas?">
      <div className="card pad form">
        <p className="muted small">Por ejemplo, «10% de descuento contado» contra «12 cuotas sin recargo».</p>
        <div className="row">
          <Field label="Precio">
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ej: 24000" />
          </Field>
          <Field label="Descuento (%)">
            <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
        </div>
        <div className="row">
          <Field label="Cuotas">
            <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label="Recargo (%)">
            <input inputMode="decimal" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} />
          </Field>
        </div>
        <Field label="Inflación o lo que rinde tu plata (% por año)" hint={`Sugerido: ${def.source}`}>
          <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        {r && (
          <button className={`verdict ${r.best === 'cash' ? 'good' : r.best === 'installments' ? 'info' : ''}`} onClick={explain}>
            {r.best === 'same' ? (
              <strong>Da prácticamente lo mismo.</strong>
            ) : (
              <strong>
                Conviene {r.best === 'cash' ? `contado (${money(r.cash)})` : `en ${r.rows.length} cuotas de ${money(r.each)}`}: te
                ahorrás {money(Math.round(r.difference))} en plata de hoy.
              </strong>
            )}
            <span className="muted small">
              Contado {money(r.cash)} · cuotas {money(r.total)} (en plata de hoy {money(Math.round(r.presentValue))}). Da lo mismo
              con {pct(r.breakEven)} de descuento. ¿De dónde sale?
            </span>
          </button>
        )}
      </div>
    </Section>
  );
}

/** Cuánto te sale cada uso (fijos unidos a una rutina). */
function UseCosts() {
  const data = useData();
  const today = useToday();
  const uses = costPerUse(data, today);
  const suggestions = suggestUseLinks(data);
  if (!uses.length && !suggestions.length && !data.habits.length) return null;
  return (
    <Section title="Cuánto te sale cada uso">
      {uses.length === 0 && suggestions.length === 0 ? (
        <Empty icon="info" title="Uní un gasto fijo con una rutina">
          Por ejemplo, la cuota del gimnasio con tu rutina de ejercicio: Lifty te dice cuánto te sale cada vez que vas. Se hace en
          el gasto fijo, en «¿Lo usás con una rutina?».
        </Empty>
      ) : (
        <div className="card list">
          {uses.map((u) => (
            <button key={u.fixed.id} className="tx-row wrap-text" onClick={() => openFixedForm(u.fixed.id)}>
              <span className="tx-icon">{u.habit.icon}</span>
              <span className="tx-main">
                <span className="tx-title">{u.fixed.name}</span>
                <span className="tx-meta">
                  {u.uses
                    ? `${u.uses} ${u.uses === 1 ? 'vez' : 'veces'} en ${monthLabel(u.month, false).toLowerCase()}${u.planned ? ` (tocaban ${u.planned})` : ''} · ${money(u.monthly)} por mes`
                    : `No lo usaste en ${monthLabel(u.month, false).toLowerCase()}: te salió ${money(u.monthly)} sin usarlo`}
                </span>
              </span>
              <span className={`tx-amount ${u.perUse === null ? 'text-bad' : ''}`}>
                {u.perUse !== null ? `${money(Math.round(u.perUse))} c/vez` : '—'}
              </span>
            </button>
          ))}
          {suggestions.map((s) => (
            <div key={s.fixed.id} className="tx-row wrap-text">
              <span className="tx-icon">{s.habit.icon}</span>
              <span className="tx-main">
                <span className="tx-title">
                  ¿{s.fixed.name} va con «{s.habit.name}»?
                </span>
                <span className="tx-meta">Así sabés cuánto te sale cada vez</span>
              </span>
              <button
                className="btn btn-sm"
                onClick={() => {
                  mutate('fixed', 'upsert', { ...s.fixed, habitId: s.habit.id });
                  toast(`${s.fixed.name} unido a ${s.habit.name}`);
                }}
              >
                Unir
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
