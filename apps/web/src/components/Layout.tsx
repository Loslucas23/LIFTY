import { useEffect, type ReactNode } from 'react';
import { togglePrivacy } from '../lib/privacy';
import { useSync } from '../lib/store';
import { useUpdateAvailable } from '../lib/update';
import { sync } from '../lib/sync';
import { Icon, type IconName } from './Icon';
import { openSearch } from './Search';
import { openTxForm } from './TxForm';

const NAV: { href: string; label: string; icon: IconName; match: RegExp }[] = [
  { href: '/', label: 'Inicio', icon: 'home', match: /^\/$/ },
  { href: '/movimientos', label: 'Movimientos', icon: 'list', match: /^\/movimientos/ },
  { href: '/presupuesto', label: 'Presupuesto', icon: 'budget', match: /^\/presupuesto/ },
  { href: '/ahorro', label: 'Ahorro', icon: 'piggy', match: /^\/ahorro/ },
  { href: '/cuentas', label: 'Cuentas', icon: 'bank', match: /^\/(cuentas|deudas)/ },
  { href: '/alimentacion', label: 'Alimentación', icon: 'food', match: /^\/alimentacion/ },
  { href: '/tarjeta', label: 'Tarjeta', icon: 'card', match: /^\/tarjeta/ },
  { href: '/stock', label: 'Stock', icon: 'box', match: /^\/stock/ },
  { href: '/rutinas', label: 'Rutinas', icon: 'check', match: /^\/rutinas/ },
  { href: '/estudio', label: 'Estudio', icon: 'calendar', match: /^\/estudio/ },
  { href: '/informes', label: 'Informes', icon: 'chart', match: /^\/(anio|informes)/ },
  { href: '/peso', label: 'Peso', icon: 'scale', match: /^\/peso/ },
  {
    href: '/mas',
    label: 'Más',
    icon: 'more',
    match: /^\/(mas|sueldos|fijos|categorias|conectar|importar|ajustes|respaldo)/,
  },
];

/** En el celular entran 4 + el botón de agregar. */
const MOBILE = ['/', '/movimientos', '/presupuesto', '/mas'];

/** Atajos en la compu: N = nuevo movimiento, / o Ctrl+K = buscar en todo, P = modo privado. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!document.querySelector('.sheet')) openSearch();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.sheet')) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        openTxForm();
      } else if (key === '/') {
        e.preventDefault();
        openSearch();
      } else if (key === 'p') {
        togglePrivacy();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}

function PrivacyButton({ on }: { on: boolean }) {
  return (
    <button
      className="icon-btn privacy-btn"
      onClick={togglePrivacy}
      aria-pressed={on}
      aria-label={on ? 'Mostrar los montos' : 'Ocultar los montos'}
      title={on ? 'Mostrar los montos (P)' : 'Ocultar los montos (P)'}
    >
      <Icon name={on ? 'eyeOff' : 'eye'} size={18} />
    </button>
  );
}

export function Layout({ route, privacy, children }: { route: string; privacy: boolean; children: ReactNode }) {
  useShortcuts();
  return (
    <div className={`shell ${privacy ? 'is-private' : ''}`}>
      <aside className="sidebar">
        <a className="brand" href="#/">
          <img src="./icon.svg" alt="" width={32} height={32} />
          <span>Lifty</span>
        </a>
        <button className="btn btn-primary sidebar-add" onClick={() => openTxForm()}>
          <Icon name="plus" /> Nuevo movimiento
        </button>
        <button className="sidebar-search" onClick={openSearch}>
          <Icon name="search" size={16} />
          <span className="grow">Buscar en todo</span>
          <kbd>/</kbd>
        </button>
        <nav aria-label="Secciones">
          {NAV.map((n) => (
            <a key={n.href} href={`#${n.href}`} className={`side-link ${n.match.test(route) ? 'on' : ''}`}>
              <Icon name={n.icon} />
              {n.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <SyncBadge />
          <PrivacyButton on={privacy} />
        </div>
        <p className="shortcuts muted small">
          Atajos: <kbd>N</kbd> nuevo · <kbd>/</kbd> buscar · <kbd>P</kbd> ocultar montos
        </p>
      </aside>

      <main className="main">
        <UpdateBanner />
        <div className="mobile-top">
          <a className="brand" href="#/">
            <img src="./icon.svg" alt="" width={26} height={26} />
            <span>Lifty</span>
          </a>
          <div className="mobile-top-actions">
            <button className="icon-btn" onClick={openSearch} aria-label="Buscar en todo">
              <Icon name="search" size={18} />
            </button>
            <PrivacyButton on={privacy} />
            <SyncBadge />
          </div>
        </div>
        {children}
      </main>

      <nav className="tabbar" aria-label="Secciones">
        {NAV.filter((n) => MOBILE.includes(n.href)).map((n, i) => (
          <TabLink
            key={n.href}
            n={n}
            on={
              n.match.test(route) ||
              (n.href === '/mas' &&
                /^\/(anio|informes|tarjeta|ahorro|peso|cuentas|deudas|alimentacion|stock|rutinas|estudio|semana|suscripciones|vencimientos|metas|recetas|simulador|diario)/.test(
                  route,
                ))
            }
            first={i === 2}
          />
        ))}
      </nav>
    </div>
  );
}

function TabLink({ n, on, first }: { n: (typeof NAV)[number]; on: boolean; first: boolean }) {
  return (
    <>
      {first && (
        <button className="fab" onClick={() => openTxForm()} aria-label="Nuevo movimiento">
          <Icon name="plus" size={26} />
        </button>
      )}
      <a href={`#${n.href}`} className={`tab ${on ? 'on' : ''}`}>
        <Icon name={n.icon} />
        <span>{n.label}</span>
      </a>
    </>
  );
}

function UpdateBanner() {
  const available = useUpdateAvailable();
  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <span>✨ Hay una versión nueva de Lifty.</span>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>
        Actualizar
      </button>
    </div>
  );
}

export function SyncBadge() {
  const { status, outbox, lastSync, local, live } = useSync();
  const pending = outbox.length;
  let label: string;
  let icon: IconName = 'cloud';
  let tone = 'ok';
  if (status === 'offline') {
    label = pending ? `Sin conexión · ${pending} sin enviar` : 'Sin conexión';
    icon = 'cloudOff';
    tone = 'warn';
  } else if (status === 'syncing' || status === 'loading') {
    label = 'Sincronizando…';
    icon = 'sync';
  } else if (status === 'error' || status === 'unauthorized') {
    label = status === 'unauthorized' ? 'Sin vincular' : 'Error al sincronizar';
    icon = 'cloudOff';
    tone = 'bad';
  } else {
    label = local ? 'En esta compu' : 'Sincronizado';
  }
  const title = [
    lastSync ? `Última sincronización: ${new Date(lastSync).toLocaleString('es-UY')}` : null,
    live ? 'En vivo: los cambios de los otros dispositivos llegan al instante' : null,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <button
      className={`sync-badge sync-${tone} ${live && tone === 'ok' ? 'is-live' : ''}`}
      onClick={() => void sync()}
      title={title || undefined}
    >
      <Icon name={icon} size={16} className={status === 'syncing' ? 'spin' : ''} />
      <span>{label}</span>
    </button>
  );
}
