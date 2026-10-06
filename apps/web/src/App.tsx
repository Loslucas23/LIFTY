import { useEffect, type ReactNode } from 'react';
import { EditorsHost } from './components/Editors';
import { Layout } from './components/Layout';
import { SearchHost } from './components/Search';
import { SetupHost } from './components/Setup';
import { TxFormHost } from './components/TxForm';
import { Toasts, toast } from './components/ui';
import { match, useRoute } from './lib/router';
import { useSync } from './lib/store';
import { onSyncError } from './lib/sync';
import { Budget } from './pages/Budget';
import { Card } from './pages/Card';
import { Accounts } from './pages/Accounts';
import { Debts } from './pages/Debts';
import { Food } from './pages/Food';
import { Categories, SettingsPage } from './pages/Config';
import { Connect, Pair } from './pages/Connect';
import { Backup, ImportExcel } from './pages/Data';
import { Home } from './pages/Home';
import { More } from './pages/More';
import { Movements } from './pages/Movements';
import { FixedList, Incomes } from './pages/Plans';
import { Savings } from './pages/Savings';
import { Weight } from './pages/Weight';
import { Reports } from './pages/Reports';
import { Stock } from './pages/Stock';
import { LifeCalendar } from './pages/LifeCalendar';
import { Periods } from './pages/Periods';
import { Retro } from './pages/Retro';
import { Routines } from './pages/Routines';
import { Study } from './pages/Study';
import { Recipes } from './pages/Recipes';
import { Journal } from './pages/Journal';
import { Simulator } from './pages/Simulator';
import { Review } from './pages/Review';
import { Autopilot, AutopilotRunner } from './pages/Autopilot';
import { Health } from './pages/Health';
import { Challenges } from './pages/Challenges';
import { Recurring, Reminders, Week, YearGoals } from './pages/Extras';
import { usePrivacy } from './lib/privacy';
import { Year } from './pages/Year';

const ROUTES: [string, (p: Record<string, string>) => ReactNode][] = [
  ['/', () => <Home />],
  ['/movimientos', () => <Movements />],
  ['/movimientos/:month', (p) => <Movements month={p.month} />],
  ['/presupuesto', () => <Budget />],
  ['/presupuesto/:month', (p) => <Budget month={p.month} />],
  ['/anio', () => <Year />],
  ['/anio/:year', (p) => <Year year={p.year} />],
  ['/informes', () => <Reports />],
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
  ['/alimentacion', () => <Food />],
  ['/deudas', () => <Debts />],
  ['/stock', () => <Stock />],
  ['/lista', () => <Stock initialTab="lista" />],
  ['/calendario', () => <LifeCalendar />],
  ['/calendario/:month', (p) => <LifeCalendar month={p.month} />],
  ['/epocas', () => <Periods />],
  ['/tu-anio', () => <Retro />],
  ['/tu-anio/:year', (p) => <Retro year={p.year} />],
  ['/rutinas', () => <Routines />],
  ['/estudio', () => <Study />],
  ['/semana', () => <Week />],
  ['/suscripciones', () => <Recurring />],
  ['/vencimientos', () => <Reminders />],
  ['/metas', () => <YearGoals />],
  ['/recetas', () => <Recipes />],
  ['/diario', () => <Journal />],
  ['/simulador', () => <Simulator />],
  ['/resumen', () => <Review />],
  ['/piloto', () => <Autopilot />],
  ['/salud', () => <Health />],
  ['/desafios', () => <Challenges />],
  ['/resumen/:month', (p) => <Review month={p.month} />],
];

export function App() {
  const route = useRoute();
  const { status, records } = useSync();
  // Al prender o apagar el modo privado se vuelve a dibujar todo con los montos ocultos.
  const privacy = usePrivacy();

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
      <Layout route={route} privacy={privacy}>
        {page ?? <Home />}
      </Layout>
      <TxFormHost />
      <EditorsHost />
      <SearchHost />
      <SetupHost />
      <AutopilotRunner />
      <Toasts />
    </>
  );
}
