import { useRef, useState } from 'react';
import { ENTITY_NAMES, isEntityName, type EntityName, type Mutation } from '@lifty/core';
import { Icon } from '../components/Icon';
import { PageHeader, Section, toast } from '../components/ui';
import { navigate } from '../lib/router';
import { useData, useSync } from '../lib/store';
import { ApiError, getToken, mutate, mutateMany } from '../lib/sync';

interface ImportPreview {
  records: { entity: EntityName; record: { id: string } & Record<string, unknown> }[];
  settings: Record<string, unknown>;
  summary: { label: string; count: number }[];
  warnings: string[];
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
  };

  return (
    <div className="page narrow">
      <PageHeader title="Importar desde Excel" subtitle="Traé lo que ya tenías en tu planilla de finanzas" back="/mas" />
      <div className="card pad">
        <p>
          Lifty lee las hojas <strong>Fijos</strong> (sueldos, gastos fijos y dólar), <strong>movimientos</strong>,{' '}
          <strong>Tarjeta</strong> (rearma las compras en cuotas) y <strong>RESUMEN</strong> (los meses que marcaste como
          terminados, con su total real).
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
        <button className="btn btn-primary" onClick={exportJson}>
          <Icon name="download" /> Descargar copia (.json)
        </button>
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
