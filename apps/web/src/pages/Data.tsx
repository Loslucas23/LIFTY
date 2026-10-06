import { useEffect, useRef, useState } from 'react';
import { ENTITY_NAMES, isEntityName, monthLabel, type EntityName, type Mutation, type RecordStore } from '@lifty/core';
import { money } from '../lib/format';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Editors';
import { Field, PageHeader, Section, toast } from '../components/ui';
import { navigate } from '../lib/router';
import { useData, useSync } from '../lib/store';
import { api, ApiError, getToken, mutate, mutateMany } from '../lib/sync';
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
      applyBackup(json.records, false, records);
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
      <AutoBackup />
    </div>
  );
}

/**
 * Aplica una copia. `exact`: además borra lo que no estaba en la copia (vuelve a como estaba
 * ese día). Si no, suma o actualiza y no borra lo cargado después.
 */
function applyBackup(backup: Record<string, { id: string }[]>, exact: boolean, current: RecordStore) {
  const updatedAt = new Date().toISOString();
  const mutations: Mutation[] = [];
  const kept = new Set<string>();
  for (const [entity, list] of Object.entries(backup)) {
    if (!isEntityName(entity) || !Array.isArray(list)) continue;
    for (const record of list) {
      mutations.push({ entity, op: 'upsert', id: record.id, updatedAt, record });
      kept.add(`${entity}:${record.id}`);
    }
  }
  let removed = 0;
  if (exact)
    for (const entity of ENTITY_NAMES)
      for (const id of Object.keys(current[entity] ?? {}))
        if (!kept.has(`${entity}:${id}`) && entity !== 'settings') {
          mutations.push({ entity, op: 'delete', id, updatedAt });
          removed++;
        }
  mutateMany(mutations);
  toast(`Copia restaurada (${mutations.length - removed} registros${removed ? `, ${removed} borrados` : ''})`);
}

interface BackupStatus {
  enabled: boolean;
  folder: string | null;
  keep: number;
  hasPassword: boolean;
  canConfigure: boolean;
  last: { at: string; file: string | null; error: string | null } | null;
  files: { name: string; size: number; at: string }[];
  suggestions: { label: string; path: string }[];
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Respaldo automático cifrado a un pendrive o a la nube (lo hace la compu sola, una vez por día). */
function AutoBackup() {
  const { records } = useSync();
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const [folder, setFolder] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<BackupStatus>('/backup')
      .then((s) => {
        setStatus(s);
        setFolder(s.folder ?? s.suggestions[0]?.path ?? '');
      })
      .catch(() => setOffline(true));
  }, []);

  const save = async () => {
    if (!status?.hasPassword || password) {
      if (password.length < 6) return toast('La contraseña tiene que tener 6 letras o más', { tone: 'error' });
      if (password !== password2) return toast('Las contraseñas no coinciden', { tone: 'error' });
    }
    setBusy(true);
    try {
      const s = await api<BackupStatus>('/backup', {
        method: 'PUT',
        body: JSON.stringify({ folder, ...(password ? { password } : {}) }),
      });
      setStatus(s);
      setPassword('');
      setPassword2('');
      const r = await api<{ result: { ok: boolean; error: string | null }; status: BackupStatus }>('/backup/run', {
        method: 'POST',
      });
      setStatus(r.status);
      toast(r.result.ok ? 'Listo: ya hice la primera copia cifrada' : `No pude copiar: ${r.result.error}`, {
        tone: r.result.ok ? undefined : 'error',
      });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'No pude guardar', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      const r = await api<{ result: { ok: boolean; error: string | null }; status: BackupStatus }>('/backup/run', {
        method: 'POST',
      });
      setStatus(r.status);
      toast(r.result.ok ? 'Copia hecha' : `No pude copiar: ${r.result.error}`, { tone: r.result.ok ? undefined : 'error' });
    } catch {
      toast('Necesitás conexión con la compu', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (exact: boolean) => {
    if (!restoreFile) return;
    setBusy(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'X-Backup-Password': encodeURIComponent(restorePassword),
      };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch('./api/backup/open', { method: 'POST', headers, body: await restoreFile.arrayBuffer() });
      const body = await res.json();
      if (!res.ok) throw new ApiError(res.status, body.message ?? 'No pude abrir la copia');
      applyBackup(body.records, exact, records);
      setRestoreFile(null);
      setRestorePassword('');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Necesitás conexión con la compu para abrir la copia', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="🔒 Respaldo automático cifrado">
      <div className="card pad form">
        <p className="small">
          Una vez por día (si hubo cambios), la compu guarda una copia de todo en la carpeta que elijas: un pendrive, OneDrive,
          Google Drive… La copia va <strong>cifrada con tu contraseña</strong>: sin ella nadie la puede abrir, ni siquiera quien
          tenga el archivo.
        </p>
        {offline ? (
          <p className="muted small">Necesitás conexión con la compu para ver o cambiar el respaldo.</p>
        ) : !status ? (
          <p className="muted small">Cargando…</p>
        ) : (
          <>
            {status.enabled ? (
              <p className={`small ${status.last?.error ? 'text-bad' : 'text-income'}`}>
                {status.last?.error
                  ? `⚠️ La última copia falló (${when(status.last.at)}): ${status.last.error}`
                  : status.last
                    ? `✅ Última copia: ${when(status.last.at)} en ${status.folder}`
                    : `Activo: copia en ${status.folder}`}
              </p>
            ) : (
              <p className="muted small">Todavía no está activado.</p>
            )}
            {status.canConfigure ? (
              <>
                <Field
                  label="Carpeta"
                  hint="La ruta completa. Si es un pendrive, dejalo conectado (si no está, lo intenta más tarde)."
                >
                  <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="E:\Lifty respaldos" />
                </Field>
                {status.suggestions.length > 0 && (
                  <div className="chips">
                    {status.suggestions.map((s) => (
                      <button
                        key={s.path}
                        type="button"
                        className={`chip ${folder === s.path ? 'on' : ''}`}
                        onClick={() => setFolder(s.path)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="row">
                  <Field label={status.hasPassword ? 'Nueva contraseña (opcional)' : 'Contraseña'}>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                  <Field label="Repetila">
                    <input
                      type="password"
                      value={password2}
                      onChange={(e) => setPassword2(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>
                <p className="muted small">
                  Anotala en un lugar seguro: <strong>si te la olvidás, las copias no se pueden abrir</strong>. Lifty no la guarda
                  (guarda una clave derivada para poder cifrar solo).
                </p>
                <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !folder.trim()}>
                  <Icon name="check" /> {status.enabled ? 'Guardar cambios' : 'Activar respaldo automático'}
                </button>
              </>
            ) : (
              <p className="muted small">La carpeta y la contraseña se eligen desde la compu.</p>
            )}
            {status.enabled && (
              <button className="btn" onClick={() => void runNow()} disabled={busy}>
                <Icon name="download" /> Hacer una copia ahora
              </button>
            )}
            {status.files.length > 0 && (
              <p className="muted small">
                {status.files.length} copia{status.files.length === 1 ? '' : 's'} en la carpeta (se guardan las últimas{' '}
                {status.keep}). La más nueva: {status.files[0].name}.
              </p>
            )}
          </>
        )}
        <hr />
        <p className="small">
          <strong>Restaurar una copia cifrada (.lifty)</strong>
        </p>
        <input
          ref={fileInput}
          type="file"
          accept=".lifty"
          hidden
          onChange={(e) => {
            setRestoreFile(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <button className="btn" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" /> {restoreFile ? restoreFile.name : 'Elegir el archivo .lifty'}
        </button>
        {restoreFile && (
          <>
            <Field label="Contraseña de la copia">
              <input type="password" value={restorePassword} onChange={(e) => setRestorePassword(e.target.value)} />
            </Field>
            <div className="btn-row">
              <button className="btn" disabled={busy || !restorePassword} onClick={() => void openFile(false)}>
                Sumar a lo que hay
              </button>
              <button
                className="btn btn-danger-ghost"
                disabled={busy || !restorePassword}
                onClick={() =>
                  openMenu('¿Volver a como estaba en la copia?', [
                    {
                      label: 'Sí, volver a esa copia',
                      hint: 'Borra lo que cargaste después de esa fecha (en todos tus dispositivos).',
                      tone: 'danger',
                      run: () => void openFile(true),
                    },
                  ])
                }
              >
                Volver a esa copia
              </button>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
