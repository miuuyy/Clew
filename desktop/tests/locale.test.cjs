const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DESKTOP_COPY, localeFromSystem, readLocale, saveLocale } = require('../locale.cjs');

test('uses the system language until the user chooses a language', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clew-language-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const defaultLocale = localeFromSystem('zh-Hans-CN');
  assert.equal(readLocale(directory, defaultLocale), 'zh-CN');
  assert.equal(localeFromSystem('en-GB'), 'en');
  saveLocale(directory, 'en');
  assert.equal(readLocale(directory, defaultLocale), 'en');
  saveLocale(directory, 'zh-CN');
  assert.throws(() => saveLocale(directory, 'constructor'), /Unsupported interface language/);
  assert.equal(readLocale(directory, 'en'), 'zh-CN');
  assert.equal(DESKTOP_COPY['zh-CN'].menu.help, '帮助');
  assert.deepEqual(Object.keys(DESKTOP_COPY.en.menu), Object.keys(DESKTOP_COPY['zh-CN'].menu));
});
