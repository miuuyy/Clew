const { spawn } = require('node:child_process');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const readline = require('node:readline');
const { APP_ORIGIN } = require('./security.cjs');

function launchBackend({ root, resources, dataDir, logsDir, packaged, log, python, onExit, version }) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  const token = crypto.randomBytes(32).toString('hex');
  const command = packaged ? path.join(resources, 'backend', process.platform === 'win32' ? 'ClewBackend.exe' : 'ClewBackend') : python;
  if (!command || !fs.existsSync(command)) throw new Error('Clew backend is missing. Reinstall the app or run the development setup.');
  const child = spawn(command, packaged ? [] : [path.join(root, 'backend', 'desktop_entry.py')], {
    cwd: dataDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONPATH: packaged ? '' : path.join(root, 'backend'),
      KG_DB_PATH: path.join(dataDir, 'knowledge_graph.sqlite3'), KG_DESKTOP_TOKEN: token,
      KG_FRONTEND_ORIGIN: APP_ORIGIN, KG_DEBUG_LOG_DIR: path.join(logsDir, 'backend') }
  });
  let ready = false;
  let settled = false;
  let stopped;
  child.stdin.on('error', error => {
    if (!['EPIPE', 'ERR_STREAM_DESTROYED'].includes(error.code)) log(`Backend lifetime pipe failed: ${error.message}`);
  });
  child.on('exit', (code, signal) => { if (ready) onExit?.(code, signal); });
  const startup = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); finish(new Error('Clew backend did not become ready within 30 seconds.')); }, 30000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    child.once('error', error => finish(error));
    child.once('exit', (code, signal) => {
      if (!ready) finish(new Error(`Clew backend exited before startup (${code ?? signal}). See the desktop log.`));
    });
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { log(line); return; }
      if (message?.event !== 'ready' || settled) return;
      if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535 || message.version !== version) {
        child.kill(); finish(new Error('Clew backend returned an invalid startup contract.')); return;
      }
      ready = true;
      finish(null, { apiBase: `http://127.0.0.1:${message.port}`, sessionToken: token });
    });
    readline.createInterface({ input: child.stderr }).on('line', log);
  });
  function stop() {
    if (stopped) return stopped;
    if (child.exitCode !== null || child.signalCode !== null) return;
    stopped = new Promise((resolve, reject) => {
      let forced = false;
      const force = setTimeout(() => {
        forced = true;
        log('The local backend did not exit after launcher EOF; terminating it.');
        child.kill('SIGKILL');
      }, 5000);
      const deadline = setTimeout(() => { clearTimeout(force); reject(new Error('The local backend could not be stopped.')); }, 8000);
      child.once('exit', () => { clearTimeout(force); clearTimeout(deadline); resolve({ forced }); });
      // EOF also happens if the parent crashes. The backend must watch stdin and
      // request graceful uvicorn shutdown; signals alone are abrupt on Windows.
      child.stdin.end();
    });
    return stopped;
  }
  return { child, startup, stop };
}

module.exports = { launchBackend };
