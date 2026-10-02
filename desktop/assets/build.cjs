const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');
const source = fs.readFileSync(path.join(__dirname, '../../frontend/public/clew-mark.svg'), 'utf8');
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1024" height="1024"><rect width="1254" height="1254" rx="260" fill="#151515"/>${source.trim()}</svg>\n`;
const png = new Resvg(icon, { fitTo: { mode: 'width', value: 1024 } }).render().asPng();
fs.writeFileSync(path.join(__dirname, 'icon.svg'), icon);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
