import { useState } from 'react';
import { isActiveIn, monthOf, newId, ruleSchema, suggestRules, type AutoLog } from '@lifty/core';
import { Icon } from '../components/Icon';
import { Chips, Empty, Field, PageHeader, Section, Toggle, toast } from '../components/ui';
import { undoAuto, useAutopilot } from '../lib/autopilot';
import { money } from '../lib/format';
import { useData, useLookups, useToday } from '../lib/store';
import { mutate } from '../lib/sync';

/** Corre el piloto automático en segundo plano (va en la app, no dibuja nada). */
export function AutopilotRunner() {
  useAutopilot();
  return null;
}

const KIND_ICON: Record<AutoLog['kind'], string> = {
  fixed: '📅',
  income: '💼',
  load: '🍽️',
  saving: '🐷',
  shop: '🛒',
  category: '🏷️',
};

/** Piloto automático: qué hace Lifty solo, las reglas de categorías y lo que ya hizo. */
export function Autopilot() {
  const data = useData();
  const today = useToday();
  const month = monthOf(today);
  const { category } = useLookups();
  const st = data.settings;
  const fixed = data.fixed.filter((f) => !f.archived && isActiveIn(month, f.startMonth, f.endMonth));
  const incomes = data.incomes.filter((i) => !i.archived && isActiveIn(month, i.startMonth, i.endMonth));
  const food = data.accounts.filter((a) => a.type === 'food' && !a.archived);
  const cards = data.accounts.filter((a) => a.type === 'credit' && !a.archived);
  const goals = data.goals.filter((g) => !g.archived);
  const logs = data.autoLogs.slice(0, 40);
  const active =
    fixed.filter((f) => f.autopay).length +
    incomes.filter((i) => i.autoConfirm).length +
    food.filter((a) => a.autoLoad).length +
    cards.filter((a) => a.autopay !== false).length +
    Number(st.autoSave) +
    Number(st.autoShop) +
    data.rules.length;

  return (
    <div className="page narrow">
      <PageHeader
        title="Piloto automático"
        subtitle={`Lo que Lifty hace solo por vos · ${active} cosa${active === 1 ? '' : 's'} activada${active === 1 ? '' : 's'}`}
        back="/mas"
      />
      <p className="muted small">
        Cada cosa que hace queda abajo, en "Lo que hizo", y se puede deshacer (si la deshacés, no la vuelve a hacer).
      </p>

      <Section title="📅 Gastos fijos que se debitan solos">
        {fixed.length === 0 ? (
          <p className="muted small">No tenés gastos fijos este mes.</p>
        ) : (
          <div className="card list">
            {fixed.map((f) => (
              <div key={f.id} className="tx-row static">
                <span className="tx-main">
                  <span className="tx-title">{f.name}</span>
                  <span className="tx-meta">
                    {money(f.amount, f.currency)}
                    {f.dayOfMonth ? ` · vence el ${f.dayOfMonth}` : ' · ponele día de vencimiento para activarlo'}
                  </span>
                </span>
                <Toggle
                  checked={f.autopay}
                  onChange={(v) => mutate('fixed', 'upsert', { ...f, autopay: v })}
                  label={`Se debita solo: ${f.name}`}
                  disabled={!f.dayOfMonth}
                  compact
                />
              </div>
            ))}
          </div>
        )}
        <p className="muted small">El día que vence, lo marca pagado (con la cuenta del gasto fijo).</p>
      </Section>

      <Section title="💼 Sueldos que se cobran solos">
        {incomes.length === 0 ? (
          <p className="muted small">No tenés sueldos este mes.</p>
        ) : (
          <div className="card list">
            {incomes.map((i) => (
              <div key={i.id} className="tx-row static">
                <span className="tx-main">
                  <span className="tx-title">{i.name}</span>
                  <span className="tx-meta">{i.payDay ? `se cobra el ${i.payDay}` : 'ponele día de cobro para activarlo'}</span>
                </span>
                <Toggle
                  checked={i.autoConfirm}
                  onChange={(v) => mutate('income', 'upsert', { ...i, autoConfirm: v })}
                  label={`Se cobra solo: ${i.name}`}
                  disabled={!i.payDay}
                  compact
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {(food.length > 0 || cards.length > 0) && (
        <Section title="💳 Tarjetas">
          <div className="card list">
            {food.map((a) => (
              <div key={a.id} className="tx-row static">
                <span className="tx-main">
                  <span className="tx-title">{a.name}: carga sola</span>
                  <span className="tx-meta">
                    {a.monthlyLoad && a.loadDay
                      ? `${money(a.monthlyLoad)} el día ${a.loadDay}`
                      : 'poné la carga y el día en la tarjeta para activarlo'}
                  </span>
                </span>
                <Toggle
                  checked={a.autoLoad}
                  onChange={(v) => mutate('account', 'upsert', { ...a, autoLoad: v })}
                  label={`Carga sola: ${a.name}`}
                  disabled={!a.monthlyLoad || !a.loadDay}
                  compact
                />
              </div>
            ))}
            {cards.map((a) => (
              <div key={a.id} className="tx-row static">
                <span className="tx-main">
                  <span className="tx-title">{a.name}: débito del resumen</span>
                  <span className="tx-meta">Cada resumen vencido se da por pagado (si pagás el mínimo, apagalo)</span>
                </span>
                <Toggle
                  checked={a.autopay !== false}
                  onChange={(v) => mutate('account', 'upsert', { ...a, autopay: v })}
                  label={`Débito automático: ${a.name}`}
                  compact
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="🐷 Ahorro automático">
        <div className="card pad form">
          <Toggle
            checked={st.autoSave}
            onChange={(v) => mutate('settings', 'upsert', { ...st, autoSave: v })}
            label="Cuando cobro, pasar al ahorro lo que falta para la meta del mes"
            disabled={st.savingsMode === 'none'}
          />
          {st.savingsMode === 'none' ? (
            <p className="muted small">
              Primero elegí cuánto querés ahorrar por mes en{' '}
              <a className="link" href="#/ahorro">
                Ahorro
              </a>
              .
            </p>
          ) : (
            st.autoSave &&
            goals.length > 1 && (
              <Field label="¿A qué meta?">
                <Chips
                  label="Meta"
                  value={st.autoSaveGoalId}
                  onChange={(v) => mutate('settings', 'upsert', { ...st, autoSaveGoalId: v })}
                  options={goals.map((g) => ({ value: g.id as string | null, label: g.name, icon: g.icon }))}
                />
              </Field>
            )
          )}
        </div>
      </Section>

      <Section title="🛒 Lista de compras automática">
        <div className="card pad">
          <Toggle
            checked={st.autoShop}
            onChange={(v) => mutate('settings', 'upsert', { ...st, autoShop: v })}
            label="Lo que se termina en el stock va solo a la lista de compras"
            disabled={!data.stockItems.length}
          />
          {!data.stockItems.length && <p className="muted small">Necesita productos en el Stock.</p>}
        </div>
      </Section>

      <RulesSection />

      <Section title="Lo que hizo">
        {logs.length === 0 ? (
          <Empty icon="check" title="Todavía nada">
            Cuando active algo, lo vas a ver acá.
          </Empty>
        ) : (
          <div className="card list">
            {logs.map((l) => (
              <div key={l.id} className={`tx-row static ${l.undone ? 'is-undone' : ''}`}>
                <span className="tx-icon">{KIND_ICON[l.kind]}</span>
                <span className="tx-main">
                  <span className="tx-title">{l.title}</span>
                  <span className="tx-meta">
                    {l.date.split('-').reverse().join('/')}
                    {l.undone ? ' · deshecho' : ''}
                  </span>
                </span>
                {!l.undone && (
                  <button className="btn btn-ghost" onClick={() => undoAuto(l)}>
                    Deshacer
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function RulesSection() {
  const data = useData();
  const { category } = useLookups();
  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const expense = data.categories.filter((c) => !c.archived && c.kind === 'expense');
  const suggestions = suggestRules(data);
  const add = (contains: string, cat: string | null) => {
    const r = ruleSchema.safeParse({ id: newId(), updatedAt: '', contains, categoryId: cat });
    if (!r.success) return toast('Escribí una palabra (2 letras o más) y elegí la categoría', { tone: 'error' });
    mutate('rule', 'upsert', r.data);
    toast(`Regla: "${r.data.contains}" → ${category.get(r.data.categoryId)?.name ?? ''}`);
    setText('');
  };
  return (
    <Section title="🏷️ Reglas de categorías">
      <p className="muted small">
        Si la descripción contiene la palabra, va a esa categoría: al cargar un gasto y en los que quedaron sin categoría.
      </p>
      {data.rules.length > 0 && (
        <div className="card list">
          {data.rules.map((r) => (
            <div key={r.id} className="tx-row static">
              <span className="tx-main">
                <span className="tx-title">"{r.contains}"</span>
                <span className="tx-meta">
                  → {category.get(r.categoryId)?.icon} {category.get(r.categoryId)?.name ?? 'categoría borrada'}
                </span>
              </span>
              <button
                className="icon-btn"
                aria-label={`Borrar la regla ${r.contains}`}
                onClick={() => {
                  mutate('rule', 'delete', r.id);
                  toast('Regla borrada', { action: { label: 'Deshacer', run: () => mutate('rule', 'upsert', r) } });
                }}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="card pad form">
        <Field label="Si dice…">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ej: uber, farmacia, disco" maxLength={40} />
        </Field>
        <Field label="…va a">
          <Chips
            label="Categoría"
            value={categoryId}
            onChange={setCategoryId}
            options={expense.map((c) => ({ value: c.id as string | null, label: c.name, icon: c.icon, color: c.color }))}
          />
        </Field>
        <button className="btn btn-primary" onClick={() => add(text, categoryId)}>
          <Icon name="plus" /> Agregar regla
        </button>
      </div>
      {suggestions.length > 0 && (
        <>
          <p className="muted small">Sugeridas (las usaste siempre en la misma categoría):</p>
          <div className="chips">
            {suggestions.map((s) => (
              <button key={s.contains} className="chip chip-add" onClick={() => add(s.contains, s.categoryId)}>
                <Icon name="plus" size={14} /> "{s.contains}" → {category.get(s.categoryId)?.name} ({s.count})
              </button>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
