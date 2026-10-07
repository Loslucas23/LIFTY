import { fold, formatMoney } from './money';
import type { Account, Currency, LiftyData, TxKind } from './schema';
import { cleanDescription, parseDate, parseNumber } from './statement';
import { addDays } from './weight';

/**
 * Cargar con una frase: «gasté 450 en la feria», «ayer 2 lucas de nafta con la visa en 3 cuotas»
 * o el mensaje que te manda el banco. Todo con reglas (sin IA), y cada cosa que entendió queda
 * a la vista para que la corrijas.
 */
export interface QuickParse {
  kind: TxKind;
  amount: number | null;
  currency: Currency;
  date: string;
  description: string;
  accountId: string | null;
  toAccountId: string | null;
  installments: number | null;
  /** Lo que entendió, en palabras («$ 450», «ayer», «con Visa»), para mostrarlo. */
  understood: string[];
  /** Parece el aviso de una compra del banco o la tarjeta. */
  fromBank: boolean;
}

// ---------------- Números dichos con palabras ----------------

const UNITS: Record<string, number> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};
/** «mil», «dos lucas» (mil pesos), «un palo» (un millón). */
const MULT: Record<string, number> = {
  mil: 1000,
  luca: 1000,
  lucas: 1000,
  k: 1000,
  millon: 1_000_000,
  millones: 1_000_000,
  palo: 1_000_000,
  palos: 1_000_000,
};

interface Token {
  /** Como lo escribiste (para armar la descripción). */
  raw: string;
  /** Sin tildes y en minúsculas (para entenderlo). */
  w: string;
  used: boolean;
}

const tokenize = (text: string): Token[] =>
  (text.match(/u\$s|us\$|\$u(?!\p{L})|\$|\d{1,2}:\d{2}|[\p{L}\p{N}][\p{L}\p{N}.,/'’-]*|[^\s\p{L}\p{N}]/giu) ?? []).map((raw) => {
    // «450.» o «Feria,»: la puntuación del final no es parte de la palabra.
    const clean = /\d[.,]$/.test(raw) || /\p{L}[.,]$/u.test(raw) ? raw.slice(0, -1) : raw;
    return { raw: clean, w: fold(clean), used: false };
  });

const isDigits = (w: string) => /^\d[\d.,]*k?$/.test(w);
/** «450», «1.500», «2k». */
const digitsValue = (w: string) => (w.endsWith('k') ? (parseNumber(w.slice(0, -1)) ?? NaN) * 1000 : parseNumber(w));
const isNumberWord = (w: string) => w in UNITS || w in MULT;

interface Span {
  start: number;
  end: number; // exclusivo
  value: number;
}

/** Junta los números de la frase: «450», «1.500», «2 mil 500», «dos lucas y media», «mil quinientos». */
function numberSpans(tokens: Token[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i].w;
    const startsNumber = isDigits(t) || (t in UNITS && t !== 'un' && t !== 'una') || (t in MULT && t !== 'k');
    // «un»/«una» solo cuentan si siguen números («una luca», «un millón»).
    const startsWithOne = (t === 'un' || t === 'una') && i + 1 < tokens.length && tokens[i + 1].w in MULT;
    if (!startsNumber && !startsWithOne) {
      i++;
      continue;
    }
    // Las fechas (3/10) y horas no son plata.
    if (/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(t) || /^\d{1,2}:\d{2}$/.test(t)) {
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let lastMult = 1;
    let j = i;
    let any = false;
    while (j < tokens.length) {
      const w = tokens[j].w;
      if (isDigits(w)) {
        // Dos números seguidos sin palabra en el medio son cosas distintas («3 empanadas 360»).
        if (any && current !== 0) break;
        const n = digitsValue(w);
        if (n === null || !Number.isFinite(n)) break;
        current += n;
      } else if (w in UNITS && !(any && (w === 'un' || w === 'una') && !(tokens[j + 1]?.w in MULT))) {
        current += UNITS[w];
      } else if (w in MULT && (any || w !== 'k')) {
        const m = MULT[w];
        total += (current || 1) * m;
        current = 0;
        lastMult = m;
      } else if (w === 'y' && any && j + 1 < tokens.length) {
        const next = tokens[j + 1].w;
        // «luca y media», «mil y pico» no: solo «y media/medio».
        if ((next === 'media' || next === 'medio') && lastMult > 1) {
          total += lastMult / 2;
          j += 2;
          any = true;
          break;
        }
        if (!(next in UNITS)) break;
      } else break;
      any = true;
      j++;
    }
    if (any) {
      out.push({ start: i, end: j, value: total + current });
      i = j;
    } else i++;
  }
  return out;
}

// ---------------- Palabras que dan pistas ----------------

const CURRENCY_USD = new Set(['u$s', 'us$', 'usd', 'dolar', 'dolares', 'verdes', 'dolarcitos']);
const CURRENCY_UYU = new Set(['$', '$u', 'uyu', 'pesos', 'peso', 'mangos', 'mango', 'uy$']);
const UNIT_WORDS =
  /^(kg|kilo|kilos|g|gr|gramos|l|lt|litro|litros|ml|unidad|unidades|u|cuota|cuotas|pago|pagos|dias|dia|meses|mes|anos|horas|hs|veces|personas|%|por ciento)$/;
const EXPENSE =
  /^(gaste|pague|compre|me cobraron|cobraron|me debitaron|salio|me salio|costo|me costo|puse|gastamos|pagamos|compramos)$/;
const INCOME =
  /^(cobre|cobramos|me pagaron|me depositaron|me transfirieron|me entro|me entraron|recibi|me devolvieron|ingreso|ingresaron|vendi)$/;
const SAVING = /^(ahorre|guarde|aparte|separe)$/;
const TRANSFER = /^(saque|retire|pase|movi|transferi)$/;
const STOP = new Set([
  'en',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'al',
  'a',
  'por',
  'para',
  'con',
  'y',
  'un',
  'una',
  'unos',
  'unas',
  'lo',
  'me',
  'que',
  'hoy',
  'es',
  'fue',
  'son',
  'total',
  'tu',
  'su',
  'mi',
  ':',
  '-',
  ',',
  '.',
  '!',
  '?',
]);
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'setiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const monthIndex = (w: string) => (w === 'septiembre' ? 8 : MONTHS.indexOf(w));
const BANK_HINT =
  /(compra|consumo|debito|transferencia|aprobad|informa|tarjeta|terminada en|\*{2,}\d{2,4}|acreditaci|deposito|retiro|cajero)/;

/** Encuentra las cuentas nombradas («con la visa», «en efectivo», «tarjeta de alimentación»). */
function findAccounts(tokens: Token[], accounts: Account[]): { account: Account; start: number; end: number }[] {
  const out: { account: Account; start: number; end: number }[] = [];
  const words = tokens.map((t) => t.w);
  const text = ` ${words.join(' ')} `;
  // De nombre más largo a más corto: «BROU dólares» le gana a «BROU».
  const named = accounts
    .filter((a) => !a.archived)
    .map((a) => ({ a, name: fold(a.name).split(/\s+/).filter(Boolean) }))
    .filter((x) => x.name.length)
    .sort((x, y) => y.name.join(' ').length - x.name.join(' ').length);
  const taken = new Set<number>();
  for (const { a, name } of named) {
    if (!text.includes(` ${name.join(' ')} `)) continue;
    for (let i = 0; i + name.length <= words.length; i++) {
      if (name.every((w, k) => words[i + k] === w) && !name.some((_, k) => taken.has(i + k))) {
        name.forEach((_, k) => taken.add(i + k));
        out.push({ account: a, start: i, end: i + name.length });
        break;
      }
    }
  }
  // Por el tipo, si no la nombraste: «en efectivo», «tarjeta de alimentación».
  const byType = (type: Account['type']) => accounts.filter((a) => !a.archived && a.type === type);
  const typeWords: [RegExp, Account['type']][] = [
    [/^(efectivo|cash)$/, 'cash'],
    [/^(alimentacion|edenred|sodexo|pluxee|ticketera)$/, 'food'],
  ];
  words.forEach((w, i) => {
    if (taken.has(i)) return;
    for (const [re, type] of typeWords) {
      const list = byType(type);
      if (re.test(w) && list.length >= 1 && !out.some((o) => o.account.type === type)) {
        out.push({ account: list[0], start: i, end: i + 1 });
        taken.add(i);
      }
    }
  });
  // «con la tarjeta» o «con crédito» y tenés una sola de crédito.
  const credits = byType('credit');
  if (credits.length === 1 && !out.some((o) => o.account.type === 'credit') && !/ (debito|alimentacion|terminada) /.test(text)) {
    const i = words.findIndex((w, k) => (w === 'credito' || (w === 'tarjeta' && words[k + 1] !== 'de')) && !taken.has(k));
    if (i >= 0) out.push({ account: credits[0], start: i, end: i + 1 });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** El comercio en un aviso del banco: «… en TIENDA INGLESA con tarjeta…» → «Tienda Inglesa». */
function bankMerchant(text: string): string | null {
  const m =
    text.match(/\b(?:en|EN)\s+([A-Z0-9][A-Z0-9 .&'*-]{2,40}?)(?=\s+(?:con|por|el|POR|CON|EL)\b|[.,;\n]|\s+\d{1,2}[/-]|$)/) ??
    text.match(/\bcomercio:?\s*([^\n.,;]{3,40})/i);
  if (!m) return null;
  const name = cleanDescription(m[1].trim());
  return name.length >= 3 ? name : null;
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Interpreta la frase. Lo que no entiende lo deja vacío (nunca inventa). */
export function parseQuick(text: string, data: Pick<LiftyData, 'accounts'>, today: string): QuickParse {
  const tokens = tokenize(text.slice(0, 1000));
  const words = tokens.map((t) => t.w);
  const folded = fold(text);
  const fromBank = BANK_HINT.test(folded) && /(\$|uyu|usd|u\$s|us\$)/.test(folded);
  const understood: string[] = [];
  const use = (from: number, to: number) => {
    for (let k = from; k < to && k < tokens.length; k++) tokens[k].used = true;
  };

  // Qué fue: gasto, ingreso, ahorro o movimiento entre cuentas (con frases de dos palabras: «me pagaron»).
  let kind: TxKind = 'expense';
  for (let i = 0; i < words.length; i++) {
    const one = words[i];
    const two = `${words[i]} ${words[i + 1] ?? ''}`;
    const hit = (re: RegExp) => (re.test(two) ? 2 : re.test(one) ? 1 : 0);
    let n: number;
    if ((n = hit(EXPENSE))) kind = 'expense';
    else if ((n = hit(INCOME))) kind = 'income';
    else if ((n = hit(SAVING))) kind = 'saving';
    else if ((n = hit(TRANSFER))) kind = 'transfer';
    else continue;
    use(i, i + n);
    break;
  }
  if (fromBank && /(transferencia recibida|acreditacion|deposito recibido|te transfirieron|recibiste)/.test(folded))
    kind = 'income';
  // «sueldo 45000» sin verbo también es un ingreso.
  if (kind === 'expense' && !words.some((w) => EXPENSE.test(w)) && words.some((w) => /^(sueldo|aguinaldo)$/.test(w)))
    kind = 'income';

  // Fecha: hoy, ayer, anteayer, «hace 3 días», «el lunes», «el 5», 5/10.
  let date = today;
  let dateText: string | null = null;
  for (let i = 0; i < words.length && !dateText; i++) {
    const w = words[i];
    if (w === 'ayer' && words[i - 1] !== 'antes' && words[i - 1] !== 'de') {
      date = addDays(today, -1);
      dateText = 'ayer';
      use(i, i + 1);
    } else if (w === 'anteayer' || w === 'antier' || (w === 'antes' && words[i + 1] === 'de' && words[i + 2] === 'ayer')) {
      date = addDays(today, -2);
      dateText = 'anteayer';
      use(i, w === 'antes' ? i + 3 : i + 1);
    } else if (w === 'hace' && words[i + 2]?.startsWith('dia')) {
      const n = isDigits(words[i + 1]) ? Number(words[i + 1]) : (UNITS[words[i + 1]] ?? NaN);
      if (n >= 0 && n <= 60) {
        date = addDays(today, -n);
        dateText = `hace ${n} día${n === 1 ? '' : 's'}`;
        use(i, i + 3);
      }
    } else if (WEEKDAYS.includes(w) && (words[i - 1] === 'el' || words[i - 1] === 'este')) {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      const back = (dow - WEEKDAYS.indexOf(w) + 7) % 7 || 7;
      date = addDays(today, -back);
      dateText = `el ${w}`;
      use(i - 1, words[i + 1] === 'pasado' ? i + 2 : i + 1);
    } else if (/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(w)) {
      const [d, m, y] = w.split(/[/-]/).map(Number);
      let iso = parseDate(`${d}/${m}/${y ? (y < 100 ? 2000 + y : y) : today.slice(0, 4)}`);
      if (iso && !y && iso > today) iso = parseDate(`${d}/${m}/${Number(today.slice(0, 4)) - 1}`);
      if (iso && iso <= today) {
        date = iso;
        dateText = `el ${d}/${m}`;
        use(i, i + 1);
      }
    } else if (/^\d{1,2}$/.test(w) && words[i + 1] === 'de' && monthIndex(words[i + 2] ?? '') >= 0) {
      // «3 de octubre» (el año: este, o el pasado si todavía no llegó).
      const m = monthIndex(words[i + 2]) + 1;
      let iso = parseDate(`${w}/${m}/${today.slice(0, 4)}`);
      if (iso && iso > today) iso = parseDate(`${w}/${m}/${Number(today.slice(0, 4)) - 1}`);
      if (iso) {
        date = iso;
        dateText = `el ${Number(w)} de ${MONTHS[m - 1]}`;
        use(words[i - 1] === 'el' ? i - 1 : i, i + 3);
      }
    } else if (w === 'el' && (words[i + 1] === 'dia' ? isDigits(words[i + 2] ?? '') : /^\d{1,2}$/.test(words[i + 1] ?? ''))) {
      const k = words[i + 1] === 'dia' ? i + 2 : i + 1;
      const d = Number(words[k]);
      // «el 5» es una fecha solo si no sigue plata ni cuotas («el 5%» o «el 3 de 4» no).
      const next = words[k + 1] ?? '';
      if (d >= 1 && d <= 31 && !UNIT_WORDS.test(next) && !CURRENCY_UYU.has(next) && !CURRENCY_USD.has(next) && next !== 'de') {
        let iso = `${today.slice(0, 8)}${String(d).padStart(2, '0')}`;
        if (iso > today || !parseDate(iso)) {
          const prev = addDays(`${today.slice(0, 8)}01`, -1);
          iso = `${prev.slice(0, 8)}${String(Math.min(d, Number(prev.slice(8)))).padStart(2, '0')}`;
        }
        date = iso;
        dateText = `el ${d}`;
        use(i, k + 1);
      }
    } else if (w === 'hoy') use(i, i + 1);
  }
  if (dateText) understood.push(dateText);

  // Cuotas: «en 3 cuotas», «en tres pagos».
  let installments: number | null = null;
  for (let i = 0; i < words.length; i++) {
    if (!/^(cuotas?|pagos)$/.test(words[i])) continue;
    const n = isDigits(words[i - 1] ?? '') ? Number(words[i - 1]) : (UNITS[words[i - 1]] ?? NaN);
    if (n >= 1 && n <= 60) {
      installments = n;
      use(words[i - 2] === 'en' ? i - 2 : i - 1, i + 1);
      if (n > 1) understood.push(`${n} cuotas`);
    }
    break;
  }

  // Cuentas.
  const accs = findAccounts(tokens, data.accounts).filter((x) => !tokens.slice(x.start, x.end).some((t) => t.used));
  let accountId: string | null = null;
  let toAccountId: string | null = null;
  for (const x of accs) {
    // «con la Visa», «de BROU a efectivo»: la preposición también se va.
    let from = x.start;
    while (from > 0 && ['con', 'la', 'el', 'mi', 'tarjeta', 'cuenta', 'de', 'en', 'del'].includes(words[from - 1])) from--;
    use(from, x.end);
  }
  if (kind === 'transfer') {
    const cash = data.accounts.find((a) => !a.archived && a.type === 'cash');
    const isWithdraw = /^(saque|retire)$/.test(words.find((w) => TRANSFER.test(w)) ?? '');
    if (isWithdraw) {
      accountId = accs.find((x) => x.account.type !== 'cash')?.account.id ?? null;
      toAccountId = cash?.id ?? null;
      words.forEach((w, i) => /^(cajero|redbrou|banred|del)$/.test(w) && use(i, i + 1));
    } else {
      accountId = accs[0]?.account.id ?? null;
      toAccountId = accs[1]?.account.id ?? null;
    }
  } else {
    // «Itaú: compra con tarjeta Visa»: la que va después de «con» o «tarjeta» es con la que pagaste.
    const after = (x: (typeof accs)[number]) => {
      let k = x.start - 1;
      while (k >= 0 && (words[k] === 'la' || words[k] === 'mi' || words[k] === 'tu')) k--;
      return words[k] === 'con' || words[k] === 'tarjeta';
    };
    accountId = (accs.find(after) ?? accs[0])?.account.id ?? null;
  }
  const accName = (id: string | null) => data.accounts.find((a) => a.id === id)?.name;
  if (kind === 'transfer') {
    if (accountId) understood.push(`de ${accName(accountId)}`);
    if (toAccountId) understood.push(`a ${accName(toAccountId)}`);
  } else if (accountId) understood.push(`con ${accName(accountId)}`);

  // Monto: el que tiene $ o «pesos»/«dólares» al lado; si no, el más grande que no sea cantidad («2 kilos»).
  const spans = numberSpans(tokens).filter((s) => !tokens.slice(s.start, s.end).some((t) => t.used));
  const marker = (s: Span): Currency | null => {
    const before = words[s.start - 1] ?? '';
    const after = words[s.end] ?? '';
    if (CURRENCY_USD.has(before) || CURRENCY_USD.has(after) || (after === 'de' && CURRENCY_USD.has(words[s.end + 1] ?? '')))
      return 'USD';
    if (CURRENCY_UYU.has(before) || CURRENCY_UYU.has(after)) return 'UYU';
    return null;
  };
  // Ni cantidades («2 kilos»), ni los números de la tarjeta («terminada en 1234», «***1234»).
  const candidates = spans.filter(
    (s) =>
      !UNIT_WORDS.test(words[s.end] ?? '') &&
      s.value > 0 &&
      words[s.start - 1] !== '*' &&
      !(words[s.start - 1] === 'en' && words[s.start - 2] === 'terminada'),
  );
  const marked = candidates.filter((s) => marker(s));
  const chosen = marked[0] ?? [...candidates].sort((a, b) => b.value - a.value)[0] ?? null;
  let currency: Currency = 'UYU';
  let amount: number | null = null;
  if (chosen) {
    amount = Math.round(chosen.value * 100) / 100;
    currency = marker(chosen) ?? 'UYU';
    use(chosen.start, chosen.end);
    // La moneda que acompaña al número también se va de la descripción.
    const around = [chosen.start - 1, chosen.end, chosen.end + 1];
    for (const k of around) {
      const w = words[k] ?? '';
      if (CURRENCY_USD.has(w) || CURRENCY_UYU.has(w) || (k === chosen.end && w === 'de' && CURRENCY_USD.has(words[k + 1] ?? '')))
        use(k, k + 1);
    }
    if (words[chosen.start - 1] === 'por' || words[chosen.start - 1] === 'son') use(chosen.start - 1, chosen.start);
  }
  // Una cuenta en dólares («BROU dólares») o «dólares» suelto en la frase.
  if (!chosen || !marker(chosen)) {
    const acc = data.accounts.find((a) => a.id === accountId);
    if (acc?.currency === 'USD' || words.some((w) => CURRENCY_USD.has(w))) currency = 'USD';
  }
  words.forEach((w, i) => (CURRENCY_USD.has(w) || w === 'pesos' || w === 'mangos') && use(i, i + 1));
  if (amount !== null) understood.unshift(formatMoney(amount, currency));

  // Descripción: lo que queda (en un aviso del banco, el comercio).
  let description = '';
  const merchant = fromBank ? bankMerchant(text) : null;
  if (merchant) description = merchant;
  else {
    const rest = tokens.filter((t) => !t.used).map((t) => t.raw);
    // Sacar palabras sueltas del principio y del final («en la feria» → «feria»).
    while (rest.length && STOP.has(fold(rest[0]))) rest.shift();
    while (rest.length && STOP.has(fold(rest[rest.length - 1]))) rest.pop();
    description = capitalize(
      rest
        .join(' ')
        .replace(/\s+([,.:;!?])/g, '$1')
        .replace(/[,.:;]$/, '')
        .trim(),
    ).slice(0, fromBank ? 60 : 120);
  }
  if (description) understood.push(`«${description}»`);
  const kindText = { expense: 'gasto', income: 'ingreso', saving: 'ahorro', transfer: 'movimiento entre cuentas' }[kind];
  understood.unshift(kindText);

  return { kind, amount, currency, date, description, accountId, toAccountId, installments, understood, fromBank };
}
