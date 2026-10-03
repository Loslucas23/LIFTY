import { useEffect, type ReactNode } from 'react';
import { Layout } from './components/Layout';
import { TxFormHost } from './components/TxForm';
import { Toasts, toast } from './components/ui';
import { match, useRoute } from './lib/router';
import { useSync } from './lib/store';
import { onSyncError } from './lib/sync';
import { Budget } from './pages/Budget';
import { Card } from './pages/Card';
import { Accounts, Categories, SettingsPage } from './pages/Config';
import { Connect, Pair } from './pages/Connect';
import { Backup, ImportExcel } from './pages/Data';
import { Home } from './pages/Home';
import { More } from './pages/More';
import { Movements } from './pages/Movements';
import { FixedList, Incomes } from './pages/Plans';
import { Savings } from './pages/Savings';
import { Weight } from './pages/Weight';
import { Year } from './pages/Year';

const ROUTES: [string, (p: Record<string, string>) => ReactNode][] = [
  ['/', () => <Home />],
  ['/movimientos', () => <Movements />],
  ['/movimientos/:month', (p) => <Movements month={p.month} />],
  ['/presupuesto', () => <Budget />],
  ['/presupuesto/:month', (p) => <Budget month={p.month} />],
  ['/anio', () => <Year />],
  ['/anio/:year', (p) => <Year year={p.year} />],
  ['/tarjeta', () => <Card />],
  ['/ahorro', () => <Savings />],
  ['/mas', () => <More />],
  ['/sueldos', () => <Incomes />],
  ['/fijos', () => <FixedList />],
  ['/categorias', () => <Categories />],
  ['/cuentas', () => <Accounts />],
  ['/ajustes', () => <SettingsPage />],
  ['/conectar', () => <Connect />],
  ['/importar', () => <ImportExcel />],
  ['/respaldo', () => <Backup />],
  ['/peso', () => <Weight />],
];

export function App() {
  const route = useRoute();
  const { status, records } = useSync();

  useEffect(() => {
    const off = onSyncError((msg) => toast(msg, { tone: 'error' }));
    return () => {
      off();
    };
  }, []);
  // Ojo: en Chromium nuevo window.scrollTo() devuelve una promesa. Un efecto no puede
  // devolver nada que no sea una función de limpieza (React la ejecutaría y fallaría).
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  const pair = match('/vincular/:code', route) ?? (match('/vincular', route) ? {} : null);
  if (pair || status === 'unauthorized') {
    return (
      <>
        <Pair code={pair?.code} />
        <Toasts />
      </>
    );
  }

  if (status === 'loading' && Object.keys(records).length === 0) {
    return (
      <div className="splash">
        <img src="./icon.svg" alt="" width={64} height={64} />
        <p className="muted">Cargando Lifty…</p>
      </div>
    );
  }

  let page: ReactNode = null;
  for (const [pattern, render] of ROUTES) {
    const params = match(pattern, route);
    if (params) {
      page = render(params);
      break;
    }
  }

  return (
    <>
      <Layout route={route}>{page ?? <Home />}</Layout>
      <TxFormHost />
      <Toasts />
    </>
  );
}
