import { useMemo, useState } from 'react';
import {
  addMonths,
  adjustBalance,
  financialHealth,
  suggestGoalAccount,
  goalBalances,
  goalMonths,
  mainAccount,
  newId,
  monthOf,
  moneyCheck,
  netWorthHistory,
  paydayPlan,
  plata,
  round2,
  type Account,
  type Commitment,
  type Goal,
  type Place,
  type Plata as PlataT,
} from '@lifty/core';
import { openExplain, openMenu, openPrompt } from '../components/Editors';
import { Icon } from '../components/Icon';
import { openSetup } from '../components/Setup';
import { openTxForm } from '../components/TxForm';
import { Chips, Field, PageHeader, Progress, Section, Sheet, toast } from '../components/ui';
import { money, parseAmount } from '../lib/format';
import { assignToGoal, doPayday, registerInterest, renewInvestment, setGoalAccount } from '../lib/plata';
import { navigate } from '../lib/router';
import { useData, useMonth, useMonths, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

/** Tu plata calculada para hoy. */
export function usePlata(): PlataT {
  const data = useData();
  const today = useToday();
  const b = useMonth(monthOf(today));
  return useMemo(() => plata(data, b, today), [data, b, today]);
}

const fmtDate = (d: string) => d.split('-').reverse().slice(0, 2).join('/');
const COLORS = { free: 'var(--accent)', committed: 'var(--warn)', goals: '#0ea5e9', unassigned: '#7dd3fc', invest: '#0d9488' };
const KIND_ICON: Record<Commitment['kind'], string> = { fixed: '📅', card: '💳', loan: '🏦', saving: '🐷', provision: '🗓️' };

/** "Te sobra": cómo sale, paso a paso. */
export function explainFree(p: PlataT) {
  openExplain({
    title: 'Te sobra',
    intro: `Lo libre de verdad en tus cuentas para gastar, hasta ${p.nextIncome ? `el cobro del ${fmtDate(p.until)} (${p.nextIncome.name})` : 'fin de mes'}.`,
    rows: [
      { label: 'Bancos y efectivo para gastar', value: p.spend },
      ...(p.goalsInSpend ? [{ label: 'Apartado para metas en esas cuentas', value: p.goalsInSpend, op: '−' as const }] : []),
      ...p.commitments.map((c) => ({
        label: `${KIND_ICON[c.kind]} ${c.name}`,
        value: c.amount,
        op: '−' as const,
        note: [c.date ? fmtDate(c.date) : null, c.note].filter(Boolean).join(' · '),
      })),
    ],
    result: { label: 'Te sobra', value: p.free },
    footnote:
      p.freePerDay !== null
        ? `${money(Math.round(p.free))} ÷ ${p.days} días = ${money(Math.round(p.freePerDay))} por día. La plata guardada (cuentas de ahorro e inversiones) no cuenta: no es para gastar.`
        : 'No te alcanza lo que hay en tus cuentas para lo comprometido hasta el cobro.',
  });
}

/** Tu plata: dónde está cada peso, a qué está destinado y cuánto te sobra de verdad. */
export function Plata() {
  const data = useData();
  const today = useToday();
  const b = useMonth(monthOf(today));
  const p = usePlata();
  const check = useMemo(() => moneyCheck(data, today, b), [data, today, b]);
  const history = useMemo(() => netWorthHistory(data, today, 4), [data, today]);
  const [payday, setPayday] = useState(false);
  const [assigning, setAssigning] = useState<Place | null>(null);
  const rate = data.settings.usdRate;

  const savedGoals = p.places.filter((x) => x.group === 'spend').reduce((s, x) => s + x.goalsUYU, 0);
  const inSaved = p.places.filter((x) => x.group === 'saved' || x.group === 'invest');
  const goalsSaved = inSaved.reduce((s, x) => s + Math.min(x.goalsUYU, Math.max(0, x.balanceUYU)), 0);
  const segments = [
    { key: 'free', label: 'Te sobra', value: Math.max(0, p.free), color: COLORS.free },
    {
      key: 'committed',
      label: p.nextIncome ? 'Comprometido hasta el cobro' : 'Comprometido hasta fin de mes',
      // En la barra, lo que alcanza a cubrir la plata que hay; en el detalle, todo lo comprometido.
      value: Math.min(p.committed, Math.max(0, p.spend - savedGoals)),
      shown: p.committed,
      color: COLORS.committed,
    },
    { key: 'goals', label: 'Metas', value: savedGoals + goalsSaved, color: COLORS.goals },
    { key: 'unassigned', label: 'Ahorro sin destino', value: p.unassigned, color: COLORS.unassigned },
  ].filter((s) => s.value > 0.5);
  const barTotal = Math.max(
    1,
    segments.reduce((s, x) => s + x.value, 0),
  );
  const change = history.length >= 2 ? round2(history[history.length - 1].total - history[history.length - 2].total) : null;
  const monthly =
    history.length >= 4 ? round2((history[history.length - 1].total - history[0].total) / (history.length - 1)) : null;

  return (
    <div className="page narrow">
      <PageHeader title="Tu plata" subtitle="Dónde está cada peso y cuánto te sobra de verdad" back="/mas" />

      <section
        className={`hero ${p.free < 0 ? 'hero-neg' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => explainFree(p)}
        onKeyDown={(e) => e.key === 'Enter' && explainFree(p)}
      >
        <p className="hero-label">{p.free >= 0 ? 'Te sobra' : 'Te falta'}</p>
        <p className="hero-value">{money(Math.round(Math.abs(p.free)))}</p>
        <p className="hero-sub">
          {p.free >= 0 && p.freePerDay !== null
            ? `${money(Math.round(p.freePerDay))} por día hasta ${p.nextIncome ? `el cobro del ${fmtDate(p.until)}` : 'fin de mes'} (${p.days} días)`
            : `Lo que hay en tus cuentas no alcanza para lo comprometido hasta ${p.nextIncome ? 'el cobro' : 'fin de mes'}`}
        </p>
        <div className="hero-stats">
          <div>
            <span>En tus cuentas</span>
            <strong>{money(Math.round(p.spend))}</strong>
          </div>
          <div>
            <span>Comprometido</span>
            <strong>{money(Math.round(p.committed))}</strong>
          </div>
          <div>
            <span>Guardado</span>
            <strong>{money(Math.round(p.saved + p.invested + p.goalsInSpend))}</strong>
          </div>
        </div>
        <p className="hero-foot">Tocá para ver de dónde sale</p>
      </section>

      <div className="btn-row plata-actions">
        <button className="btn btn-primary" onClick={() => setPayday(true)}>
          <Icon name="wallet" /> Repartir el cobro
        </button>
        <button className="btn" onClick={() => openTxForm({ preset: { kind: 'transfer' } })}>
          <Icon name="repeat" /> Mover plata
        </button>
        <button className="btn" onClick={() => openSetup()}>
          <Icon name="check" /> Poner a punto
        </button>
      </div>

      <Todo p={p} check={check} onAssign={setAssigning} />

      {segments.length > 0 && (
        <Section title="A qué está destinada tu plata">
          <div className="card pad">
            <div className="where-bar plata-bar" aria-hidden="true">
              {segments.map((s) => (
                <span key={s.key} style={{ width: `${(s.value / barTotal) * 100}%`, background: s.color }} />
              ))}
            </div>
            <dl className="receipt">
              {segments.map((s) => (
                <div key={s.key} className="receipt-row">
                  <dt>
                    <i className="where-dot" style={{ background: s.color }} />
                    {s.label}
                  </dt>
                  <dd>{money(Math.round('shown' in s && s.shown !== undefined ? s.shown : s.value))}</dd>
                </div>
              ))}
              {p.free < 0 && (
                <div className="receipt-row">
                  <dt className="text-bad">Te falta para cubrir lo comprometido</dt>
                  <dd className="text-bad">{money(Math.round(-p.free))}</dd>
                </div>
              )}
            </dl>
          </div>
        </Section>
      )}

      {p.commitments.length > 0 && (
        <Section title={`Comprometido hasta ${p.nextIncome ? `el cobro (${fmtDate(p.until)})` : 'fin de mes'}`}>
          <div className="card list">
            {p.commitments.map((c) => (
              <div key={c.id} className="tx-row static">
                <span className="tx-icon">{KIND_ICON[c.kind]}</span>
                <span className="tx-main">
                  <span className="tx-title">{c.name}</span>
                  <span className={`tx-meta ${c.overdue ? 'text-bad' : ''}`}>
                    {[c.date ? fmtDate(c.date) : null, c.note].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="tx-amount">{money(Math.round(c.amount))}</span>
              </div>
            ))}
          </div>
          <p className="muted small">
            🗓️ «Lo que pagás cada tanto» es lo que ya deberías tener guardado para la patente, el seguro o lo que no es de todos
            los meses (así no te agarra de sorpresa).
          </p>
        </Section>
      )}

      <Section title="Dónde está cada peso">
        <PlaceGroupList title="💳 Para gastar" places={p.places.filter((x) => x.group === 'spend')} rate={rate} />
        <PlaceGroupList
          title="🔒 Ahorro"
          places={p.places.filter((x) => x.group === 'saved')}
          rate={rate}
          onAssign={setAssigning}
        />
        <PlaceGroupList
          title="📈 Inversiones"
          places={p.places.filter((x) => x.group === 'invest')}
          rate={rate}
          onAssign={setAssigning}
        />
        <PlaceGroupList title="💳 Tarjetas (lo que debés)" places={p.places.filter((x) => x.group === 'credit')} rate={rate} />
        {(p.netWorth.owedToMe > 0 || p.netWorth.iOwe > 0) && (
          <a className="card pad tile-link" href="#/deudas">
            <span className="tile-text">
              <strong>Préstamos y deudas</strong>
              <span className="muted small">
                {p.netWorth.owedToMe > 0 ? `Te deben ${money(Math.round(p.netWorth.owedToMe))}` : ''}
                {p.netWorth.owedToMe > 0 && p.netWorth.iOwe > 0 ? ' · ' : ''}
                {p.netWorth.iOwe > 0 ? `Debés ${money(Math.round(p.netWorth.iOwe))}` : ''}
              </span>
            </span>
            <Icon name="right" />
          </a>
        )}
        <a className="link small" href="#/cuentas">
          + Agregar una cuenta, una caja de ahorro o una inversión
        </a>
      </Section>

      <EmergencyCard />

      <Section title="Tu patrimonio">
        <div className="card pad">
          <div className="limit-head">
            <span>Lo que tenés − lo que debés</span>
            <strong className={p.netWorth.total < 0 ? 'text-bad' : ''}>{money(Math.round(p.netWorth.total))}</strong>
          </div>
          <p className="muted small">
            ≈ {money(Math.round(p.netWorth.totalUSD), 'USD')} · {Math.round(p.netWorth.usdShare * 100)}% de lo que tenés está en
            dólares
            {p.accrued > 0 ? ` · incluye ${money(Math.round(p.accrued))} de intereses estimados` : ''}
          </p>
          <dl className="receipt">
            <div className="receipt-row">
              <dt>Cuentas, ahorro e inversiones{p.netWorth.owedToMe > 0 ? ' (y lo que te deben)' : ''}</dt>
              <dd>{money(Math.round(p.netWorth.assets))}</dd>
            </div>
            <div className="receipt-row">
              <dt>Tarjetas y deudas</dt>
              <dd className="text-expense">−{money(Math.round(p.netWorth.debts))}</dd>
            </div>
          </dl>
          {change !== null && Math.abs(change) >= 1 && (
            <p className={`small ${change >= 0 ? 'text-income' : 'text-expense'}`}>
              {change >= 0 ? '▲' : '▼'} {money(Math.round(Math.abs(change)))} desde fin del mes pasado
            </p>
          )}
          {monthly !== null && monthly > 0 && (
            <p className="small">
              A este ritmo (+{money(Math.round(monthly))} por mes, promedio de los últimos 3), en un año tendrías{' '}
              <strong>{money(Math.round(p.netWorth.total + monthly * 12))}</strong>.
            </p>
          )}
          {monthly !== null && monthly < 0 && (
            <p className="small text-expense">
              Tu patrimonio viene bajando {money(Math.round(-monthly))} por mes (promedio de los últimos 3).
            </p>
          )}
          <a className="link small" href="#/informes">
            Ver cómo cambió mes a mes
          </a>
        </div>
      </Section>

      {payday && <PaydaySheet onClose={() => setPayday(false)} />}
      {assigning && <AssignSheet place={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

/** Colchón para emergencias: cuántos meses de gastos cubre lo que tenés, y la meta para llegar a 3. */
function EmergencyCard() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const months = useMonths(addMonths(month, -3), month);
  const h = useMemo(() => financialHealth(data, months, today), [data, months, today]);
  if (!h || h.emergency.essentials <= 0) return null;
  const e = h.emergency;
  const existing = data.goals.find((g) => !g.archived && /emergencia|colch[oó]n/i.test(g.name));
  const create = () => {
    const acc = suggestGoalAccount(data, { currency: 'UYU' });
    const goal: Goal = {
      id: newId(),
      updatedAt: '',
      name: 'Fondo de emergencia',
      currency: 'UYU',
      target: Math.round(e.target / 1000) * 1000,
      targetMonth: addMonths(month, 12),
      startMonth: month,
      accountId: acc?.id ?? null,
      color: '#16a34a',
      icon: '🛟',
      archived: false,
    };
    mutate('goal', 'upsert', goal);
    toast(`Meta creada: ${goal.name} (${money(goal.target!)} en un año)`, {
      action: { label: 'Deshacer', run: () => mutate('goal', 'delete', goal.id) },
    });
  };
  return (
    <Section title="Colchón para emergencias">
      <div className="card pad">
        <div className="limit-head">
          <span>Cubrís</span>
          <strong className={e.months < 3 ? 'text-bad' : 'text-income'}>
            {e.months.toLocaleString('es-UY', { maximumFractionDigits: 1 })} meses
          </strong>
        </div>
        <Progress value={Math.min(e.months, 6)} max={6} label="Meses que cubre tu colchón" />
        <p className="muted small">
          Lo que tenés ({money(Math.round(e.have))}, sin lo que debés) ÷ lo que gastás por mes ({money(Math.round(e.essentials))}
          ). Se recomiendan de 3 a 6 meses, por si te quedás sin trabajo o surge algo grande.
        </p>
        {e.months < 3 &&
          (existing ? (
            <p className="small">
              Ya tenés la meta <strong>{existing.name}</strong>: seguí sumándole (te faltan {money(Math.round(e.missing))}).
            </p>
          ) : (
            <div className="btn-row">
              <span className="small">
                Te faltan {money(Math.round(e.missing))}: {money(Math.round(e.perMonth12))} por mes durante un año.
              </span>
              <button className="btn" onClick={create}>
                🛟 Crear la meta
              </button>
            </div>
          ))}
      </div>
    </Section>
  );
}

/** Lo que hay que resolver para que cada peso tenga lugar y destino. */
function Todo({ p, check, onAssign }: { p: PlataT; check: ReturnType<typeof moneyCheck>; onAssign: (x: Place) => void }) {
  const data = useData();
  const places = data.accounts.filter((a) => !a.archived && (a.type === 'bank' || a.type === 'cash'));
  const items: React.ReactNode[] = [];
  for (const h of p.homeless)
    items.push(
      <div key={`h-${h.goal.id}`} className="card pad todo-card">
        <p>
          <strong>
            ¿Dónde está «{h.goal.name}» ({money(h.balance.balance, h.goal.currency)})?
          </strong>
          <br />
          <span className="muted small">
            Cada meta vive en una cuenta: así Lifty sabe qué parte de esa cuenta es ahorro y no la cuenta para gastar.
          </span>
        </p>
        <Chips
          label={`Cuenta de ${h.goal.name}`}
          value={null as string | null}
          onChange={(id) => {
            const acc = places.find((a) => a.id === id);
            if (acc) setGoalAccount(h.goal, acc);
          }}
          options={[...places]
            .sort((a, b) => Number(b.id === h.suggested?.id) - Number(a.id === h.suggested?.id))
            .map((a) => ({
              value: a.id as string | null,
              label: `${a.name}${a.id === h.suggested?.id ? ' (sugerida)' : ''}`,
              icon: a.icon,
            }))}
        />
      </div>,
    );
  for (const x of p.overAssigned)
    items.push(
      <div key={`o-${x.account.id}`} className="note note-bad">
        En <strong>{x.account.name}</strong> apartaste para metas {money(Math.round(-x.unassignedUYU))} más de lo que hay. ¿El
        saldo está al día?{' '}
        <button className="link" onClick={() => openSetup()}>
          Poner a punto
        </button>
      </div>,
    );
  for (const x of p.places.filter((y) => y.unassignedUYU > 0.5 && data.goals.some((g) => !g.archived)))
    items.push(
      <div key={`u-${x.account.id}`} className="card pad todo-card">
        <p>
          Tenés <strong>{money(Math.round(x.unassignedUYU))}</strong> en {x.account.name} sin destino.{' '}
          <span className="muted small">¿Para qué son?</span>
        </p>
        <button className="btn" onClick={() => onAssign(x)}>
          Asignar a una meta
        </button>
      </div>,
    );
  if (Math.abs(check.difference) >= 100)
    items.push(
      <div key="diff" className="note">
        ⚖️ Tus cuentas y tu presupuesto no coinciden por <strong>{money(Math.round(Math.abs(check.difference)))}</strong>: según
        tus cuentas tenés {money(Math.round(check.available))} y según lo cargado, {money(Math.round(check.budget.value))}. Puede
        ser un gasto sin anotar o un saldo viejo.{' '}
        <button className="link" onClick={() => openSetup()}>
          Poner a punto
        </button>
      </div>,
    );
  if (!items.length) return null;
  return <Section title="Para que cada peso tenga lugar">{items}</Section>;
}

function PlaceGroupList({
  title,
  places,
  rate,
  onAssign,
}: {
  title: string;
  places: Place[];
  rate: number;
  onAssign?: (x: Place) => void;
}) {
  const data = useData();
  const today = useToday();
  if (!places.length) return null;
  const adjust = (a: Account, balance: number) =>
    openPrompt({
      title: `Saldo de ${a.name}`,
      label: `¿Cuánto hay hoy? (${a.currency === 'USD' ? 'US$' : '$'})`,
      initial: String(a.type === 'credit' ? -balance : balance).replace('.', ','),
      hint:
        a.type === 'credit'
          ? 'Lo que debés hoy en la tarjeta (en positivo).'
          : 'Mirá la app del banco. Lifty ajusta el saldo; los movimientos no cambian.',
      onSubmit: (v) => {
        const next = adjustBalance(data, a.id, a.type === 'credit' ? -Math.abs(v) : v, today);
        if (next) mutate('account', 'upsert', next);
        toast(`${a.name}: saldo actualizado`, { action: { label: 'Deshacer', run: () => mutate('account', 'upsert', a) } });
      },
    });
  return (
    <div className="plata-group">
      <h4 className="shop-aisle">{title}</h4>
      <div className="card list">
        {places.map((x) => (
          <div key={x.account.id} className="plata-place">
            <button className="tx-row" onClick={() => adjust(x.account, x.balance)}>
              <span className="tx-icon" style={{ '--tint': x.account.color } as React.CSSProperties}>
                {x.account.icon}
              </span>
              <span className="tx-main">
                <span className="tx-title">{x.account.name}</span>
                <span className="tx-meta">
                  {x.invest
                    ? [
                        `${x.invest.rate}% anual`,
                        x.invest.maturity
                          ? x.invest.daysToMaturity! < 0
                            ? `venció el ${fmtDate(x.invest.maturity)}`
                            : `vence el ${fmtDate(x.invest.maturity)} (${x.invest.daysToMaturity} días)`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : x.group === 'credit'
                      ? 'Lo que debés (también las cuotas que vienen)'
                      : 'Tocá para poner el saldo real'}
                </span>
              </span>
              <span className={`tx-amount ${x.balance < 0 ? 'text-expense' : ''}`}>
                {money(x.balance, x.account.currency)}
                {x.account.currency === 'USD' && <small>≈ {money(Math.round(x.balanceUYU))}</small>}
              </span>
            </button>
            {x.goals.map((g) => (
              <div key={g.goal.id} className="tx-row static sub-row">
                <span className="tx-icon">{g.goal.icon}</span>
                <span className="tx-main">
                  <span className="tx-title">{g.goal.name}</span>
                  <span className="tx-meta">Apartado para esta meta</span>
                </span>
                <span className="tx-amount">{money(g.balance, g.goal.currency)}</span>
              </div>
            ))}
            {(x.group === 'saved' || x.group === 'invest') && Math.abs(x.unassignedUYU) > 0.5 && (
              <div className="tx-row static sub-row">
                <span className="tx-icon">{x.unassignedUYU > 0 ? '❔' : '⚠️'}</span>
                <span className="tx-main">
                  <span className="tx-title">{x.unassignedUYU > 0 ? 'Sin destino' : 'Apartaste de más'}</span>
                  <span className="tx-meta">
                    {x.unassignedUYU > 0
                      ? 'Ahorro que todavía no es para nada en particular'
                      : 'Las metas suman más que el saldo'}
                  </span>
                </span>
                <span className="tx-amount">{money(Math.round(x.unassignedUYU))}</span>
                {x.unassignedUYU > 0 && onAssign && (
                  <button className="btn btn-ghost small" onClick={() => onAssign(x)}>
                    Asignar
                  </button>
                )}
              </div>
            )}
            {x.invest && (
              <div className="tx-row static sub-row">
                <span className="tx-icon">💹</span>
                <span className="tx-main">
                  <span className="tx-title">Intereses estimados: {money(x.invest.accrued, x.account.currency)}</span>
                  <span className="tx-meta">
                    Desde el {fmtDate(x.invest.since)}
                    {x.invest.atMaturity !== null
                      ? ` · al vencer tendrías ${money(Math.round(x.invest.atMaturity), x.account.currency)}`
                      : ''}
                  </span>
                </span>
                <button
                  className="btn btn-ghost small"
                  onClick={() =>
                    openMenu(x.account.name, [
                      {
                        label: 'Anotar los intereses',
                        hint: 'Cuando el banco los acredita: quedan en la inversión',
                        run: () =>
                          openPrompt({
                            title: 'Intereses que cobraste',
                            label: `Monto (${x.account.currency === 'USD' ? 'US$' : '$'})`,
                            initial: String(x.invest!.accrued).replace('.', ','),
                            onSubmit: (v) => {
                              if (v <= 0) return 'Tiene que ser mayor a 0';
                              registerInterest(x.account, v, today);
                            },
                          }),
                      },
                      { label: 'Lo renové por 30 días', run: () => renewInvestment(x.account, 30, today) },
                      { label: 'Lo renové por 90 días', run: () => renewInvestment(x.account, 90, today) },
                      { label: 'Lo renové por 1 año', run: () => renewInvestment(x.account, 365, today) },
                      {
                        label: 'Lo pasé a mi cuenta',
                        run: () =>
                          openTxForm({
                            preset: {
                              kind: 'transfer',
                              accountId: x.account.id,
                              toAccountId: mainAccount(data)?.id ?? null,
                              amount: x.balance,
                              currency: x.account.currency,
                            },
                          }),
                      },
                    ])
                  }
                >
                  Opciones
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {rate && places.some((x) => x.account.currency === 'USD') && (
        <p className="muted small">Los dólares, a {rate.toLocaleString('es-UY')} (la cotización de Ajustes).</p>
      )}
    </div>
  );
}

/** Asignar a una meta plata guardada sin destino. */
function AssignSheet({ place, onClose }: { place: Place; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const rate = data.settings.usdRate;
  const balances = goalBalances(data);
  // Las metas de esta cuenta, o las que todavía no tienen plata en otro lado (no se mudan metas con plata).
  const goals = data.goals.filter(
    (g) =>
      !g.archived &&
      (g.accountId === place.account.id ||
        !g.accountId ||
        Math.abs(balances.find((x) => x.goalId === g.id)?.balance ?? 0) < 0.005),
  );
  const [goalId, setGoalId] = useState<string | null>(
    goals.find((g) => g.accountId === place.account.id)?.id ??
      goals.find((g) => g.currency === place.account.currency)?.id ??
      'new',
  );
  const [newName, setNewName] = useState('');
  const goal = goals.find((g) => g.id === goalId);
  const currency = goal?.currency ?? place.account.currency;
  const maxIn = (c: Goal['currency']) => round2(c === 'USD' ? place.unassignedUYU / rate : place.unassignedUYU);
  const [amount, setAmount] = useState(String(maxIn(currency)).replace('.', ','));
  const save = () => {
    const v = parseAmount(amount);
    if (!v || v <= 0) return toast('Poné el monto', { tone: 'error' });
    let target = goal;
    if (goalId === 'new') {
      if (!newName.trim()) return toast('Poné el nombre de la meta', { tone: 'error' });
      target = {
        id: newId(),
        updatedAt: '',
        name: newName.trim(),
        currency: place.account.currency,
        target: null,
        targetMonth: null,
        startMonth: null,
        accountId: place.account.id,
        color: '#0ea5e9',
        icon: '🎯',
        archived: false,
      };
      mutate('goal', 'upsert', target);
    } else if (target && target.accountId !== place.account.id) {
      target = { ...target, accountId: place.account.id };
      mutate('goal', 'upsert', target);
    }
    if (!target) return toast('Elegí la meta', { tone: 'error' });
    assignToGoal(data, place.account, target, v, today);
    onClose();
  };
  return (
    <Sheet
      title={`Asignar plata de ${place.account.name}`}
      onClose={onClose}
      footer={
        <button className="btn btn-primary grow" onClick={save}>
          Asignar
        </button>
      }
    >
      <div className="form">
        <p className="muted small">
          No mueve plata ni toca el presupuesto del mes: solo dice para qué es lo que ya tenés guardado en {place.account.name}.
        </p>
        <Field label="¿Para qué es?">
          <Chips
            label="Meta"
            value={goalId}
            onChange={(v) => {
              setGoalId(v);
              const g = goals.find((x) => x.id === v);
              setAmount(String(maxIn(g?.currency ?? place.account.currency)).replace('.', ','));
            }}
            options={[
              ...goals.map((g) => ({ value: g.id as string | null, label: g.name, icon: g.icon, color: g.color })),
              { value: 'new' as string | null, label: 'Una meta nueva', icon: '➕' },
            ]}
          />
        </Field>
        {goalId === 'new' && (
          <Field label="Nombre de la meta" hint="Ej: Fondo de emergencia, Auto, Viaje">
            <input data-autofocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
          </Field>
        )}
        <Field
          label={`Monto (${currency === 'USD' ? 'US$' : '$'})`}
          hint={`Sin destino: ${money(Math.round(place.unassignedUYU))}`}
        >
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

/** Repartir el cobro: lo que tiene fecha, las metas y lo que queda por día. */
export function PaydaySheet({ onClose, amount: initial }: { onClose: () => void; amount?: number }) {
  const data = useData();
  const today = useToday();
  const b = useMonth(monthOf(today));
  const p = usePlata();
  const lastSalary = data.transactions.find((t) => t.kind === 'income' && t.linkKind === 'salary' && t.date <= today);
  const [amountText, setAmountText] = useState(String(Math.round(initial ?? lastSalary?.amount ?? p.nextIncome?.amount ?? 0)));
  const income = parseAmount(amountText) ?? 0;
  const pending = useMemo(
    () => goalMonths(data, today).map((g) => ({ goal: g.goal, pending: g.pendingThisMonth })),
    [data, today],
  );
  const plan = useMemo(() => paydayPlan(data, b, today, income, pending), [data, b, today, income, pending]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const actionLines = plan.lines.filter((l) => l.action && !skip.has(l.id));
  const from = lastSalary?.accountId ?? mainAccount(data)?.id ?? null;
  return (
    <Sheet
      title="Repartir el cobro"
      onClose={onClose}
      footer={
        <button
          className="btn btn-primary grow"
          disabled={!actionLines.length}
          onClick={() => {
            if (doPayday(data, actionLines, from, today)) onClose();
          }}
        >
          Depositar en las metas ({actionLines.length})
        </button>
      }
    >
      <div className="form">
        <Field label="¿Cuánto cobraste?">
          <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </Field>
        <p className="muted small">
          Primero lo que tiene fecha hasta el próximo cobro ({fmtDate(plan.until)}), después tus metas («pagate primero») y lo de
          cada tanto. Lo que queda es para gastar.
        </p>
        <div className="card list">
          {plan.lines.map((l) => (
            <div key={l.id} className={`tx-row static ${skip.has(l.id) ? 'is-undone' : ''}`}>
              <span className="tx-icon">
                {l.kind === 'goal' || l.kind === 'saving'
                  ? '🐷'
                  : l.kind === 'provision'
                    ? '🗓️'
                    : l.kind === 'card'
                      ? '💳'
                      : l.kind === 'loan'
                        ? '🏦'
                        : '📅'}
              </span>
              <span className="tx-main">
                <span className="tx-title">{l.name}</span>
                <span className="tx-meta">
                  {l.currency === 'USD' && l.original ? `US$ ${l.original.toLocaleString('es-UY')} · ` : ''}
                  {l.note}
                </span>
              </span>
              <span className="tx-amount">{money(Math.round(l.amount))}</span>
              {l.action && (
                <input
                  type="checkbox"
                  aria-label={`Depositar en ${l.name}`}
                  checked={!skip.has(l.id)}
                  onChange={(e) => {
                    const next = new Set(skip);
                    if (e.target.checked) next.delete(l.id);
                    else next.add(l.id);
                    setSkip(next);
                  }}
                />
              )}
            </div>
          ))}
        </div>
        <div className={`note ${plan.left < 0 ? 'note-bad' : 'note-good'}`}>
          {plan.left >= 0 ? (
            <>
              Te quedan <strong>{money(Math.round(plan.left))}</strong> para gastar hasta el {fmtDate(plan.until)}:{' '}
              <strong>{money(Math.round(plan.perDay ?? 0))} por día</strong> ({plan.days} días).
            </>
          ) : (
            <>No alcanza: te faltan {money(Math.round(-plan.left))}. Achicá alguna meta este mes o revisá los gastos.</>
          )}
        </div>
        <p className="muted small">
          Los fijos, la tarjeta y las cuotas no se mueven ahora: quedan reservados en tu cuenta para el día que salen. Las metas
          se depositan con un toque (los dólares, a {data.settings.usdRate.toLocaleString('es-UY')}).
        </p>
        <button className="btn btn-ghost" onClick={() => navigate('/ahorro')}>
          Cambiar metas
        </button>
      </div>
    </Sheet>
  );
}
