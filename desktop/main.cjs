const { app, BrowserWindow, dialog, ipcMain, Menu, shell, net, protocol, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { launchBackend } = require('./backend.cjs');
const { APP_URL, applicationUrl, externalUrl, trustedFrame } = require('./security.cjs');
const { createProtocolHandler, fetchBackend } = require('./protocol.cjs');
const { createLogger, redact } = require('./logging.cjs');
const { checkLatestRelease } = require('./updates.cjs');
const { validateExport, writeExport, nativeCommit } = require('./export.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'clew', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true
} }]);

let mainWindow;
let backend;
let quitting = false;
let failing = false;
let checkingUpdates = false;
let exporting = false;
let log = value => process.stderr.write(`${redact(value)}\n`);
const root = path.join(__dirname, '..');
const smokePath = process.env.CLEW_SMOKE_REPORT;
const python = process.env.CLEW_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (smokePath && process.env.CLEW_SMOKE_DATA_DIR) {
  app.setPath('userData', process.env.CLEW_SMOKE_DATA_DIR);
  app.setAppLogsPath(path.join(process.env.CLEW_SMOKE_DATA_DIR, 'logs'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(start).catch(fatal);
}

async function fatal(error) {
  if (failing || quitting) return;
  failing = true;
  log(error.stack || String(error));
  if (smokePath) {
    let previous = {};
    try { previous = JSON.parse(fs.readFileSync(smokePath, 'utf8')); } catch {}
    fs.mkdirSync(path.dirname(smokePath), { recursive: true });
    fs.writeFileSync(smokePath, JSON.stringify({ ...previous, ok: false, error: redact(error.message) }, null, 2));
  }
  else dialog.showErrorBox('Clew could not continue', `${redact(error.message)}\n\nLogs: ${app.getPath('logs')}`);
  process.exitCode = 1;
  app.quit();
}

async function start() {
  log = createLogger(app.getPath('logs'));
  backend = launchBackend({ root, resources: process.resourcesPath, dataDir: path.join(app.getPath('userData'), 'data'),
    logsDir: app.getPath('logs'), packaged: app.isPackaged, log, version: app.getVersion(),
    onExit: (code, signal) => { if (!quitting) void fatal(new Error(`The local backend stopped (${code ?? signal}). Restart Clew.`)); },
    python });
  const connection = await backend.startup;
  const bootstrap = { ...connection, apiBase: 'clew://app', version: app.getVersion(), platform: process.platform };
  if (failing || quitting) return;
  const frontendDir = app.isPackaged ? path.join(process.resourcesPath, 'frontend') : path.join(root, 'frontend/dist');
  protocol.handle('clew', await createProtocolHandler({ frontendDir, ...connection,
    fetchFile: url => net.fetch(url), fetchBackend }));
  ipcMain.handle('clew:open-external', (event, url) => {
    if (!trustedFrame(event, mainWindow?.webContents)) throw new Error('Untrusted window.');
    return shell.openExternal(externalUrl(url));
  });
  ipcMain.handle('clew:export-obsidian', async (event, exportPackage) => {
    if (!trustedFrame(event, mainWindow?.webContents)) throw new Error('Untrusted window.');
    if (exporting) throw new Error('An Obsidian export is already in progress.');
    validateExport(exportPackage);
    exporting = true;
    try {
      const choice = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose a parent folder for the Obsidian export', properties: ['openDirectory', 'createDirectory']
      });
      if (choice.canceled) return false;
      if (choice.filePaths.length !== 1) throw new Error('Choose one export directory.');
      return await writeExport(exportPackage, choice.filePaths[0], nativeCommit({ root, resources: process.resourcesPath, packaged: app.isPackaged, python }));
    } finally { exporting = false; }
  });
  mainWindow = new BrowserWindow({ width: 1400, height: 920, minWidth: 860, minHeight: 620, show: false,
    title: 'Clew', backgroundColor: '#000000', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, webSecurity: true,
      additionalArguments: [`--clew-bootstrap=${encodeURIComponent(JSON.stringify(bootstrap))}`] }
  });
  mainWindow.webContents.on('preload-error', (_event, _path, error) => void fatal(new Error(`The desktop bridge failed: ${error.message}`)));
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (!quitting) void fatal(new Error(`The renderer stopped (${details.reason}). Restart Clew.`));
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openWeb(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-redirect', event => { if (!applicationUrl(event.url)) event.preventDefault(); });
  mainWindow.webContents.on('will-frame-navigate', event => {
    if (!event.isMainFrame || !applicationUrl(event.url)) {
      event.preventDefault();
      if (event.isMainFrame) void openWeb(event.url);
    }
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.once('ready-to-show', () => { if (!smokePath) mainWindow.show(); });
  mainWindow.on('closed', () => { mainWindow = null; });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Clew', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    ...(process.platform !== 'darwin' ? [{ label: 'File', submenu: [{ role: 'close' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [
      { label: 'Documentation', click: () => void openWeb('https://clew.my/docs') },
      { label: 'Check for Updates…', click: checkForUpdates },
      { label: 'Open Data Folder', click: () => void openFolder(app.getPath('userData')) },
      { label: 'Open Logs', click: () => void openFolder(app.getPath('logs')) },
      { label: 'Report an Issue', click: () => void openWeb('https://github.com/miuuyy/Clew/issues') }
    ] }
  ]));
  await mainWindow.loadURL(APP_URL);
  if (smokePath) await smoke(connection);
}

async function checkForUpdates() {
  if (!app.isPackaged) { dialog.showErrorBox('Development build', 'Install a release build to check for updates.'); return; }
  if (checkingUpdates) return;
  checkingUpdates = true;
  try {
    const result = await checkLatestRelease(app.getVersion(), process.platform, process.arch);
    if (!result.available) { await dialog.showMessageBox({ message: 'Clew is up to date.' }); return; }
    const { response } = await dialog.showMessageBox({ message: `Clew ${result.version} is available.`,
      detail: 'Download the installer from the release page, close Clew, and install it. Your local data is retained.',
      buttons: ['View Release', 'Later'], cancelId: 1 });
    if (response === 0) await openWeb(result.url);
  } catch (error) { dialog.showErrorBox('Could not check for updates', redact(error.message)); }
  finally { checkingUpdates = false; }
}

async function openWeb(url) {
  try { await shell.openExternal(externalUrl(url)); }
  catch (error) { log(`Could not open external link: ${error.message}`); }
}

async function openFolder(folder) {
  try {
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
  } catch (error) { dialog.showErrorBox('Could not open folder', redact(error.message)); }
}

async function smoke(bootstrap) {
  const health = await fetch(`${bootstrap.apiBase}/healthz`, { signal: AbortSignal.timeout(5000) });
  const blocked = await fetch(`${bootstrap.apiBase}/api/v1/workspace/current`, { signal: AbortSignal.timeout(5000) });
  const preflight = await fetch(`${bootstrap.apiBase}/api/v1/chatgpt/account`, { method: 'OPTIONS',
    headers: { Origin: 'clew://app', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-clew-session' },
    signal: AbortSignal.timeout(5000) });
  const cors = preflight.ok && preflight.headers.get('Access-Control-Allow-Origin') === 'clew://app';
  const deadline = Date.now() + 20000;
  let visible;
  do {
    visible = await mainWindow.webContents.executeJavaScript(`({ title: document.title, text: document.body.innerText, isolated: typeof require === 'undefined', bridge: !!window.clewDesktop, origin: location.origin, secure: isSecureContext, ready: !!document.querySelector('.signInContinue:not(:disabled)'), svgReady: (document.querySelector('.signInMark use')?.getBBox().width ?? 0) > 0, whiteMark: !!document.querySelector('.signInMark') && getComputedStyle(document.querySelector('.signInMark')).color === 'rgb(255, 255, 255)', github: !!document.querySelector('a[aria-label="Star on GitHub"]'), x: !!document.querySelector('a[aria-label="Follow on X"]') })`);
    if (visible.ready && visible.svgReady) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  const rendererAccess = await mainWindow.webContents.executeJavaScript(`(async () => {
    const response = await fetch(window.clewDesktop.apiBase + '/api/v1/chatgpt/account', {
      headers: { 'X-Clew-Session': window.clewDesktop.sessionToken }, signal: AbortSignal.timeout(5000)
    });
    return response.status;
  })()`);
  const storageValue = JSON.stringify(process.env.CLEW_SMOKE_STORAGE_VALUE);
  const write = process.env.CLEW_SMOKE_STORAGE_PHASE === 'write';
  const persisted = await mainWindow.webContents.executeJavaScript(`(() => {
    ${write ? `localStorage.setItem('clew-smoke-preference', ${storageValue}); localStorage.setItem('knowledge_graph_theme_mode_v1', 'light');` : ''}
    return localStorage.getItem('clew-smoke-preference') === ${storageValue};
  })()`);
  session.defaultSession.flushStorageData();
  const exportPackage = { kind: 'mapmind_obsidian_export', version: 1, folder_name: 'Smoke export', file_count: 1,
    files: [{ path: 'Topic.md', body: '# Clew smoke\n' }] };
  const parent = fs.realpathSync(app.getPath('userData'));
  const commit = nativeCommit({ root, resources: process.resourcesPath, packaged: app.isPackaged, python });
  if (write) await writeExport(exportPackage, parent, commit);
  let collisionRejected = false;
  try { await writeExport(exportPackage, parent, commit); } catch { collisionRejected = true; }
  const exportCommit = collisionRejected && fs.readFileSync(path.join(parent, 'Smoke export/Topic.md'), 'utf8') === '# Clew smoke\n';
  const preferences = mainWindow.webContents.getLastWebPreferences();
  const sandbox = preferences.sandbox && preferences.contextIsolation && !preferences.nodeIntegration && preferences.webSecurity;
  const ok = health.ok && blocked.status === 403 && rendererAccess === 200 && cors && exportCommit && sandbox && persisted
    && visible.origin === 'clew://app' && visible.secure && visible.isolated && visible.bridge && visible.ready
    && visible.text.includes('Continue with ChatGPT') && visible.github && visible.x && visible.whiteMark && visible.svgReady;
  fs.writeFileSync(smokePath, JSON.stringify({ ok, version: app.getVersion(), platform: process.platform, arch: process.arch,
    health: health.status, blocked: blocked.status, rendererAccess, cors, exportCommit, origin: visible.origin, secure: visible.secure,
    sandbox, persisted, whiteMark: visible.whiteMark, svgReady: visible.svgReady, storagePhase: process.env.CLEW_SMOKE_STORAGE_PHASE, isolated: visible.isolated,
    bridge: visible.bridge, onboarding: visible.text }, null, 2));
  const image = await mainWindow.webContents.capturePage();
  fs.writeFileSync(smokePath.replace(/\.json$/, '.png'), image.toPNG());
  if (!ok) throw new Error('Packaged onboarding smoke check failed.');
  app.quit();
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (!backend || quitting) return;
  event.preventDefault();
  quitting = true;
  Promise.resolve(backend.stop()).then(result => {
    if (smokePath && fs.existsSync(smokePath)) {
      const receipt = JSON.parse(fs.readFileSync(smokePath, 'utf8'));
      fs.writeFileSync(smokePath, JSON.stringify({ ...receipt, backendStopped: true, backendGraceful: !result?.forced }, null, 2));
    }
  }).catch(error => {
    log(error.message);
    process.exitCode = 1;
  }).finally(() => app.quit());
});
