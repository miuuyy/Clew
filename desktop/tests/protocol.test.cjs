const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { createProtocolHandler, contentSecurityPolicy } = require('../protocol.cjs');

test('application protocol serves only bundle files with a private-origin CSP', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clew-protocol-'));
  try {
    const bundle = path.join(root, 'bundle');
    await fs.mkdir(bundle);
    await fs.writeFile(path.join(bundle, 'index.html'), '<html>Clew</html>');
    await fs.mkdir(path.join(root, 'private'));
    await fs.writeFile(path.join(root, 'private/private.txt'), 'private');
    await fs.symlink(path.join(root, 'private'), path.join(bundle, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    let forwarded;
    const handler = await createProtocolHandler({ frontendDir: bundle, apiBase: 'http://127.0.0.1:45678', sessionToken: 'private-session',
      fetchFile: async url => new Response(await fs.readFile(fileURLToPath(url))), fetchBackend: async (url, options) => {
        forwarded = { url, options };
        return new Response('stream-data', { headers: { 'Content-Type': 'application/x-ndjson' } });
      } });
    const serve = (url, method = 'GET', initiatorOrigin = 'clew://app') => handler({ url, method, initiatorOrigin });
    const response = await serve('clew://app/');
    assert.equal(await response.text(), '<html>Clew</html>');
    assert.match(response.headers.get('Content-Security-Policy'), /connect-src 'self';/);
    assert.equal(response.headers.get('Content-Security-Policy').includes('http:'), false);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(await (await serve('clew://app/', 'HEAD')).text(), '');
    for (const value of ['clew://evil/', 'clew://user@app/', 'clew://app/escape/private.txt', 'clew://app/%2e%2e%2fprivate.txt']) assert.equal((await serve(value)).status, 403);
    assert.equal((await serve('clew://app/', 'POST')).status, 405);
    assert.equal((await serve('clew://app/missing.js')).status, 404);
    assert.equal((await serve('clew://app/%00secret')).status, 400);
    assert.equal((await serve('clew://app/%zz')).status, 400);
    assert.equal((await serve('clew://app/', 'GET', 'https://evil.example')).status, 403);
    assert.equal((await handler({ url: 'clew://app/', method: 'GET' })).status, 200);
    const request = { url: 'clew://app/api/v1/chat?cursor=1', method: 'POST', initiatorOrigin: 'clew://app',
      headers: new Headers({ 'X-Clew-Session': 'private-session', 'content-type': 'application/json', Host: 'evil.example' }), body: '{"message":"hello"}' };
    assert.equal(await (await handler(request)).text(), 'stream-data');
    assert.equal(forwarded.url, 'http://127.0.0.1:45678/api/v1/chat?cursor=1');
    assert.equal(forwarded.options.body, request.body);
    assert.equal(forwarded.options.headers.get('Host'), null);
    assert.equal(forwarded.options.headers.get('Origin'), 'clew://app');
    assert.equal(forwarded.options.redirect, 'error');
    assert.equal((await handler({ ...request, headers: new Headers() })).status, 403);
    assert.equal((await handler({ ...request, initiatorOrigin: undefined })).status, 403);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('CSP refuses an external or credential-bearing backend', () => {
  for (const value of ['https://evil.example', 'http://localhost:1234', 'http://127.0.0.1', 'http://user:secret@127.0.0.1:1234', 'http://127.0.0.1:1234/api']) assert.throws(() => contentSecurityPolicy(value));
});
