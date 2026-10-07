import { useMemo, useRef, useState } from 'react';
import {
  adjustBalance,
  detectColumns,
  newId,
  reconcile,
  statementLines,
  transactionSchema,
  type Cell,
  type ColumnMap,
  type MissingLine,
  type Movement,
} from '@lifty/core';
import { openTxForm } from '../components/TxForm';
import { Chips, Empty, Field, PageHeader, Section, Toggle, toast } from '../components/ui';
import { money } from '../lib/format';
import { useData, useToday } from '../lib/store';
import { api, ApiError, mutate, mutateMany } from '../lib/sync';

const ddmm = (d: string) => d.split('-').reverse().slice(0, 2).join('/');
const colName = (i: number) => String.fromCharCode(65 + (i % 26));

/**
 * Conciliar con el banco: subís el Excel o CSV de movimientos que bajás de la web del banco (o de
 * la tarjeta) y Lifty lo cruza con lo que cargaste: lo que falta anotar, lo repetido y lo que no
 * está en el banco. En Uruguay no se puede conectar una app al banco: el archivo es lo más práctico.
 */
export function Reconcile() {
  const data = useData();
  const accounts = data.accounts.filter((a) => !a.archived && a.type !== 'food');
  const [accountId, setAccountId] = useState<string>(accounts.find((a) => a.type === 'bank')?.id ?? accounts[0]?.id ?? '');
  const account = data.accounts.find((a) => a.id === accountId);
  const [rows, setRows] = useState<Cell[][] | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [invert, setInvert] = useState(false);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editCols, setEditCols] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const read = async (file: File) => {
    setBusy(true);
    setFileName(file.name);
    try {
      const body = await api<{ rows: Cell[][] }>('/statement/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: await file.arrayBuffer(),
      });
      const detected = detectColumns(body.rows);
      setRows(body.rows);
      setMap(detected);
      setEditCols(!detected);
      setInvert(account?.type === 'credit' && !!detected && detected.debit === null && detected.credit === null);
      if (!detected) toast('No reconocí las columnas: elegilas abajo', { tone: 'error' });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Necesitás conexión con la compu para leer el archivo', { tone: 'error' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const lines = useMemo(
    () => (rows && map && account ? statementLines(rows, map, account.currency, invert) : []),
    [rows, map, account, invert],
  );
  const result = useMemo(() => (account && lines.length ? reconcile(data, account.id, lines) : null), [data, account, lines]);

  return (
    <div className="page narrow">
      <PageHeader title="Conciliar con el banco" subtitle="Cruzá el extracto con lo que cargaste" back="/cuentas" />
      <div className="card pad form">
        <p className="muted small">
          Bajá los movimientos de la web del banco o de la tarjeta (en <strong>Excel o CSV</strong>) y subilos acá. Lifty te
          muestra lo que falta anotar, lo que cargaste dos veces y lo que no está en el banco. Nada se cambia hasta que vos lo
          confirmes.
        </p>
        <Field label="¿De qué cuenta es el extracto?">
          <Chips
            label="Cuenta"
            value={accountId}
            onChange={(id) => {
              setAccountId(id);
              const a = data.accounts.find((x) => x.id === id);
              if (map) setInvert(a?.type === 'credit' && map.debit === null && map.credit === null);
            }}
            options={accounts.map((a) => ({ value: a.id, label: a.name, icon: a.icon }))}
          />
        </Field>
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,.xlsx,.xls,.htm,.html"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
          }}
        />
        <button className="btn btn-primary" disabled={busy || !account} onClick={() => input.current?.click()}>
          {busy ? 'Leyendo…' : fileName ? 'Elegir otro archivo' : 'Elegir el archivo del banco'}
        </button>
      </div>

      {rows && (
        <Section
          title={fileName}
          action={
            <button className="link small" onClick={() => setEditCols(!editCols)}>
              {editCols ? 'Listo' : 'Cambiar columnas'}
            </button>
          }
        >
          <div className="card pad form">
            {map && !editCols && (
              <p className="small">
                Leí <strong>{lines.length}</strong> movimientos
                {result ? ` del ${ddmm(result.from)} al ${ddmm(result.to)}` : ''}. Columnas: fecha ({colName(map.date)}), detalle
                ({map.description.map(colName).join('+') || '—'}),{' '}
                {map.debit !== null || map.credit !== null
                  ? `débito (${map.debit !== null ? colName(map.debit) : '—'}) y crédito (${map.credit !== null ? colName(map.credit) : '—'})`
                  : `importe (${map.amount !== null ? colName(map.amount) : '—'})`}
                {map.amountUSD !== null ? `, dólares (${colName(map.amountUSD)})` : ''}
                {map.balance !== null ? `, saldo (${colName(map.balance)})` : ''}.
              </p>
            )}
            {editCols && <ColumnEditor rows={rows} map={map} onChange={setMap} />}
            {map && map.debit === null && map.credit === null && (
              <Toggle
                checked={invert}
                onChange={setInvert}
                label="Los gastos vienen en positivo (pasa en los estados de cuenta de las tarjetas)"
              />
            )}
          </div>
        </Section>
      )}

      {rows && map && !lines.length && (
        <Empty icon="info" title="No encontré movimientos">
          Revisá las columnas: tiene que haber una con la fecha y otra con el importe (o débito y crédito).
        </Empty>
      )}

      {result && <Results result={result} />}
    </div>
  );
}

function ColumnEditor({ rows, map, onChange }: { rows: Cell[][]; map: ColumnMap | null; onChange: (m: ColumnMap) => void }) {
  const width = Math.max(0, ...rows.slice(0, 40).map((r) => r.length));
  const [header, setHeader] = useState(map?.header ?? -1);
  const sample = rows.slice(header + 1, header + 4);
  const label = (i: number) => {
    const h = header >= 0 ? rows[header]?.[i] : null;
    const ex = sample.map((r) => r[i]).find((v) => v !== null && v !== undefined && v !== '');
    return `${colName(i)}${h ? ` · ${String(h).slice(0, 18)}` : ''}${ex !== undefined ? ` (ej: ${String(ex).slice(0, 16)})` : ''}`;
  };
  const cur: ColumnMap = map ?? {
    header,
    date: 0,
    description: [1],
    amount: 2,
    debit: null,
    credit: null,
    amountUSD: null,
    balance: null,
  };
  const set = (patch: Partial<ColumnMap>) => onChange({ ...cur, header, ...patch });
  const select = (value: number | null, onPick: (v: number | null) => void, allowNone = true) => (
    <select value={value ?? ''} onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}>
      {allowNone && <option value="">—</option>}
      {Array.from({ length: width }, (_, i) => (
        <option key={i} value={i}>
          {label(i)}
        </option>
      ))}
    </select>
  );
  return (
    <>
      <Field label="Fila de títulos" hint="La fila con «Fecha», «Descripción»… (0 si no hay)">
        <input
          inputMode="numeric"
          value={header + 1}
          onChange={(e) => {
            const h = Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0) - 1;
            setHeader(h);
            onChange({ ...cur, header: h });
          }}
        />
      </Field>
      <div className="row">
        <Field label="Fecha">{select(cur.date, (v) => set({ date: v ?? 0 }), false)}</Field>
        <Field label="Detalle">{select(cur.description[0] ?? null, (v) => set({ description: v === null ? [] : [v] }))}</Field>
      </div>
      <div className="row">
        <Field label="Importe (una columna)">{select(cur.amount, (v) => set({ amount: v, debit: null, credit: null }))}</Field>
        <Field label="Saldo">{select(cur.balance, (v) => set({ balance: v }))}</Field>
      </div>
      <div className="row">
        <Field label="Débito (sale)">{select(cur.debit, (v) => set({ debit: v, amount: null }))}</Field>
        <Field label="Crédito (entra)">{select(cur.credit, (v) => set({ credit: v, amount: null }))}</Field>
      </div>
    </>
  );
}

function Results({ result: r }: { result: NonNullable<ReturnType<typeof reconcile>> }) {
  const data = useData();
  const today = useToday();
  const cur = r.account.currency;
  return (
    <>
      <div className="stat-row reconcile-stats">
        <div className="card stat">
          <span>Coinciden</span>
          <strong className="text-income">{r.matched.length}</strong>
        </div>
        <div className="card stat">
          <span>Falta anotar</span>
          <strong className={r.missing.length ? 'text-expense' : ''}>{r.missing.length}</strong>
        </div>
        <div className="card stat">
          <span>Repetidos</span>
          <strong className={r.repeated.length ? 'text-expense' : ''}>{r.repeated.length}</strong>
        </div>
        <div className="card stat">
          <span>Solo en Lifty</span>
          <strong>{r.extra.length}</strong>
        </div>
      </div>

      {r.balance && (
        <div className={`card pad ${Math.abs(r.balance.diff) < 1 ? 'verdict good' : ''}`}>
          {Math.abs(r.balance.diff) < 1 ? (
            <p>
              ✅ El saldo cuadra: el banco y Lifty dicen <strong>{money(r.balance.bank, cur)}</strong> el {ddmm(r.balance.date)}.
            </p>
          ) : (
            <>
              <p>
                El banco dice <strong>{money(r.balance.bank, cur)}</strong> el {ddmm(r.balance.date)}; Lifty,{' '}
                <strong>{money(r.balance.lifty, cur)}</strong> (diferencia {money(r.balance.diff, cur)}).
              </p>
              <p className="muted small">
                Anotá lo que falta y borrá lo repetido: la diferencia debería achicarse. Si queda algo (por ejemplo, empezaste a
                usar Lifty con otro saldo), ajustá el saldo.
              </p>
              <button
                className="btn btn-wrap"
                onClick={() => {
                  const next = adjustBalance(data, r.account.id, r.balance!.bank, r.balance!.date);
                  if (!next) return;
                  const before = data.accounts.find((a) => a.id === r.account.id)!;
                  mutate('account', 'upsert', next);
                  toast('Saldo ajustado', { action: { label: 'Deshacer', run: () => mutate('account', 'upsert', before) } });
                }}
              >
                Ajustar el saldo de {r.account.name} a {money(r.balance.bank, cur)}
              </button>
            </>
          )}
        </div>
      )}

      {r.missing.length > 0 && <MissingList key={r.from + r.to + r.missing.length} missing={r.missing} />}

      {r.repeated.length > 0 && (
        <Section title="Cargado dos veces">
          <p className="muted small">El extracto lo tiene una vez y en Lifty está dos veces (mismo monto, fechas cercanas).</p>
          <div className="card list">
            {r.repeated.map((m) => (
              <MovementRow key={m.id} m={m} today={today}>
                <button
                  className="btn btn-sm btn-danger-ghost"
                  onClick={() => {
                    const tx = m.tx!;
                    mutate('transaction', 'delete', tx.id);
                    toast('Borrado', { action: { label: 'Deshacer', run: () => mutate('transaction', 'upsert', tx) } });
                  }}
                >
                  Borrar
                </button>
              </MovementRow>
            ))}
          </div>
        </Section>
      )}

      {r.extra.length > 0 && (
        <Section title="Solo en Lifty">
          <p className="muted small">
            En esas fechas y no están en el extracto: ¿los pagaste con otra cuenta o en efectivo? ¿Todavía no pasaron por el
            banco? Tocá para corregirlos.
          </p>
          <div className="card list">
            {r.extra.map((m) => (
              <MovementRow key={m.id} m={m} today={today} />
            ))}
          </div>
        </Section>
      )}

      {r.matched.length > 0 && (
        <details className="card pad reconcile-matched">
          <summary>
            {r.matched.length} coinciden{r.matched.some((m) => m.days) ? ' (algunos con 1 a 3 días de diferencia)' : ''}
          </summary>
          <ul className="plain-list small">
            {r.matched.map((m) => (
              <li key={`${m.line.row}-${m.movement.id}`}>
                {ddmm(m.line.date)} · {m.line.description || '—'} · {money(m.line.amount, m.line.currency)} ↔{' '}
                {m.movement.description || 'sin descripción'}
                {m.days ? ` (${m.days} día${m.days === 1 ? '' : 's'})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function MovementRow({ m, today, children }: { m: Movement; today: string; children?: React.ReactNode }) {
  const label = m.source === 'auto' ? 'débito automático de la tarjeta' : m.source === 'debt' ? 'deuda' : '';
  return (
    <div className="tx-row wrap-text">
      <button className="tx-main" onClick={() => m.tx && m.source === 'tx' && openTxForm({ tx: m.tx })}>
        <span className="tx-title">{m.description || 'Sin descripción'}</span>
        <span className="tx-meta">
          {m.date === today ? 'Hoy' : ddmm(m.date)}
          {label ? ` · ${label}` : ''}
        </span>
      </button>
      <span className={`tx-amount ${m.amount < 0 ? '' : 'text-income'}`}>{money(m.amount)}</span>
      {children}
    </div>
  );
}

function MissingList({ missing }: { missing: MissingLine[] }) {
  const data = useData();
  const [picked, setPicked] = useState(() => new Set(missing.map((_, i) => i)));
  const [edits, setEdits] = useState<Record<number, { description?: string; categoryId?: string | null }>>({});
  const cats = (kind: string) => data.categories.filter((c) => c.kind === kind && !c.archived);
  const add = () => {
    const now = new Date().toISOString();
    const records = missing
      .map((m, i) => ({ m, i }))
      .filter(({ i }) => picked.has(i))
      .map(({ m, i }) =>
        transactionSchema.parse({
          id: newId(),
          updatedAt: now,
          date: m.line.date,
          kind: m.kind,
          amount: Math.abs(m.line.amount),
          currency: m.line.currency,
          fxRate: m.line.currency === 'USD' ? data.settings.usdRate : 1,
          categoryId: m.kind === 'transfer' ? null : (edits[i]?.categoryId ?? m.categoryId),
          accountId: m.accountId,
          toAccountId: m.toAccountId,
          description: (edits[i]?.description ?? m.description).trim(),
          ...(m.toAccountId && m.linkMonth ? { linkKind: 'cardbill', linkId: m.toAccountId, linkMonth: m.linkMonth } : {}),
        }),
      );
    if (!records.length) return;
    mutateMany(records.map((record) => ({ entity: 'transaction', op: 'upsert', id: record.id, updatedAt: now, record })));
    toast(`${records.length} movimiento${records.length === 1 ? '' : 's'} anotado${records.length === 1 ? '' : 's'}`, {
      action: {
        label: 'Deshacer',
        run: () =>
          mutateMany(
            records.map((r) => ({ entity: 'transaction', op: 'delete', id: r.id, updatedAt: new Date().toISOString() })),
          ),
      },
    });
  };
  return (
    <Section
      title="Falta anotar"
      action={
        <button
          className="link small"
          onClick={() => setPicked(picked.size === missing.length ? new Set() : new Set(missing.map((_, i) => i)))}
        >
          {picked.size === missing.length ? 'Ninguno' : 'Todos'}
        </button>
      }
    >
      <div className="card list">
        {missing.map((m, i) => (
          <div key={`${m.line.row}-${i}`} className={`missing-row ${picked.has(i) ? '' : 'off'}`}>
            <input
              type="checkbox"
              aria-label={`Anotar ${m.description}`}
              checked={picked.has(i)}
              onChange={() => {
                const next = new Set(picked);
                if (next.has(i)) next.delete(i);
                else next.add(i);
                setPicked(next);
              }}
            />
            <div className="missing-main">
              <input
                className="missing-desc"
                value={edits[i]?.description ?? m.description}
                onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], description: e.target.value } })}
                aria-label="Descripción"
              />
              <span className="muted small">
                {ddmm(m.line.date)} · {m.line.description}
              </span>
              {m.kind === 'transfer' ? (
                <span className="small">
                  ↔ Mover a {data.accounts.find((a) => a.id === m.toAccountId)?.name} ({m.why})
                </span>
              ) : (
                <select
                  value={edits[i]?.categoryId ?? m.categoryId ?? ''}
                  onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], categoryId: e.target.value || null } })}
                  aria-label="Categoría"
                >
                  <option value="">Sin categoría</option>
                  {cats(m.kind).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <span className={`tx-amount ${m.line.amount > 0 ? 'text-income' : ''}`}>{money(m.line.amount, m.line.currency)}</span>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!picked.size} onClick={add}>
        Anotar {picked.size} movimiento{picked.size === 1 ? '' : 's'}
      </button>
    </Section>
  );
}
