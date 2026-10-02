const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchBackend } = require('../backend.cjs');

const python = process.env.CLEW_PYTHON || path.resolve(__dirname, '../../.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
function peer(port) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clew-backend-peer-'));
  fs.mkdirSync(path.join(root, 'backend'));
  fs.writeFileSync(path.join(root, 'backend/desktop_entry.py'), `import os,sys,json\nassert os.environ['KG_FRONTEND_ORIGIN'] == 'clew://app'\nassert os.path.isabs(os.environ['KG_DEBUG_LOG_DIR'])\nassert len(os.environ['KG_DESKTOP_TOKEN']) == 64\nprint(json.dumps({'event':'ready','port':${port},'version':'1.0.0'}),flush=True)\nsys.stdin.buffer.read()\n`);
  return root;
}

test('backend launch supplies its private session and writable paths, then exits on launcher EOF', async () => {
  const root = peer(45678);
  let backend;
  try {
    backend = launchBackend({ root, dataDir: path.join(root, 'data'), logsDir: path.join(root, 'logs'), packaged: false, python, log: () => {}, version: '1.0.0' });
    const bootstrap = await backend.startup;
    assert.equal(bootstrap.apiBase, 'http://127.0.0.1:45678');
    assert.match(bootstrap.sessionToken, /^[a-f0-9]{64}$/);
    const stopping = backend.stop();
    assert.equal(backend.stop(), stopping);
    assert.deepEqual(await stopping, { forced: false });
    assert.equal(backend.child.exitCode, 0);
  } finally { await backend?.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('backend rejects an invalid readiness contract and cannot pretend to start', async () => {
  const root = peer(0);
  let backend;
  try {
    backend = launchBackend({ root, dataDir: path.join(root, 'data'), logsDir: path.join(root, 'logs'), packaged: false, python, log: () => {}, version: '1.0.0' });
    await assert.rejects(backend.startup, /invalid startup contract/);
  } finally { await backend?.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});
