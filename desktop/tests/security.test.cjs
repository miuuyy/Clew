const { test } = require('node:test');
const assert = require('node:assert/strict');
const { externalUrl, trustedFrame, applicationUrl } = require('../security.cjs');

test('external links reject executable schemes, embedded credentials and insecure hosts', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com', 'http://example.com']) {
    assert.throws(() => externalUrl(url));
  }
  assert.equal(externalUrl('https://auth.openai.com/api/accounts/authorize?state=abc'), 'https://auth.openai.com/api/accounts/authorize?state=abc');
  assert.equal(externalUrl('http://127.0.0.1:8787/auth/callback'), 'http://127.0.0.1:8787/auth/callback');
});

test('IPC accepts only the owned top-level application frame', () => {
  const frame = { url: 'clew://app/' };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  assert.equal(trustedFrame({ sender: contents, senderFrame: frame }, contents), true);
  assert.equal(trustedFrame({ sender: {}, senderFrame: frame }, contents), false);
  assert.equal(trustedFrame({ sender: contents, senderFrame: { url: frame.url } }, contents), false);
  frame.url = 'https://evil.example/';
  assert.equal(trustedFrame({ sender: contents, senderFrame: frame }, contents), false);
  frame.url = 'clew://app/';
  assert.equal(trustedFrame({}, contents), false);
  assert.equal(trustedFrame({ sender: contents, senderFrame: frame }, { ...contents, isDestroyed: () => true }), false);
});

test('application origin comparison rejects opaque-origin and authority lookalikes', () => {
  assert.equal(applicationUrl('clew://app/'), true);
  assert.equal(applicationUrl('clew://app/#topic'), true);
  for (const value of ['clew://evil/', 'clew://app.evil/', 'clew://app:80/', 'clew://user@app/', 'file:///app', 'data:text/html,app', 'null', 'http://127.0.0.1:50000/']) {
    assert.equal(applicationUrl(value), false, value);
  }
});
