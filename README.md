# Lifty

Tus finanzas del día a día y tu presupuesto mensual, en la compu y en el celular, con los mismos datos.

Lifty nació de la planilla `finanzas.xlsm` y toma sus ideas (sueldos con descuentos, gastos fijos con
vigencia, tarjeta en cuotas, ahorro en pesos y dólares, cierre de mes con el "total real"), pero no las
copia: todo eso se calcula solo y se carga en segundos desde el celular.

## Qué hace

Regla de oro: **todo número se puede tocar para ver de dónde sale** ("¿De dónde sale?"). Nada de IA: cuentas
claras y reglas simples.

| | |
|---|---|
| **Inicio** | **Hoy podés gastar $X** y **esta semana te quedan $Y** (se recalcula todos los días), avisos ("a este ritmo terminás con…", "te pasás en Comida el día 22", "gastaste 30% más en salidas que el mes pasado"), lo que vence o se cobra en los próximos 7 días con tilde, proponer pasar al ahorro lo que sobró el mes pasado y primeros pasos. |
| **Movimientos** | Gastos, ingresos, ahorros y **Mover** (transferencias entre cuentas, que no son gasto). Montos como en Excel (`8000+5600`), pesos o dólares, reintegros, dividir un gasto con alguien, "Lo de siempre", deshacer, duplicar. Etiquetas ("viaje Brasil") para juntar gastos de distintas categorías, cotización del dólar del día. Filtros por mes, tipo, categoría, cuenta y etiqueta, y vista de calendario con lo gastado cada día y lo que vence. |
| **Presupuesto mensual** | Asistente de 3 pasos (cuánto entra → qué pagás sí o sí → cuánto querés gastar en cada cosa) con "sin asignar" en vivo y la meta de ahorro primero. Presupuesto por categoría para todos los meses o uno solo. Gastos fijos con día de vencimiento, frecuencia (mensual, cada 2/3/6 meses, anual o una vez), "Ya no lo pago", "Lo pago este mes y después no" y "Cambiar el monto desde este mes". Cierre de mes asistido con el saldo real de tus cuentas. |
| **Sueldos** | Nominal → líquido con los descuentos de Uruguay (todo editable) o líquido a mano, vigencia desde/hasta, aguinaldo por semestre en junio y diciembre (proporcional si el trabajo termina antes) o "no genera aguinaldo". |
| **Ahorro** | Meta mensual (monto o % de lo que entra) que se aparta primero. Metas con fecha ("US$ 2.000 para diciembre"): cuánto separar por mes y si vas adelantado o atrasado. Depósitos y retiros en pesos y dólares. |
| **Cuentas** | Saldo de BROU, Itaú, efectivo, dólares y tarjetas; ajustar saldo. **¿Dónde está tu plata?**: lo que hay en tus cuentas repartido en ahorro, tarjeta, fijos que faltan y lo libre, y si cuadra con tu presupuesto (si no, te ayuda a encontrar la diferencia). **Deudas y préstamos** con pagos parciales. |
| **Tarjeta de alimentación** | Va **aparte**: no es plata, no entra en ingresos, gastos ni presupuesto. Su saldo, la carga mensual y cuánto te queda por día para el súper. |
| **Tarjeta de crédito** | Compras en cuotas (monto total o por cuota, desde qué mes) y en dólares. Resumen de cada mes en pesos y dólares, **Pagar** (es una transferencia, no un gasto), próximos 6 meses y cuotas que faltan. |
| **Informes** | El año mes a mes con gráfico. Tendencias: patrimonio, cuánto ahorrás de lo que entra, en qué se te va la plata, qué días gastás más, lo gastado por etiqueta y los gastos más grandes. Racha de días sin gastar. |
| **Importar Excel** | Trae tu `finanzas.xlsm` y antes de importar te muestra, mes a mes, si los totales dan igual que en la planilla y por qué no cuando no. Se puede importar varias veces sin duplicar. |
| **Exportar y respaldo** | Todo a un `.xlsx` (resumen, movimientos, sueldos, fijos, cuentas, metas, deudas, peso). Copia de seguridad automática todos los días y restaurar. |
| **Stock de la casa** | Comida, limpieza e higiene: cuánto tenés, cuánto usás por día (aprende de lo que anotás y de cuando contás lo que hay), cuántos días te dura y qué día se termina. Lista de compras automática para cubrir hasta la próxima compra, con cantidades redondeadas al paquete, costo estimado y si te alcanza la tarjeta de alimentación; se puede compartir por WhatsApp. "Registrar compra" suma al stock y carga el gasto en un paso. Precios por unidad (si subieron, dónde está más barato), vencimientos (se usa primero lo más viejo), lo que tirás y cuánto gasta la casa por mes. |
| **Lista de compras compartida** | Se sincroniza entre la compu y el celular: tildás en el súper y al terminar se registra la compra (stock + gasto). Se le suma lo que falta según el stock o cualquier cosa suelta. |
| **Rutinas** | Hábitos por momento del día y días de la semana (estudiar 60 min, 8 vasos de agua, ejercicio lunes/miércoles/viernes, medicación…): tildar o sumar, racha (los días que no tocan no la cortan), últimos 7 días y horas de estudio de la semana. |
| **Peso** | Pesajes con promedio de 7 días, cambio semanal y mensual, IMC y meta. |
| **Detalles** | Modo privado (el ojo arriba, o la tecla **P**): oculta los montos. En la compu: **N** nuevo movimiento, **/** buscar. Tema claro, oscuro o automático. |

## Cómo se conectan la compu y el celular

```
┌──────────── Compu (programa Lifty) ────────────┐        ┌──── Celular ────┐
│  servidor + base de datos (tus datos quedan acá)│◄──────►│  app Lifty       │
│  ventana de Lifty                               │ Wi-Fi  │  (guarda todo    │
└─────────────────────────────────────────────────┘ de casa│  aunque no haya  │
                                                            │  señal)          │
                                                            └─────────────────┘
```

1. Instalá y abrí **Lifty** en la compu. Al cerrar la ventana queda en la bandeja (al lado del reloj) para que el
   celular pueda sincronizar. Desde ahí podés activar "Abrir al iniciar la compu".
2. En Lifty: **Más → Conectar dispositivos → Generar código**.
3. Con el celular en el mismo Wi-Fi, escaneá el QR con la cámara. Listo: el celular queda vinculado.
4. En el navegador del celular: **Agregar a la pantalla de inicio** para tenerla como una app más.

El celular guarda los datos y lo que cargues sin conexión (en la calle, sin Wi-Fi) y lo manda a la compu
apenas la vuelve a ver. La primera vez que abras Lifty en Windows puede aparecer el aviso del firewall:
aceptalo para "redes privadas" para que el celular pueda entrar.

**¿Querés sincronizar también fuera de casa?** Dos opciones:

- **Tailscale** (gratis, lo más simple): instalalo en la compu y en el celular, y en la compu corré
  `tailscale serve --bg 4321`. Te da una dirección `https://...ts.net` que funciona desde cualquier lado; en
  Lifty de la compu ponela en `LIFTY_PUBLIC_URL` para que el QR la use. Con https además la app se instala
  como app de verdad y abre sin conexión.
- **Un servidor en la nube** con Docker (ver más abajo), con contraseña.

## Instalar

### En Windows, con los .bat (lo más simple)

1. En GitHub: **Code → Download ZIP** y descomprimilo en una carpeta (por ejemplo `Documentos\Lifty`).
   Si tenés git: `git clone` es mejor, porque después se actualiza solo.
2. Doble clic en **`instalar-lifty.bat`**: instala Node.js si no lo tenés, todo lo demás, y compila Lifty.
   Al final te ofrece generar el instalador `.exe` y abrir Lifty.
3. Para abrirlo después: **`iniciar-lifty.bat`**.
4. Para pasar a una versión nueva: **`actualizar-lifty.bat`** (con git baja los cambios solo; si bajaste el
   ZIP, te explica qué hacer). Tus datos no se tocan.

### Con el instalador

Los instaladores se generan en GitHub: **Actions → "Instaladores de escritorio" → Run workflow**. Al terminar,
en la corrida aparecen `Lifty-Windows` (instalador `.exe`), `Lifty-Linux` (`.AppImage`) y `Lifty-macOS` (`.dmg`).
Si creás un tag `v0.1.0`, también se publican en "Releases".

> Los instaladores no están firmados: Windows puede mostrar "Windows protegió tu PC" → *Más información* →
> *Ejecutar de todas formas*.

Tus datos quedan en `%APPDATA%\Lifty\data` (Windows) o `~/.config/Lifty/data` (Linux), con una copia de
seguridad automática por día (se guardan las últimas 14). Desde **Más → Copia de seguridad** podés descargar
todo en Excel o en un archivo para restaurar.

### Si algo no anda

- Si una pantalla falla, Lifty muestra el error con un botón para volver (en vez de quedar en negro).
- En el programa: **F5** recarga y **Ctrl+Shift+I** abre las herramientas (pestaña *Console*: lo que esté en
  rojo es el error).
- El programa guarda un registro en `%APPDATA%\Lifty\lifty.log`.

### Desde el código (para desarrollar)

Necesitás [Node.js 20 o más nuevo](https://nodejs.org).

```bash
npm install
npm run dev          # servidor en :4321 + app web con recarga en http://localhost:5173
npm run desktop      # el programa de escritorio
npm test             # tests
LIFTY_EXCEL=ruta/a/finanzas.xlsm npm test -w @lifty/server   # compara la importación con los totales de tu planilla
npm run import-excel -- ruta/a/finanzas.xlsm   # importa la planilla directo a ~/.lifty
```

### En un servidor (modo nube)

```bash
docker build -t lifty .
docker run -d -p 4321:4321 -v lifty-data:/data -e LIFTY_PASSWORD='una-contraseña-larga' lifty
```

Ponelo detrás de https (Caddy, Cloudflare Tunnel, etc.). Desde el celular entrás con la contraseña.

Variables: `LIFTY_DATA_DIR`, `PORT`, `HOST`, `LIFTY_PASSWORD`, `LIFTY_PUBLIC_URL`, `LIFTY_TRUST_LOCALHOST=1`.

## Cómo está hecho

```
packages/core   Lógica pura y testeada: presupuesto mensual, sueldo y aguinaldo, cuotas, esquemas de datos.
apps/server     Servidor (Fastify + SQLite vía sql.js): sincronización, vinculación por QR, importador de Excel.
apps/web        La app (React): la misma para el celular y la compu. Funciona sin conexión.
apps/desktop    El programa de escritorio (Electron): arranca el servidor y abre la app.
```

- **Primero local.** La app guarda los datos en el dispositivo y calcula todo ahí (con `packages/core`). Cada
  cambio se aplica al instante y queda en una "bandeja de salida" que se manda al servidor cuando hay conexión.
- **Sincronización.** Cada registro tiene `updatedAt`; gana el cambio más nuevo. Los borrados quedan como
  "lápida" para que un dispositivo desactualizado no los reviva. Cada dispositivo pide solo lo que cambió desde
  la última vez.
- **Seguridad.** Solo la propia compu entra sin vincular. Los demás dispositivos necesitan un código de un solo
  uso (vence en 10 minutos) o la contraseña; cada uno recibe un token propio que se puede revocar desde
  **Conectar dispositivos**.

### Agregar un módulo (hábitos, gimnasio…)

Lifty guarda todo como registros genéricos, así que un módulo nuevo no necesita tocar la base de datos.
**Peso** está hecho así y sirve de ejemplo (`weightSchema` en `packages/core/src/schema.ts`, cálculos en
`packages/core/src/weight.ts` y la pantalla en `apps/web/src/pages/Weight.tsx`):

1. En `packages/core/src/schema.ts`, definí el esquema y sumalo a `ENTITY_SCHEMAS`, `EntityTypes` y `LiftyData`
   (y a `toLiftyData` en `store.ts`). Con eso el servidor ya lo valida y lo sincroniza.
2. Si tiene cálculos, ponelos en `packages/core` con sus tests.
3. En `apps/web/src/pages/` creá la pantalla, registrala en `App.tsx` y en el menú (`Layout.tsx` / `More.tsx`).
   Para guardar: `mutate('entidad', 'upsert', registro)`; para leer: `useData()`.
4. Sumá la ruta al recorrido de prueba (`apps/desktop/src/smoke-tour.ts`).
