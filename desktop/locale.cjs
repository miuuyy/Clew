const fs = require('node:fs');
const path = require('node:path');

const DESKTOP_COPY = {
  en: {
    menu: {
      file: 'File', edit: 'Edit', view: 'View', window: 'Window', help: 'Help',
      about: 'About Clew', hide: 'Hide Clew', hideOthers: 'Hide Others', quit: 'Quit Clew', close: 'Close',
      undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
      resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', togglefullscreen: 'Toggle Full Screen',
      minimize: 'Minimize', zoom: 'Zoom', front: 'Bring All to Front',
      documentation: 'Documentation', updates: 'Check for Updates…', data: 'Open Data Folder',
      logs: 'Open Logs', reportIssue: 'Report an Issue'
    },
    docsUrl: 'https://clew.my/docs',
    continue: 'Continue with ChatGPT', github: 'Star on GitHub', x: 'Follow on X',
    exportFolder: 'Choose a parent folder for the Obsidian export',
    exportBusy: 'An Obsidian export is already in progress.',
    chooseOne: 'Choose one export directory.',
    ok: 'OK',
    devBuild: 'Development build',
    devUpdates: 'Install a release build to check for updates.',
    upToDate: 'Clew is up to date.',
    updateAvailable: version => `Clew ${version} is available.`,
    updateDetail: 'Download the installer from the release page, close Clew, and install it. Your local data is retained.',
    viewRelease: 'View Release', later: 'Later', updateFailed: 'Could not check for updates',
    folderFailed: 'Could not open folder',
    fatal: 'Clew could not continue',
    logLocation: folder => `Logs: ${folder}`,
    backendStopped: status => `The local backend stopped (${status}). Restart Clew.`,
    bridgeFailed: error => `The desktop bridge failed: ${error}`,
    rendererStopped: reason => `The renderer stopped (${reason}). Restart Clew.`
  },
  'zh-CN': {
    menu: {
      file: '文件', edit: '编辑', view: '视图', window: '窗口', help: '帮助',
      about: '关于 Clew', hide: '隐藏 Clew', hideOthers: '隐藏其他应用', quit: '退出 Clew', close: '关闭',
      undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
      resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小', togglefullscreen: '切换全屏',
      minimize: '最小化', zoom: '缩放', front: '将所有窗口置于前台',
      documentation: '文档', updates: '检查更新…', data: '打开数据文件夹',
      logs: '打开日志文件夹', reportIssue: '报告问题'
    },
    docsUrl: 'https://github.com/miuuyy/Clew/blob/main/docs/USAGE_GUIDE.zh-CN.md',
    continue: '使用 ChatGPT 继续', github: '在 GitHub 上加星', x: '在 X 上关注',
    exportFolder: '选择 Obsidian 导出的目标位置',
    exportBusy: '已有一项 Obsidian 导出正在进行。',
    chooseOne: '请选择一个导出目录。',
    ok: '确定',
    devBuild: '开发版本',
    devUpdates: '请安装正式发布的版本后再检查更新。',
    upToDate: 'Clew 已是最新版本。',
    updateAvailable: version => `Clew ${version} 已发布。`,
    updateDetail: '请从发布页面下载安装包，关闭 Clew 后安装。你的本地数据会保留。',
    viewRelease: '查看发布页面', later: '稍后', updateFailed: '无法检查更新',
    folderFailed: '无法打开文件夹',
    fatal: 'Clew 无法继续运行',
    logLocation: folder => `日志位置：${folder}`,
    backendStopped: status => `本地服务已停止（${status}）。请重启 Clew。`,
    bridgeFailed: error => `桌面应用通信失败：${error}`,
    rendererStopped: reason => `界面进程已停止（${reason}）。请重启 Clew。`
  }
};

function localeFromSystem(language) {
  return language.toLowerCase().split('-')[0] === 'zh' ? 'zh-CN' : 'en';
}

function validateLocale(locale) {
  if (typeof locale !== 'string' || !Object.hasOwn(DESKTOP_COPY, locale)) {
    throw new Error('Unsupported interface language.');
  }
}

function readLocale(userData, defaultLocale) {
  let locale;
  try { locale = fs.readFileSync(path.join(userData, 'interface-language'), 'utf8').trim(); }
  catch (error) {
    if (error.code === 'ENOENT') return defaultLocale;
    throw error;
  }
  validateLocale(locale);
  return locale;
}

function saveLocale(userData, locale) {
  validateLocale(locale);
  fs.mkdirSync(userData, { recursive: true });
  const file = path.join(userData, 'interface-language');
  fs.writeFileSync(`${file}.tmp`, `${locale}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

module.exports = { DESKTOP_COPY, localeFromSystem, readLocale, saveLocale };
