const { test } = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../logging.cjs');

test('diagnostics redact OAuth URLs, JSON secrets and session headers', () => {
  const output = redact('https://auth.openai.com/authorize?code=oauth-value Bearer bearer-value {"refresh_token":"refresh-value", "sessionToken": "session-value"} X-Clew-Session=private-value sk-api-key');
  for (const value of ['oauth-value', 'bearer-value', 'refresh-value', 'session-value', 'private-value', 'sk-api-key']) assert.equal(output.includes(value), false, value);
  assert.equal(redact('x'.repeat(20000)).length, 16384);
});
