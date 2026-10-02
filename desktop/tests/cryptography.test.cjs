const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyMacCryptography } = require('../scripts/check-cryptography.cjs');

const extension = '/venv/cryptography/hazmat/bindings/_rust.abi3.so';
const listing = (file, libraries) => `${file}:\n${libraries.map(library => `\t${library} (compatibility version 1.0.0, current version 1.0.0)`).join('\n')}\n`;
const system = '/usr/lib/libSystem.B.dylib';

function peer(extensions, outputs) {
  return (command, args) => {
    if (command === '/venv/python') {
      assert.equal(args[0], '-c');
      return JSON.stringify(extensions);
    }
    assert.equal(command, '/usr/bin/otool');
    assert.equal(args[0], '-L');
    assert.ok(Object.hasOwn(outputs, args[1]));
    return outputs[args[1]];
  };
}

test('macOS cryptography preflight accepts actual static-wheel dependency shape', () => {
  const output = listing(extension, ['@rpath/cryptography.hazmat.bindings._rust.abi3.so', '/usr/lib/libiconv.2.dylib', system]);
  assert.deepEqual(verifyMacCryptography('/venv/python', peer([extension], { [extension]: output })), [extension]);
  const universal = ['x86_64', 'arm64'].map(arch => output.replace(`${extension}:`, `${extension} (architecture ${arch}):`)).join('');
  assert.deepEqual(verifyMacCryptography('/venv/python', peer([extension], { [extension]: universal })), [extension]);
});

test('macOS cryptography preflight rejects dynamic OpenSSL for every native extension', () => {
  const other = '/venv/cryptography/other.abi3.so';
  for (const library of ['/usr/local/opt/openssl@3/lib/libssl.3.dylib', '@rpath/libcrypto.3.dylib', '@loader_path/libssl.dylib']) {
    const run = peer([extension, other], { [extension]: listing(extension, [system]), [other]: listing(other, [system, library]) });
    assert.throws(() => verifyMacCryptography('/venv/python', run), error => {
      assert.match(error.message, /must use static OpenSSL/);
      assert.ok(error.message.includes(library));
      assert.match(error.message, /OPENSSL_STATIC=1/);
      return true;
    });
  }
});

test('macOS cryptography preflight refuses missing extensions or uninspectable binaries', () => {
  for (const extensions of [[], null, ['relative.so'], [123], ['/venv/unknown.txt']]) {
    assert.throws(() => verifyMacCryptography('/venv/python', peer(extensions, {})), /no valid native extensions/);
  }
  for (const output of ['', `${extension}:\n`, `${extension}:\ninvalid dependency\n`]) {
    assert.throws(() => verifyMacCryptography('/venv/python', peer([extension], { [extension]: output })), /Cannot inspect/);
  }
  assert.throws(() => verifyMacCryptography('/venv/python', command => {
    if (command === '/venv/python') return JSON.stringify([extension]);
    throw new Error('otool failed');
  }), /otool failed/);
});
