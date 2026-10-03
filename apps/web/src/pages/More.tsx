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
      { href: '/simulador', icon: 'card', label: '¿Me lo puedo comprar?', hint: 'Simulá una compra al contado o en cuotas' },
      { href: '/metas', icon: 'chart', label: 'Metas del año', hint: 'Ahorro, peso, estudio y hábitos: si vas al día' },
      { href: '/semana', icon: 'calendar', label: 'Tu semana', hint: 'Gastos, ahorro, rutinas, estudio y peso de la semana' },
    ],
  },
  {
    title: 'Presupuesto',
    items: [
      { href: '/sueldos', icon: 'wallet', label: 'Sueldos e ingresos', hint: 'Líquido, aguinaldo, salario vacacional' },
      { href: '/fijos', icon: 'repeat', label: 'Gastos fijos', hint: 'Mensuales, anuales o cada N meses' },
      {
        href: '/suscripciones',
        icon: 'repeat',
        label: 'Lo que pagás siempre',
        hint: 'Suscripciones: por mes, por año y aumentos',
      },
      { href: '/categorias', icon: 'tag', label: 'Categorías', hint: 'Y cuánto querés gastar en cada una' },
    ],
  },
  {
    title: 'Casa',
    items: [
      { href: '/recetas', icon: 'food', label: 'Recetas', hint: 'Qué podés cocinar con lo que tenés y cuánto sale' },
      { href: '/vencimientos', icon: 'bell', label: 'Vencimientos', hint: 'Cédula, libreta, seguro, service, garantías' },
      { href: '/stock', icon: 'box', label: 'Stock', hint: 'Lo que tenés, cuánto te dura, lista de compras y vencimientos' },
    ],
  },
  {
    title: 'Salud',
    items: [
      { href: '/diario', icon: 'edit', label: 'Diario', hint: 'Sueño y ánimo, y cómo influyen en tu plata y tus rutinas' },
      { href: '/rutinas', icon: 'check', label: 'Rutinas', hint: 'Hábitos del día, estudio, agua, ejercicio y rachas' },
      { href: '/estudio', icon: 'calendar', label: 'Estudio', hint: 'Materias, examen, cuánto estudiar por día y cronómetro' },
      { href: '/peso', icon: 'scale', label: 'Peso', hint: 'Pesajes, tendencia, IMC y meta' },
    ],
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
