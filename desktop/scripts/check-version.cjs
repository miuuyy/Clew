const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const version = require(path.join(root, 'package.json')).version;
const frontend = require(path.join(root, 'frontend/package.json')).version;
const backend = fs.readFileSync(path.join(root, 'backend/pyproject.toml'), 'utf8').match(/^version = "([^"]+)"/m)?.[1];
if (version !== frontend || version !== backend) throw new Error(`Version mismatch: desktop=${version}, frontend=${frontend}, backend=${backend}`);
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Release tag does not match package version.');
console.log(`Clew ${version}: versions agree.`);
