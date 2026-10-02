module.exports = {
  appId: 'my.clew.desktop',
  productName: 'Clew',
  artifactName: 'Clew-${version}-${os}-${arch}.${ext}',
  asar: true,
  beforePack: 'desktop/scripts/before-pack.cjs',
  directories: { output: 'desktop/artifacts', buildResources: 'desktop/assets' },
  files: ['desktop/*.cjs', 'desktop/assets/icon.png', 'package.json', 'LICENSE'],
  extraResources: [
    { from: 'desktop/build/backend/ClewBackend', to: 'backend' },
    { from: process.platform === 'win32' ? 'desktop/build/export/ClewExportCommit.exe' : 'desktop/build/export/ClewExportCommit',
      to: process.platform === 'win32' ? 'export/ClewExportCommit.exe' : 'export/ClewExportCommit' },
    { from: 'frontend/dist', to: 'frontend' },
    { from: 'desktop/build/licenses', to: 'LICENSES' },
    { from: 'LICENSE', to: 'LICENSE' }
  ],
  publish: [{ provider: 'github', owner: 'miuuyy', repo: 'Clew', releaseType: 'draft' }],
  mac: {
    category: 'public.app-category.education', icon: 'desktop/assets/icon.png',
    minimumSystemVersion: '13.0', hardenedRuntime: true, identity: '-',
    target: ['dmg', 'zip'], notarize: false
  },
  win: { icon: 'desktop/assets/icon.png', target: ['nsis'] },
  nsis: { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, deleteAppDataOnUninstall: false },
  linux: { category: 'Education', icon: 'desktop/assets/icon.png', executableName: 'clew', syncDesktopName: true, target: ['AppImage', 'deb'],
    // Builder's ${arch} expands to x86_64 for AppImage and amd64 for Debian.
    // Native-host validation lets every format use the same public x64/arm64 name.
    artifactName: `Clew-\${version}-linux-${process.arch}.\${ext}`,
    extraFiles: [
      { from: 'desktop/linux/AppRun', to: 'AppRun' },
      { from: 'desktop/build/linux/libnotify.so.4', to: 'usr/lib/libnotify.so.4' }
    ]
  },
  // electron-builder's default desktop entry adds --no-sandbox. Clew owns its
  // AppRun and explicitly rejects that behavior instead of weakening security.
  appImage: { executableArgs: [] },
  deb: { depends: ['libc6', 'libgtk-3-0', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0',
    'libuuid1', 'libsecret-1-0', 'libnotify4', 'dbus', 'libasound2 | libasound2t64'] }
};
