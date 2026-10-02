const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('yaml');
const builder = require('../builder.cjs');

test('native release matrix covers exactly the five supported targets and drafts publication', () => {
  const release = parse(fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/release.yml'), 'utf8'));
  assert.deepEqual(release.jobs.build.strategy.matrix.include.map(item => [item.runner, item.arch]), [
    ['windows-latest', 'x64'], ['macos-15', 'arm64'], ['macos-15-intel', 'x64'], ['ubuntu-22.04', 'x64'], ['ubuntu-24.04-arm', 'arm64']
  ]);
  assert.equal(release.permissions.contents, 'read');
  const draft = release.jobs['prepare-release'];
  assert.equal(draft.needs, 'build');
  assert.equal(draft.permissions.contents, 'write');
  assert.match(draft.steps.find(step => step.name === 'Prepare draft for owner publication').run, /--draft/);
  assert.match(draft.steps.find(step => step.run?.includes('collect-release')).run, /--complete/);
});

test('packaging preserves signing limits, data and sandbox requirements', () => {
  assert.equal(builder.mac.identity, '-');
  assert.equal(builder.mac.notarize, false);
  assert.equal(builder.mac.hardenedRuntime, true);
  assert.equal(builder.nsis.perMachine, false);
  assert.equal(builder.nsis.allowElevation, false);
  assert.equal(builder.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(builder.appImage.executableArgs, []);
  assert.equal(builder.linux.artifactName, `Clew-\${version}-linux-${process.arch}.\${ext}`);
  assert.ok(builder.beforePack);
  assert.ok(builder.extraResources.some(item => item.to.startsWith('export/')));
});
