const RELEASES = 'https://github.com/miuuyy/Clew/releases';
const API = 'https://api.github.com/repos/miuuyy/Clew/releases/latest';

function versionParts(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Invalid stable release version.');
  }
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('Invalid stable release version.');
  return parts;
}

async function checkLatestRelease(currentVersion, platform, arch, request = fetch) {
  const current = versionParts(currentVersion);
  const response = await request(API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Clew/${currentVersion}` },
    signal: AbortSignal.timeout(15000), redirect: 'error'
  });
  if (response.status === 404) throw new Error('There is no published stable release yet.');
  if (!response.ok) throw new Error(`GitHub release check returned HTTP ${response.status}. Try again later.`);
  const text = await response.text();
  if (text.length > 1024 * 1024) throw new Error('Release metadata is too large.');
  const release = JSON.parse(text);
  const version = typeof release.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : '';
  const latest = versionParts(version);
  const url = `${RELEASES}/tag/v${version}`;
  if (release.draft || release.prerelease || release.tag_name !== `v${version}` || release.html_url !== url || !Array.isArray(release.assets)) {
    throw new Error('GitHub returned an invalid stable release contract.');
  }
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[platform];
  const extension = { darwin: 'dmg', win32: 'exe', linux: 'AppImage' }[platform];
  const asset = `Clew-${version}-${os}-${arch}.${extension}`;
  if (!os || !['x64', 'arm64'].includes(arch) || !release.assets.some(item => item.name === asset)) {
    throw new Error('The latest release has no installer for this platform and architecture.');
  }
  const difference = latest.map((part, index) => part - current[index]).find(value => value !== 0) ?? 0;
  return { available: difference > 0, version, url };
}

module.exports = { checkLatestRelease };
