import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { Empty, Field, PageHeader, Section, toast } from '../components/ui';
import { navigate } from '../lib/router';
import { useSync } from '../lib/store';
import { local as prefs } from '../lib/local';
import { api, ApiError, currentDevice, forgetDevice, pairDevice, sync } from '../lib/sync';

interface Pairing {
  code: string;
  expiresAt: number;
  urls: string[];
  qr: string | null;
}

interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  online?: boolean;
}

/** "hace 5 s", "hace 3 min"… */
function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`;
  return `el ${new Date(iso).toLocaleDateString('es-UY')}`;
}

const STATUS_LABEL: Record<string, [string, string]> = {
  synced: ['Sincronizado', 'dot-on'],
  syncing: ['Sincronizando…', 'dot-on'],
  loading: ['Cargando…', ''],
  offline: ['Sin conexión con la compu', 'dot-warn'],
  error: ['Error al sincronizar', 'dot-bad'],
  unauthorized: ['Sin vincular', 'dot-bad'],
};

/** Estado de la conexión: si llega a la compu, qué tan rápido, si está en vivo y qué falta mandar. */
function ConnectionStatus({ now }: { now: number }) {
  const s = useSync();
  const [pings, setPings] = useState<number[] | null>(null);
  const [testing, setTesting] = useState(false);
  const [info, setInfo] = useState<{ version: string; urls: string[] } | null>(null);
  useEffect(() => {
    api<{ version: string; urls: string[] }>('/server-info')
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [s.status === 'synced']);
  const test = async () => {
    setTesting(true);
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      try {
        await api('/health');
        times.push(performance.now() - t0);
      } catch {
        break;
      }
    }
    setPings(times);
    setTesting(false);
  };
  const median = pings?.length ? [...pings].sort((a, b) => a - b)[Math.floor(pings.length / 2)] : null;
  const [label, dot] = STATUS_LABEL[s.status] ?? [s.status, ''];
  const me = currentDevice();
  return (
    <div className="card pad">
      <dl className="conn-rows">
        <dt>Estado</dt>
        <dd>
          <span className={`dot ${dot}`} />
          {label}
        </dd>
        <dt>En vivo</dt>
        <dd>{s.live ? 'Sí, al instante' : 'No (revisa cada 20 s)'}</dd>
        <dt>Última sincronización</dt>
        <dd>{s.lastSync ? ago(s.lastSync, now) : 'nunca'}</dd>
        <dt>Cambios sin enviar</dt>
        <dd>
          {s.outbox.length}{' '}
          {s.outbox.length > 0 && (
            <button className="link small" onClick={() => void sync()}>
              Enviar ahora
            </button>
          )}
        </dd>
        <dt>Respuesta de la compu</dt>
        <dd>
          {pings === null ? (
            '—'
          ) : median === null ? (
            <span className="text-bad">No responde</span>
          ) : (
            `${Math.round(median)} ms · ${median < 150 ? 'excelente' : median < 600 ? 'buena' : 'lenta'}`
          )}{' '}
          <button className="link small" onClick={() => void test()} disabled={testing}>
            {testing ? 'Probando…' : 'Probar'}
          </button>
        </dd>
        <dt>Este dispositivo</dt>
        <dd>{s.local ? 'Esta compu (servidor)' : (me?.name ?? '—')}</dd>
        {info && (
          <>
            <dt>Versión de Lifty</dt>
            <dd>{info.version}</dd>
          </>
        )}
      </dl>
      {(s.status === 'offline' || s.status === 'error') && (
        <details className="small conn-help" open>
          <summary>¿No conecta?</summary>
          <ul>
            <li>Fijate que la compu esté prendida y con Lifty abierto.</li>
            <li>El celular tiene que estar en el mismo Wi-Fi que la compu (no con datos móviles).</li>
            <li>
              En Windows, la primera vez que abrís Lifty, el Firewall pregunta si lo dejás conectarse: tiene que estar permitido
              en "redes privadas".
            </li>
            <li>Si la compu cambió de dirección (pasa al reiniciar el router), volvé a escanear el QR.</li>
            <li>Lo que cargues igual se guarda en este dispositivo y se manda solo cuando vuelva la conexión.</li>
          </ul>
        </details>
      )}
      {s.local && info && info.urls.length > 0 && (
        <p className="muted small">
          Desde otro dispositivo de la red: <code>{info.urls[0]}</code>
        </p>
      )}
    </div>
  );
}

/** En la compu: muestra el QR para vincular el celular y la lista de dispositivos. */
export function Connect() {
  const { local, status } = useSync();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [localOnline, setLocalOnline] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const me = currentDevice();

  const loadDevices = () =>
    api<{ devices: Device[]; localOnline?: boolean }>('/devices')
      .then((r) => {
        setDevices(r.devices);
        setLocalOnline(!!r.localOnline);
        // Para "Primeros pasos": ya hay un celular vinculado.
        if (r.devices.length > 0) prefs.set('lifty-paired', '1');
      })
      .catch(() => setDevices(null));

  useEffect(() => {
    void loadDevices();
    const t = setInterval(() => setNow(Date.now()), 1000);
    // Quién está en línea cambia: se actualiza cada 15 s.
    const d = setInterval(() => void loadDevices(), 15_000);
    return () => {
      clearInterval(t);
      clearInterval(d);
    };
  }, []);

  const rename = async () => {
    if (!renaming) return;
    try {
      await api(`/devices/${renaming.id}`, { method: 'PATCH', body: JSON.stringify({ name: renaming.name }) });
      setRenaming(null);
      void loadDevices();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Sin conexión con la compu', { tone: 'error' });
    }
  };

  const create = async () => {
    try {
      setPairing(await api<Pairing>('/pairing', { method: 'POST' }));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Sin conexión con la compu', { tone: 'error' });
    }
  };

  const left = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0;

  return (
    <div className="page">
      <PageHeader
        title="Conectar dispositivos"
        subtitle="Usá Lifty en el celular con los mismos datos que en la compu"
        back="/mas"
      />

      <Section title="Estado de la conexión">
        <ConnectionStatus now={now} />
      </Section>

      <div className="connect-grid">
        <Section title="Vincular un celular">
          <div className="card pad connect">
            {pairing && left > 0 ? (
              <>
                {pairing.qr ? (
                  <div className="qr" dangerouslySetInnerHTML={{ __html: pairing.qr }} />
                ) : (
                  <p className="muted">No encontré la red local de esta compu. Usá el código a mano.</p>
                )}
                <p className="pair-code" aria-label="Código de vinculación">
                  {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
                </p>
                <p className="muted small">
                  Vence en {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} · sirve una sola vez
                </p>
                <ol className="steps">
                  <li>Conectá el celular al mismo Wi-Fi que esta compu.</li>
                  <li>
                    Escaneá el QR con la cámara (o abrí{' '}
                    {pairing.urls[0] ? <code>{pairing.urls[0].split('/#')[0]}</code> : 'la dirección'} y poné el código).
                  </li>
                  <li>En el celular, "Agregar a la pantalla de inicio" para tenerla como app.</li>
                </ol>
                {pairing.urls.length > 1 && (
                  <details className="small">
                    <summary>¿No conecta? Probá otra dirección</summary>
                    <ul>
                      {pairing.urls.map((u) => (
                        <li key={u}>
                          <code>{u}</code>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <>
                <Icon name="phone" size={40} />
                <p>
                  Generá un código QR y escanealo con el celular. El celular guarda lo que cargues aunque no tenga señal y lo
                  sincroniza cuando vuelve a ver la compu.
                </p>
                <button className="btn btn-primary" onClick={create} disabled={status === 'offline'}>
                  Generar código
                </button>
              </>
            )}
          </div>
        </Section>

        <Section title="Dispositivos vinculados">
          {devices === null ? (
            <Empty title="No se pudo cargar la lista" />
          ) : devices.length === 0 ? (
            <Empty icon="phone" title="Todavía no vinculaste ninguno" />
          ) : (
            <div className="card list">
              <div className="tx-row static">
                <span className="tx-icon">💻</span>
                <span className="tx-main">
                  <span className="tx-title">Esta compu (servidor)</span>
                  <span className="tx-meta">
                    <span className={`dot ${localOnline ? 'dot-on' : ''}`} />
                    {localOnline ? 'En línea ahora' : 'Programa cerrado o solo el servidor'}
                  </span>
                </span>
              </div>
              {devices.map((d) => (
                <div key={d.id} className="tx-row static">
                  <span className="tx-icon">📱</span>
                  <span className="tx-main">
                    {renaming?.id === d.id ? (
                      <form
                        className="row"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void rename();
                        }}
                      >
                        <input
                          autoFocus
                          value={renaming.name}
                          onChange={(e) => setRenaming({ id: d.id, name: e.target.value })}
                          maxLength={60}
                          aria-label="Nombre del dispositivo"
                        />
                        <button className="btn btn-primary">Guardar</button>
                      </form>
                    ) : (
                      <button className="tx-title link-plain" onClick={() => setRenaming({ id: d.id, name: d.name })}>
                        {d.name}
                        {me?.id === d.id ? ' (este)' : ''} ✎
                      </button>
                    )}
                    <span className="tx-meta">
                      <span className={`dot ${d.online ? 'dot-on' : ''}`} />
                      {d.online ? 'En línea ahora' : d.lastSeenAt ? `Visto ${ago(d.lastSeenAt, now)}` : 'Nunca se conectó'} ·
                      vinculado el {new Date(d.createdAt).toLocaleDateString('es-UY')}
                    </span>
                  </span>
                  <button
                    className="btn btn-danger-ghost"
                    onClick={async () => {
                      await api(`/devices/${d.id}`, { method: 'DELETE' });
                      toast(`${d.name} desvinculado`);
                      void loadDevices();
                    }}
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
          {!local && (
            <button className="btn btn-ghost" onClick={() => (forgetDevice(), navigate('/'))}>
              Desvincular este dispositivo
            </button>
          )}
        </Section>
      </div>
    </div>
  );
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Celular Android' : 'Tablet Android';
  if (/Windows/.test(ua)) return 'Compu Windows';
  if (/Mac/.test(ua)) return 'Mac';
  return 'Dispositivo';
}

/** En el celular: pantalla para vincularse (por QR, código o contraseña). */
export function Pair({ code: initialCode }: { code?: string }) {
  const [code, setCode] = useState(initialCode ?? '');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ password: boolean }>('/health')
      .then((h) => setHasPassword(h.password))
      .catch(() => setError('No encuentro la compu con Lifty. ¿Está prendida y en el mismo Wi-Fi?'));
  }, []);

  const submit = async (value = code) => {
    setBusy(true);
    setError(null);
    try {
      await pairDevice(usePassword ? { password, name: deviceName() } : { code: value, name: deviceName() });
      toast('¡Listo! Este dispositivo quedó vinculado');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No me pude conectar con la compu.');
    } finally {
      setBusy(false);
    }
  };

  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (autoSubmitted.current || !initialCode || !/^\d{6}$/.test(initialCode)) return;
    autoSubmitted.current = true;
    void submit(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode]);

  return (
    <div className="pair-screen">
      <div className="card pad pair-card">
        <img src="./icon.svg" alt="" width={56} height={56} />
        <h1>Conectá este dispositivo</h1>
        <p className="muted">
          En la compu, abrí Lifty → <strong>Más → Conectar dispositivos</strong> y escaneá el QR, o escribí el código de 6
          números.
        </p>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {usePassword ? (
            <Field label="Contraseña">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </Field>
          ) : (
            <Field label="Código">
              <input
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                autoFocus
              />
            </Field>
          )}
          {error && <p className="field-error">{error}</p>}
          <button className="btn btn-primary" disabled={busy || (usePassword ? !password : code.length !== 6)}>
            {busy ? 'Conectando…' : 'Conectar'}
          </button>
          {hasPassword && (
            <button type="button" className="link small" onClick={() => setUsePassword(!usePassword)}>
              {usePassword ? 'Usar un código' : 'Entrar con contraseña'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
