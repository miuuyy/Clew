const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateExport, writeExport, nativeCommit } = require('../export.cjs');

const root = path.resolve(__dirname, '../..');
const commit = nativeCommit({ root, packaged: false, python: process.env.CLEW_PYTHON || (process.platform === 'win32' ? 'python' : path.join(root, '.venv/bin/python')) });
const pkg = (paths = ['README.md', 'Zone/Topic.md']) => ({ kind: 'mapmind_obsidian_export', version: 1, folder_name: 'My graph', file_count: paths.length, files: paths.map(file => ({ path: file, body: `# ${file}\n` })) });

test('Obsidian paths reject traversal, platform-special names and collisions', () => {
  for (const file of ['../secret', '/absolute', 'a//b', 'a/./b', 'a/../b', 'a\\b', 'C:/secret', 'NUL.txt', 'COM1.md', 'LPT².md', 'a.', 'a ', 'a\0b', 'a\nb', '\ud800.md']) assert.throws(() => validateExport(pkg([file])), file);
  for (const paths of [['a.md', 'a.md'], ['a.md', 'A.md'], ['a', 'a/b.md'], ['A/b.md', 'a/c.md'], ['é.md', 'e\u0301.md']]) assert.throws(() => validateExport(pkg(paths)));
  assert.throws(() => validateExport({ ...pkg(), folder_name: '../graph' }));
  assert.throws(() => validateExport({ ...pkg(), file_count: 99 }));
  assert.throws(() => validateExport({ ...pkg(), kind: 'unknown' }));
  assert.throws(() => validateExport(pkg([])));
  assert.equal(validateExport(pkg()).files.length, 2);
});

test('native export commits a complete folder and never replaces an existing directory', async () => {
  const parent = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'clew-export-test-'));
  try {
    assert.equal(await writeExport(pkg(), parent, commit), true);
    assert.equal(await fs.readFile(path.join(parent, 'My graph/Zone/Topic.md'), 'utf8'), '# Zone/Topic.md\n');
    await assert.rejects(writeExport(pkg(['new.md']), parent, commit));
    assert.equal(await fs.readFile(path.join(parent, 'My graph/README.md'), 'utf8'), '# README.md\n');
    await assert.rejects(fs.stat(path.join(parent, 'My graph/new.md')), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(parent), ['My graph']);
    await fs.mkdir(path.join(parent, 'Empty'));
    await assert.rejects(writeExport({ ...pkg(), folder_name: 'Empty' }, parent, commit));
    assert.deepEqual(await fs.readdir(path.join(parent, 'Empty')), []);
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});

test('failed writes and symlink targets never publish partial exports', async () => {
  const parent = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'clew-export-failure-'));
  try {
    await assert.rejects(writeExport(pkg(), parent, async () => { throw new Error('commit refused'); }), /commit refused/);
    assert.deepEqual(await fs.readdir(parent), []);
    await fs.mkdir(path.join(parent, 'outside'));
    await fs.symlink(path.join(parent, 'outside'), path.join(parent, 'My graph'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(writeExport(pkg(), parent, commit));
    assert.deepEqual(await fs.readdir(path.join(parent, 'outside')), []);
    await assert.rejects(writeExport(pkg(), path.join(parent, 'My graph'), commit), /symlinks/);
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
