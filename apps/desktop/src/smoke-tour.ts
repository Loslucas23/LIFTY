/**
 * Recorrido de prueba que corre ADENTRO de la página (Electron real en CI, o Playwright):
 * visita todas las pantallas, abre los formularios y guarda un sueldo y un gasto.
 * Devuelve la lista de problemas encontrados (vacía = todo bien).
 *
 * Tiene que ser autocontenida: se serializa con toString() y se ejecuta en la página.
 */
export async function smokeTour(): Promise<string[]> {
  const problems: string[] = [];
  const errors: string[] = [];
  window.addEventListener('error', (e) => errors.push(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`promesa: ${String((e as PromiseRejectionEvent).reason)}`));

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & Element>(sel);
  const waitFor = async (sel: string, ms = 4000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const el = $(sel);
      if (el) return el as HTMLElement;
      await sleep(50);
    }
    return null;
  };
  const check = (where: string) => {
    const boundary = $('.error-detail');
    if (boundary) problems.push(`${where}: ${boundary.textContent}`);
    if (!$('.page') && !$('.pair-screen')) problems.push(`${where}: la pantalla quedó vacía`);
    while (errors.length) problems.push(`${where}: ${errors.shift()}`);
  };
  const go = async (route: string) => {
    window.location.hash = route;
    await sleep(250);
    await waitFor('.page');
    check(route);
  };
  /** Escribe en un input controlado por React. */
  const type = (el: HTMLInputElement | null, value: string) => {
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  const clickText = (sel: string, text: string) => {
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((x) => x.textContent?.includes(text));
    el?.click();
    return !!el;
  };
  const closeSheet = async () => {
    $<HTMLButtonElement>('.sheet [aria-label="Cerrar"]')?.click();
    await sleep(150);
  };

  const routes = [
    '/',
    '/movimientos',
    '/presupuesto',
    '/anio',
    '/tarjeta',
    '/ahorro',
    '/mas',
    '/sueldos',
    '/fijos',
    '/categorias',
    '/cuentas',
    '/ajustes',
    '/conectar',
    '/importar',
    '/respaldo',
    '/peso',
    '/',
  ];
  for (const r of routes) await go(r);

  // Cargar un sueldo (lo que fallaba).
  await go('/sueldos');
  if (!clickText('.page-head button', 'Agregar')) problems.push('sueldos: no encontré "Agregar"');
  if (!(await waitFor('.sheet'))) problems.push('sueldos: no se abrió el formulario');
  type($('.sheet input[placeholder="Ej: Sueldo Equim"]'), 'Sueldo de prueba');
  type($('.sheet input[placeholder="50400"]'), '50400');
  await sleep(100);
  check('formulario de sueldo');
  $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
  if (!(await waitFor('.item-card'))) problems.push('sueldos: no se guardó el sueldo');
  check('guardar sueldo');

  // Cargar un gasto desde el botón principal.
  await go('/');
  ($('.sidebar-add') ?? $('.fab'))?.click();
  if (!(await waitFor('.sheet .amount-input input'))) problems.push('inicio: no se abrió "Nuevo movimiento"');
  type($('.sheet .amount-input input'), '8000+600');
  $<HTMLButtonElement>('.sheet .chip')?.click();
  await sleep(100);
  check('formulario de movimiento');
  $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
  await sleep(300);
  if ($('.sheet')) {
    problems.push('inicio: el movimiento no se guardó');
    await closeSheet();
  }
  check('guardar movimiento');

  // Anotar un peso.
  await go('/peso');
  clickText('.page-head button', 'Anotar peso');
  if (!(await waitFor('.sheet .amount-input input'))) problems.push('peso: no se abrió el formulario');
  type($('.sheet .amount-input input'), '80,5');
  $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
  if (!(await waitFor('.chart svg'))) problems.push('peso: no se guardó el pesaje');
  check('peso');

  // Armar el presupuesto con el asistente.
  await go('/presupuesto');
  clickText('.page-head button', 'Armar presupuesto');
  if (!(await waitFor('.wizard-steps'))) problems.push('presupuesto: no se abrió el asistente');
  const addRow = async (values: string[]) => {
    const inputs = [...document.querySelectorAll<HTMLInputElement>('.sheet .add-row input')];
    values.forEach((v, i) => type(inputs[i], v));
    await sleep(50);
    clickText('.sheet .add-row button', 'Agregar');
    await sleep(250);
  };
  const rowsBefore = document.querySelectorAll('.sheet .plan-row').length;
  await addRow(['Sueldo prueba', '40000']);
  if (document.querySelectorAll('.sheet .plan-row').length <= rowsBefore) problems.push('asistente: no se agregó el sueldo');
  clickText('.sheet-foot button', 'Siguiente');
  await sleep(200);
  const fixedBefore = document.querySelectorAll('.sheet .plan-row').length;
  await addRow(['Gimnasio prueba', '1600', '10']);
  const gym = () =>
    [...document.querySelectorAll<HTMLElement>('.sheet .plan-row')].find((r) => r.textContent?.includes('Gimnasio prueba'));
  if (!gym()) problems.push('asistente: no se agregó el gasto fijo');
  [...(gym()?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find((b) => b.textContent?.includes('Ya no lo pago'))
    ?.click();
  await sleep(250);
  if (gym()) problems.push('asistente: "Ya no lo pago" no sacó el gasto fijo');
  if (document.querySelectorAll('.sheet .plan-row').length !== fixedBefore)
    problems.push('asistente: quedaron gastos fijos de más');
  clickText('.sheet-foot button', 'Siguiente');
  await sleep(200);
  type($('.sheet .budget-input input'), '5000');
  clickText('.sheet-foot button', 'Guardar presupuesto');
  if (!(await waitFor('.sheet .receipt-total'))) problems.push('asistente: no llegó al resumen');
  check('asistente');
  clickText('.sheet-foot button', 'Listo');
  await sleep(250);
  if ($('.sheet')) problems.push('asistente: no se cerró');
  if (!(await waitFor('.cat-row'))) problems.push('presupuesto: no aparece el presupuesto por categoría');
  const catText = $('.cat-bars')?.textContent ?? '';
  if (!catText.includes('Te quedan') && !catText.includes('Te pasaste')) problems.push('presupuesto: no muestra cuánto queda');

  // Cambiar el presupuesto de una categoría solo para este mes.
  $<HTMLButtonElement>('.cat-row')?.click();
  if (!(await waitFor('.sheet .amount-input input'))) problems.push('presupuesto: no se abrió el editor de categoría');
  type($('.sheet .amount-input input'), '6000');
  await sleep(100);
  clickText('.sheet .segmented button', 'Solo');
  await sleep(100);
  $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
  if (!(await waitFor('.cat-row .tag', 2000))) problems.push('presupuesto: no quedó marcado "solo este mes"');
  check('editar presupuesto de categoría');

  // Menú de un gasto fijo / sueldo.
  $<HTMLButtonElement>('.planned-more')?.click();
  if (!(await waitFor('.action-list'))) problems.push('presupuesto: no se abrió el menú de opciones');
  await closeSheet();
  check('menú de opciones');

  // Tildar un pendiente, tildar todos y abrir el cierre de mes.
  await go('/presupuesto');
  $<HTMLButtonElement>('.planned .check')?.click();
  await sleep(150);
  clickText('.section-head button', 'Tildar todos');
  await sleep(150);
  clickText('.receipt button', 'Cerrar mes');
  await sleep(150);
  check('presupuesto');
  await closeSheet();

  await go('/');
  return problems;
}
