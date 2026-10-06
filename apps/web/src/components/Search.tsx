import { useState, useSyncExternalStore } from 'react';
import { fold, searchAll, type SearchKind, type SearchResult } from '@lifty/core';
import { money, parseAmount } from '../lib/format';
import { navigate } from '../lib/router';
import { useData } from '../lib/store';
import { openFixedForm, openIncomeForm } from './Editors';
import { Icon } from './Icon';
import { openTxForm } from './TxForm';
import { Sheet } from './ui';

/** Buscar en todo: movimientos, stock, recetas, rutinas, metas… y las pantallas. Tecla / o Ctrl+K. */
let open = false;
const listeners = new Set<() => void>();
function setOpen(v: boolean) {
  open = v;
  listeners.forEach((fn) => fn());
}
export const openSearch = () => setOpen(true);

const PAGES: { label: string; path: string; words: string }[] = [
  { label: 'Inicio', path: '/', words: 'hoy home' },
  { label: 'Movimientos', path: '/movimientos', words: 'gastos ingresos lista' },
  { label: 'Presupuesto', path: '/presupuesto', words: 'mes categorias cerrar' },
  { label: 'Ahorro', path: '/ahorro', words: 'metas ahorrar' },
  { label: 'Cuentas', path: '/cuentas', words: 'banco brou itau efectivo saldos cuadrar' },
  { label: 'Deudas', path: '/deudas', words: 'prestamo me deben debo' },
  { label: 'Tarjeta de crédito', path: '/tarjeta', words: 'cuotas resumen pagar' },
  { label: 'Tarjeta de alimentación', path: '/alimentacion', words: 'comida' },
  { label: 'Stock', path: '/stock', words: 'despensa heladera comida compras lista super precios vence' },
  { label: 'Lista del súper', path: '/lista', words: 'compras supermercado mandados lo de siempre precios' },
  { label: 'Recetas', path: '/recetas', words: 'cocinar comida' },
  { label: 'Rutinas', path: '/rutinas', words: 'habitos agua gym ejercicio' },
  { label: 'Estudio', path: '/estudio', words: 'examen materias facultad' },
  { label: 'Diario', path: '/diario', words: 'sueño dormir animo' },
  { label: 'Peso', path: '/peso', words: 'kilos balanza' },
  { label: 'Desafíos', path: '/desafios', words: 'reto desafio juego meta corta' },
  { label: 'Tu salud (puntaje)', path: '/salud', words: 'salud financiera puntaje fondo emergencia colchon balance vida' },
  { label: 'Piloto automático', path: '/piloto', words: 'automatico reglas debito solo automatizar' },
  { label: 'Calendario', path: '/calendario', words: 'agenda dias mes cobros pagos vencimientos examenes' },
  { label: 'Vacaciones y mes difícil', path: '/epocas', words: 'viaje vacaciones modo ajustado tope dificil' },
  { label: 'Tu año', path: '/tu-anio', words: 'retrospectiva wrapped anual resumen año' },
  { label: 'Resumen del mes', path: '/resumen', words: 'mes balance como me fue animo sueño' },
  { label: 'Informes', path: '/informes', words: 'graficos patrimonio reportes' },
  { label: 'Resumen del año', path: '/anio', words: 'anual' },
  { label: 'Tu semana', path: '/semana', words: 'resumen semanal' },
  { label: 'Suscripciones', path: '/suscripciones', words: 'netflix spotify recurrentes' },
  { label: 'Vencimientos', path: '/vencimientos', words: 'cedula seguro documentos' },
  { label: 'Metas del año', path: '/metas', words: 'objetivos' },
  { label: '¿Me lo puedo comprar?', path: '/simulador', words: 'simulador cuotas comprar' },
  { label: 'Sueldos e ingresos', path: '/sueldos', words: 'sueldo aguinaldo' },
  { label: 'Gastos fijos', path: '/fijos', words: 'alquiler ute antel' },
  { label: 'Categorías', path: '/categorias', words: '' },
  { label: 'Ajustes', path: '/ajustes', words: 'dolar cotizacion nombre configuracion' },
  { label: 'Importar Excel', path: '/importar', words: 'planilla' },
  { label: 'Respaldo y exportar', path: '/respaldo', words: 'backup excel exportar' },
  { label: 'Vincular el celular', path: '/conectar', words: 'qr sincronizar' },
];

const ROUTE: Partial<Record<SearchKind, string>> = {
  stock: '/stock',
  recipe: '/recetas',
  habit: '/rutinas',
  subject: '/estudio',
  reminder: '/vencimientos',
  goal: '/ahorro',
  debt: '/deudas',
  account: '/cuentas',
  category: '/categorias',
};

interface Option {
  key: string;
  title: string;
  detail: string;
  amount?: string;
  run: () => void;
}

export function SearchHost() {
  const isOpen = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => open,
  );
  return isOpen ? <SearchSheet onClose={() => setOpen(false)} /> : null;
}

function SearchSheet({ onClose }: { onClose: () => void }) {
  const data = useData();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = fold(query);

  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const fromResult = (r: SearchResult): Option => ({
    key: `${r.kind}:${r.id}`,
    title: r.title,
    detail: r.detail,
    amount: r.amount !== undefined ? money(r.amount, r.currency) : undefined,
    run: go(() => {
      if (r.kind === 'movement') {
        const tx = data.transactions.find((t) => t.id === r.id);
        if (tx) openTxForm({ tx });
      } else if (r.kind === 'fixed') openFixedForm(r.id);
      else if (r.kind === 'income') openIncomeForm(r.id);
      else navigate(ROUTE[r.kind] ?? '/');
    }),
  });

  const options: Option[] = [];
  // "500 super" → cargar el gasto directo desde acá.
  const quick = /^(\d+(?:[.,]\d+)?)\s*(.*)$/.exec(query.trim());
  const amount = quick ? parseAmount(quick[1]) : null;
  if (quick && amount) {
    const description = quick[2].trim();
    options.push({
      key: 'quick',
      title: `Cargar gasto de ${money(amount)}${description ? ` · ${description}` : ''}`,
      detail: 'Nuevo movimiento',
      run: go(() => openTxForm({ preset: { kind: 'expense', amount, description } })),
    });
  }
  if (q.length >= 2) {
    for (const p of PAGES)
      if (fold(`${p.label} ${p.words}`).includes(q))
        options.push({ key: `page:${p.path}`, title: p.label, detail: 'Pantalla', run: go(() => navigate(p.path)) });
    options.push(...searchAll(data, query, 30).map(fromResult));
  }
  const current = Math.min(active, Math.max(0, options.length - 1));

  return (
    <Sheet title="Buscar" onClose={onClose}>
      <div className="search-box">
        <Icon name="search" size={18} />
        <input
          data-autofocus
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(Math.min(current + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(Math.max(current - 1, 0));
            } else if (e.key === 'Enter' && options[current]) {
              e.preventDefault();
              options[current].run();
            }
          }}
          placeholder="Arroz, UTE, #viaje, 1500… o «500 super» para cargar"
          aria-label="Buscar en todo"
        />
      </div>
      {q.length >= 2 && options.length === 0 ? (
        <p className="muted small search-empty">No encontré nada con «{query}».</p>
      ) : options.length === 0 ? (
        <p className="muted small search-empty">
          Busca en movimientos (por texto, categoría, cuenta, #etiqueta o monto), stock, recetas, rutinas, estudio, metas, deudas,
          vencimientos y pantallas.
        </p>
      ) : (
        <ul className="search-results" role="listbox" aria-label="Resultados">
          {options.map((o, i) => (
            <li key={o.key}>
              <button
                className={`search-result ${i === current ? 'on' : ''}`}
                role="option"
                aria-selected={i === current}
                onMouseEnter={() => setActive(i)}
                onClick={o.run}
              >
                <span className="grow">
                  {o.title}
                  <small className="muted"> · {o.detail}</small>
                </span>
                {o.amount && <strong className="small">{o.amount}</strong>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
