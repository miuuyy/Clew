const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', 'frontend', 'run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const result = spawnSync(require('electron'), [root], { cwd: root, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
process.exit(result.status ?? 1);
