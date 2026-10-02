const { contextBridge, ipcRenderer } = require('electron');
const encoded = process.argv.find(arg => arg.startsWith('--clew-bootstrap='));
if (!encoded) throw new Error('Clew desktop bootstrap is missing.');
const bootstrap = JSON.parse(decodeURIComponent(encoded.slice('--clew-bootstrap='.length)));
contextBridge.exposeInMainWorld('clewDesktop', Object.freeze({
  ...bootstrap,
  openExternal: url => ipcRenderer.invoke('clew:open-external', url),
  exportObsidian: exportPackage => ipcRenderer.invoke('clew:export-obsidian', exportPackage)
}));
