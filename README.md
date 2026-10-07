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
| **Inicio** | **Hoy podés gastar $X** y **esta semana te quedan $Y** (se recalcula todos los días), avisos ("a este ritmo terminás con…", "te pasás en Comida el día 22", "gastaste 30% más en salidas que el mes pasado"), **Para hoy**: todo lo del día en una lista, venga de donde venga (fijos que vencen, cobros, rutinas, lo que te toca estudiar, lo que se terminó o vence en el stock, vencimientos y sueño/ánimo), cada cosa se resuelve con un toque. Lo que se cobra o paga en los próximos 7 días, proponer pasar al ahorro lo que sobró el mes pasado y primeros pasos. |
| **Movimientos** | Gastos, ingresos, ahorros y **Mover** (transferencias entre cuentas, que no son gasto). Montos como en Excel (`8000+5600`), pesos o dólares, reintegros, dividir un gasto con alguien, "Lo de siempre", deshacer, duplicar. Etiquetas ("viaje Brasil") para juntar gastos de distintas categorías, cotización del dólar del día. Filtros por mes, tipo, categoría, cuenta y etiqueta, y vista de calendario con lo gastado cada día y lo que vence. |
| **Presupuesto mensual** | Asistente de 3 pasos (cuánto entra → qué pagás sí o sí → cuánto querés gastar en cada cosa) con "sin asignar" en vivo y la meta de ahorro primero. Presupuesto por categoría para todos los meses o uno solo, y qué pasa con **lo que sobra** de cada una: queda libre, **se acumula** para el mes siguiente en esa categoría (ropa, regalos) o **va al ahorro** con un toque. Gastos fijos con día de vencimiento, frecuencia (mensual, cada 2/3/6 meses, anual o una vez), "Ya no lo pago", "Lo pago este mes y después no" y "Cambiar el monto desde este mes". Cierre de mes asistido con el saldo real de tus cuentas. |
| **Sueldos** | Nominal → líquido con los descuentos de Uruguay (todo editable) o líquido a mano, vigencia desde/hasta, aguinaldo por semestre en junio y diciembre (el proporcional al terminar un trabajo, solo si lo activás: muchas veces se cobra tarde o con el último sueldo) o "no genera aguinaldo". |
| **Ahorro** | Meta mensual (monto o % de lo que entra) que se aparta primero. Metas con fecha ("US$ 2.000 para diciembre"): cuánto separar por mes y si vas adelantado o atrasado. Depósitos y retiros en pesos y dólares. |
| **Tu plata** | Cada peso tiene un lugar (una cuenta) y un destino. **Te sobra**: lo que hay en tus cuentas para gastar, menos lo apartado para metas y lo comprometido hasta el próximo cobro (fijos que faltan, débito de la tarjeta, cuotas de préstamos, lo que falta ahorrar y lo que deberías tener guardado para lo que pagás cada tanto, como la patente), con cuánto por día. **Dónde está cada peso**: cada cuenta con sus metas adentro y el ahorro "sin destino" (para asignarlo a una meta sin mover plata). **Repartir el cobro**: al cobrar, primero lo que tiene fecha, después tus metas ("pagate primero", los dólares a la cotización de hoy) y lo que queda por día. **Inversiones** (plazo fijo, UI, letras, fondos, acciones, cripto): tasa, vencimiento, intereses estimados, aviso cuando vence, renovar o anotar los intereses. **Préstamos en cuotas**: cuota, día de pago, cuántas faltan, cuándo terminás y cuánto pagás de intereses. **Patrimonio** en pesos y dólares, con **tus bienes** (auto, casa, moto: lo que valen hoy según cuánto se deprecian por año o tu última tasación) y lo de los grupos, % en dólares, cómo cambió y a dónde llegás a este ritmo. **Colchón para emergencias** con la meta de 3 meses. |
| **Cuentas** | Saldo de BROU, Itaú, efectivo, dólares y tarjetas; ajustar saldo. **¿Dónde está tu plata?**: lo que hay en tus cuentas repartido en ahorro, tarjeta, fijos que faltan y lo libre, y si cuadra con tu presupuesto (si no, te ayuda a encontrar la diferencia). **Deudas y préstamos** con pagos parciales y **recordar con amabilidad a quien te debe**: un toque arma el mensaje de WhatsApp con el monto que falta y el detalle (amable, directo o con humor; con su celular abre el chat directo), y si pasa una semana sin que te pague aparece en «Para hoy». **Poner a punto**: decís cuánto tenés hoy en cada cuenta y cuánto debés de la tarjeta, y todo cuadra desde hoy (se ofrece solo al importar el Excel). **¿Llegás a fin de mes?**: lo que tendrías cada día en bancos y efectivo (cobros, fijos, débitos de la tarjeta y tu gasto típico) y tu punto más bajo. |
| **Fechas y regalos** | Las **fechas caras del año** (Fiestas, Reyes, inicio de clases, Día de la Madre y del Padre: se agregan con un toque) y los **cumpleaños**: cuánto pensás gastar, **cuánto apartar por mes** para no llegar justo (lo que falta ÷ los meses que quedan), cuánto llevás gastado (lo anotado con su etiqueta), ideas de regalo y aviso con anticipación en «Para hoy» y en el calendario. |
| **Gastos en grupo** | Para la casa, la pareja o un viaje con amigos (como Splitwise): quién pagó cada cosa, en partes iguales o con montos, **cómo quedan** todos y **cómo quedar a mano con la menor cantidad de pagos**. Con tu plata cuadra: si pagaste vos, sale de tu cuenta y en tu presupuesto cuenta solo tu parte; si pagó otro, cuenta tu parte sin tocar tus cuentas; y los pagos para saldar mueven plata sin ser gasto. Se une a un viaje de **Épocas** (tus gastos llevan su etiqueta y el viaje muestra lo del grupo), y a quien te debe le mandás el resumen por WhatsApp con un toque. |
| **Conciliar con el banco** | En Uruguay no se puede conectar una app al banco, así que se usa el archivo: bajás los movimientos de la web de BROU, Itaú o la tarjeta (Excel .xlsx, CSV o el «.xls» que en realidad es una tabla) y Lifty reconoce solo las columnas (fecha, detalle, débito/crédito o importe, saldo; si no, las elegís). Lo cruza con lo cargado en esa cuenta (mismo monto, hasta 3 días de diferencia) y te muestra **lo que falta anotar** (con la categoría sugerida por tus reglas y tu historial, y el pago de la tarjeta como «Mover» a su resumen), **lo cargado dos veces** (para borrarlo), **lo que está solo en Lifty** y si **el saldo cuadra** con el del banco (o ajustarlo). En la tarjeta, cada cuota coincide con su renglón. Nada se cambia hasta que confirmás. |
| **Día a día** | **¿Con qué tarjeta pago hoy?**: con el día de cierre y de pago de cada tarjeta, «la OCA cerró ayer: si comprás hoy, lo pagás el 20/11, dentro de 45 días» (y al cargar un gasto con la tarjeta te avisa si otra te da más días). **Gastos hormiga**: lo chico (hasta $ 600) que se repite 2 o más veces por mes en los últimos 90 días, por mes, por año y en **horas de tu trabajo** (sueldo líquido ÷ horas del mes; las horas por semana se cambian). **¿Contado o en cuotas?**: «10% contado» contra «12 cuotas sin recargo», pasando cada cuota a plata de hoy con la inflación (o lo que rinde tu plazo fijo), y con qué descuento da lo mismo. **Cuánto te sale cada uso**: un gasto fijo unido a una rutina (gimnasio ↔ «Ir al gimnasio») dice «te salió $ 400 cada vez que fuiste este mes» o «no lo usaste». |
| **Tarjeta de alimentación** | Va **aparte**: no es plata, no entra en ingresos, gastos ni presupuesto. Su saldo, la carga mensual y cuánto te queda por día para el súper. |
| **Tarjeta de crédito** | Compras en cuotas (monto total o por cuota, desde qué mes) y en dólares. Resumen de cada mes en pesos y dólares, **Pagar** (es una transferencia, no un gasto), próximos 6 meses y cuotas que faltan. **Débito automático** (si pagás el resumen entero): cada resumen vencido se da por pagado desde tu cuenta sin anotar nada; si pagás el mínimo, lo desactivás y anotás cada pago. **Día de cierre**: lo que comprás después del cierre entra en el resumen siguiente (el gasto sigue contando en el mes en que compraste), así los resúmenes y el débito quedan exactos. |
| **Informes** | El año mes a mes con gráfico. Tendencias: patrimonio, cuánto ahorrás de lo que entra, en qué se te va la plata, qué días gastás más, lo gastado por etiqueta y los gastos más grandes. **Tu inflación**: cuánto subió lo que vos comprás (stock y gastos fijos) pesado por lo que gastás en cada cosa. Racha de días sin gastar. |
| **Resumen del mes** | Plata y vida juntas: lo que entró, gastaste y ahorraste (contra el mes anterior), en qué se fue, días sin gastar, % de rutinas, estudio, sueño, ánimo, peso y qué te cambia el ánimo, con lo que se destaca. |
| **Importar Excel** | Trae tu `finanzas.xlsm` y antes de importar te muestra, mes a mes, si los totales dan igual que en la planilla y por qué no cuando no. Se puede importar varias veces sin duplicar. |
| **Exportar y respaldo** | Todo a un `.xlsx` (resumen, movimientos, sueldos, fijos, cuentas, metas, deudas, stock, peso, rutinas, estudio y diario). Copia de seguridad automática todos los días y restaurar. **Respaldo automático cifrado**: una vez por día (si hubo cambios) copia todo a la carpeta que elijas (pendrive, OneDrive, Google Drive…) cifrado con tu contraseña (AES-256-GCM); se restaura sumando o "volviendo a esa copia". |
| **Stock de la casa** | Comida, limpieza e higiene: cuánto tenés, cuánto usás por día (aprende de lo que anotás y de cuando contás lo que hay), cuántos días te dura y qué día se termina. Lista de compras automática para cubrir hasta la próxima compra, con cantidades redondeadas al paquete, costo estimado y si te alcanza la tarjeta de alimentación; se puede compartir por WhatsApp. "Registrar compra" suma al stock y carga el gasto en un paso. Precios por unidad (si subieron, dónde está más barato), vencimientos (se usa primero lo más viejo), lo que tirás y cuánto gasta la casa por mes, que se puede usar como presupuesto del súper. |
| **Lista de compras compartida** | Se sincroniza entre la compu y el celular: tildás en el súper y al terminar se registra la compra (stock + gasto). Se le suma lo que falta según el stock o cualquier cosa suelta. |
| **Rutinas** | Hábitos por momento del día y días de la semana (estudiar 60 min, 8 vasos de agua, ejercicio lunes/miércoles/viernes, medicación…): tildar o sumar, racha (los días que no tocan no la cortan), últimos 7 días y horas de estudio de la semana. |
| **Estudio** | Materias con fecha de examen y horas meta: cuánto estudiar por día para llegar, si a tu ritmo llegás, cronómetro (sigue aunque cierres la app) y últimos 14 días. Las sesiones también suman a tu hábito "Estudiar". |
| **Tu semana** | Resumen de lunes a domingo: lo gastado contra la semana anterior y en qué, días sin gastar, ahorro, % de rutinas y mejor racha, horas de estudio, días de ejercicio, peso, compras del súper, sueño y ánimo, y lo que vence la semana que viene. |
| **Lo que pagás siempre** | Suscripciones y gastos fijos ordenados por lo que salen por mes (los anuales repartidos), total por año y cuánto aumentó cada uno. **Revisar suscripciones**: una vez por mes te pregunta «¿usaste esto?» (con cuántas veces la usaste si está unida a una rutina); lo que cancelás deja de contar desde el mes siguiente y Lifty lleva la cuenta de **cuánto ahorrás** por haberlo dado de baja. |
| **Vencimientos** | Cédula, libreta, pasaporte, seguro, service, garantías: aviso en Inicio con la anticipación que elijas y "Renové" que pasa a la próxima fecha. |
| **Metas del año** | "Ahorrar $X", "llegar a 75 kg", "200 h de estudio", "150 días de gimnasio" o lo que anotes a mano: el avance sale solo de lo que cargás, contra dónde deberías estar hoy, y cuánto te falta por mes o por semana. |
| **Recetas** | Ingredientes del stock en la unidad que quieras ("2 cebollas" aunque las compres por kilo, "300 g" de carne): cuántas veces podés hacerla con lo que tenés, cuánto sale el plato y por porción, "Cociné" descuenta del stock (pasando a la unidad de cada producto) y los faltantes van a la lista de compras. |
| **Menú de la semana** | Elegís qué comer cada día (almuerzo y cena, para cuántos) y Lifty suma los ingredientes de todas las comidas, los compara con el stock y arma la lista con lo que falta **en unidades que se compran** ("Cebolla: 4 u. (≈0,6 kg)", paquetes enteros), te dice **cuánto sale cada comida y la semana**, qué te va a sobrar, qué comprar más cerca del día (lo que se echa a perder antes) y qué recetas usan lo que vence. Lo de hoy aparece en "Para hoy" para marcar "Cociné". Los productos saben más: **cuánto pesa una unidad**, **cuánto duran** (y avisan antes de que venzan aunque no anotes la fecha) y si son **básicos** (sal, aceite); los comunes de la feria y el súper se completan solos. |
| **¿Me lo puedo comprar?** | Ponés el precio y las cuotas: mes a mes, lo libre (ingresos − fijos − cuotas − ahorro − tu gasto promedio) menos la cuota, si te alcanza y cuántos meses tardarías en juntarlo. |
| **Diario** | Cuánto dormiste y cómo estás (1 a 5) en un toque, también desde Inicio. Cruza los días que dormís menos de 6 h o estás bajón con lo que gastás, tus rutinas y tu estudio. **Qué te cambia el ánimo**: tu ánimo los días que cumplís cada rutina, dormís 7 h, no gastás o gastás en cada categoría, contra los demás. |
| **Peso** | Pesajes con promedio de 7 días, cambio semanal y mensual, IMC y meta. **Ejercicio y peso**: cuánto cambió tu peso las semanas que entrenaste 3+ veces contra las demás. |
| **Piloto automático** | Lo que Lifty hace solo, con lo que vos actives: los gastos fijos con débito se marcan pagados el día que vencen, el sueldo se marca cobrado el día de cobro, la carga de la tarjeta de alimentación se anota sola, cuando cobrás pasa al ahorro lo que falta para la meta del mes, lo que se termina en el stock va a la lista de compras y tus **reglas** ("uber" → Transporte) categorizan lo que quedó sin categoría (y te sugiere reglas). Todo queda en "Lo que hizo" y se puede deshacer (y no lo repite). |
| **Tu salud** | Dos puntajes de 0 a 100 con la cuenta a la vista: **salud financiera** (ahorro, colchón para emergencias, gastar menos de lo que entra, deudas y cuotas, cuentas al día) y **balance de vida** (rutinas, sueño, ánimo y movimiento), cada parte con qué hacer para mejorarla. **Fondo de emergencia**: cuántos meses te cubre lo que tenés y la meta para llegar a 3 meses en un año. A la noche, "Para hoy" pregunta **¿gastaste algo hoy?** (anotalo o marcá que no). |
| **Coach** | **Plan del mes con un toque**: al empezar el mes propone el presupuesto de cada categoría con lo que gastás normalmente (y lo achica si no entra con tus ingresos, fijos y ahorro). **Avisos de ritmo**: "en ocio vas 45% más rápido que de costumbre: a este ritmo terminás en $X". **Metas que se ajustan solas**: si un mes pusiste menos, recalcula cuánto separar en los meses que quedan (y el piloto puede separarlo solo cuando cobrás). **Los próximos 7 días** (en Tu semana): lo que pagás, cobrás y vence, exámenes, rutinas y lo que podés gastar por día. **Horas de trabajo**: cada gasto te dice cuántas horas de tu sueldo son. |
| **Lista del súper inteligente** | Se ordena sola por sector, como recorrés el súper (verdulería, panadería, carnes, lácteos, almacén, limpieza…). Se agrega escribiendo "2 kg arroz", "leche x3" o con errores ("lehce" → Leche). **Lo de siempre**: lo que comprás cada ~15 días avisa cuando ya toca (aunque no anotes el consumo). **¿Dónde conviene?**: cuánto sale la lista en cada súper con tus últimos precios y cuánto ahorrás dividiendo la compra. **Subió de precio**: avisa desde 15% y dónde lo pagaste menos. Y si te alcanza el presupuesto del súper o la tarjeta de alimentación. |
| **Subcategorías** | Comida afuera › Delivery, Transporte › Uber y taxi… (con ideas para agregar con un toque). Lo de una subcategoría suma a la de arriba y a su presupuesto, y en Presupuesto ves el detalle. Al cargar, si escribís "uber" va directo a la subcategoría. |
| **Calendario** | El mes día por día: cobros, pagos, débitos de la tarjeta, vencimientos, exámenes, vacaciones, lo que gastaste, tu ánimo y tus rutinas. Cuánto falta pagar y cobrar. |
| **Vacaciones y mes difícil** | Vacaciones: presupuesto del viaje, lo que cargás en esas fechas lleva su etiqueta sola, te dice cuánto podés gastar por día y pausa las rutinas. Mes difícil: un tope por día más bajo (sugerido), aviso al cargar y cuántos días lo cumpliste. |
| **Tu año** | Tu año contado con tus números: cuánto entró y salió (contra el año anterior), en qué se fue, tu mejor mes, el gasto más grande, tu clásico, días sin gastar, rutina más constante, ánimo, sueño y peso. |
| **Desafíos** | Metas cortas que se siguen solas: "7 días sin pedir comida", "no pasar de $X en ocio este mes", "3 días sin gastar esta semana", "gimnasio 4 de 7 días", "ahorrar $X antes de fin de mes". Te sugiere los que tienen sentido según tus números (en qué vas más rápido, qué te baja el ánimo, qué rutina te cuesta). |
| **Más inteligente (sin IA)** | Todo con cuentas simples que podés ver tocando "¿De dónde sale?". **A este ritmo** mira cómo gastás cada día de la semana (los sábados no son como los martes) y recorta los días con compras fuera de lo común. **Categoría sugerida**: al escribir "Uber" elige Transporte porque así lo cargaste antes (o por palabras comunes, si recién empezás). **¿Ya lo cargaste?**: avisa si cargás dos veces el mismo gasto. **Parecen gastos fijos**: detecta lo que pagás a mano todos los meses (Netflix, el gimnasio…) y lo pasa a fijos con un toque. **Gastos fuera de lo común**: "$ 9.000 en comida afuera, 5 veces lo normal". **Revisión del presupuesto**: si en una categoría te pasás siempre o siempre te sobra, propone un número más realista. |
| **Buscar en todo** | La lupa (o **/** o **Ctrl+K** en la compu): movimientos por texto, categoría, cuenta, #etiqueta o monto, y también stock, recetas, rutinas, materias, metas, deudas, vencimientos y pantallas. Escribí "500 super" y te ofrece cargar ese gasto. |
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
apenas la vuelve a ver (si falla, reintenta solo cada vez más espaciado). Con los dos conectados, la
sincronización es **en vivo**: lo que tildás en la lista del súper desde el celular aparece al instante en la
compu (el puntito verde al lado de "Sincronizado"). En **Conectar dispositivos** ves el estado de la conexión
(si llega a la compu, en cuántos milisegundos, cambios sin enviar), qué dispositivos están en línea ahora, y
podés ponerles nombre o desvincularlos. Si actualizás Lifty en la compu, el celular avisa "Hay una versión
nueva" para recargar. La primera vez que abras Lifty en Windows puede aparecer el aviso del firewall:
aceptalo para "redes privadas" para que el celular pueda entrar.

**Rápida en el celular.** Al abrir, Lifty baja solo lo que necesita Inicio; el resto de las pantallas se
traen de a una cuando la app queda quieta (así después abren al instante y quedan guardadas para usar sin
conexión). Las cuentas que comparten varias pantallas (saldos, el presupuesto del mes, rutinas) se hacen una
sola vez por cada cambio en los datos. Si una pantalla no se pudo bajar porque se cortó la conexión, aparece un
aviso con **Reintentar** en vez de una pantalla rota.

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
todo en Excel o en un archivo para restaurar, y activar el **respaldo automático cifrado** a un pendrive o a la
nube (OneDrive, Google Drive): elegís la carpeta y una contraseña, y la compu copia sola una vez por día.

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
