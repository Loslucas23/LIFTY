import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app, BrowserWindow, dialog, Menu, Notification, nativeImage, shell, Tray } from 'electron';
import { startServer } from '../../server/src/index';

/**
 * Lifty para la compu.
 *
 * Arranca el servidor de Lifty adentro del programa (los datos quedan en esta compu) y
 * lo abre en una ventana. El servidor también escucha en la red de casa, así el celular
 * se conecta escaneando un QR. Al cerrar la ventana, Lifty sigue en la bandeja del
 * sistema para que el celular pueda sincronizar.
 */

const SMOKE_TEST = process.argv.includes('--smoke-test');
const DEFAULT_PORT = 4321;
const assets = (...p: string[]) => path.join(__dirname, ...p);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let baseUrl = '';
let server: Awaited<ReturnType<typeof startServer>> | null = null;

// Muchas placas de video en Windows dejan la ventana de Electron en negro. Lifty no
// necesita aceleración gráfica, así que va apagada (LIFTY_GPU=1 la vuelve a prender).
if (process.env.LIFTY_GPU !== '1') app.disableHardwareAcceleration();

/** Registro en %APPDATA%/Lifty/lifty.log para poder diagnosticar problemas. */
function log(...parts: unknown[]) {
  const line = `[${new Date().toISOString()}] ${parts.map((p) => (p instanceof Error ? (p.stack ?? p.message) : String(p))).join(' ')}\n`;
  if (!SMOKE_TEST) console.log(line.trimEnd());
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'lifty.log'), line);
  } catch {
    /* sin permiso de escritura: solo consola */
  }
}

process.on('uncaughtException', (err) => log('uncaughtException', err));
process.on('unhandledRejection', (err) => log('unhandledRejection', err));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app
    .whenReady()
    .then(main)
    .catch((err) => {
      log('No arrancó', err);
      if (!SMOKE_TEST) {
        dialog.showErrorBox(
          'Lifty no pudo arrancar',
          `${err instanceof Error ? err.message : String(err)}\n\nEl detalle quedó en:\n${path.join(app.getPath('userData'), 'lifty.log')}`,
        );
      }
      app.exit(1);
    });
}

/** Primer puerto libre desde `from` (por si el 4321 está ocupado). */
function freePort(from: number): Promise<number> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(freePort(from + 1)));
    probe.once('listening', () => probe.close(() => resolve(from)));
    probe.listen(from, '0.0.0.0');
  });
}

async function main() {
  const dataDir = SMOKE_TEST
    ? fs.mkdtempSync(path.join(app.getPath('temp'), 'lifty-smoke-'))
    : path.join(app.getPath('userData'), 'data');
  const port = await freePort(DEFAULT_PORT);
  server = await startServer({
    dataDir,
    port,
    host: '0.0.0.0',
    webDir: assets('web'),
    wasmPath: assets('sql-wasm.wasm').replace('app.asar', 'app.asar.unpacked'),
    trustLocalhost: true,
    // Dirección para el QR si usás Tailscale u otra red (ver README).
    publicUrl: process.env.LIFTY_PUBLIC_URL || null,
  });
  baseUrl = `http://127.0.0.1:${port}`;
  log(`Servidor en ${baseUrl}`, `datos: ${dataDir}`, `web: ${assets('web')}`);

  createWindow();
  if (SMOKE_TEST) return runSmokeTest();
  createTray(dataDir);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 380,
    minHeight: 560,
    title: 'Lifty',
    icon: assets('icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f4f6f3',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const w = win;
  w.once('ready-to-show', () => {
    if (!SMOKE_TEST && !process.argv.includes('--hidden')) w.show();
  });
  // Por si "ready-to-show" nunca llega, mostrar igual a los pocos segundos.
  setTimeout(() => {
    if (!SMOKE_TEST && !w.isDestroyed() && !w.isVisible() && !process.argv.includes('--hidden')) w.show();
  }, 4000);

  w.webContents.on('did-fail-load', (_e, code, description, url) => {
    log('did-fail-load', code, description, url);
    if (code !== -3) showProblem(w, `No se pudo cargar la app (${description}).`);
  });
  w.webContents.on('render-process-gone', (_e, details) => {
    log('render-process-gone', JSON.stringify(details));
    if (!w.isDestroyed()) showProblem(w, `La ventana se cerró de golpe (${details.reason}).`);
  });
  w.webContents.on('console-message', (event) => {
    const e = event as unknown as { level?: string | number; message?: string };
    if (e.level === 'error' || e.level === 3) log('consola:', e.message);
  });
  // F5 recarga, Ctrl+Shift+I abre las herramientas para diagnosticar.
  w.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') w.webContents.reload();
    if (input.control && input.shift && input.key.toLowerCase() === 'i') w.webContents.toggleDevTools();
  });

  win.loadURL(`${baseUrl}/#/`);

  // Los enlaces externos se abren en el navegador.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(baseUrl)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  win.on('close', (event) => {
    if (quitting || SMOKE_TEST || process.platform === 'darwin') return;
    // Cerrar = minimizar a la bandeja, para que el celular pueda seguir sincronizando.
    event.preventDefault();
    win?.hide();
    if (!hintShown && Notification.isSupported()) {
      hintShown = true;
      new Notification({
        title: 'Lifty sigue abierto',
        body: 'Queda en la bandeja para que tu celular pueda sincronizar. Para salir: clic derecho → Salir.',
      }).show();
    }
  });
}

let hintShown = false;

/** Página de error propia (nunca una ventana negra sin explicación). */
function showProblem(w: BrowserWindow, message: string) {
  const logFile = path.join(app.getPath('userData'), 'lifty.log');
  const html = `<!doctype html><meta charset="utf-8"><title>Lifty</title>
  <body style="font-family:system-ui,sans-serif;background:#f4f6f3;color:#0f1a15;padding:40px;max-width:640px;margin:auto">
  <h1>Algo salió mal</h1><p>${message}</p>
  <p>Probá cerrar Lifty desde el ícono al lado del reloj (clic derecho → Salir) y abrirlo de nuevo.</p>
  <p>Si se repite, mandá este archivo: <code>${logFile.replace(/</g, '&lt;')}</code></p>
  <p><a href="${baseUrl}/#/">Reintentar</a></p></body>`;
  void w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  if (!SMOKE_TEST) w.show();
}

function showWindow(route?: string) {
  if (!win || win.isDestroyed()) createWindow();
  if (route) win!.loadURL(`${baseUrl}/#${route}`);
  win!.show();
  if (win!.isMinimized()) win!.restore();
  win!.focus();
}

function createTray(dataDir: string) {
  const icon = nativeImage.createFromPath(assets('icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Lifty');
  const startAtLogin = () => app.getLoginItemSettings().openAtLogin;
  const rebuild = () =>
    tray!.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir Lifty', click: () => showWindow() },
        { label: 'Conectar el celular…', click: () => showWindow('/conectar') },
        { type: 'separator' },
        {
          label: 'Abrir al iniciar la compu',
          type: 'checkbox',
          checked: startAtLogin(),
          click: (item) => {
            app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] });
            rebuild();
          },
        },
        { label: 'Abrir carpeta de datos', click: () => void shell.openPath(dataDir) },
        { type: 'separator' },
        {
          label: 'Salir',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
  rebuild();
  tray.on('click', () => showWindow());
  if (process.argv.includes('--hidden')) win?.hide();
}

/** Prueba de humo para CI: el servidor responde y la app web dibuja la pantalla de inicio. */
async function runSmokeTest() {
  const fail = (msg: string) => {
    console.error(`SMOKE FAIL: ${msg}`);
    app.exit(1);
  };
  setTimeout(() => fail('timeout'), 30_000);
  try {
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json());
    if (health.app !== 'lifty') return fail('health');
    for (let i = 0; i < 100; i++) {
      const ok = await win!.webContents.executeJavaScript(`!!document.querySelector('.hero')`).catch(() => false);
      if (ok) {
        console.log('SMOKE OK');
        await server?.close();
        app.exit(0);
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    fail('la pantalla de inicio no se dibujó');
  } catch (err) {
    fail(String(err));
  }
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  void server?.close();
});

app.on('activate', () => showWindow());

app.on('window-all-closed', () => {
  // En macOS las apps siguen vivas sin ventanas; en Windows/Linux sigue la bandeja.
  if (SMOKE_TEST) app.quit();
});
