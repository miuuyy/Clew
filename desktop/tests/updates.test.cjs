const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkLatestRelease } = require('../updates.cjs');

function release(version = '1.1.0') {
  return { tag_name: `v${version}`, html_url: `https://github.com/miuuyy/Clew/releases/tag/v${version}`, draft: false, prerelease: false,
    assets: [{ name: `Clew-${version}-mac-arm64.dmg` }] };
}
const peer = value => async () => new Response(JSON.stringify(value), { status: 200 });

test('manual updates compare stable versions and require a platform installer', async () => {
  const result = await checkLatestRelease('1.0.0', 'darwin', 'arm64', peer(release()));
  assert.equal(result.available, true);
  assert.equal(result.url, 'https://github.com/miuuyy/Clew/releases/tag/v1.1.0');
  assert.equal((await checkLatestRelease('1.1.0', 'darwin', 'arm64', peer(release()))).available, false);
  assert.equal((await checkLatestRelease('2.0.0', 'darwin', 'arm64', peer(release()))).available, false);
  await assert.rejects(checkLatestRelease('1.0.0', 'win32', 'x64', peer(release())), /installer/);
});

test('unavailable or malformed release checks never claim up to date', async () => {
  for (const status of [404, 403, 500]) await assert.rejects(checkLatestRelease('1.0.0', 'darwin', 'arm64', async () => new Response('', { status })));
  for (const value of [{ ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), html_url: 'https://evil.example' }, release('1.2.3-rc.1'), { ...release(), assets: null }]) {
    await assert.rejects(checkLatestRelease('1.0.0', 'darwin', 'arm64', peer(value)));
  }
});
