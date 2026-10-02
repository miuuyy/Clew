const { execFileSync } = require('node:child_process');
const path = require('node:path');

function verifyMacCryptography(python, run = execFileSync) {
  // Locate extensions without importing them: a conflicting OpenSSL can already
  // prevent the import that this packaging gate is intended to protect.
  const extensions = JSON.parse(run(python, ['-c',
    'import importlib.util,json,pathlib; root=pathlib.Path(importlib.util.find_spec("cryptography").origin).parent; print(json.dumps(sorted(str(p) for p in root.rglob("*.so"))))'
  ], { encoding: 'utf8' }));
  if (!Array.isArray(extensions) || !extensions.length || extensions.some(file => typeof file !== 'string' || !path.isAbsolute(file) || !file.endsWith('.so'))) {
    throw new Error('macOS cryptography preflight found no valid native extensions.');
  }
  for (const file of extensions) {
    const output = run('/usr/bin/otool', ['-L', file], { encoding: 'utf8' });
    let dependencies = 0;
    for (const line of output.split(/\r?\n/).filter(Boolean)) {
      if (line.startsWith(`${file}:`) || line.startsWith(`${file} (architecture `) && line.endsWith('):')) continue;
      const match = /^\s+(.+?)\s+\(compatibility version [^,]+, current version [^)]+\)$/.exec(line);
      if (!match) throw new Error(`Cannot inspect macOS cryptography dependency: ${file}: ${line}`);
      dependencies++;
      if (/^lib(?:ssl|crypto)(?:[.\-_]|$)/i.test(path.basename(match[1]))) {
        throw new Error(`macOS cryptography must use static OpenSSL; ${file} links ${match[1]}. Rebuild the same cryptography version from source with OPENSSL_STATIC=1 and MACOSX_DEPLOYMENT_TARGET=13.0 (without the pip wheel cache); see docs/DESKTOP_RELEASE_VALIDATION.md.`);
      }
    }
    if (!dependencies) throw new Error(`Cannot inspect macOS cryptography dependencies: ${file}: empty otool output.`);
  }
  return extensions;
}

module.exports = { verifyMacCryptography };
