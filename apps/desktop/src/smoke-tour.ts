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

  // Tildar un pendiente y abrir el cierre de mes.
  await go('/presupuesto');
  $<HTMLButtonElement>('.planned .check')?.click();
  await sleep(150);
  clickText('.receipt button', 'Cerrar mes');
  await sleep(150);
  check('presupuesto');
  await closeSheet();

  await go('/');
  return problems;
}
