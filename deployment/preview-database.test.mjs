import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openPreviewDatabase } from './preview-database.mjs';

test('local preview refuses concurrent database owners and retains rows after a complete close', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-preview-database-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let db = await openPreviewDatabase(directory);
  try {
    await db.exec('CREATE TABLE saved_project (id int PRIMARY KEY, document jsonb)');
    await db.query('INSERT INTO saved_project VALUES ($1,$2)', [1, { title: 'Recovery test', files: { 'App.tsx': 'saved' } }]);
    await assert.rejects(openPreviewDatabase(directory), /locked/);
    await Promise.all([db.close(), db.close()]);
    db = await openPreviewDatabase(directory);
    assert.deepEqual((await db.query('SELECT document FROM saved_project')).rows, [
      { document: { title: 'Recovery test', files: { 'App.tsx': 'saved' } } },
    ]);
    await assert.rejects(openPreviewDatabase(`${directory}/.`), /locked/);
  } finally {
    await db.close();
  }
});
