// Stage a native, ABI-checked build toolset without changing shared caches.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Arch } = require('builder-util');
const { getAppImageTools } = require('app-builder-lib/out/toolsets/linux.js');
const { requireElf, requireNotifySymbol } = require('./verify-linux.cjs');

async function main() {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Linux native preparation requires Linux x64 or arm64.');
  const root = path.resolve(__dirname, '../..');
  const output = path.join(root, 'desktop/build/linux');
  fs.mkdirSync(output, { recursive: true });
  const archive = path.join(output, 'libnotify-0.8.7.tar.xz');
  execFileSync('curl', ['--fail', '--location', '--retry', '3', '--connect-timeout', '15', '--max-time', '300',
    'https://download.gnome.org/sources/libnotify/0.8/libnotify-0.8.7.tar.xz', '--output', archive], { stdio: 'inherit' });
  if (crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== '4be15202ec4184fce1ac15997ece5530d2be32fe9573875aeb10e3b573858748') {
    throw new Error('libnotify source checksum mismatch.');
  }
  const stage = fs.mkdtempSync(path.join(output, 'source-'));
  try {
    execFileSync('tar', ['-xJf', archive, '-C', stage]);
    const source = path.join(stage, 'libnotify-0.8.7');
    const build = path.join(stage, 'build');
    execFileSync('meson', ['setup', build, source, '--buildtype=release', '--strip', '-Dtests=false',
      '-Dintrospection=disabled', '-Dman=false', '-Dgtk_doc=false', '-Ddocbook_docs=disabled'], { stdio: 'inherit' });
    execFileSync('meson', ['compile', '-C', build], { stdio: 'inherit' });
    const library = path.join(output, 'libnotify.so.4');
    fs.copyFileSync(path.join(build, 'libnotify/libnotify.so.4'), library);
    fs.chmodSync(library, 0o755);
    requireElf(library);
    requireNotifySymbol(library);
    const notices = path.join(root, 'desktop/build/native-notices/libnotify');
    fs.mkdirSync(notices, { recursive: true });
    fs.copyFileSync(path.join(source, 'COPYING'), path.join(notices, 'COPYING'));
    fs.writeFileSync(path.join(notices, 'SOURCE.txt'), 'libnotify 0.8.7\nhttps://download.gnome.org/sources/libnotify/0.8/libnotify-0.8.7.tar.xz\nLGPL-2.1-or-later; source archive shipped alongside release notices.\n');
    fs.copyFileSync(archive, path.join(notices, path.basename(archive)));
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }

  const tools = await getAppImageTools('0.0.0', Arch[process.arch]);
  const cache = path.dirname(tools.runtime);
  const owned = path.join(root, 'desktop/build/appimage-tools');
  fs.rmSync(owned, { recursive: true, force: true });
  fs.cpSync(cache, owned, { recursive: true, verbatimSymlinks: true });
  if (process.arch === 'x64') {
    const link = path.join(owned, 'lib/x64/libnotify.so.4');
    const target = fs.realpathSync(link);
    const relative = path.relative(owned, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('libnotify target escapes owned build tools.');
    fs.copyFileSync(path.join(output, 'libnotify.so.4'), target);
    requireNotifySymbol(link);
  }
  const mksquashfs = path.join(owned, `linux-${process.arch}`, 'mksquashfs');
  requireElf(mksquashfs);
  execFileSync(mksquashfs, ['-version'], { stdio: 'inherit' });
  const fpm = execFileSync('fpm', ['--version'], { encoding: 'utf8' }).trim();
  if (fpm !== '1.17.0') throw new Error('Install native fpm 1.17.0 before packaging.');
  if (process.env.GITHUB_ENV) fs.appendFileSync(process.env.GITHUB_ENV, `APPIMAGE_TOOLS_PATH=${owned}\nUSE_SYSTEM_FPM=true\n`);
  console.log(`APPIMAGE_TOOLS_PATH=${owned}\nUSE_SYSTEM_FPM=true`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
