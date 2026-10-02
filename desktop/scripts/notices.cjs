const fs = require('node:fs');
const path = require('node:path');

function installedPackage(name, base) {
  let directory = base;
  for (;;) {
    const candidate = path.join(directory, 'node_modules', name, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Missing installed runtime dependency: ${name}`);
    directory = parent;
  }
}

function collectNotices(root, output) {
  const seen = new Set();
  const index = [];
  function visit(name, base) {
    const manifest = installedPackage(name, base);
    const directory = path.dirname(manifest);
    const metadata = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const identity = `${metadata.name}@${metadata.version}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const destination = path.join(output, 'JavaScript', identity.replaceAll('/', '__'));
    fs.mkdirSync(destination, { recursive: true });
    const notices = [];
    function scan(folder) {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.isSymbolicLink()) continue;
        const source = path.join(folder, entry.name);
        if (entry.isDirectory()) scan(source);
        else if (/^(license|licence|copying|notice|copyright|authors)([._-]|$)/i.test(entry.name)) {
          const relative = path.relative(directory, source);
          fs.mkdirSync(path.dirname(path.join(destination, relative)), { recursive: true });
          fs.copyFileSync(source, path.join(destination, relative));
          notices.push(relative);
        }
      }
    }
    scan(directory);
    const supplements = {
      'remark-math@6.0.0': 'remark-math-MIT.txt',
      'rehype-katex@7.0.1': 'remark-math-MIT.txt'
    };
    if (!notices.length) {
      const supplement = supplements[identity];
      if (!supplement) throw new Error(`Missing license notice for ${identity}; supply its reviewed upstream notice.`);
      fs.copyFileSync(path.join(root, 'desktop/licenses', supplement), path.join(destination, supplement));
      notices.push(supplement);
    }
    index.push({ name: metadata.name, version: metadata.version, license: metadata.license || 'See notices', notices });
    for (const dependency of Object.keys(metadata.dependencies || {})) visit(dependency, directory);
    // Only installed optional dependencies belong to the current native build.
    for (const dependency of Object.keys(metadata.optionalDependencies || {})) {
      try { installedPackage(dependency, directory); } catch { continue; }
      visit(dependency, directory);
    }
  }
  for (const base of [root, path.join(root, 'frontend')]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
    for (const name of Object.keys(manifest.dependencies || {})) visit(name, base);
  }
  fs.writeFileSync(path.join(output, 'JavaScript-INDEX.json'), JSON.stringify(index.sort((a, b) => a.name.localeCompare(b.name)), null, 2));
  const native = path.join(root, 'desktop/build/native-notices');
  if (fs.existsSync(native)) fs.cpSync(native, path.join(output, 'Native'), { recursive: true });
  const fonts = path.join(output, 'Fonts');
  fs.mkdirSync(fonts, { recursive: true });
  for (const notice of ['manrope-OFL.txt', 'jetbrains-mono-OFL.txt', 'README.md']) {
    fs.copyFileSync(path.join(root, 'frontend/public/fonts', notice), path.join(fonts, notice));
  }
  console.log(`Collected notices for ${index.length} JavaScript runtime packages.`);
}

if (require.main === module) collectNotices(path.resolve(__dirname, '../..'), path.resolve(process.argv[2]));
module.exports = { collectNotices };
