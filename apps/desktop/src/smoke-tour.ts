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
    // Las pantallas se bajan cuando hacen falta: esperar la de verdad, no el esqueleto.
    await waitFor('.page:not(.page-loading)');
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
  const until = async (ok: () => boolean, ms = 2500) => {
    const end = Date.now() + ms;
    while (Date.now() < end && !ok()) await sleep(50);
    return ok();
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
    '/informes',
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
    '/cuentas',
    '/alimentacion',
    '/deudas',
    '/stock',
    '/rutinas',
    '/estudio',
    '/semana',
    '/suscripciones',
    '/vencimientos',
    '/metas',
    '/recetas',
    '/simulador',
    '/diario',
    '/resumen',
    '/piloto',
    '/salud',
    '/desafios',
    '/lista',
    '/plata',
    '/dia-a-dia',
    '/conciliar',
    '/grupos',
    '/menu',
    '/fechas',
    '/beneficios',
    '/compartir',
    '/calendario',
    '/epocas',
    '/tu-anio',
    '/',
  ];
  for (const r of routes) await go(r);

  // Cargar un sueldo (lo que fallaba).
  await go('/sueldos');
  if (!clickText('.page-head button', 'Agregar')) problems.push('sueldos: no encontré "Agregar"');
  if (!(await waitFor('.sheet'))) problems.push('sueldos: no se abrió el formulario');
  type($('.sheet input[placeholder="Ej: Sueldo de la empresa"]'), 'Sueldo de prueba');
  type($('.sheet input[placeholder="45000"]'), '45000');
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
  // Si el recorrido ya cargó este gasto antes, avisa "¿Ya lo cargaste?": es otro.
  if ($('.sheet .dup-note')) {
    $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
    await sleep(300);
  }
  if ($('.sheet')) {
    problems.push('inicio: el movimiento no se guardó');
    await closeSheet();
  }
  check('guardar movimiento');

  // Helpers para el formulario de movimientos.
  const openNew = async () => {
    ($('.sidebar-add') ?? $('.fab'))?.click();
    return !!(await waitFor('.sheet .amount-input input'));
  };
  const chip = (text: string, scope = '.sheet') =>
    [...document.querySelectorAll<HTMLButtonElement>(`${scope} .chip`)].find((c) => c.textContent?.trim().endsWith(text));
  const saveSheet = async (what: string) => {
    $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
    await until(() => !$('.sheet') || !!$('.sheet .dup-note'), 3000);
    // "¿Ya lo cargaste?" (el recorrido corre dos veces con los mismos datos): es otro, guardar igual.
    if ($('.sheet .dup-note')) {
      $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
      await until(() => !$('.sheet'), 3000);
    }
    if ($('.sheet')) {
      problems.push(`${what}: no se guardó (${$('.sheet .field-error')?.textContent ?? 'sin mensaje'})`);
      await closeSheet();
    }
    check(what);
  };

  // Categoría sugerida por la descripción y aviso de gasto repetido.
  await go('/');
  const dupAmount = String(1000 + (Date.now() % 9000));
  for (let i = 0; i < 2; i++) {
    if (!(await openNew())) {
      problems.push('sugerencia: no se abrió el formulario');
      break;
    }
    type($('.sheet .amount-input input'), dupAmount);
    type($('.sheet input[list="tx-desc-suggestions"]'), 'Uber al centro');
    // La primera vez la sugiere por la palabra; después la completa "lo de siempre".
    if (!(await until(() => !!$('.sheet .chip.on')?.textContent?.includes('Transporte'))))
      problems.push(`sugerencia: no propuso Transporte (${$('.sheet .chip.on')?.textContent ?? 'ninguna'})`);
    $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
    // Esperar a que se cierre o avise que ya estaba (con la compu ocupada puede tardar).
    await until(() => !$('.sheet') || !!$('.sheet .dup-note'), 3000);
    if (i === 1 && !$('.sheet .dup-note')) problems.push('repetido: no avisó que ya estaba cargado');
    if ($('.sheet .dup-note')) {
      $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
      await until(() => !$('.sheet'), 3000);
    }
    if ($('.sheet')) {
      problems.push(`sugerencia: no se guardó (${$('.sheet .field-error')?.textContent ?? 'sin mensaje'})`);
      await closeSheet();
    }
  }
  check('sugerencia y repetido');

  // Cargar con una frase (lo mismo que llega dictado o compartido).
  await go('/');
  if (await openNew()) {
    const quick = $<HTMLInputElement>('.sheet .quick-line input');
    type(quick, 'ayer gasté 2 lucas de nafta');
    quick?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const amount = () => $<HTMLInputElement>('.sheet .amount-input input')?.value;
    if (!(await until(() => amount() === '2000'))) problems.push(`frase: no completó el monto (${amount() ?? 'sin campo'})`);
    if (!(await until(() => !!$('.sheet .chip.on')?.textContent?.includes('Transporte'))))
      problems.push(`frase: no sugirió la categoría (${$('.sheet .chip.on')?.textContent ?? 'ninguna'})`);
    if (!$('.sheet .quick-line')?.textContent?.includes('Entendí')) problems.push('frase: no muestra lo que entendió');
    await closeSheet();
  } else problems.push('frase: no se abrió el formulario');
  check('cargar con una frase');

  // Transferencia (cajero): no es gasto.
  await go('/');
  if (await openNew()) {
    clickText('.sheet .segmented button', 'Mover');
    await sleep(100);
    type($('.sheet .amount-input input'), '1000');
    await sleep(50);
    const fieldChips = (label: string) =>
      [...document.querySelectorAll<HTMLElement>('.sheet .field')].find(
        (f) => f.querySelector('.field-label')?.textContent === label,
      );
    [...(fieldChips('Sale de')?.querySelectorAll<HTMLButtonElement>('.chip') ?? [])]
      .find((c) => c.textContent?.includes('BROU'))
      ?.click();
    await sleep(50);
    [...(fieldChips('Entra a')?.querySelectorAll<HTMLButtonElement>('.chip') ?? [])]
      .find((c) => c.textContent?.includes('Efectivo'))
      ?.click();
    await sleep(50);
    await saveSheet('transferencia');
  } else problems.push('transferencia: no se abrió el formulario');

  // Compra en cuotas con la tarjeta de crédito.
  if (await openNew()) {
    type($('.sheet .amount-input input'), '3000');
    await sleep(50);
    chip('Tarjeta de crédito')?.click();
    await sleep(100);
    $<HTMLButtonElement>('.sheet [aria-label="Más cuotas"]')?.click();
    await sleep(50);
    $<HTMLButtonElement>('.sheet [aria-label="Más cuotas"]')?.click();
    await sleep(100);
    if (!document.querySelector('.sheet .installments')?.textContent?.includes('3 cuotas'))
      problems.push('cuotas: no muestra las 3 cuotas');
    await saveSheet('compra en cuotas');
  } else problems.push('cuotas: no se abrió el formulario');

  // Gasto dividido: queda una deuda. Con una etiqueta para probar el filtro.
  if (await openNew()) {
    type($('.sheet .amount-input input'), '2000');
    await sleep(50);
    if (!type($('.sheet input[aria-label="Agregar etiqueta"]'), 'viaje prueba')) problems.push('etiquetas: no está el campo');
    [...document.querySelectorAll<HTMLElement>('.sheet .toggle')].find((t) => t.textContent?.includes('Dividir'))?.click();
    await sleep(100);
    type($('.sheet input[placeholder="Ej: Juan"]'), 'Juan Prueba');
    clickText('.sheet .chip', 'La mitad');
    await sleep(100);
    await saveSheet('gasto dividido');
  } else problems.push('gasto dividido: no se abrió el formulario');
  await go('/deudas');
  if (!document.body.textContent?.includes('Juan Prueba')) problems.push('deudas: el gasto dividido no creó la deuda');

  // Deuda: me prestaron y pago una parte.
  clickText('.page-head button', 'Agregar');
  if (await waitFor('.sheet input[placeholder="Ej: Juan"]')) {
    clickText('.sheet .segmented button', 'Me prestaron');
    type($('.sheet input[placeholder="Ej: Juan"]'), 'Mamá Prueba');
    type($('.sheet input[placeholder="0"]'), '5000');
    await sleep(100);
    await saveSheet('nueva deuda');
    [...document.querySelectorAll<HTMLButtonElement>('.tx-row')].find((r) => r.textContent?.includes('Mamá Prueba'))?.click();
    if (await waitFor('.sheet .split')) {
      clickText('.sheet .split button', 'Pagué');
      await sleep(200);
      check('pago de deuda');
      await closeSheet();
    } else problems.push('deudas: no se abrió el detalle');
  } else problems.push('deudas: no se abrió el formulario');

  // Etiquetas: el gasto dividido llevaba "viaje prueba".
  await go(`/movimientos?etiqueta=${encodeURIComponent('viaje prueba')}`);
  if (!$('.tag-banner') || !$('.day-group')) problems.push('etiquetas: el filtro por etiqueta no muestra el gasto');

  // Calendario del mes.
  await go('/movimientos');
  clickText('.page .segmented button', 'Calendario');
  if (!(await waitFor('.calendar .cal-day', 2000))) problems.push('calendario: no se dibujó');
  $<HTMLButtonElement>('.calendar .cal-day.today')?.click();
  await sleep(150);
  check('calendario');
  clickText('.page .segmented button', 'Lista');
  await sleep(100);

  // Tarjeta de alimentación: va aparte.
  await go('/alimentacion');
  clickText('.page button', 'Gasto con la tarjeta');
  if (await waitFor('.sheet .amount-input input')) {
    type($('.sheet .amount-input input'), '450');
    await sleep(100);
    if (!$('.sheet .note')?.textContent?.includes('no cuenta en tu presupuesto'))
      problems.push('alimentación: falta el aviso de que va aparte');
    await saveSheet('gasto con alimentación');
  } else problems.push('alimentación: no se abrió el formulario');

  // Ajustar el saldo de una cuenta.
  await go('/cuentas');
  $<HTMLButtonElement>('.list .tx-row')?.click();
  if (await waitFor('.action-list')) {
    clickText('.action', 'Ajustar saldo');
    if (await waitFor('.sheet input[inputmode="decimal"]')) {
      type($('.sheet input[inputmode="decimal"]'), '25000');
      await sleep(50);
      $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
      await sleep(250);
      if ($('.sheet')) problems.push('cuentas: no se ajustó el saldo');
      if (!$('.list')?.textContent?.includes('25.000')) problems.push('cuentas: el saldo ajustado no se ve');
    } else problems.push('cuentas: no se abrió "Ajustar saldo"');
  } else problems.push('cuentas: no se abrió el menú de la cuenta');
  check('cuentas');

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
  if (!type($('.sheet .savings-input input'), '2000')) problems.push('asistente: no aparece la meta de ahorro');
  type($('.sheet .budget-input:not(.savings-input) input'), '5000');
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

  // Inicio: "Hoy podés gastar" y de dónde sale.
  await go('/');
  if (!(await waitFor('.hero[role="button"]'))) problems.push('inicio: no aparece "Hoy podés gastar"');
  else if (!$('.hero')?.textContent?.match(/Hoy (podés gastar|te pasaste)/))
    problems.push('inicio: el número grande no es el de hoy');
  $<HTMLElement>('.hero[role="button"]')?.click();
  if (!(await waitFor('.sheet .explain-result'))) problems.push('inicio: no se abrió "¿de dónde sale?"');
  check('explicación del gasto diario');
  await closeSheet();

  // Ahorro: meta mensual (cargada en el asistente) y una meta con fecha.
  await go('/ahorro');
  if (!(await waitFor('.monthly-goal'))) problems.push('ahorro: no aparece la meta mensual del asistente');
  clickText('.page-head button', 'Nueva meta');
  if (!(await waitFor('.sheet input[type="month"]'))) problems.push('ahorro: no se abrió el formulario de meta');
  type($('.sheet input[placeholder="Ej: Viaje a Brasil"]'), 'Meta prueba');
  type($('.sheet input[placeholder="Ej: 60000"]'), '24000');
  type($('.sheet input[type="month"]'), `${new Date().getFullYear() + 1}-12`);
  await sleep(150);
  if (!$('.sheet .note-good')?.textContent?.includes('por mes')) problems.push('ahorro: no calcula cuánto separar por mes');
  $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
  await sleep(250);
  const goal = [...document.querySelectorAll<HTMLElement>('.goal')].find((g) => g.textContent?.includes('Meta prueba'));
  if (!goal?.querySelector('.goal-plan')) problems.push('ahorro: la meta con fecha no muestra el plan');
  goal?.querySelector<HTMLButtonElement>('.goal-plan')?.click();
  if (!(await waitFor('.sheet .explain-result'))) problems.push('ahorro: no se explica el plan de la meta');
  await closeSheet();
  check('ahorro');

  // Tarjeta: pagar el resumen (es una transferencia, no un gasto).
  await go('/tarjeta');
  for (let i = 0; i < 3 && !$('.statement .btn-primary'); i++) {
    $<HTMLButtonElement>('.month-picker [aria-label="Mes siguiente"]')?.click();
    await sleep(200);
  }
  if (!$('.statement .btn-primary')) problems.push('tarjeta: no aparece "Pagar" en el resumen');
  else {
    $<HTMLButtonElement>('.statement .btn-primary')?.click();
    if (!(await waitFor('.sheet-foot .btn-primary'))) problems.push('tarjeta: no se abrió el pago del resumen');
    $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
    await sleep(300);
    if (!$('.statement')?.textContent?.includes('Pagaste')) problems.push('tarjeta: el pago del resumen no quedó registrado');
  }
  check('tarjeta');

  // ¿Dónde está tu plata? (cuadre de cuentas y presupuesto)
  await go('/cuentas');
  if (!(await waitFor('.where'))) problems.push('cuadre: no aparece "¿Dónde está tu plata?"');
  // Si no cuadra: "Poner a punto" (saldos de hoy) y tiene que quedar cuadrando.
  const setupBtn = [...document.querySelectorAll<HTMLButtonElement>('.where .btn')].find((b) =>
    b.textContent?.includes('Poner a punto'),
  );
  if (setupBtn) {
    setupBtn.click();
    if (!(await waitFor('.sheet input[aria-label^="Saldo de"]'))) problems.push('poner a punto: no se abrió');
    for (const input of document.querySelectorAll<HTMLInputElement>('.sheet input[aria-label^="Saldo de"]'))
      if (!input.value) type(input, '1000');
    await sleep(100);
    $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
    if (!(await until(() => !$('.sheet') && $('.where .tag')?.textContent === 'Cuadra', 4000)))
      problems.push(
        `poner a punto: sigue sin cuadrar (${$('.where .tag')?.textContent}; ${$('.sheet .field-error')?.textContent ?? ''})`,
      );
  }
  // ¿Llegás a fin de mes?
  if (!document.body.textContent?.includes('¿Llegás a fin de mes?')) problems.push('cuentas: falta "¿Llegás a fin de mes?"');
  check('cuadre');

  // Stock: producto, compra con precio (y gasto), uso, conteo y lista de compras.
  await go('/stock');
  // La pestaña se recuerda entre visitas: arrancar siempre desde "Lo que tengo".
  clickText('.page .segmented button', 'Lo que tengo');
  await sleep(100);
  const stockName = `Arroz prueba ${Date.now() % 100000}`;
  clickText('.page-head button', 'Producto');
  if (await waitFor('.sheet input[placeholder="Ej: Arroz"]')) {
    type($('.sheet input[placeholder="Ej: Arroz"]'), stockName);
    clickText('.sheet .chip', 'kg');
    await sleep(80);
    type($('.sheet input[placeholder^="Ej: 2"]'), '2');
    await saveSheet('nuevo producto de stock');
  } else problems.push('stock: no se abrió el formulario de producto');
  const stockRow = () =>
    [...document.querySelectorAll<HTMLElement>('.stock-row')].find((r) => r.textContent?.includes(stockName));
  if (!(await until(() => !!stockRow()?.textContent?.includes('2 kg'))))
    problems.push(`stock: el producto no muestra la cantidad (${stockRow()?.textContent ?? 'no está'})`);
  stockRow()?.querySelector<HTMLButtonElement>('[aria-label^="Compré"]')?.click();
  if (await waitFor('.sheet .purchase-line')) {
    type($('.sheet .purchase-line input[aria-label="Cantidad"]'), '1');
    type($('.sheet .purchase-line input[aria-label="Precio total"]'), '60');
    await sleep(80);
    $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
    await sleep(300);
    if ($('.sheet')) problems.push(`stock: no se guardó la compra (${$('.sheet .field-error')?.textContent ?? ''})`);
  } else problems.push('stock: no se abrió registrar compra');
  if (!(await until(() => !!stockRow()?.textContent?.includes('3 kg'))))
    problems.push(`stock: la compra no sumó al stock (${stockRow()?.textContent ?? 'no está'})`);
  stockRow()?.querySelector<HTMLButtonElement>('.tx-main')?.click();
  if (await waitFor('.sheet .net-box')) {
    clickText('.sheet .btn-row button', 'Conté');
    if (await waitFor('.sheet input[inputmode="decimal"]')) {
      type($('.sheet input[inputmode="decimal"]'), '0');
      // El cuadro de "Conté" se abre arriba de la ficha: es el último.
      [...document.querySelectorAll<HTMLButtonElement>('.sheet-foot .btn-primary')].pop()?.click();
      await sleep(300);
    }
    await closeSheet();
  } else problems.push('stock: no se abrió la ficha del producto');
  clickText('.page .segmented button', 'Comprar');
  await sleep(150);
  if (!(await until(() => [...document.querySelectorAll('.shop-row')].some((r) => r.textContent?.includes(stockName)))))
    problems.push('stock: la lista de compras no tiene lo que queda poco');
  // Lista compartida: agregar lo sugerido, tildar y terminar la compra.
  clickText('.section-head button', 'Agregar todo');
  if (!(await until(() => !!$('.shop-row .check[aria-pressed="false"]'))))
    problems.push('lista de compras: no se agregó lo sugerido');
  [...document.querySelectorAll<HTMLElement>('.shop-row')]
    .find((r) => r.textContent?.includes(stockName) && r.querySelector('.check'))
    ?.querySelector<HTMLButtonElement>('.check')
    ?.click();
  await sleep(150);
  clickText('.shop-total button', 'Terminé');
  if (await waitFor('.sheet .purchase-line', 2000)) {
    $<HTMLButtonElement>('.sheet-foot .btn-primary')?.click();
    await sleep(300);
  } else problems.push('lista de compras: "Terminé" no abrió la compra');
  check('stock');
  await go('/movimientos');
  if (!document.body.textContent?.includes('Compra del súper')) problems.push('stock: la compra no cargó el gasto');

  // Rutinas: crear un hábito desde las ideas (si no está) y tildarlo.
  await go('/rutinas');
  const habit = () =>
    [...document.querySelectorAll<HTMLElement>('.habit-row')].find((r) => r.textContent?.includes('Tender la cama'));
  if (!habit()) {
    clickText('.chips .chip', 'Tender la cama');
    if (await waitFor('.sheet .day-picker')) await saveSheet('nuevo hábito');
    else problems.push('rutinas: no se abrió el formulario');
  }
  const pressed = () => habit()?.querySelector('.habit-check')?.getAttribute('aria-pressed');
  const before = pressed();
  habit()?.querySelector<HTMLButtonElement>('.habit-check')?.click();
  if (!(await until(() => pressed() !== before))) problems.push('rutinas: no se pudo tildar el hábito');
  check('rutinas');

  // Estudio: materia con examen y meta, sumar una hora.
  await go('/estudio');
  const subjectName = `Materia prueba ${Date.now() % 100000}`;
  clickText('.page-head button', 'Materia');
  if (await waitFor('.sheet input[placeholder="Ej: Matemática"]')) {
    type($('.sheet input[placeholder="Ej: Matemática"]'), subjectName);
    type($('.sheet input[placeholder="Ej: 30"]'), '20');
    const exam = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    type($('.sheet input[aria-label="Fecha del examen"]'), exam);
    await saveSheet('nueva materia');
  } else problems.push('estudio: no se abrió el formulario');
  const card = () => [...document.querySelectorAll<HTMLElement>('.goal')].find((c) => c.textContent?.includes(subjectName));
  if (!card()?.textContent?.includes('por día')) problems.push('estudio: no dice cuánto estudiar por día');
  [...(card()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent?.includes('+1 h'))?.click();
  if (!(await until(() => !!card()?.querySelector('.goal-value')?.textContent?.startsWith('1 h'))))
    problems.push(`estudio: no sumó la hora (${card()?.querySelector('.goal-value')?.textContent ?? ''})`);
  check('estudio');

  // Vencimientos: el seguro vence en 10 días → aviso en Inicio.
  await go('/vencimientos');
  if (![...document.querySelectorAll('.tx-row')].some((r) => r.textContent?.includes('Seguro del auto'))) {
    clickText('.chips .chip', 'Seguro del auto');
    if (await waitFor('.sheet input[aria-label="Fecha de vencimiento"]')) {
      type(
        $('.sheet input[aria-label="Fecha de vencimiento"]'),
        new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
      );
      await saveSheet('nuevo vencimiento');
    } else problems.push('vencimientos: no se abrió el formulario');
  }
  // "Para hoy" en Inicio: junta el vencimiento y la rutina (que se tilda desde ahí).
  await go('/');
  const agendaRow = (text: string) =>
    [...document.querySelectorAll<HTMLElement>('.agenda li')].find((r) => r.textContent?.includes(text));
  if (!(await until(() => !!agendaRow('Seguro del auto')))) problems.push('para hoy: no aparece el vencimiento');
  if (!agendaRow('Tender la cama')) clickText('.section-head button', 'Ver lo hecho');
  const bed = () => agendaRow('Tender la cama')?.querySelector<HTMLButtonElement>('.check');
  if (!(await until(() => !!bed()))) problems.push('para hoy: no aparece la rutina');
  else {
    const was = bed()!.getAttribute('aria-pressed');
    bed()!.click();
    if (!(await until(() => !bed() || bed()!.getAttribute('aria-pressed') !== was)))
      problems.push('para hoy: no se pudo tildar la rutina');
  }
  check('para hoy');

  // Buscar en todo (tecla /): encuentra el producto del stock y lleva a su pantalla.
  window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
  const search = await waitFor('.sheet input[aria-label="Buscar en todo"]');
  if (!search) problems.push('buscar: no se abrió con /');
  else {
    type(search as HTMLInputElement, '500 super');
    if (!(await until(() => !!$('.search-result')?.textContent?.includes('Cargar gasto'))))
      problems.push('buscar: no ofrece cargar el gasto');
    type(search as HTMLInputElement, stockName);
    if (!(await until(() => [...document.querySelectorAll('.search-result')].some((r) => r.textContent?.includes(stockName)))))
      problems.push('buscar: no encontró el producto del stock');
    else {
      clickText('.search-result', stockName);
      if (!(await until(() => location.hash === '#/stock'))) problems.push(`buscar: no llevó al stock (${location.hash})`);
    }
    if ($('.sheet')) await closeSheet();
  }
  check('buscar');
  for (const route of ['/semana', '/suscripciones']) {
    await go(route);
    if (!$('.page-head')) problems.push(`${route}: no se dibujó`);
  }

  // Metas del año: ahorro (si no está) y su avance.
  await go('/metas');
  if (!$('.year-progress')) {
    clickText('.chips .chip', 'Ahorrar en el año');
    if (await waitFor('.sheet input[aria-label="Valor de la meta"]')) {
      type($('.sheet input[aria-label="Valor de la meta"]'), '60000');
      await saveSheet('meta del año');
    } else problems.push('metas: no se abrió el formulario');
  }
  if (!(await until(() => !!$('.year-progress')))) problems.push('metas: no muestra el avance');
  check('metas');
  await go('/stock');
  clickText('.page .segmented button', 'Precios');
  await sleep(150);
  check('precios del stock');

  // ¿Me lo puedo comprar?
  await go('/simulador');
  type($('input[placeholder="Ej: 36000"]'), '36000');
  if (!(await until(() => !!$('.sim-verdict')))) problems.push('simulador: no muestra si alcanza');
  check('simulador');

  // Recetas: una receta con un ingrediente del stock.
  await go('/recetas');
  if (!$('.recipe')) {
    clickText('.page-head button', 'Receta');
    if (await waitFor('.sheet input[placeholder="Ej: Fideos con tuco"]')) {
      type($('.sheet input[placeholder="Ej: Fideos con tuco"]'), 'Receta prueba');
      const sel = $<HTMLSelectElement>('.sheet select[aria-label="Ingrediente"]');
      if (sel && sel.options.length > 1) {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
        setter.call(sel, sel.options[1].value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await sleep(100);
      await saveSheet('nueva receta');
    } else problems.push('recetas: no se abrió el formulario');
  }
  if (!(await until(() => !!$('.recipe')))) problems.push('recetas: no aparece la receta');
  check('recetas');

  // Diario: sueño y ánimo de hoy.
  await go('/diario');
  clickText('.journal-quick .chip', '7 h');
  $<HTMLButtonElement>('.journal-quick .chip[aria-label="Ánimo 4 de 5"]')?.click();
  if (!(await until(() => document.querySelectorAll('.journal-quick .chip.on').length === 2)))
    problems.push('diario: no se guardó el sueño y el ánimo');
  check('diario');

  // Piloto automático: una regla de categoría (se agrega y se borra).
  await go('/piloto');
  const ruleWord = `regla${Date.now() % 100000}`;
  type($<HTMLInputElement>('input[placeholder="Ej: uber, farmacia, disco"]'), ruleWord);
  [...document.querySelectorAll<HTMLButtonElement>('.page .chip')].find((c) => c.textContent?.includes('Supermercado'))?.click();
  await sleep(100);
  clickText('.page .btn-primary', 'Agregar regla');
  const ruleRow = () => [...document.querySelectorAll<HTMLElement>('.tx-row')].find((r) => r.textContent?.includes(ruleWord));
  if (!(await until(() => !!ruleRow()))) problems.push('piloto: no se agregó la regla');
  else {
    ruleRow()!.querySelector<HTMLButtonElement>('.icon-btn')?.click();
    if (!(await until(() => !ruleRow()))) problems.push('piloto: no se borró la regla');
  }
  check('piloto automático');

  // Desafíos: uno de días sin gastar (se crea y se quita).
  await go('/desafios');
  clickText('.page-head button', 'Desafío');
  if (await waitFor('.sheet')) {
    clickText('.sheet .chip', 'Días sin gastar');
    await sleep(100);
    type($<HTMLInputElement>('.sheet input[placeholder="Ej: 3"]'), '2');
    await saveSheet('nuevo desafío');
    const card = () =>
      [...document.querySelectorAll<HTMLElement>('.challenge')].find((c) => c.textContent?.includes('2 días sin gastar en 7'));
    if (!(await until(() => !!card()))) problems.push('desafíos: no aparece el desafío');
    else {
      [...card()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Quitar'))?.click();
      if (!(await until(() => !card()))) problems.push('desafíos: no se pudo quitar');
    }
  } else problems.push('desafíos: no se abrió el formulario');
  check('desafíos');

  // Subcategorías: Comida afuera › Delivery (con un toque desde las ideas).
  await go('/categorias');
  clickText('.page .tx-row', 'Comida afuera');
  if (await waitFor('.sheet')) {
    clickText('.sheet .chip-add', 'Delivery');
    await sleep(200);
    await closeSheet();
    if (!(await until(() => !![...document.querySelectorAll('.sub-row')].find((r) => r.textContent?.includes('Delivery')))))
      problems.push('subcategorías: no aparece Comida afuera › Delivery');
  } else problems.push('subcategorías: no se abrió la categoría');
  check('subcategorías');

  // Lista del súper: "2 kg arroz" entra con cantidad y en su sector (y se saca).
  await go('/lista');
  type($<HTMLInputElement>('input[aria-label="Agregar a la lista"]'), '2 kg arroz');
  await sleep(100);
  $<HTMLFormElement>('form.shop-add')?.requestSubmit();
  const shopRow = () =>
    [...document.querySelectorAll<HTMLElement>('.shop-group .shop-row')].find((r) => r.textContent?.includes('Arroz'));
  if (!(await until(() => !!shopRow()))) problems.push('lista: no se agregó «2 kg arroz»');
  else {
    if (!shopRow()!.textContent?.includes('2')) problems.push('lista: no tomó la cantidad');
    if (![...document.querySelectorAll('.shop-aisle')].some((h) => h.textContent?.includes('Almacén')))
      problems.push('lista: el arroz no quedó en Almacén');
    shopRow()!.querySelector<HTMLButtonElement>('button[aria-label^="Sacar"]')?.click();
    if (!(await until(() => !shopRow()))) problems.push('lista: no se pudo sacar');
  }
  check('lista del súper');

  // Vacaciones: se planean, aparecen y se quitan.
  await go('/epocas');
  clickText('.page .btn', 'Planear unas vacaciones');
  if (await waitFor('.sheet')) {
    type($<HTMLInputElement>('.sheet input[placeholder^="Ej: Floripa"]'), 'Viaje prueba');
    type($<HTMLInputElement>('.sheet input[placeholder="Ej: 30000"]'), '20000');
    await saveSheet('vacaciones');
    const card = () => [...document.querySelectorAll<HTMLElement>('.goal')].find((c) => c.textContent?.includes('Viaje prueba'));
    if (!(await until(() => !!card()))) problems.push('vacaciones: no aparece');
    else {
      [...card()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Cambiar'))?.click();
      if (await waitFor('.sheet')) {
        clickText('.sheet-foot button', 'Quitar');
        if (!(await until(() => !card()))) problems.push('vacaciones: no se pudo quitar');
      }
    }
  } else problems.push('vacaciones: no se abrió el formulario');
  check('vacaciones');

  // Tu plata: te sobra, y repartir el cobro.
  await go('/plata');
  if (!$('.hero')) problems.push('tu plata: no muestra cuánto te sobra');
  clickText('.plata-actions .btn', 'Repartir el cobro');
  if (await waitFor('.sheet')) {
    if (!$('.sheet input[inputmode="decimal"]')) problems.push('repartir el cobro: falta el monto');
    await closeSheet();
  } else problems.push('repartir el cobro: no se abrió');
  check('tu plata');

  // Día a día: ¿contado o cuotas? da un veredicto con la cuenta.
  await go('/dia-a-dia');
  if (!$('.daytoday-hero')) problems.push('día a día: no dice con qué tarjeta pagar hoy');
  type($('input[placeholder="Ej: 24000"]') as HTMLInputElement | null, '24000');
  if (!(await waitFor('.verdict'))) problems.push('contado o cuotas: no da el resultado');
  check('día a día');

  // Conciliar: un extracto CSV se lee en la compu y se cruza con lo cargado.
  await go('/conciliar');
  const file = $('input[type=file]') as HTMLInputElement | null;
  if (file) {
    const csv = 'Fecha;Descripción;Débito;Crédito;Saldo\n02/09/2026;COMPRA FARMACIA;450,00;;9.550,00\n';
    const dt = new DataTransfer();
    dt.items.add(new File([csv], 'extracto.csv', { type: 'text/csv' }));
    file.files = dt.files;
    file.dispatchEvent(new Event('change', { bubbles: true }));
    if (!(await waitFor('.reconcile-stats', 6000))) problems.push('conciliar: no leyó el extracto');
    else if (!$('.missing-row')) problems.push('conciliar: no muestra lo que falta anotar');
  } else problems.push('conciliar: falta elegir el archivo');
  check('conciliar');

  // Gastos en grupo: crear un grupo, anotar un gasto que pagaste vos y ver cómo quedar a mano.
  await go('/grupos');
  clickText('.page-head button', 'Nuevo grupo');
  if (await waitFor('.sheet')) {
    type($('.sheet input[placeholder^="Ej: Casa"]') as HTMLInputElement | null, 'Prueba');
    type($('.sheet input[placeholder="Nombre"]') as HTMLInputElement | null, 'Juan');
    clickText('.sheet .btn-primary', 'Guardar');
    if (!(await until(() => location.hash.startsWith('#/grupos/'), 4000))) problems.push('grupos: no se creó el grupo');
    else {
      await waitFor('.page:not(.page-loading) .page-head');
      clickText('.page-head button', 'Gasto');
      if (await waitFor('.sheet')) {
        type($('.sheet input[placeholder^="Ej: Cena"]') as HTMLInputElement | null, 'Cena');
        type($('.sheet input[inputmode="decimal"]') as HTMLInputElement | null, '3000');
        clickText('.sheet .btn-primary', 'Guardar');
        if (!(await until(() => !!document.body.textContent?.includes('Para quedar a mano'), 3000)))
          problems.push('grupos: no dice cómo quedar a mano');
      } else problems.push('grupos: no se abrió el gasto');
    }
  } else problems.push('grupos: no se abrió el formulario');
  check('grupos');

  // Calendario: tocar hoy muestra el detalle del día.
  await go('/calendario');
  if (!$('.cal-day.today')) problems.push('calendario: no marca hoy');
  check('calendario');

  // Modo privado (tecla P): oculta los montos y se vuelve a mostrar.
  await go('/');
  const pressP = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  pressP();
  await sleep(150);
  if (!$('.hero-value')?.textContent?.includes('•••')) problems.push('modo privado: los montos no se ocultaron');
  pressP();
  await sleep(150);
  if ($('.hero-value')?.textContent?.includes('•••')) problems.push('modo privado: los montos no volvieron');
  check('modo privado');

  await go('/');
  return problems;
}
