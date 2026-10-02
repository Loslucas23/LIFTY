import { monthLabel, monthOf } from '@lifty/core';
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
  const pending = [...b.income.planned, ...b.fixed.items].filter((l) => !l.confirmed);
  const limits = b.categories.filter((c) => c.limit);
  const recent = data.transactions.slice(0, 6);
  const name = data.settings.ownerName;
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
            {b.result > 0 ? (
              <>
                Podés gastar <strong>{money(b.daily.perDay)}</strong> por día · quedan {b.daily.daysLeft} días
              </>
            ) : (
              <>Estás {money(-b.result)} por debajo: revisá el presupuesto</>
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

      {empty && (
        <Section>
          <Empty icon="wallet" title="Empecemos">
            <p>Cargá tu sueldo y tus gastos fijos para armar el presupuesto, o traé todo desde tu planilla de Excel.</p>
            <div className="btn-row">
              <a className="btn btn-primary" href="#/sueldos">
                Cargar sueldo
              </a>
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

      {limits.length > 0 && (
        <Section title="Topes por categoría">
          <ul className="limits">
            {limits.map((c) => {
              const cat = c.categoryId ? category.get(c.categoryId) : undefined;
              return (
                <li key={c.categoryId}>
                  <div className="limit-head">
                    <span>
                      {cat?.icon} {cat?.name}
                    </span>
                    <span className={c.spent > c.limit! ? 'text-bad' : 'muted'}>
                      {money(c.spent)} de {money(c.limit!)}
                    </span>
                  </div>
                  <Progress value={c.spent} max={c.limit!} label={`${cat?.name}: gastado`} />
                </li>
              );
            })}
          </ul>
        </Section>
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
