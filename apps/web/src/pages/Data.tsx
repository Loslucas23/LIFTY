import { useRef, useState } from 'react';
import { ENTITY_NAMES, isEntityName, monthLabel, type EntityName, type Mutation } from '@lifty/core';
import { money } from '../lib/format';
import { Icon } from '../components/Icon';
import { PageHeader, Section, toast } from '../components/ui';
import { navigate } from '../lib/router';
import { useData, useSync } from '../lib/store';
import { ApiError, getToken, mutate, mutateMany } from '../lib/sync';
import { openSetup } from '../components/Setup';

interface ImportPreview {
  records: { entity: EntityName; record: { id: string } & Record<string, unknown> }[];
  settings: Record<string, unknown>;
  summary: { label: string; count: number }[];
  warnings: string[];
  comparison?: {
    month: string;
    parts: { label: string; excel: number; lifty: number; note: string | null; explained: boolean }[];
  }[];
}

const INCOME_PARTS = ['Sueldos', 'Aguinaldo', 'Otros ingresos'];
const EXPENSE_PARTS = ['Gastos fijos', 'Gastos del día a día', 'Tarjeta'];

/** Totales de cada mes según la planilla y según Lifty, con el porqué de cada diferencia. */
function Comparison({ months }: { months: NonNullable<ImportPreview['comparison']> }) {
  const total = (m: (typeof months)[number], labels: string[], key: 'excel' | 'lifty') =>
    m.parts.filter((p) => labels.includes(p.label)).reduce((s, p) => s + p[key], 0);
  const withNotes = months.filter((m) => m.parts.some((p) => p.note));
  const unexplained = months.some((m) => m.parts.some((p) => !p.explained));
  return (
    <div className="compare">
      <h3>Comparación con tu planilla</h3>
      <p className="muted small">
        {withNotes.length === 0
          ? 'Todos los meses dan igual que en tu planilla.'
          : unexplained
            ? 'Hay meses que no coinciden y no sé explicar por qué: revisalos antes de importar.'
            : `${months.length - withNotes.length} de ${months.length} meses dan igual. En los demás te explico la diferencia.`}
      </p>
      <div className="table-wrap">
        <table className="table compare-table">
          <thead>
            <tr>
              <th scope="col">Mes</th>
              <th scope="col">Ingresos planilla</th>
              <th scope="col">Ingresos Lifty</th>
              <th scope="col">Gastos planilla</th>
              <th scope="col">Gastos Lifty</th>
              <th scope="col" aria-label="Coincide" />
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const ok = !m.parts.some((p) => p.note);
              const bad = m.parts.some((p) => !p.explained);
              return (
                <tr key={m.month}>
                  <th scope="row">{monthLabel(m.month, false)}</th>
                  <td>{money(Math.round(total(m, INCOME_PARTS, 'excel')))}</td>
                  <td>{money(Math.round(total(m, INCOME_PARTS, 'lifty')))}</td>
                  <td>{money(Math.round(total(m, EXPENSE_PARTS, 'excel')))}</td>
                  <td>{money(Math.round(total(m, EXPENSE_PARTS, 'lifty')))}</td>
                  <td>{ok ? '✅' : bad ? '❌' : 'ℹ️'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {withNotes.length > 0 && (
        <ul className="warnings compare-notes">
          {withNotes.flatMap((m) =>
            m.parts
              .filter((p) => p.note)
              .map((p) => (
                <li key={`${m.month}-${p.label}`} className={p.explained ? '' : 'text-bad'}>
                  <strong>
                    {monthLabel(m.month, false)}, {p.label.toLowerCase()}:
                  </strong>{' '}
                  planilla {money(p.excel)}, Lifty {money(p.lifty)}. {p.note}
                </li>
              )),
          )}
        </ul>
      )}
    </div>
  );
}

export function ImportExcel() {
  const data = useData();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');

  const read = async (file: File) => {
    setBusy(true);
    setFileName(file.name);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('./api/import/excel', { method: 'POST', headers, body: await file.arrayBuffer() });
      const body = await res.json();
      if (!res.ok) throw new ApiError(res.status, body.message ?? 'No pude leer el archivo');
      setPreview(body);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Necesitás conexión con la compu para importar', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!preview) return;
    const updatedAt = new Date().toISOString();
    mutateMany(preview.records.map((r) => ({ entity: r.entity, op: 'upsert', id: r.record.id, updatedAt, record: r.record })));
    mutate('settings', 'upsert', { ...data.settings, ...preview.settings });
    toast('Planilla importada');
    navigate('/');
    // La planilla trae el pasado; para que hoy cuadre hacen falta los saldos de hoy.
    setTimeout(
      () =>
        openSetup('Listo, importé tu planilla. Para que los números de hoy sean reales, decime cuánto tenés hoy en cada lugar.'),
      400,
    );
  };

  return (
    <div className="page narrow">
      <PageHeader title="Importar desde Excel" subtitle="Traé lo que ya tenías en tu planilla de finanzas" back="/mas" />
      <div className="card pad">
        <p>
          Lifty lee las hojas <strong>Fijos</strong> (sueldos, gastos fijos y dólar), <strong>movimientos</strong>,{' '}
          <strong>Tarjeta</strong> (rearma las compras en cuotas) y <strong>RESUMEN</strong> (los meses que marcaste como
          terminados, con su total real). Antes de importar te muestra, mes a mes, si los totales dan igual que en tu planilla y
          por qué no cuando no.
        </p>
        <p className="muted small">Podés importar la misma planilla varias veces: no duplica, actualiza.</p>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xlsm"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = '';
          }}
        />
        <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={busy}>
          <Icon name="upload" /> {busy ? 'Leyendo…' : 'Elegir archivo .xlsm o .xlsx'}
        </button>
      </div>

      {preview && (
        <Section title={`Encontré en ${fileName}`}>
          <div className="card pad">
            <ul className="summary-list">
              {preview.summary.map((s) => (
                <li key={s.label}>
                  <span>{s.label}</span>
                  <strong>{s.count}</strong>
                </li>
              ))}
            </ul>
            {preview.warnings.length > 0 && (
              <ul className="warnings">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {preview.comparison && preview.comparison.length > 0 && <Comparison months={preview.comparison} />}
            <div className="btn-row">
              <button className="btn btn-primary" onClick={apply}>
                Importar todo
              </button>
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

export function Backup() {
  const { records, outbox } = useSync();
  const input = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const out: Record<string, unknown[]> = {};
    for (const e of ENTITY_NAMES) out[e] = Object.values(records[e] ?? {});
    const blob = new Blob(
      [JSON.stringify({ app: 'lifty', version: 1, exportedAt: new Date().toISOString(), records: out }, null, 2)],
      {
        type: 'application/json',
      },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lifty-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const [downloading, setDownloading] = useState(false);
  const exportExcel = async () => {
    setDownloading(true);
    try {
      const headers: Record<string, string> = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('./api/export/excel', { headers });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `lifty-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      toast('Necesitás conexión con la compu para exportar a Excel', { tone: 'error' });
    } finally {
      setDownloading(false);
    }
  };

  const restore = async (file: File) => {
    try {
      const json = JSON.parse(await file.text());
      if (json?.app !== 'lifty' || typeof json.records !== 'object') throw new Error('No es una copia de Lifty');
      const updatedAt = new Date().toISOString();
      const mutations: Mutation[] = [];
      for (const [entity, list] of Object.entries(json.records as Record<string, { id: string }[]>)) {
        if (!isEntityName(entity) || !Array.isArray(list)) continue;
        for (const record of list) mutations.push({ entity, op: 'upsert', id: record.id, updatedAt, record });
      }
      mutateMany(mutations);
      toast(`Copia restaurada (${mutations.length} registros)`);
    } catch (err) {
      toast(`No pude restaurar: ${(err as Error).message}`, { tone: 'error' });
    }
  };

  return (
    <div className="page narrow">
      <PageHeader title="Copia de seguridad" back="/mas" />
      <div className="card pad form">
        <p>
          La compu guarda una copia automática de la base todos los días (las últimas 14). Además podés descargar todo en un
          archivo para guardarlo donde quieras.
        </p>
        <button className="btn btn-primary" onClick={exportExcel} disabled={downloading}>
          <Icon name="download" /> {downloading ? 'Preparando…' : 'Descargar en Excel (.xlsx)'}
        </button>
        <p className="muted small">Resumen mes a mes, movimientos, sueldos, gastos fijos y peso, listos para filtrar.</p>
        <button className="btn" onClick={exportJson}>
          <Icon name="download" /> Descargar copia completa (.json)
        </button>
        <p className="muted small">La copia .json es la que sirve para restaurar.</p>
        <hr />
        <p className="muted small">Restaurar suma o actualiza lo que haya en la copia; no borra lo que cargaste después.</p>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void restore(f);
            e.target.value = '';
          }}
        />
        <button className="btn" onClick={() => input.current?.click()}>
          <Icon name="upload" /> Restaurar desde archivo
        </button>
        {outbox.length > 0 && <p className="muted small">Hay {outbox.length} cambio(s) esperando para sincronizar.</p>}
      </div>
    </div>
  );
}
