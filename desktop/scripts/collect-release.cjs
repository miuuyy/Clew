const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parse, stringify } = require('yaml');

async function sha512(file) {
  const hash = crypto.createHash('sha512');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('base64');
}
function safeName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..');
}

async function collectRelease(source, destination, { complete = false, version = require('../../package.json').version } = {}) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  const relative = path.relative(source, destination);
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('Output must be outside the input tree.');
  if (fs.existsSync(destination) && fs.readdirSync(destination).length) throw new Error('Release output must be empty.');
  const assets = new Map();
  const manifests = new Map();
  const allowedManifests = new Set(['latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml']);
  function scan(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Release inputs must not contain symlinks.');
      if (entry.isDirectory()) { scan(file); continue; }
      if (!entry.isFile() || !safeName(entry.name)) throw new Error('Invalid release asset name.');
      if (allowedManifests.has(entry.name)) {
        const documents = manifests.get(entry.name) || [];
        documents.push(parse(fs.readFileSync(file, 'utf8'), { maxAliasCount: 0 }));
        manifests.set(entry.name, documents);
      } else {
        if (assets.has(entry.name)) throw new Error(`Duplicate release asset: ${entry.name}`);
        if (!/\.(dmg|zip|exe|AppImage|deb|blockmap|json|png)$/.test(entry.name)) throw new Error(`Unexpected release asset: ${entry.name}`);
        assets.set(entry.name, file);
      }
    }
  }
  scan(source);
  if (assets.size === 0 || manifests.size === 0) throw new Error('Release artifacts or manifests are missing.');
  const merged = new Map();
  for (const [name, documents] of manifests) {
    const files = new Map();
    for (const metadata of documents) {
      if (metadata?.version !== version || !Array.isArray(metadata.files) || !metadata.files.length) throw new Error('Mixed versions or invalid updater metadata.');
      for (const item of metadata.files) {
        if (!safeName(item?.url) || typeof item.sha512 !== 'string' || !Number.isSafeInteger(item.size) || item.size <= 0) throw new Error('Invalid update asset contract.');
        const asset = assets.get(item.url);
        if (!asset) throw new Error(`Missing update asset: ${item.url}`);
        if (files.has(item.url)) throw new Error(`Duplicate update asset: ${item.url}`);
        const os = name === 'latest-mac.yml' ? 'mac' : name === 'latest.yml' ? 'win' : 'linux';
        const arch = name === 'latest-linux-arm64.yml' ? ['arm64'] : name === 'latest-mac.yml' ? ['arm64', 'x64'] : ['x64'];
        const extensions = os === 'mac' ? ['zip', 'dmg'] : os === 'win' ? ['exe'] : ['AppImage'];
        const names = arch.flatMap(a => extensions.map(ext => `Clew-${version}-${os}-${a}.${ext}`));
        if (!names.includes(item.url)) throw new Error(`Wrong platform asset in ${name}: ${item.url}`);
        if (fs.statSync(asset).size !== item.size || await sha512(asset) !== item.sha512) throw new Error(`Update asset checksum or size mismatch: ${item.url}`);
        files.set(item.url, item);
      }
      if (metadata.path && (!safeName(metadata.path) || !files.has(metadata.path) || metadata.sha512 !== files.get(metadata.path).sha512)) {
        throw new Error('Legacy manifest fields do not match a verified asset.');
      }
    }
    const ordered = [...files.values()].sort((a, b) => {
      // ZIP is Squirrel's macOS payload; keep the legacy fields consistent too.
      const priority = value => value.url.endsWith('.zip') ? 0 : 1;
      return priority(a) - priority(b) || a.url.localeCompare(b.url);
    });
    const dates = documents.map(item => item.releaseDate).filter(value => typeof value === 'string' && !Number.isNaN(Date.parse(value))).sort();
    merged.set(name, { version, files: ordered, path: ordered[0].url, sha512: ordered[0].sha512,
      ...(dates.length ? { releaseDate: dates.at(-1) } : {}) });
  }
  if (complete) {
    const expected = [
      'win-x64.exe', 'mac-arm64.dmg', 'mac-arm64.zip', 'mac-x64.dmg', 'mac-x64.zip',
      'linux-x64.AppImage', 'linux-x64.deb', 'linux-arm64.AppImage', 'linux-arm64.deb'
    ].map(suffix => `Clew-${version}-${suffix}`);
    for (const asset of expected) if (!assets.has(asset)) throw new Error(`Required release asset missing: ${asset}`);
    for (const name of allowedManifests) if (!merged.has(name)) throw new Error(`Required updater manifest missing: ${name}`);
    for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64'], ['linux', 'arm64']]) {
      const name = `smoke-${platform}-${arch}.json`;
      if (!assets.has(name) || !assets.has(name.replace('.json', '.png'))) throw new Error(`Missing packaged smoke evidence: ${name}`);
      const receipt = JSON.parse(fs.readFileSync(assets.get(name), 'utf8'));
      if (receipt.version !== version || receipt.platform !== platform || receipt.arch !== arch || !receipt.ok
          || receipt.origin !== 'clew://app' || !receipt.sandbox || !receipt.persisted || !receipt.backendStopped || !receipt.backendGraceful
          || !receipt.cors || !receipt.exportCommit || !receipt.whiteMark || !receipt.svgReady || receipt.storagePhase !== 'read') {
        throw new Error(`Failed or stale packaged smoke evidence: ${name}`);
      }
    }
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(destination), '.clew-release-'));
  try {
    for (const [name, file] of assets) fs.copyFileSync(file, path.join(stage, name));
    for (const [name, metadata] of merged) fs.writeFileSync(path.join(stage, name), stringify(metadata));
    if (fs.existsSync(destination)) fs.rmdirSync(destination);
    fs.renameSync(stage, destination);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}

if (require.main === module) {
  const [source, destination, mode] = process.argv.slice(2);
  if (!source || !destination || (mode && mode !== '--complete')) throw new Error('Usage: collect-release <input> <output> [--complete]');
  collectRelease(source, destination, { complete: mode === '--complete' }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { collectRelease };
