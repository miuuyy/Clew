const { app, BrowserWindow, dialog, ipcMain, Menu, shell, net, protocol, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { launchBackend } = require('./backend.cjs');
const { APP_URL, applicationUrl, externalUrl, trustedFrame } = require('./security.cjs');
const { createProtocolHandler, fetchBackend } = require('./protocol.cjs');
const { createLogger, redact } = require('./logging.cjs');
const { checkLatestRelease } = require('./updates.cjs');
const { DESKTOP_COPY, localeFromSystem, readLocale, saveLocale } = require('./locale.cjs');
const { validateExport, writeExport, nativeCommit } = require('./export.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'clew', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true
} }]);

let locale = 'en';
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
  else {
    const copy = DESKTOP_COPY[locale];
    dialog.showErrorBox(copy.fatal, `${redact(error.message)}\n\n${copy.logLocation(app.getPath('logs'))}`);
  }
  process.exitCode = 1;
  app.quit();
}

async function start() {
  log = createLogger(app.getPath('logs'));
  const userData = app.getPath('userData');
  locale = localeFromSystem(app.getPreferredSystemLanguages()[0] ?? app.getLocale());
  locale = readLocale(userData, locale);
  backend = launchBackend({ root, resources: process.resourcesPath, dataDir: path.join(app.getPath('userData'), 'data'),
    logsDir: app.getPath('logs'), packaged: app.isPackaged, log, version: app.getVersion(),
    onExit: (code, signal) => { if (!quitting) void fatal(new Error(DESKTOP_COPY[locale].backendStopped(code ?? signal))); },
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
  ipcMain.handle('clew:get-locale', event => {
    if (!trustedFrame(event, mainWindow?.webContents)) throw new Error('Untrusted window.');
    return locale;
  });
  ipcMain.handle('clew:set-locale', (event, next) => {
    if (!trustedFrame(event, mainWindow?.webContents)) throw new Error('Untrusted window.');
    if (next === locale) return;
    saveLocale(userData, next);
    locale = next;
    installMenu();
  });
  ipcMain.handle('clew:export-obsidian', async (event, exportPackage) => {
    if (!trustedFrame(event, mainWindow?.webContents)) throw new Error('Untrusted window.');
    const copy = DESKTOP_COPY[locale];
    if (exporting) throw new Error(copy.exportBusy);
    validateExport(exportPackage);
    exporting = true;
    try {
      const choice = await dialog.showOpenDialog(mainWindow, {
        title: copy.exportFolder, properties: ['openDirectory', 'createDirectory']
      });
      if (choice.canceled) return false;
      if (choice.filePaths.length !== 1) throw new Error(copy.chooseOne);
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
  mainWindow.webContents.on('preload-error', (_event, _path, error) => void fatal(new Error(DESKTOP_COPY[locale].bridgeFailed(error.message))));
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (!quitting) void fatal(new Error(DESKTOP_COPY[locale].rendererStopped(details.reason)));
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
  installMenu();
  await mainWindow.loadURL(APP_URL);
  if (smokePath) await smoke(connection);
}

function installMenu() {
  const copy = DESKTOP_COPY[locale];
  const label = copy.menu;
  const mac = process.platform === 'darwin';
  const roles = (...names) => names.map(role => role
    ? { role, label: label[role] } : { type: 'separator' });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    mac ? { label: 'Clew', submenu: roles('about', null, 'hide', 'hideOthers', null, 'quit') }
      : { label: label.file, submenu: roles('close', null, 'quit') },
    { label: label.edit, submenu: roles('undo', 'redo', null, 'cut', 'copy', 'paste', 'selectAll') },
    { label: label.view, submenu: roles('resetZoom', 'zoomIn', 'zoomOut', null, 'togglefullscreen') },
    { role: 'windowMenu', label: label.window, submenu: mac
      ? roles('minimize', 'zoom', null, 'front') : roles('minimize', 'close') },
    { label: label.help, submenu: [
      { label: label.documentation, click: () => void openWeb(copy.docsUrl) },
      { label: label.updates, click: checkForUpdates },
      { label: label.data, click: () => void openFolder(app.getPath('userData')) },
      { label: label.logs, click: () => void openFolder(app.getPath('logs')) },
      { label: label.reportIssue, click: () => void openWeb('https://github.com/miuuyy/Clew/issues') }
    ] }
  ]));
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    const copy = DESKTOP_COPY[locale];
    dialog.showErrorBox(copy.devBuild, copy.devUpdates);
    return;
  }
  if (checkingUpdates) return;
  checkingUpdates = true;
  try {
    const result = await checkLatestRelease(app.getVersion(), process.platform, process.arch);
    const copy = DESKTOP_COPY[locale];
    if (!result.available) { await dialog.showMessageBox({ message: copy.upToDate, buttons: [copy.ok] }); return; }
    const { response } = await dialog.showMessageBox({ message: copy.updateAvailable(result.version),
      detail: copy.updateDetail, buttons: [copy.viewRelease, copy.later], cancelId: 1 });
    if (response === 0) await openWeb(result.url);
  } catch (error) { dialog.showErrorBox(DESKTOP_COPY[locale].updateFailed, redact(error.message)); }
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
  } catch (error) { dialog.showErrorBox(DESKTOP_COPY[locale].folderFailed, redact(error.message)); }
}

async function smoke(bootstrap) {
  const health = await fetch(`${bootstrap.apiBase}/healthz`, { signal: AbortSignal.timeout(5000) });
  const blocked = await fetch(`${bootstrap.apiBase}/api/v1/workspace/current`, { signal: AbortSignal.timeout(5000) });
  const preflight = await fetch(`${bootstrap.apiBase}/api/v1/chatgpt/account`, { method: 'OPTIONS',
    headers: { Origin: 'clew://app', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-clew-session' },
    signal: AbortSignal.timeout(5000) });
  const cors = preflight.ok && preflight.headers.get('Access-Control-Allow-Origin') === 'clew://app';
  const write = process.env.CLEW_SMOKE_STORAGE_PHASE === 'write';
  const initialLocale = write ? localeFromSystem(app.getPreferredSystemLanguages()[0] ?? app.getLocale()) : 'zh-CN';
  const initial = await smokeOnboarding(initialLocale);
  const languages = write && initialLocale === 'zh-CN' ? ['en', 'zh-CN'] : [write ? 'zh-CN' : 'en'];
  let visible = initial;
  for (const next of languages) {
    await mainWindow.webContents.executeJavaScript(`(() => {
      const select = document.querySelector('.signInLanguage select');
      select.value = ${JSON.stringify(next)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    visible = await smokeOnboarding(next);
  }
  if (write) {
    await mainWindow.loadURL(APP_URL);
    visible = await smokeOnboarding('zh-CN');
  }
  const lastLocale = languages.at(-1);
  const menu = Menu.getApplicationMenu().items.find(item => item.label === DESKTOP_COPY[lastLocale].menu.help);
  const localized = initial.localized && visible.localized && locale === lastLocale
    && !!menu?.submenu.items.some(item => item.label === DESKTOP_COPY[lastLocale].menu.updates);
  const rendererAccess = await mainWindow.webContents.executeJavaScript(`(async () => {
    const response = await fetch(window.clewDesktop.apiBase + '/api/v1/chatgpt/account', {
      headers: { 'X-Clew-Session': window.clewDesktop.sessionToken }, signal: AbortSignal.timeout(5000)
    });
    return response.status;
  })()`);
  const storageValue = JSON.stringify(process.env.CLEW_SMOKE_STORAGE_VALUE);
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
    && localized && visible.whiteMark && visible.svgReady;
  fs.writeFileSync(smokePath, JSON.stringify({ ok, version: app.getVersion(), platform: process.platform, arch: process.arch,
    health: health.status, blocked: blocked.status, rendererAccess, cors, exportCommit, origin: visible.origin, secure: visible.secure,
    sandbox, persisted, localized, initialLocale, locale, whiteMark: visible.whiteMark, svgReady: visible.svgReady, storagePhase: process.env.CLEW_SMOKE_STORAGE_PHASE, isolated: visible.isolated,
    bridge: visible.bridge, onboarding: visible.text }, null, 2));
  const image = await mainWindow.webContents.capturePage();
  fs.writeFileSync(smokePath.replace(/\.json$/, '.png'), image.toPNG());
  if (!ok) throw new Error('Packaged onboarding smoke check failed.');
  app.quit();
}

async function smokeOnboarding(expectedLocale) {
  const expected = DESKTOP_COPY[expectedLocale];
  const deadline = Date.now() + 20000;
  let visible;
  do {
    visible = await mainWindow.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('.signInContinue');
      const github = document.querySelector('a[href="https://github.com/miuuyy/Clew"]');
      const x = document.querySelector('a[href="https://x.com/miu21590"]');
      const select = document.querySelector('.signInLanguage select');
      const logo = document.querySelector('.signInMark');
      return { text: document.body.innerText, isolated: typeof require === 'undefined', bridge: !!window.clewDesktop,
        origin: location.origin, secure: isSecureContext, ready: !!button && !button.disabled && !select?.disabled,
        svgReady: (logo?.querySelector('use')?.getBBox().width ?? 0) > 0,
        whiteMark: !!logo && getComputedStyle(logo).color === 'rgb(255, 255, 255)',
        localized: document.documentElement.lang === ${JSON.stringify(expectedLocale)}
          && select?.value === ${JSON.stringify(expectedLocale)}
          && button?.textContent.trim() === ${JSON.stringify(expected.continue)}
          && github?.getAttribute('aria-label') === ${JSON.stringify(expected.github)}
          && x?.getAttribute('aria-label') === ${JSON.stringify(expected.x)}
      };
    })()`);
    if (visible.ready && visible.svgReady && visible.localized) return visible;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`Onboarding did not render in ${expectedLocale}. ${JSON.stringify(visible)}`);
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
