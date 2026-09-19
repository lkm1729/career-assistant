import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTrustedDocument } from '../electron/trusted-document.js';
import { WriteQueue } from '../src/write-queue.js';
import { atomicExport } from '../electron/atomic-export.js';
import { mkdtemp, readFile, writeFile, readdir, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('same-document skip links stay trusted without accepting other pages or origins', () => {
  const base = 'file:///D:/career/dist/index.html';
  assert.equal(isTrustedDocument(base + '#main-content', base), true);
  assert.equal(isTrustedDocument(base + '?other=true', base), false);
  assert.equal(isTrustedDocument('file:///D:/other.html', base), false);
  assert.equal(
    isTrustedDocument('http://127.0.0.1:5173/#main-content', 'http://127.0.0.1:5173'),
    true,
  );
  assert.equal(isTrustedDocument('http://127.0.0.1:5174/', 'http://127.0.0.1:5173'), false);
  assert.equal(isTrustedDocument('not a URL', base), false);
});

test('closing drains writes appended while the previous write is still in flight', async () => {
  const queue = new WriteQueue();
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  queue.enqueue('resume', () => first.promise);
  const flushed = queue.flush();
  let finished = false;
  void flushed.then(() => {
    finished = true;
  });
  queue.enqueue('letter', () => second.promise);
  first.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  second.resolve();
  assert.equal(await flushed, true);
});

test('a successful write for another tab cannot hide a failed save', async () => {
  const queue = new WriteQueue();
  queue.enqueue('resume', async () => {
    throw new Error('disk full');
  });
  queue.enqueue('letter', async () => {});
  assert.equal(await queue.flush(), false);
  queue.enqueue('resume', async () => {});
  assert.equal(await queue.flush(), true);
});

test('failed staged export preserves the existing file and removes only its temporary file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'career-export-'));
  const target = join(directory, 'resume.md');
  await writeFile(target, 'original resume');
  await assert.rejects(
    atomicExport(target, 'new resume', {
      async writeFile(path, text, options) {
        await writeFile(path, text.slice(0, 3), options);
        throw new Error('simulated disk full');
      },
      rename,
      unlink,
    }),
    /disk full/,
  );
  assert.equal(await readFile(target, 'utf8'), 'original resume');
  assert.deepEqual(await readdir(directory), ['resume.md']);
  await atomicExport(target, '完整新简历');
  assert.equal(await readFile(target, 'utf8'), '完整新简历');
});
