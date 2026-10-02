const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function requireElf(file, arch = process.arch) {
  const header = Buffer.alloc(20);
  const descriptor = fs.openSync(file, 'r');
  try {
    const machine = { x64: 62, arm64: 183 }[arch];
    if (!machine || fs.readSync(descriptor, header, 0, 20, 0) !== 20 || header.toString('hex', 0, 6) !== '7f454c460201' || header.readUInt16LE(18) !== machine) {
      throw new Error(`Expected a native ${arch} ELF64 binary: ${file}`);
    }
  } finally { fs.closeSync(descriptor); }
}

function requireNotifySymbol(file) {
  requireElf(file);
  const symbols = execFileSync('nm', ['-D', '--defined-only', file], { encoding: 'utf8', timeout: 30000 });
  if (!symbols.split('\n').some(line => line.trim().split(/\s+/).at(-1) === 'notify_notification_get_activation_app_launch_context')) {
    throw new Error('Bundled libnotify is missing the symbol required by Electron.');
  }
}

function dependencies(file, environment = process.env) {
  const output = execFileSync('ldd', ['-r', file], { env: environment, encoding: 'utf8', timeout: 30000 });
  if (/undefined symbol:|not found/.test(output)) throw new Error(`Unresolved native dependencies in ${file}:\n${output}`);
}

function verifyAppImage(image) {
  requireElf(image);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'clew-appimage-'));
  try {
    execFileSync(path.resolve(image), ['--appimage-extract'], { cwd: stage, stdio: 'ignore', timeout: 60000 });
    const app = path.join(stage, 'squashfs-root');
    const launcher = fs.readFileSync(path.join(app, 'AppRun'), 'utf8');
    if (launcher !== fs.readFileSync(path.join(__dirname, '../linux/AppRun'), 'utf8')) throw new Error('AppImage did not retain the Clew sandbox-preserving launcher.');
    const desktop = fs.readFileSync(path.join(app, 'clew.desktop'), 'utf8');
    if (/^Exec=.*--no-sandbox/m.test(desktop)) throw new Error('AppImage desktop entry disables the sandbox.');
    const library = path.join(app, 'usr/lib/libnotify.so.4');
    requireNotifySymbol(library);
    const electron = path.join(app, 'clew');
    const backend = path.join(app, 'resources/backend/ClewBackend');
    const exportCommit = path.join(app, 'resources/export/ClewExportCommit');
    requireElf(electron);
    requireElf(backend);
    requireElf(exportCommit);
    const environment = { ...process.env, LD_LIBRARY_PATH: path.join(app, 'usr/lib') };
    dependencies(electron, environment);
    dependencies(backend, { ...environment, LD_LIBRARY_PATH: path.join(app, 'resources/backend/_internal') });
    dependencies(library, environment);
    dependencies(exportCommit, environment);
    console.log(`AppImage ${process.arch}: native Electron/backend, dependency resolution and sandbox launcher passed.`);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

if (require.main === module) {
  if (process.platform !== 'linux') throw new Error('AppImage validation requires native Linux.');
  const folder = path.resolve(__dirname, '../artifacts');
  const images = fs.readdirSync(folder).filter(name => name.endsWith(`-linux-${process.arch}.AppImage`));
  if (images.length !== 1) throw new Error('Expected exactly one native AppImage.');
  verifyAppImage(path.join(folder, images[0]));
}

module.exports = { requireElf, requireNotifySymbol, verifyAppImage };
