const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
// The asset owner maintains the canonical SVG and generator.
execFileSync(process.execPath, [path.join(root, 'desktop/assets/build.cjs')], { cwd: root, stdio: 'inherit' });
const python = process.env.CLEW_PYTHON || path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(python)) throw new Error('Set CLEW_PYTHON to a Python environment with backend and desktop/requirements.txt installed.');
const pythonArch = execFileSync(python, ['-c', 'import platform; print(platform.machine())'], { encoding: 'utf8' }).trim().toLowerCase();
const architectures = { arm64: ['arm64', 'aarch64'], x64: ['x86_64', 'amd64'] };
if (!architectures[process.arch]?.includes(pythonArch) || (process.platform === 'win32' && process.arch !== 'x64')) {
  throw new Error(`Build with native Python and Node on a supported target: Node=${process.platform}/${process.arch}, Python=${pythonArch}.`);
}
fs.rmSync(path.join(root, 'desktop/build/licenses'), { recursive: true, force: true });
execFileSync(python, [path.join(root, 'desktop/scripts/notices.py'), path.join(root, 'desktop/build/licenses')], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'desktop/scripts/notices.cjs'), path.join(root, 'desktop/build/licenses')], { cwd: root, stdio: 'inherit' });
execFileSync(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'ClewBackend',
  '--distpath', path.join(root, 'desktop/build/backend'), '--workpath', path.join(root, 'desktop/build/pyinstaller'),
  '--specpath', path.join(root, 'desktop/build'), '--paths', path.join(root, 'backend'),
  '--add-data', `${path.join(root, 'contracts')}${path.delimiter}contracts`,
  '--collect-all', 'keyring', '--collect-all', 'jaraco', '--collect-all', 'uvicorn',
  '--copy-metadata', 'keyring', '--copy-metadata', 'clew-backend',
  path.join(root, 'backend/desktop_entry.py')], { cwd: root, stdio: 'inherit' });
execFileSync(python, ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--name', 'ClewExportCommit',
  '--distpath', path.join(root, 'desktop/build/export'), '--workpath', path.join(root, 'desktop/build/export-work'),
  '--specpath', path.join(root, 'desktop/build'), path.join(root, 'desktop/export-commit.py')], { cwd: root, stdio: 'inherit' });
fs.writeFileSync(path.join(root, 'desktop/build/backend/target.json'), JSON.stringify({
  version: require(path.join(root, 'package.json')).version, platform: process.platform, arch: process.arch
}, null, 2));
