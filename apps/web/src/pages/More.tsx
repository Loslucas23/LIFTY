import { Icon, type IconName } from '../components/Icon';
import { PageHeader, Section } from '../components/ui';
import { useSync } from '../lib/store';

const GROUPS: { title: string; items: { href: string; icon: IconName; label: string; hint: string }[] }[] = [
  {
    title: 'Plata',
    items: [
      {
        href: '/plata',
        icon: 'wallet',
        label: 'Tu plata',
        hint: 'Cuánto te sobra de verdad, dónde está cada peso, metas, inversiones y patrimonio',
      },
      {
        href: '/conciliar',
        icon: 'upload',
        label: 'Conciliar con el banco',
        hint: 'Subí el Excel o CSV del banco o la tarjeta: lo que falta anotar y lo repetido',
      },
      {
        href: '/dia-a-dia',
        icon: 'tag',
        label: 'Día a día',
        hint: 'Con qué tarjeta pagar hoy, gastos hormiga, ¿contado o cuotas?, cuánto te sale cada uso',
      },
      {
        href: '/cuentas',
        icon: 'bank',
        label: 'Cuentas y saldos',
        hint: 'BROU, Itaú, efectivo, dólares, inversiones; transferir',
      },
      { href: '/alimentacion', icon: 'food', label: 'Tarjeta de alimentación', hint: 'Va aparte: saldo, carga y cuánto por día' },
      { href: '/tarjeta', icon: 'card', label: 'Tarjeta de crédito', hint: 'Cuotas, resumen y lo que vas a pagar' },
      { href: '/ahorro', icon: 'piggy', label: 'Ahorro', hint: 'Meta del mes y metas con fecha' },
      { href: '/deudas', icon: 'people', label: 'Deudas y préstamos', hint: 'Lo que te deben y lo que debés' },
      {
        href: '/grupos',
        icon: 'people',
        label: 'Gastos en grupo',
        hint: 'La casa, la pareja o un viaje: quién puso cuánto y cómo quedar a mano',
      },
      {
        href: '/desafios',
        icon: 'check',
        label: 'Desafíos',
        hint: 'Metas cortas que se siguen solas: 7 días sin pedir comida, ahorrar $X…',
      },
      {
        href: '/salud',
        icon: 'chart',
        label: 'Tu salud',
        hint: 'Puntaje de salud financiera, fondo de emergencia y balance de vida',
      },
      {
        href: '/piloto',
        icon: 'sync',
        label: 'Piloto automático',
        hint: 'Lo que Lifty hace solo: débitos, sueldo, ahorro, lista y reglas',
      },
      {
        href: '/calendario',
        icon: 'calendar',
        label: 'Calendario',
        hint: 'Cobros, pagos, vencimientos, exámenes y cómo te fue cada día',
      },
      {
        href: '/epocas',
        icon: 'calendar',
        label: 'Vacaciones y mes difícil',
        hint: 'Presupuesto del viaje (con su etiqueta) o un tope por día más bajo',
      },
      { href: '/tu-anio', icon: 'chart', label: 'Tu año', hint: 'Tu año en Lifty: en qué se fue, tu mejor mes, rachas…' },
      { href: '/resumen', icon: 'chart', label: 'Resumen del mes', hint: 'Plata, rutinas, sueño, ánimo y peso del mes juntos' },
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
      {
        href: '/lista',
        icon: 'cart',
        label: 'Lista del súper',
        hint: 'Ordenada por sector, lo de siempre, dónde sale menos y qué subió',
      },
      {
        href: '/menu',
        icon: 'calendar',
        label: 'Menú de la semana',
        hint: 'Qué comer cada día, lo que falta comprar y cuánto sale',
      },
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
