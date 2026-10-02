# Lifty

Tus finanzas del día a día y tu presupuesto mensual, en la compu y en el celular, con los mismos datos.

Lifty nació de la planilla `finanzas.xlsm` y toma sus ideas (sueldos con descuentos, gastos fijos con
vigencia, tarjeta en cuotas, ahorro en pesos y dólares, cierre de mes con el "total real"), pero no las
copia: todo eso se calcula solo y se carga en segundos desde el celular.

## Qué hace

| | |
|---|---|
| **Inicio** | Cuánto te queda este mes, cuánto podés gastar por día, lo que falta pagar o cobrar y tus topes por categoría. |
| **Movimientos** | Gastos, ingresos y ahorros día a día. Cuentas en el monto como en Excel (`8000+5600`), pesos o dólares, reintegros. |
| **Presupuesto mensual** | Lo que viene del mes anterior + sueldos + aguinaldo + extras − gastos fijos − día a día − tarjeta − ahorro. Los fijos y el sueldo se tildan cuando los pagás o cobrás. Al terminar el mes lo cerrás con el saldo real y ese saldo pasa al mes siguiente. |
| **Sueldos** | Nominal → líquido con los descuentos de Uruguay (jubilatorio, FONASA, FRL, SNIS, IRPF; todo editable), vigencia desde/hasta y aguinaldo en junio y diciembre (proporcional si el trabajo termina antes). |
| **Tarjeta** | Compras en cuotas: cada cuota cae en su mes. Cuánto vas a pagar los próximos 6 meses. |
| **Ahorro** | Metas en pesos y en dólares, depósitos y retiros. |
| **Año** | Resumen mes a mes (como la hoja RESUMEN) con gráfico de ingresos y gastos. |
| **Importar Excel** | Trae tu `finanzas.xlsm`: sueldos, fijos, movimientos, tarjeta y meses cerrados. Se puede importar varias veces sin duplicar. |

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

### El programa para la compu

Los instaladores se generan en GitHub: **Actions → "Instaladores de escritorio" → Run workflow**. Al terminar,
en la corrida aparecen `Lifty-Windows` (instalador `.exe`), `Lifty-Linux` (`.AppImage`) y `Lifty-macOS` (`.dmg`).
Si creás un tag `v0.1.0`, también se publican en "Releases".

> Los instaladores no están firmados: Windows puede mostrar "Windows protegió tu PC" → *Más información* →
> *Ejecutar de todas formas*.

Tus datos quedan en `%APPDATA%\Lifty\data` (Windows) o `~/.config/Lifty/data` (Linux), con una copia de
seguridad automática por día (se guardan las últimas 14). Desde **Más → Copia de seguridad** podés descargar
todo en un archivo.

### Desde el código (para desarrollar)

Necesitás [Node.js 20 o más nuevo](https://nodejs.org).

```bash
npm install
npm run dev          # servidor en :4321 + app web con recarga en http://localhost:5173
npm run desktop      # el programa de escritorio
npm test             # tests
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

### Agregar un módulo (por ejemplo, Peso)

Lifty guarda todo como registros genéricos, así que un módulo nuevo no necesita tocar la base de datos:

1. En `packages/core/src/schema.ts`, definí el esquema (por ejemplo `weightSchema` con `date`, `kg`, `note`) y
   sumalo a `ENTITY_SCHEMAS` y `EntityTypes`. Con eso el servidor ya lo valida y lo sincroniza.
2. Si tiene cálculos (promedios, tendencia), ponelos en `packages/core` con sus tests.
3. En `apps/web/src/pages/` creá la pantalla, registrala en `App.tsx` y en el menú (`Layout.tsx` / `More.tsx`).
   Para guardar: `mutate('weight', 'upsert', registro)`; para leer: `useSync().records.weight`.
