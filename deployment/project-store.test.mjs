import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PostgresProjectStore } from './project-store.mjs';

// Real embedded PostgreSQL SQL/transactions, but a single-session adapter: this
// is not an RDS/pg-wire/TLS or multi-connection isolation test.
let database;
let pool;
let store;
let failReceipt = false;
before(async () => {
  database = await PGlite.create();
  await database.exec(await readFile(new URL('./sql/001-projects.sql', import.meta.url), 'utf8'));
  let previous = Promise.resolve();
  pool = {
    async connect() {
      const wait = previous;
      let release;
      previous = new Promise((resolve) => {
        release = resolve;
      });
      await wait;
      return {
        query: async (sql, params) => {
          if (failReceipt && sql.startsWith('INSERT INTO jingyue.project_mutations'))
            throw new Error('Injected receipt failure');
          return database.query(sql, params);
        },
        release,
      };
    },
    async query(sql, params) {
      const client = await this.connect();
      try {
        return await client.query(sql, params);
      } finally {
        client.release();
      }
    },
    end: () => database.close(),
  };
});
beforeEach(async () => {
  await database.exec('TRUNCATE jingyue.projects,jingyue.project_mutations');
  failReceipt = false;
  store = new PostgresProjectStore(pool, randomUUID());
});
after(async () => {
  await database?.close();
});
const doc = (title = 'Project') => ({
  schemaVersion: 1,
  title,
  messages: [{ id: 'm', role: 'assistant', content: 'Created project' }],
  snapshot: {
    chatIndex: 'm',
    files: { 'src/App.jsx': { type: 'file', content: '<h1>' + title + '</h1>', isBinary: false } },
  },
});
const create = (title) => ({
  action: 'create',
  projectId: randomUUID(),
  requestId: randomUUID(),
  document: doc(title),
});

test('SQL migration, create, full reads, checkpoint and deletion/restore preserve atomic document', async () => {
  const operation = create();
  const created = await store.mutate(operation);
  assert.equal(created.revision, 1);
  assert.deepEqual((await store.get(operation.projectId)).document, operation.document);
  const next = await store.mutate({
    action: 'checkpoint',
    projectId: operation.projectId,
    requestId: randomUUID(),
    baseRevision: 1,
    document: doc('Edited'),
  });
  assert.equal(next.revision, 2);
  const deleted = await store.mutate({
    action: 'delete',
    projectId: operation.projectId,
    requestId: randomUUID(),
    baseRevision: 2,
  });
  assert.ok(deleted.deletedAt);
  assert.equal((await store.list({})).items.length, 0);
  assert.equal((await store.list({ deleted: true })).items.length, 1);
  assert.equal((await store.get(operation.projectId)).document.title, 'Edited');
  await assert.rejects(
    store.mutate({
      action: 'checkpoint',
      projectId: operation.projectId,
      requestId: randomUUID(),
      baseRevision: 3,
      document: doc('Must not resurrect'),
    }),
    (error) => error.code === 'PROJECT_DELETED',
  );
  const restored = await store.mutate({
    action: 'restore',
    projectId: operation.projectId,
    requestId: randomUUID(),
    baseRevision: 3,
  });
  assert.equal(restored.revision, 4);
  assert.equal(restored.deletedAt, null);
});
test('same request retries replay the receipt while changed payload/foreign owners fail closed', async () => {
  const operation = create();
  const first = await store.mutate(operation);
  assert.deepEqual(await store.mutate(operation), first);
  await assert.rejects(
    store.mutate({ ...operation, document: doc('Changed retry') }),
    (error) => error.code === 'REQUEST_ID_REUSED',
  );
  const other = new PostgresProjectStore(pool, randomUUID());
  assert.deepEqual((await other.list({})).items, []);
  await assert.rejects(other.get(operation.projectId), (error) => error.status === 404);
  await assert.rejects(
    other.mutate({ action: 'delete', projectId: operation.projectId, requestId: randomUUID(), baseRevision: 1 }),
    (error) => error.status === 404,
  );
});
test('two stale writes cannot both succeed and failure after document update rolls the whole transaction back', async () => {
  const operation = create();
  await store.mutate(operation);
  const outcomes = await Promise.allSettled(
    ['A', 'B'].map((title) =>
      store.mutate({
        action: 'checkpoint',
        projectId: operation.projectId,
        requestId: randomUUID(),
        baseRevision: 1,
        document: doc(title),
      }),
    ),
  );
  assert.equal(outcomes.filter((value) => value.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find((value) => value.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const beforeFailure = await store.get(operation.projectId);
  failReceipt = true;
  await assert.rejects(
    store.mutate({
      action: 'checkpoint',
      projectId: operation.projectId,
      requestId: randomUUID(),
      baseRevision: 2,
      document: doc('Uncommitted'),
    }),
  );
  failReceipt = false;
  assert.deepEqual(await store.get(operation.projectId), beforeFailure);
});
test('migration identities isolate local numeric IDs, pagination keeps microsecond precision, and retry does not duplicate imports', async () => {
  const first = { ...create('Device A'), migration: { sourceId: randomUUID(), legacyId: '1' } };
  const second = { ...create('Device B'), migration: { sourceId: randomUUID(), legacyId: '1' } };
  await store.mutate(first);
  await store.mutate(second);
  await assert.rejects(
    store.mutate({ ...first, projectId: randomUUID(), requestId: randomUUID() }),
    (error) => error.code === 'MIGRATION_EXISTS',
  );
  await database.query('UPDATE jingyue.projects SET updated_at=$1 WHERE owner_id=$2 AND id=$3', [
    '2026-09-28T00:00:00.123456Z',
    store.ownerId,
    first.projectId,
  ]);
  await database.query('UPDATE jingyue.projects SET updated_at=$1 WHERE owner_id=$2 AND id=$3', [
    '2026-09-28T00:00:00.123455Z',
    store.ownerId,
    second.projectId,
  ]);
  const page = await store.list({ limit: 1 });
  assert.equal(page.items[0].projectId, first.projectId);
  const next = await store.list({ limit: 1, cursor: page.nextCursor });
  assert.equal(next.items[0].projectId, second.projectId);
  assert.equal(next.nextCursor, null);
  assert.equal('document' in page.items[0], false);
});

test('project count quota fails atomically and receipt expiry never turns a retry into an overwrite', async () => {
  const operation = create();
  await store.mutate(operation);
  for (let index = 1; index < 100; index++)
    await database.query(
      'INSERT INTO jingyue.projects(owner_id,id,revision,document,byte_count) VALUES($1,$2,1,$3,1)',
      [store.ownerId, randomUUID(), doc('Quota fixture')],
    );
  const rejected = create();
  await assert.rejects(store.mutate(rejected), (error) => error.code === 'PROJECT_QUOTA_EXCEEDED');
  await assert.rejects(store.get(rejected.projectId), (error) => error.status === 404);
  assert.equal(
    (
      await database.query('SELECT count(*)::integer AS count FROM jingyue.project_mutations WHERE owner_id=$1', [
        store.ownerId,
      ])
    ).rows[0].count,
    1,
  );
  await database.query("UPDATE jingyue.project_mutations SET created_at=now()-interval '25 hours'");
  await store.mutate({
    action: 'checkpoint',
    projectId: operation.projectId,
    requestId: randomUUID(),
    baseRevision: 1,
    document: doc('Latest'),
  });
  await assert.rejects(store.mutate(operation), (error) => error.code === 'PROJECT_EXISTS');
  assert.equal((await store.get(operation.projectId)).document.title, 'Latest');
});
