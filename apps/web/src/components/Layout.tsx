import type { ReactNode } from 'react';
import { useSync } from '../lib/store';
import { sync } from '../lib/sync';
import { Icon, type IconName } from './Icon';
import { openTxForm } from './TxForm';

const NAV: { href: string; label: string; icon: IconName; match: RegExp }[] = [
  { href: '/', label: 'Inicio', icon: 'home', match: /^\/$/ },
  { href: '/movimientos', label: 'Movimientos', icon: 'list', match: /^\/movimientos/ },
  { href: '/presupuesto', label: 'Presupuesto', icon: 'budget', match: /^\/presupuesto/ },
  { href: '/ahorro', label: 'Ahorro', icon: 'piggy', match: /^\/ahorro/ },
  { href: '/cuentas', label: 'Cuentas', icon: 'bank', match: /^\/(cuentas|deudas)/ },
  { href: '/alimentacion', label: 'Alimentación', icon: 'food', match: /^\/alimentacion/ },
  { href: '/tarjeta', label: 'Tarjeta', icon: 'card', match: /^\/tarjeta/ },
  { href: '/anio', label: 'Informes', icon: 'calendar', match: /^\/(anio|informes)/ },
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

export function Layout({ route, children }: { route: string; children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/">
          <img src="./icon.svg" alt="" width={32} height={32} />
          <span>Lifty</span>
        </a>
        <button className="btn btn-primary sidebar-add" onClick={() => openTxForm()}>
          <Icon name="plus" /> Nuevo movimiento
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
        </div>
      </aside>

      <main className="main">
        <div className="mobile-top">
          <a className="brand" href="#/">
            <img src="./icon.svg" alt="" width={26} height={26} />
            <span>Lifty</span>
          </a>
          <SyncBadge />
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
              (n.href === '/mas' && /^\/(anio|informes|tarjeta|ahorro|peso|cuentas|deudas|alimentacion)/.test(route))
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

export function SyncBadge() {
  const { status, outbox, lastSync, local } = useSync();
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
  const title = lastSync ? `Última sincronización: ${new Date(lastSync).toLocaleString('es-UY')}` : undefined;
  return (
    <button className={`sync-badge sync-${tone}`} onClick={() => void sync()} title={title}>
      <Icon name={icon} size={16} className={status === 'syncing' ? 'spin' : ''} />
      <span>{label}</span>
    </button>
  );
}
