const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { stringify, parse } = require('yaml');
const crypto = require('node:crypto');
const { collectRelease } = require('../scripts/collect-release.cjs');

test('release metadata retains downloads for both Mac architectures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clew-manifest-'));
  try {
    const source = path.join(root, 'input');
    const destination = path.join(root, 'output');
    for (const arch of ['arm64', 'x64']) {
      const folder = path.join(source, arch);
      fs.mkdirSync(folder, { recursive: true });
      const asset = `Clew-1.0.0-mac-${arch}.zip`;
      fs.writeFileSync(path.join(folder, asset), arch);
      const sha512 = crypto.createHash('sha512').update(arch).digest('base64');
      fs.writeFileSync(path.join(folder, 'latest-mac.yml'), stringify({ version: '1.0.0', path: asset, sha512,
        files: [{ url: asset, sha512, size: Buffer.byteLength(arch) }] }));
    }
    execFileSync(process.execPath, [path.join(__dirname, '../scripts/collect-release.cjs'), source, destination]);
    const manifest = parse(fs.readFileSync(path.join(destination, 'latest-mac.yml'), 'utf8'));
    assert.deepEqual(manifest.files.map(file => file.url).sort(), ['Clew-1.0.0-mac-arm64.zip', 'Clew-1.0.0-mac-x64.zip']);
    fs.writeFileSync(path.join(source, 'x64', 'latest-mac.yml'), stringify({ version: '2.0.0', files: [] }));
    assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, '../scripts/collect-release.cjs'), source, path.join(root, 'rejected')], { stdio: 'pipe' }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('release merge rejects corrupted assets, traversal and missing targets before writing output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clew-manifest-reject-'));
  try {
    const source = path.join(root, 'source');
    fs.mkdirSync(source);
    const asset = 'Clew-1.0.0-mac-arm64.zip';
    const item = { url: asset, sha512: crypto.createHash('sha512').update('body').digest('base64'), size: 4 };
    fs.writeFileSync(path.join(source, asset), 'body');
    const manifest = files => fs.writeFileSync(path.join(source, 'latest-mac.yml'), stringify({ version: '1.0.0', files }));
    manifest([{ ...item, url: '../outside.zip' }]);
    await assert.rejects(collectRelease(source, path.join(root, 'out')), /contract/);
    manifest([item]);
    fs.writeFileSync(path.join(source, asset), 'fake');
    await assert.rejects(collectRelease(source, path.join(root, 'out')), /checksum/);
    assert.equal(fs.existsSync(path.join(root, 'out')), false);
    fs.writeFileSync(path.join(source, asset), 'body');
    await assert.rejects(collectRelease(source, path.join(root, 'out'), { complete: true }), /Required release asset/);
    manifest([item, { ...item }]);
    await assert.rejects(collectRelease(source, path.join(root, 'out')), /Duplicate/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Linux manifests retain verified AppImage and Debian downloads for each architecture', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clew-linux-manifest-'));
  try {
    const source = path.join(root, 'source');
    for (const arch of ['x64', 'arm64']) {
      const folder = path.join(source, arch);
      fs.mkdirSync(folder, { recursive: true });
      const files = ['AppImage', 'deb'].map(extension => {
        const url = `Clew-1.0.0-linux-${arch}.${extension}`;
        const body = `${arch}-${extension}`;
        fs.writeFileSync(path.join(folder, url), body);
        return { url, size: Buffer.byteLength(body), sha512: crypto.createHash('sha512').update(body).digest('base64') };
      });
      fs.writeFileSync(path.join(folder, arch === 'x64' ? 'latest-linux.yml' : 'latest-linux-arm64.yml'),
        stringify({ version: '1.0.0', files, path: files[0].url, sha512: files[0].sha512 }));
    }
    const output = path.join(root, 'output');
    await collectRelease(source, output);
    for (const arch of ['x64', 'arm64']) {
      const manifest = parse(fs.readFileSync(path.join(output, arch === 'x64' ? 'latest-linux.yml' : 'latest-linux-arm64.yml'), 'utf8'));
      assert.deepEqual(manifest.files.map(file => file.url), [`Clew-1.0.0-linux-${arch}.AppImage`, `Clew-1.0.0-linux-${arch}.deb`]);
      assert.equal(manifest.path, manifest.files[0].url);
    }
    fs.writeFileSync(path.join(source, 'arm64', 'Clew-1.0.0-linux-arm64.deb'), 'corrupt');
    await assert.rejects(collectRelease(source, path.join(root, 'rejected')), /checksum or size mismatch/);
    assert.equal(fs.existsSync(path.join(root, 'rejected')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
