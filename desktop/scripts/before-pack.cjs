const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');

module.exports = async context => {
  const target = JSON.parse(fs.readFileSync(path.join(context.packager.projectDir, 'desktop/build/backend/target.json'), 'utf8'));
  const version = context.packager.appInfo.version;
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  if (target.version !== version || target.platform !== platform || target.arch !== arch || platform !== process.platform || arch !== process.arch) {
    throw new Error(`Native backend target does not match the Electron package (${platform}/${arch} ${version}). Build on the matching host.`);
  }
};
