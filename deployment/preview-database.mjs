import { mkdir, open, realpath, unlink } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The local test database is single-process, unlike production PostgreSQL.
// Do not let a replacement preview open it while the old process is closing.
export async function openPreviewDatabase(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = `${await realpath(directory)}.preview.lock`;
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error('Preview database is locked. Wait for the previous service to stop; do not reuse it concurrently.');
    throw error;
  }
  await lock.writeFile(`${process.pid}\n`);
  await lock.close();
  let database;
  try {
    database = await PGlite.create(directory);
  } catch (error) {
    await unlink(lockPath);
    throw error;
  }
  const close = database.close.bind(database);
  let closing;
  database.close = () => {
    closing ||= (async () => {
      // Keep Node alive until the final checkpoint and filesystem teardown
      // finish. A failed close deliberately retains the lock for inspection.
      const keepAlive = setInterval(() => {}, 1000);
      try {
        await database.exec('CHECKPOINT');
        await close();
        await unlink(lockPath);
      } finally {
        clearInterval(keepAlive);
      }
    })();
    return closing;
  };
  return database;
}
