const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..', '..');
const folder = path.join(root, 'desktop/artifacts');
const macFolder = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
const executable = process.env.CLEW_SMOKE_EXECUTABLE || (process.platform === 'darwin'
  ? path.join(folder, macFolder, 'Clew.app/Contents/MacOS/Clew')
  : path.join(folder, process.platform === 'win32' ? 'win-unpacked/Clew.exe' : process.arch === 'arm64' ? 'linux-arm64-unpacked/clew' : 'linux-unpacked/clew'));
if (!fs.existsSync(executable)) throw new Error(`Packaged native executable is missing: ${executable}`);
fs.mkdirSync(folder, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clew-package-smoke-'));
const report = path.join(folder, `smoke-${process.platform}-${process.arch}.json`);
const value = crypto.randomBytes(16).toString('hex');
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete environment[key];
}
try {
  for (const phase of ['write', 'read']) {
    fs.rmSync(report, { force: true });
    const result = spawnSync(executable, [], { timeout: 60000, stdio: 'inherit',
      env: { ...environment, CLEW_SMOKE_REPORT: report, CLEW_SMOKE_DATA_DIR: dataDir,
        CLEW_SMOKE_STORAGE_PHASE: phase, CLEW_SMOKE_STORAGE_VALUE: value } });
    if (result.error) throw result.error;
    if (result.status !== 0 || !fs.existsSync(report)) throw new Error(`Packaged app smoke failed (${result.status}). Diagnostics: ${dataDir}`);
    const receipt = JSON.parse(fs.readFileSync(report, 'utf8'));
    if (!receipt.ok || !receipt.backendStopped || !receipt.backendGraceful || !receipt.persisted || receipt.storagePhase !== phase
        || receipt.platform !== process.platform || receipt.arch !== process.arch || receipt.version !== require('../../package.json').version) {
      throw new Error(`Packaged smoke failed: ${JSON.stringify(receipt)}. Diagnostics: ${dataDir}`);
    }
  }
  console.log('Packaged Clew: onboarding, stable storage across restart, CORS, session protection, sandbox and backend shutdown passed.');
  fs.rmSync(dataDir, { recursive: true, force: true });
} catch (error) {
  console.error(`Smoke diagnostics retained: ${dataDir}`);
  throw error;
}
