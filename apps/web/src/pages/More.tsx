import { Icon, type IconName } from '../components/Icon';
import { PageHeader, Section } from '../components/ui';
import { useSync } from '../lib/store';

const GROUPS: { title: string; items: { href: string; icon: IconName; label: string; hint: string }[] }[] = [
  {
    title: 'Plata',
    items: [
      { href: '/cuentas', icon: 'bank', label: 'Cuentas y saldos', hint: 'BROU, Itaú, efectivo, dólares; transferir' },
      { href: '/alimentacion', icon: 'food', label: 'Tarjeta de alimentación', hint: 'Va aparte: saldo, carga y cuánto por día' },
      { href: '/tarjeta', icon: 'card', label: 'Tarjeta de crédito', hint: 'Cuotas, resumen y lo que vas a pagar' },
      { href: '/ahorro', icon: 'piggy', label: 'Ahorro', hint: 'Meta del mes y metas con fecha' },
      { href: '/deudas', icon: 'people', label: 'Deudas y préstamos', hint: 'Lo que te deben y lo que debés' },
      { href: '/informes', icon: 'chart', label: 'Informes', hint: 'El año mes a mes, tendencias y patrimonio' },
    ],
  },
  {
    title: 'Presupuesto',
    items: [
      { href: '/sueldos', icon: 'wallet', label: 'Sueldos e ingresos', hint: 'Líquido, aguinaldo, salario vacacional' },
      { href: '/fijos', icon: 'repeat', label: 'Gastos fijos', hint: 'Mensuales, anuales o cada N meses' },
      { href: '/categorias', icon: 'tag', label: 'Categorías', hint: 'Y cuánto querés gastar en cada una' },
    ],
  },
  {
    title: 'Casa',
    items: [
      { href: '/stock', icon: 'box', label: 'Stock', hint: 'Lo que tenés, cuánto te dura, lista de compras y vencimientos' },
    ],
  },
  {
    title: 'Salud',
    items: [{ href: '/peso', icon: 'scale', label: 'Peso', hint: 'Pesajes, tendencia, IMC y meta' }],
  },
  {
    title: 'Lifty',
    items: [
      { href: '/conectar', icon: 'phone', label: 'Conectar dispositivos', hint: 'Vinculá tu celular con un código QR' },
      { href: '/importar', icon: 'upload', label: 'Importar desde Excel', hint: 'Traé tu planilla de finanzas' },
      { href: '/respaldo', icon: 'download', label: 'Copia de seguridad', hint: 'Exportar a Excel, guardar o restaurar' },
      { href: '/ajustes', icon: 'settings', label: 'Ajustes', hint: 'Nombre, dólar, meta de ahorro, tema' },
    ],
  },
];

export function More() {
  const { local } = useSync();
  return (
    <div className="page">
      <PageHeader title="Más" />
      {GROUPS.map((g) => (
        <Section key={g.title} title={g.title}>
          <nav className="card menu">
            {g.items.map((i) => (
              <a key={i.href} href={`#${i.href}`} className="menu-item">
                <span className="menu-icon">
                  <Icon name={i.icon} />
                </span>
                <span>
                  <strong>{i.label}</strong>
                  <span className="muted small">{i.hint}</span>
                </span>
                <Icon name="right" size={18} className="muted" />
              </a>
            ))}
          </nav>
        </Section>
      ))}

      <p className="muted small center">
        Lifty está armado por módulos: después se pueden sumar hábitos, gimnasio o lo que se te ocurra.
      </p>
      {!local && <p className="muted small center">Estás usando Lifty desde otro dispositivo vinculado a tu compu.</p>}
    </div>
  );
}
