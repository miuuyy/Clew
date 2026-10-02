// Explicit native Electron test peer, never loaded by the production launcher.
const { app, BrowserWindow, protocol, net, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createProtocolHandler, fetchBackend } = require('../protocol.cjs');

const directory = process.env.CLEW_PROTOCOL_TEST_DIR;
if (!directory) throw new Error('Set CLEW_PROTOCOL_TEST_DIR to an isolated test directory.');
app.setPath('userData', directory);
protocol.registerSchemesAsPrivileged([{ scheme: 'clew', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
let server;
app.whenReady().then(async () => {
  const bundle = path.join(directory, 'bundle');
  fs.mkdirSync(bundle, { recursive: true });
  fs.writeFileSync(path.join(bundle, 'index.html'), '<!doctype html><title>Protocol test</title><p>Explicit desktop protocol test peer</p>');
  server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const valid = request.headers['x-clew-session'] === 'explicit-test-session' && request.headers.origin === 'clew://app' && body === '{"message":"test"}';
    response.writeHead(valid ? 200 : 403, { 'Content-Type': 'application/x-ndjson' });
    response.write('first\n');
    setTimeout(() => response.end('second\n'), 100);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}`;
  protocol.handle('clew', await createProtocolHandler({ frontendDir: bundle, apiBase, sessionToken: 'explicit-test-session',
    fetchFile: url => net.fetch(url), fetchBackend }));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
  await window.loadURL('clew://app/');
  const write = process.env.CLEW_PROTOCOL_TEST_PHASE === 'write';
  const receipt = await window.webContents.executeJavaScript(`(async () => {
    const response = await fetch('clew://app/api/v1/echo', { method: 'POST', headers: { 'X-Clew-Session': 'explicit-test-session', 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'test' }) });
    const reader = response.body.getReader();
    const first = await reader.read();
    const decoder = new TextDecoder();
    let text = decoder.decode(first.value);
    const progressive = text === 'first\\n' && !first.done;
    while (true) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value); }
    const blocked = await fetch('clew://app/api/v1/echo');
    ${write ? "localStorage.setItem('native-test-preference', 'paper');" : ''}
    return { origin: location.origin, secure: isSecureContext, isolated: typeof require === 'undefined', status: response.status,
      streamed: progressive && text === 'first\\nsecond\\n', blocked: blocked.status, persisted: localStorage.getItem('native-test-preference') === 'paper' };
  })()`);
  session.defaultSession.flushStorageData();
  fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
  const ok = receipt.origin === 'clew://app' && receipt.secure && receipt.isolated && receipt.status === 200 && receipt.streamed && receipt.blocked === 403 && receipt.persisted;
  await new Promise(resolve => server.close(resolve));
  app.exit(ok ? 0 : 1);
}).catch(error => {
  fs.writeFileSync(path.join(directory, 'error.txt'), error.stack || String(error));
  server?.close();
  app.exit(1);
});
