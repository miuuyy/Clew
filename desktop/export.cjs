const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function segment(value) {
  if (typeof value !== 'string' || !value || !value.isWellFormed() || value === '.' || value === '..' || Buffer.byteLength(value, 'utf8') > 240
      || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(value) || /[. ]$/.test(value)
      || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value)) {
    throw new Error('The Obsidian export contains an invalid folder or file name.');
  }
  return value;
}

function validateExport(value) {
  if (!value || value.kind !== 'mapmind_obsidian_export' || value.version !== 1 || !Array.isArray(value.files)
      || !Number.isSafeInteger(value.file_count) || value.file_count !== value.files.length
      || value.files.length < 1 || value.files.length > 20000) throw new Error('Invalid Obsidian export package.');
  const folder = segment(value.folder_name);
  const files = [];
  const entries = new Map();
  let bytes = 0;
  for (const file of value.files) {
    if (typeof file?.path !== 'string' || file.path.length > 1024 || typeof file.body !== 'string') throw new Error('Invalid Obsidian export file.');
    const parts = file.path.split('/').map(segment);
    const size = Buffer.byteLength(file.body, 'utf8');
    bytes += size;
    if (size > 8 * 1024 * 1024 || bytes > 128 * 1024 * 1024) throw new Error('The Obsidian export is too large.');
    for (let index = 1; index <= parts.length; index++) {
      const key = parts.slice(0, index).map(part => part.normalize('NFC').toLowerCase()).join('/');
      const kind = index === parts.length ? 'file' : 'directory';
      const existing = entries.get(key);
      const spelling = parts.slice(0, index).join('/');
      if (existing && (existing.kind !== kind || existing.spelling !== spelling || kind === 'file')) {
        throw new Error('The Obsidian export has duplicate or conflicting paths.');
      }
      entries.set(key, { kind, spelling });
    }
    files.push({ parts, body: file.body });
  }
  return { folder, files };
}

async function realDirectory(directory) {
  if (!path.isAbsolute(directory)) throw new Error('Choose an absolute export directory.');
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('The export directory must not contain symlinks.');
  }
  return fs.realpath(directory);
}

async function writeExport(exportPackage, parent, commit) {
  const validated = validateExport(exportPackage);
  parent = await realDirectory(parent);
  const destination = path.join(parent, validated.folder);
  const stage = await fs.mkdtemp(path.join(parent, '.clew-export-'));
  try {
    for (const file of validated.files) {
      const directory = path.join(stage, ...file.parts.slice(0, -1));
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(stage, ...file.parts), file.body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
    // A native no-replace rename is required; Node rename can overwrite an empty
    // directory on POSIX. The helper uses renameat2/renameatx_np, never a check+rename.
    await commit(stage, destination);
    return true;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

function nativeCommit({ root, resources, packaged, python }) {
  return async (source, destination) => {
    const command = packaged ? path.join(resources, 'export', process.platform === 'win32' ? 'ClewExportCommit.exe' : 'ClewExportCommit') : python;
    const args = packaged ? [source, destination] : [path.join(root, 'desktop/export-commit.py'), source, destination];
    try { await run(command, args, { windowsHide: true, timeout: 30000 }); }
    catch (error) { throw new Error(error.stderr?.trim() || 'The export commit could not be confirmed. Check the selected folder before retrying.'); }
  };
}

module.exports = { validateExport, realDirectory, writeExport, nativeCommit };
