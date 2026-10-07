import { useState } from 'react';
import {
  equalSplit,
  groupExpenseSchema,
  groupReminderText,
  groupSchema,
  groupSummary,
  groupTotals,
  mainAccount,
  ME,
  newId,
  todayISO,
  whatsappLink,
  type Currency,
  type Group,
  type GroupExpense,
  type GroupMember,
  type GroupSummary,
} from '@lifty/core';
import { Icon } from '../components/Icon';
import { Chips, Empty, Field, PageHeader, Section, Segmented, Sheet, toast } from '../components/ui';
import { deleteGroupExpense, saveGroup, saveGroupExpense } from '../lib/groups';
import { money, parseAmount } from '../lib/format';
import { cached, useData, useToday } from '../lib/store';

const ddmm = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
const nameOf = (g: Group, id: string) => (id === ME ? 'Vos' : (g.members.find((m) => m.id === id)?.name ?? '?'));

function balanceText(b: number, cur: Currency) {
  if (Math.abs(b) < 0.5) return { text: 'Están a mano', tone: '' };
  return b > 0
    ? { text: `Te deben ${money(b, cur)}`, tone: 'text-income' }
    : { text: `Debés ${money(-b, cur)}`, tone: 'text-expense' };
}

/** Gastos en grupo: la casa, la pareja, un viaje con amigos. */
export function Groups() {
  const data = useData();
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  const active = data.groups.filter((g) => !g.archived);
  const old = data.groups.filter((g) => g.archived);
  const totals = cached(data, 'group-totals', () => groupTotals(data));
  return (
    <div className="page narrow">
      <PageHeader
        title="Gastos en grupo"
        subtitle="Quién puso cuánto y cómo quedar a mano"
        actions={
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> Nuevo grupo
          </button>
        }
      />
      {active.length === 0 ? (
        <Empty icon="people" title="Todavía no tenés grupos">
          Para la casa, la pareja o un viaje con amigos: anotás quién pagó cada cosa y Lifty te dice quién le debe a quién y cómo
          saldar con la menor cantidad de pagos. En tu presupuesto cuenta solo tu parte.
        </Empty>
      ) : (
        <>
          {(totals.UYU.owedToMe > 0 || totals.UYU.iOwe > 0) && (
            <div className="stat-row">
              <div className="card stat">
                <span>Te deben</span>
                <strong className="text-income">{money(totals.UYU.owedToMe)}</strong>
              </div>
              <div className="card stat">
                <span>Debés</span>
                <strong className="text-expense">{money(totals.UYU.iOwe)}</strong>
              </div>
            </div>
          )}
          <div className="card list">
            {active.map((g) => (
              <GroupRow key={g.id} group={g} />
            ))}
          </div>
        </>
      )}
      {old.length > 0 && (
        <Section title="Terminados">
          <div className="card list">
            {old.map((g) => (
              <GroupRow key={g.id} group={g} />
            ))}
          </div>
        </Section>
      )}
      {editing && <GroupForm group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function GroupRow({ group }: { group: Group }) {
  const data = useData();
  const s = groupSummary(data, group);
  const b = balanceText(s.myBalance, group.currency);
  return (
    <a className="tx-row" href={`#/grupos/${group.id}`}>
      <span className="tx-icon">{group.icon}</span>
      <span className="tx-main">
        <span className="tx-title">{group.name}</span>
        <span className="tx-meta">
          {group.members.length} personas · {s.count} gastos · {money(s.total, group.currency)}
        </span>
      </span>
      <span className={`tx-amount small ${b.tone}`}>{b.text}</span>
    </a>
  );
}

export function GroupDetail({ id }: { id: string }) {
  const data = useData();
  const today = useToday();
  const group = data.groups.find((g) => g.id === id);
  const [form, setForm] = useState<
    | { type: 'expense'; expense: GroupExpense | null }
    | { type: 'settle'; from: string; to: string; amount: number }
    | { type: 'group' }
    | null
  >(null);
  if (!group)
    return (
      <div className="page narrow">
        <PageHeader title="Grupo" back="/grupos" />
        <Empty icon="people" title="No encontré ese grupo" />
      </div>
    );
  const s = groupSummary(data, group);
  const cur = group.currency;
  const expenses = data.groupExpenses.filter((e) => e.groupId === group.id);
  const me = balanceText(s.myBalance, cur);
  return (
    <div className="page narrow">
      <PageHeader
        title={`${group.icon} ${group.name}`}
        subtitle={s.period ? `Viaje: ${s.period.name}` : `${group.members.length} personas`}
        back="/grupos"
        actions={
          <>
            <button className="btn btn-primary" onClick={() => setForm({ type: 'expense', expense: null })}>
              <Icon name="plus" /> Gasto
            </button>
            <button className="btn" onClick={() => setForm({ type: 'group' })}>
              Editar
            </button>
          </>
        }
      />
      <div className="stat-row">
        <div className="card stat">
          <span>Gastaron entre todos</span>
          <strong>{money(s.total, cur)}</strong>
        </div>
        <div className="card stat">
          <span>Tu parte</span>
          <strong>{money(s.myShare, cur)}</strong>
        </div>
        <div className="card stat">
          <span>Vos</span>
          <strong className={me.tone}>{me.text}</strong>
        </div>
      </div>

      {s.payments.length > 0 && (
        <Section title="Para quedar a mano">
          <p className="muted small">La menor cantidad de pagos: el que más debe le paga al que más le deben.</p>
          <div className="card list">
            {s.payments.map((p) => (
              <PaymentRow
                key={`${p.from.id}-${p.to.id}`}
                s={s}
                p={p}
                onSettle={() => setForm({ type: 'settle', from: p.from.id, to: p.to.id, amount: p.amount })}
              />
            ))}
          </div>
        </Section>
      )}

      <Section title="Cómo quedan">
        <div className="card list">
          {s.balances.map((b) => {
            const t = balanceText(b.balance, cur);
            return (
              <div key={b.member.id} className="tx-row">
                <span className="tx-main">
                  <span className="tx-title">{b.member.id === ME ? 'Vos' : b.member.name}</span>
                  <span className="tx-meta">
                    Puso {money(b.paid, cur)} · le tocaba {money(b.share, cur)}
                  </span>
                </span>
                <span className={`tx-amount small ${b.balance > 0.5 ? 'text-income' : b.balance < -0.5 ? 'text-expense' : ''}`}>
                  {b.member.id === ME
                    ? t.text
                    : Math.abs(b.balance) < 0.5
                      ? 'A mano'
                      : b.balance > 0
                        ? `Le deben ${money(b.balance, cur)}`
                        : `Debe ${money(-b.balance, cur)}`}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Gastos y pagos">
        {expenses.length === 0 ? (
          <Empty icon="list" title="Todavía no hay gastos">
            Anotá quién pagó cada cosa: Lifty reparte en partes iguales (o como digas).
          </Empty>
        ) : (
          <div className="card list">
            {expenses.map((e) => {
              const mine = e.split.find((x) => x.memberId === ME)?.amount ?? 0;
              return (
                <button key={e.id} className="tx-row wrap-text" onClick={() => setForm({ type: 'expense', expense: e })}>
                  <span className="tx-icon">{e.kind === 'settlement' ? '🤝' : '🧾'}</span>
                  <span className="tx-main">
                    <span className="tx-title">
                      {e.kind === 'settlement'
                        ? `${nameOf(group, e.paidBy)} le pagó a ${nameOf(group, e.split[0]?.memberId ?? '')}`
                        : e.description || 'Gasto'}
                    </span>
                    <span className="tx-meta">
                      {e.date === today ? 'Hoy' : ddmm(e.date)}
                      {e.kind === 'expense'
                        ? ` · ${e.paidBy === ME ? 'pagaste vos' : `pagó ${nameOf(group, e.paidBy)}`} · tu parte ${money(mine, cur)}`
                        : ''}
                    </span>
                  </span>
                  <span className="tx-amount">{money(e.amount, cur)}</span>
                </button>
              );
            })}
          </div>
        )}
      </Section>

      {form?.type === 'expense' && <ExpenseForm group={group} expense={form.expense} onClose={() => setForm(null)} />}
      {form?.type === 'settle' && (
        <SettleForm group={group} from={form.from} to={form.to} amount={form.amount} onClose={() => setForm(null)} />
      )}
      {form?.type === 'group' && <GroupForm group={group} onClose={() => setForm(null)} />}
    </div>
  );
}

function PaymentRow({ s, p, onSettle }: { s: GroupSummary; p: GroupSummary['payments'][number]; onSettle: () => void }) {
  const data = useData();
  const cur = s.group.currency;
  const toMe = p.to.id === ME;
  const fromMe = p.from.id === ME;
  return (
    <div className="tx-row wrap-text">
      <span className="tx-main">
        <span className="tx-title">
          {fromMe ? `Le pagás a ${p.to.name}` : toMe ? `${p.from.name} te paga` : `${p.from.name} le paga a ${p.to.name}`}
        </span>
        <span className="tx-meta">{money(p.amount, cur)}</span>
      </span>
      <span className="btn-row tight">
        {toMe && (
          <a
            className="btn btn-sm"
            href={whatsappLink(groupReminderText(s, p.from.id, data.settings.ownerName), p.from.phone)}
            target="_blank"
            rel="noreferrer"
          >
            💬 Recordar
          </a>
        )}
        <button className="btn btn-sm" onClick={onSettle}>
          Ya pagó
        </button>
      </span>
    </div>
  );
}

/** Cuentas tuyas para pagar o cobrar (sin la tarjeta de alimentación ni la plata guardada). */
function useMyAccounts(currency: Currency) {
  const data = useData();
  return data.accounts.filter(
    (a) => !a.archived && a.type !== 'food' && !a.reserved && (a.currency === currency || a.type === 'credit'),
  );
}

function ExpenseForm({ group, expense, onClose }: { group: Group; expense: GroupExpense | null; onClose: () => void }) {
  const data = useData();
  const cur = group.currency;
  const isSettle = expense?.kind === 'settlement';
  const accounts = useMyAccounts(cur);
  const [description, setDescription] = useState(expense?.description ?? '');
  const [amountText, setAmountText] = useState(expense ? String(expense.amount).replace('.', ',') : '');
  const [date, setDate] = useState(expense?.date ?? todayISO());
  const [paidBy, setPaidBy] = useState(expense?.paidBy ?? ME);
  const [among, setAmong] = useState<string[]>(expense ? expense.split.map((x) => x.memberId) : group.members.map((m) => m.id));
  const custom0 =
    !!expense &&
    expense.kind === 'expense' &&
    (() => {
      const eq = equalSplit(
        expense.amount,
        expense.split.map((x) => x.memberId),
      );
      return eq.some((x, i) => Math.abs(x.amount - expense.split[i].amount) > 0.01);
    })();
  const [mode, setMode] = useState<'equal' | 'custom'>(custom0 ? 'custom' : 'equal');
  const [parts, setParts] = useState<Record<string, string>>(() =>
    Object.fromEntries((expense?.split ?? []).map((x) => [x.memberId, String(x.amount).replace('.', ',')])),
  );
  const [categoryId, setCategoryId] = useState<string | null>(expense?.categoryId ?? null);
  const [accountId, setAccountId] = useState<string | null>(expense?.accountId ?? mainAccount(data)?.id ?? null);
  const amount = parseAmount(amountText) ?? 0;
  const customSum = among.reduce((s, id) => s + (parseAmount(parts[id] ?? '') ?? 0), 0);
  const cats = data.categories.filter((c) => c.kind === 'expense' && !c.archived && !c.parentId);
  const iPay = paidBy === ME;
  const iPart = among.includes(ME);

  const save = () => {
    if (amount <= 0) return toast('Poné el monto', { tone: 'error' });
    if (!among.length) return toast('Elegí entre quiénes se reparte', { tone: 'error' });
    let split = equalSplit(amount, among);
    if (mode === 'custom') {
      if (Math.abs(customSum - amount) > 0.01)
        return toast(`Las partes suman ${money(customSum, cur)}: tienen que dar ${money(amount, cur)}`, { tone: 'error' });
      split = among.map((memberId) => ({ memberId, amount: parseAmount(parts[memberId] ?? '') ?? 0 }));
    }
    const record = groupExpenseSchema.parse({
      id: expense?.id ?? newId(),
      updatedAt: '',
      groupId: group.id,
      kind: 'expense',
      date,
      description: description.trim(),
      amount,
      paidBy,
      split,
      categoryId: iPart || iPay ? categoryId : null,
      accountId: iPay ? accountId : null,
    });
    saveGroupExpense(data, group, record);
    toast(
      iPay
        ? `Anotado: pagaste ${money(amount, cur)}`
        : `Anotado: tu parte es ${money(split.find((x) => x.memberId === ME)?.amount ?? 0, cur)}`,
    );
    onClose();
  };

  if (isSettle && expense)
    return (
      <SettleForm
        group={group}
        from={expense.paidBy}
        to={expense.split[0]?.memberId ?? ME}
        amount={expense.amount}
        existing={expense}
        onClose={onClose}
      />
    );

  return (
    <Sheet
      title={expense ? 'Editar gasto' : `Gasto en ${group.name}`}
      onClose={onClose}
      footer={
        <>
          {expense && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                deleteGroupExpense(data, expense);
                onClose();
              }}
            >
              Borrar
            </button>
          )}
          <button className="btn btn-primary grow" onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="¿Qué?">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ej: Cena, súper, nafta"
            maxLength={120}
          />
        </Field>
        <div className="row">
          <Field label={`Monto (${cur === 'USD' ? 'US$' : '$'})`}>
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Fecha">
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="¿Quién pagó?">
          <Chips
            label="Quién pagó"
            value={paidBy}
            onChange={setPaidBy}
            options={group.members.map((m) => ({ value: m.id, label: m.id === ME ? 'Vos' : m.name }))}
          />
        </Field>
        {iPay && (
          <Field label="¿Con qué pagaste?">
            <Chips
              label="Cuenta"
              value={accountId}
              onChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon }))}
            />
          </Field>
        )}
        <Field label="¿Entre quiénes?">
          <div className="chips">
            {group.members.map((m) => (
              <button
                key={m.id}
                type="button"
                role="checkbox"
                aria-checked={among.includes(m.id)}
                className={`chip ${among.includes(m.id) ? 'on' : ''}`}
                onClick={() => setAmong(among.includes(m.id) ? among.filter((x) => x !== m.id) : [...among, m.id])}
              >
                {m.id === ME ? 'Vos' : m.name}
              </button>
            ))}
          </div>
        </Field>
        <Segmented
          label="Cómo se reparte"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'equal', label: 'Partes iguales' },
            { value: 'custom', label: 'Montos' },
          ]}
        />
        {mode === 'equal' ? (
          amount > 0 &&
          among.length > 0 && (
            <p className="muted small">
              {money(equalSplit(amount, among)[among.length - 1].amount, cur)} cada uno ({among.length}{' '}
              {among.length === 1 ? 'persona' : 'personas'}).
            </p>
          )
        ) : (
          <>
            {among.map((id) => (
              <Field key={id} label={nameOf(group, id)}>
                <input
                  inputMode="decimal"
                  value={parts[id] ?? ''}
                  onChange={(e) => setParts({ ...parts, [id]: e.target.value })}
                  placeholder="0"
                />
              </Field>
            ))}
            <p className={`small ${Math.abs(customSum - amount) > 0.01 ? 'text-bad' : 'muted'}`}>
              Suman {money(customSum, cur)} de {money(amount, cur)}.
            </p>
          </>
        )}
        {(iPart || iPay) && (
          <Field label="Categoría de tu parte" hint="Para tu presupuesto (cuenta solo tu parte)">
            <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)}>
              <option value="">Sin categoría</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
    </Sheet>
  );
}

function SettleForm({
  group,
  from: from0,
  to: to0,
  amount: amount0,
  existing,
  onClose,
}: {
  group: Group;
  from: string;
  to: string;
  amount: number;
  existing?: GroupExpense;
  onClose: () => void;
}) {
  const data = useData();
  const cur = group.currency;
  const accounts = useMyAccounts(cur).filter((a) => a.type !== 'credit');
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(to0);
  const [amountText, setAmountText] = useState(String(amount0).replace('.', ','));
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [accountId, setAccountId] = useState<string | null>(existing?.accountId ?? mainAccount(data)?.id ?? null);
  const involved = from === ME || to === ME;
  const save = () => {
    const amount = parseAmount(amountText) ?? 0;
    if (amount <= 0) return toast('Poné el monto', { tone: 'error' });
    if (from === to) return toast('Elegí dos personas distintas', { tone: 'error' });
    if (involved && !accountId) return toast('Elegí la cuenta', { tone: 'error' });
    const record = groupExpenseSchema.parse({
      id: existing?.id ?? newId(),
      updatedAt: '',
      groupId: group.id,
      kind: 'settlement',
      date,
      description: '',
      amount,
      paidBy: from,
      split: [{ memberId: to, amount }],
      accountId: involved ? accountId : null,
    });
    saveGroupExpense(data, group, record);
    toast(`${nameOf(group, from)} → ${nameOf(group, to)}: ${money(amount, cur)}`);
    onClose();
  };
  const people = group.members.map((m) => ({ value: m.id, label: m.id === ME ? 'Vos' : m.name }));
  return (
    <Sheet
      title="Pago para saldar"
      onClose={onClose}
      footer={
        <>
          {existing && (
            <button
              className="btn btn-danger-ghost"
              onClick={() => {
                deleteGroupExpense(data, existing);
                onClose();
              }}
            >
              Borrar
            </button>
          )}
          <button className="btn btn-primary grow" onClick={save}>
            Guardar
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="¿Quién pagó?">
          <Chips label="Quién pagó" value={from} onChange={setFrom} options={people} />
        </Field>
        <Field label="¿A quién?">
          <Chips label="A quién" value={to} onChange={setTo} options={people} />
        </Field>
        <div className="row">
          <Field label="Monto">
            <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          </Field>
          <Field label="Fecha">
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
        </div>
        {involved && (
          <Field
            label={from === ME ? '¿De qué cuenta salió?' : '¿A qué cuenta entró?'}
            hint="No es un gasto: tu parte ya se contó con cada gasto"
          >
            <Chips
              label="Cuenta"
              value={accountId}
              onChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id as string | null, label: a.name, icon: a.icon }))}
            />
          </Field>
        )}
      </div>
    </Sheet>
  );
}

function GroupForm({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const data = useData();
  const [name, setName] = useState(group?.name ?? '');
  const [icon, setIcon] = useState(group?.icon ?? '👥');
  const [currency, setCurrency] = useState<Currency>(group?.currency ?? 'UYU');
  const [members, setMembers] = useState<GroupMember[]>(
    group?.members.filter((m) => m.id !== ME) ?? [{ id: newId().slice(0, 8), name: '', phone: '' }],
  );
  const [periodId, setPeriodId] = useState<string | null>(group?.periodId ?? null);
  const used = new Set(
    data.groupExpenses.filter((e) => e.groupId === group?.id).flatMap((e) => [e.paidBy, ...e.split.map((x) => x.memberId)]),
  );
  const trips = data.periods.filter((p) => p.kind === 'vacation' && !p.archived);
  const save = (archived = group?.archived ?? false) => {
    const others = members.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim() }));
    if (!name.trim()) return toast('Ponele un nombre', { tone: 'error' });
    if (!others.length) return toast('Agregá al menos una persona', { tone: 'error' });
    const record = groupSchema.parse({
      id: group?.id ?? newId(),
      updatedAt: '',
      name: name.trim(),
      icon: icon || '👥',
      currency,
      members: [{ id: ME, name: data.settings.ownerName || 'Vos', phone: '' }, ...others],
      periodId,
      archived,
    });
    saveGroup(data, record);
    toast(archived ? 'Grupo terminado' : 'Grupo guardado');
    onClose();
    if (!group) window.location.hash = `/grupos/${record.id}`;
  };
  return (
    <Sheet
      title={group ? 'Editar grupo' : 'Nuevo grupo'}
      onClose={onClose}
      footer={
        <>
          {group && (
            <button className="btn btn-ghost" onClick={() => save(!group.archived)}>
              {group.archived ? 'Reabrir' : 'Terminar'}
            </button>
          )}
          <button className="btn btn-primary grow" onClick={() => save()}>
            Guardar
          </button>
        </>
      }
    >
      <div className="form">
        <div className="row">
          <Field label="Nombre">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Casa, Floripa 2027" maxLength={60} />
          </Field>
          <Field label="Ícono">
            <input value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 4))} maxLength={4} />
          </Field>
        </div>
        <Field label="Moneda">
          <Chips
            label="Moneda"
            value={currency}
            onChange={setCurrency}
            options={[
              { value: 'UYU' as Currency, label: 'Pesos' },
              { value: 'USD' as Currency, label: 'Dólares' },
            ]}
          />
        </Field>
        <Field label="Personas (además de vos)" hint="El celular es opcional: sirve para recordarles por WhatsApp">
          <div className="member-list">
            {members.map((m, i) => (
              <div key={m.id} className="member-row">
                <input
                  value={m.name}
                  onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Nombre"
                  maxLength={40}
                />
                <input
                  inputMode="tel"
                  value={m.phone}
                  onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))}
                  placeholder="Celular"
                  maxLength={30}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Sacar a ${m.name || 'esta persona'}`}
                  disabled={used.has(m.id)}
                  title={used.has(m.id) ? 'Tiene gastos en el grupo' : undefined}
                  onClick={() => setMembers(members.filter((_, j) => j !== i))}
                >
                  <Icon name="x" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setMembers([...members, { id: newId().slice(0, 8), name: '', phone: '' }])}
            >
              <Icon name="plus" /> Agregar persona
            </button>
          </div>
        </Field>
        {trips.length > 0 && (
          <Field label="¿Es un viaje?" hint="Tus gastos del grupo llevan la etiqueta del viaje y se ven en Épocas">
            <Chips
              label="Viaje"
              value={periodId}
              onChange={setPeriodId}
              options={[
                { value: null as string | null, label: 'No' },
                ...trips.map((p) => ({ value: p.id as string | null, label: p.name })),
              ]}
            />
          </Field>
        )}
      </div>
    </Sheet>
  );
}
