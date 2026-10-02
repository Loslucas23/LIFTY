import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { app, BrowserWindow, Menu, Notification, nativeImage, shell, Tray } from 'electron';
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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app
    .whenReady()
    .then(main)
    .catch((err) => {
      console.error(err);
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
    show: !SMOKE_TEST,
    webPreferences: { contextIsolation: true, sandbox: true },
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
