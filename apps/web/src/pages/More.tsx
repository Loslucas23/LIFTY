import { Icon, type IconName } from '../components/Icon';
import { PageHeader, Section } from '../components/ui';
import { useSync } from '../lib/store';

const GROUPS: { title: string; items: { href: string; icon: IconName; label: string; hint: string }[] }[] = [
  {
    title: 'Finanzas',
    items: [
      { href: '/anio', icon: 'calendar', label: 'Resumen del año', hint: 'Ingresos, gastos y saldo de cada mes' },
      { href: '/tarjeta', icon: 'card', label: 'Tarjeta de crédito', hint: 'Cuotas y lo que vas a pagar' },
      { href: '/ahorro', icon: 'piggy', label: 'Ahorro', hint: 'Metas en pesos y dólares' },
    ],
  },
  {
    title: 'Presupuesto',
    items: [
      { href: '/sueldos', icon: 'wallet', label: 'Sueldos', hint: 'Nominal, descuentos, líquido y aguinaldo' },
      { href: '/fijos', icon: 'repeat', label: 'Gastos fijos', hint: 'Alquiler, servicios, gimnasio…' },
      { href: '/categorias', icon: 'tag', label: 'Categorías y topes', hint: 'Cuánto querés gastar en cada cosa' },
      { href: '/cuentas', icon: 'bank', label: 'Cuentas y medios de pago', hint: 'Bancos, efectivo, tarjetas' },
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
      { href: '/ajustes', icon: 'settings', label: 'Ajustes', hint: 'Nombre, dólar, mes inicial' },
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
