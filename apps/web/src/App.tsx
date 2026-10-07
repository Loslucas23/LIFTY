import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { DebtReminderHost } from './components/DebtReminder';
import { EditorsHost } from './components/Editors';
import { Layout } from './components/Layout';
import { SearchHost } from './components/Search';
import { SetupHost } from './components/Setup';
import { TxFormHost } from './components/TxForm';
import { Toasts, toast } from './components/ui';
import { match, useRoute } from './lib/router';
import { useSync } from './lib/store';
import { onSyncError } from './lib/sync';
import { Connect, Pair } from './pages/Connect';
import { Home } from './pages/Home';
import { Plata } from './pages/Plata';
import { Periods } from './pages/Periods';
import { Journal } from './pages/Journal';
import { Review } from './pages/Review';
import { Reports } from './pages/Reports';
import { Autopilot, AutopilotRunner } from './pages/Autopilot';
import { Health } from './pages/Health';
import { Challenges } from './pages/Challenges';
import { usePrivacy } from './lib/privacy';

/**
 * Las pantallas que no usa Inicio se bajan cuando hacen falta (la app abre más rápido) y,
 * con la app ya quieta, se traen todas de a una: así después abren al instante y quedan
 * guardadas para usar sin conexión.
 */
const loaders: (() => Promise<unknown>)[] = [];
function lazyPage<M, K extends keyof M>(load: () => Promise<M>, name: K): M[K] {
  let ready: ComponentType<Record<string, unknown>> | null = null;
  let pending: Promise<M> | null = null;
  const get = () =>
    (pending ??= load().then(
      (m) => {
        ready = m[name] as ComponentType<Record<string, unknown>>;
        return m;
      },
      (err) => {
        // Si falló (sin conexión, versión nueva), la próxima vez que se abra se vuelve a pedir.
        pending = null;
        Lazy = makeLazy();
        throw err;
      },
    ));
  loaders.push(get);
  const makeLazy = () => lazy(() => get().then((m) => ({ default: m[name] as ComponentType<Record<string, unknown>> })));
  let Lazy = makeLazy();
  // Si ya está bajada se dibuja directo (sin el instante de "cargando"). Se decide al montar
  // para no cambiar de componente a mitad de uso.
  function Page(props: Record<string, unknown>) {
    const [C] = useState(() => ready ?? Lazy);
    return <C {...props} />;
  }
  return Page as M[K];
}

const Movements = lazyPage(() => import('./pages/Movements'), 'Movements');
const Budget = lazyPage(() => import('./pages/Budget'), 'Budget');
const Year = lazyPage(() => import('./pages/Year'), 'Year');
const Card = lazyPage(() => import('./pages/Card'), 'Card');
const Savings = lazyPage(() => import('./pages/Savings'), 'Savings');
const More = lazyPage(() => import('./pages/More'), 'More');
const Incomes = lazyPage(() => import('./pages/Plans'), 'Incomes');
const FixedList = lazyPage(() => import('./pages/Plans'), 'FixedList');
const Categories = lazyPage(() => import('./pages/Config'), 'Categories');
const SettingsPage = lazyPage(() => import('./pages/Config'), 'SettingsPage');
const Accounts = lazyPage(() => import('./pages/Accounts'), 'Accounts');
const ImportExcel = lazyPage(() => import('./pages/Data'), 'ImportExcel');
const Backup = lazyPage(() => import('./pages/Data'), 'Backup');
const Weight = lazyPage(() => import('./pages/Weight'), 'Weight');
const Food = lazyPage(() => import('./pages/Food'), 'Food');
const Debts = lazyPage(() => import('./pages/Debts'), 'Debts');
const Stock = lazyPage(() => import('./pages/Stock'), 'Stock');
const LifeCalendar = lazyPage(() => import('./pages/LifeCalendar'), 'LifeCalendar');
const Retro = lazyPage(() => import('./pages/Retro'), 'Retro');
const Study = lazyPage(() => import('./pages/Study'), 'Study');
const Recipes = lazyPage(() => import('./pages/Recipes'), 'Recipes');
const Simulator = lazyPage(() => import('./pages/Simulator'), 'Simulator');
const Menu = lazyPage(() => import('./pages/Menu'), 'Menu');
const Groups = lazyPage(() => import('./pages/Groups'), 'Groups');
const GroupDetail = lazyPage(() => import('./pages/Groups'), 'GroupDetail');
const Reconcile = lazyPage(() => import('./pages/Reconcile'), 'Reconcile');
const DayToDay = lazyPage(() => import('./pages/DayToDay'), 'DayToDay');
const Routines = lazyPage(() => import('./pages/Routines'), 'Routines');
const Week = lazyPage(() => import('./pages/Extras'), 'Week');
const Recurring = lazyPage(() => import('./pages/Extras'), 'Recurring');
const Reminders = lazyPage(() => import('./pages/Extras'), 'Reminders');
const YearGoals = lazyPage(() => import('./pages/Extras'), 'YearGoals');

/** Mientras baja una pantalla: el esqueleto, nunca la pantalla vacía. */
function PageLoading() {
  return (
    <div className="page page-loading" aria-busy="true">
      <div className="skel skel-title" />
      <div className="skel skel-card" />
      <div className="skel skel-card short" />
    </div>
  );
}

/** Si una pantalla no se pudo bajar (sin conexión o versión nueva), ofrecer reintentar. */
class PageError extends Component<{ children: ReactNode; route: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(error: unknown) {
    // Los errores de la pantalla en sí los muestra el ErrorBoundary general.
    const msg = String((error as Error)?.message ?? error);
    if (/dynamically imported module|Importing a module script|Failed to fetch|error loading/i.test(msg)) return { failed: true };
    throw error;
  }
  componentDidUpdate(prev: { route: string }) {
    if (prev.route !== this.props.route && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page">
        <div className="card pad empty">
          <p>No se pudo abrir esta pantalla. ¿Estás sin conexión con la compu?</p>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reintentar
            </button>
            <button className="btn" onClick={() => (window.location.hash = '/')}>
              Ir al inicio
            </button>
          </div>
        </div>
      </div>
    );
  }
}

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
  ['/plata', () => <Plata />],
  ['/dia-a-dia', () => <DayToDay />],
  ['/conciliar', () => <Reconcile />],
  ['/grupos', () => <Groups />],
  ['/menu', () => <Menu />],
  ['/grupos/:id', (p) => <GroupDetail id={p.id} />],
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
  // Con la app abierta y quieta, traer el resto de las pantallas de a una.
  const ready = status !== 'loading' || Object.keys(records).length > 0;
  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const idle = (f: () => void) =>
      'requestIdleCallback' in window ? window.requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 200);
    const next = (i: number) => {
      if (stop || i >= loaders.length) return;
      idle(() => {
        loaders[i]().then(
          () => next(i + 1),
          () => next(i + 1),
        );
      });
    };
    const t = setTimeout(() => next(0), 1500);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [ready]);

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
        <PageError route={route}>
          <Suspense fallback={<PageLoading />}>{page ?? <Home />}</Suspense>
        </PageError>
      </Layout>
      <TxFormHost />
      <EditorsHost />
      <SearchHost />
      <SetupHost />
      <DebtReminderHost />
      <AutopilotRunner />
      <Toasts />
    </>
  );
}
