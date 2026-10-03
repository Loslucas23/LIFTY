import { monthLabel, monthOf, weightStats } from '@lifty/core';
import { openBudgetEditor, openBudgetWizard } from '../components/Editors';
import { Icon } from '../components/Icon';
import { PlannedList } from '../components/Planned';
import { openTxForm } from '../components/TxForm';
import { TxRow } from '../components/TxRow';
import { Amount, Empty, Progress, Section } from '../components/ui';
import { money } from '../lib/format';
import { useData, useLookups, useMonth, useToday } from '../lib/store';

export function Home() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const b = useMonth(month);
  const { category } = useLookups();
  // Lo más urgente primero (lo vencido arriba).
  const pending = [...b.income.planned, ...b.fixed.items]
    .filter((l) => !l.confirmed)
    .sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
  const limits = b.categories.filter((c) => c.limit !== null).sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0));
  const recent = data.transactions.slice(0, 6);
  const name = data.settings.ownerName;
  const weight = weightStats(data.weights, { heightCm: data.settings.heightCm, goalKg: data.settings.goalWeightKg });
  const empty = data.transactions.length === 0 && data.incomes.length === 0 && data.fixed.length === 0;

  return (
    <div className="page">
      <header className="greeting">
        <p className="muted">{monthLabel(month)}</p>
        <h1>{name ? `Hola, ${name}` : 'Hola'} 👋</h1>
      </header>

      <section className={`hero ${b.result < 0 ? 'hero-neg' : ''}`}>
        <p className="hero-label">Te queda este mes</p>
        <p className="hero-value">{money(b.result)}</p>
        {b.daily && (
          <p className="hero-sub">
            {b.daily.perDay > 0 ? (
              <>
                Podés gastar <strong>{money(b.daily.perDay)}</strong> por día
                {b.daily.basis === 'budget' ? ' según tu presupuesto' : ''} · quedan {b.daily.daysLeft} días
              </>
            ) : b.result < 0 ? (
              <>Estás {money(-b.result)} por debajo: revisá el presupuesto</>
            ) : (
              <>Ya usaste todo tu presupuesto de este mes</>
            )}
          </p>
        )}
        <div className="hero-stats">
          <a href={`#/presupuesto/${month}`}>
            <span>Ingresos</span>
            <strong>{money(Math.round(b.income.total))}</strong>
          </a>
          <a href={`#/presupuesto/${month}`}>
            <span>Gastos</span>
            <strong>{money(Math.round(b.expenses))}</strong>
          </a>
          <a href="#/ahorro">
            <span>Ahorro</span>
            <strong>{money(Math.round(b.savings.total))}</strong>
          </a>
        </div>
        {b.carryover.source !== 'none' && b.carryover.amount !== 0 && (
          <p className="hero-foot">Incluye {money(b.carryover.amount)} que vienen del mes anterior</p>
        )}
      </section>

      <div className="quick-actions">
        <button className="qa qa-expense" onClick={() => openTxForm({ preset: { kind: 'expense' } })}>
          <span>−</span> Gasto
        </button>
        <button className="qa qa-income" onClick={() => openTxForm({ preset: { kind: 'income' } })}>
          <span>+</span> Ingreso
        </button>
        <button className="qa" onClick={() => openTxForm({ preset: { kind: 'saving' } })}>
          <span>🐷</span> Ahorro
        </button>
        <a className="qa" href={`#/presupuesto/${month}`}>
          <span>
            <Icon name="budget" size={18} />
          </span>{' '}
          Presupuesto
        </a>
      </div>

      {empty && (
        <Section>
          <Empty icon="wallet" title="Empecemos">
            <p>
              Armá tu presupuesto en 3 pasos (sueldo, gastos fijos y cuánto querés gastar en cada cosa) o traé todo desde tu
              planilla de Excel.
            </p>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={() => openBudgetWizard(month)}>
                Armar mi presupuesto
              </button>
              <a className="btn" href="#/importar">
                Importar Excel
              </a>
            </div>
          </Empty>
        </Section>
      )}

      {pending.length > 0 && (
        <Section
          title="Pendientes del mes"
          action={
            <a className="link" href={`#/presupuesto/${month}`}>
              Ver todo
            </a>
          }
        >
          <PlannedList lines={pending.slice(0, 5)} month={month} />
        </Section>
      )}

      {limits.length > 0 ? (
        <Section
          title="Te queda en cada categoría"
          action={
            <a className="link" href={`#/presupuesto/${month}`}>
              Ver presupuesto
            </a>
          }
        >
          <ul className="limits">
            {limits.map((c) => {
              const cat = c.categoryId ? category.get(c.categoryId) : undefined;
              const over = (c.remaining ?? 0) < 0;
              return (
                <li key={c.categoryId}>
                  <button className="cat-row" onClick={() => c.categoryId && openBudgetEditor(month, c.categoryId)}>
                    <div className="limit-head">
                      <span>
                        {cat?.icon} {cat?.name}
                      </span>
                      <span className={over ? 'text-bad' : ''}>
                        {over ? (
                          `Te pasaste ${money(-(c.remaining ?? 0))}`
                        ) : (
                          <>
                            Te quedan <strong>{money(c.remaining ?? 0)}</strong>
                          </>
                        )}
                        <span className="muted"> de {money(c.limit!)}</span>
                      </span>
                    </div>
                    <Progress value={c.spent} max={c.limit!} label={`${cat?.name}: gastado`} />
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : (
        !empty && (
          <Section>
            <button className="card tile-link cta-tile" onClick={() => openBudgetWizard(month)}>
              <Icon name="budget" />
              <span className="tile-text">
                <strong>Poné un presupuesto por categoría</strong>
                <span className="muted small">
                  Decí cuánto querés gastar en comida, salidas, transporte… y Lifty te avisa cuánto te queda.
                </span>
              </span>
              <Icon name="right" size={18} />
            </button>
          </Section>
        )
      )}

      <Section
        title="Últimos movimientos"
        action={
          <a className="link" href="#/movimientos">
            Ver todos
          </a>
        }
      >
        {recent.length ? (
          <div className="card list">
            {recent.map((t) => (
              <TxRow key={t.id} tx={t} showDate />
            ))}
          </div>
        ) : (
          <Empty icon="list" title="Todavía no hay movimientos">
            <button className="btn btn-primary" onClick={() => openTxForm()}>
              <Icon name="plus" /> Cargar el primero
            </button>
          </Empty>
        )}
      </Section>

      {weight.latest && (
        <Section>
          <a className="card tile-link" href="#/peso">
            <Icon name="scale" />
            <span className="tile-text">
              <strong>Peso</strong>
              <span className="muted small">
                {weight.change7 !== null
                  ? `${weight.change7 > 0 ? '+' : weight.change7 < 0 ? '−' : ''}${Math.abs(weight.change7).toLocaleString('es-UY')} kg en la semana`
                  : 'Último pesaje'}
              </span>
            </span>
            <strong>{weight.latest.kg.toLocaleString('es-UY', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg</strong>
          </a>
        </Section>
      )}

      {b.card.total > 0 && (
        <Section>
          <a className="card tile-link" href="#/tarjeta">
            <Icon name="card" />
            <span className="tile-text">
              <strong>Tarjeta este mes</strong>
              <span className="muted small">
                {b.card.items.length} {b.card.items.length === 1 ? 'cuota o compra' : 'cuotas o compras'}
              </span>
            </span>
            <Amount value={b.card.total} />
          </a>
        </Section>
      )}
    </div>
  );
}
