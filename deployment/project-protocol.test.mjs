import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  validateDocument,
  validateMutation,
  mutationDigest,
  projectRoute,
  safeProjectPath,
} from './project-protocol.mjs';
import { databaseOptions, createProjectStore } from './project-store.mjs';

const document = () => ({
  schemaVersion: 1,
  title: 'Test project',
  messages: [{ id: 'm1', role: 'assistant', content: 'Done' }],
  snapshot: { chatIndex: 'm1', files: { 'src/App.jsx': { type: 'file', content: '<h1>Hello</h1>', isBinary: false } } },
});
test('full document preserves text and binary bytes and permits chat-only projects', () => {
  const value = document();
  value.snapshot.files['public/image.bin'] = { type: 'file', content: 'AAH/', isBinary: true };
  value.snapshot.files.empty = { type: 'folder' };
  assert.equal(validateDocument(value).document, value);
  assert.ok(validateDocument({ schemaVersion: 1, title: 'Empty', messages: [], snapshot: null }).bytes > 0);
});
test('snapshot anchor, shape, message identities and unsupported parts fail closed', () => {
  for (const change of [
    (d) => {
      d.snapshot.chatIndex = 'missing';
    },
    (d) => {
      d.messages.push(d.messages[0]);
    },
    (d) => {
      d.messages[0].content = [{ type: 'image', image: 'data:image/png;base64,AA==' }];
    },
    (d) => {
      d.messages[0].role = 'tool';
    },
    (d) => {
      d.snapshot.files['public/bad.bin'] = { type: 'file', content: 'not base64', isBinary: true };
    },
    (d) => {
      d.ownerId = randomUUID();
    },
    (d) => {
      d.metadata = { gitUrl: 'https://user:password@example.test/repo' };
    },
  ]) {
    const value = document();
    change(value);
    assert.throws(
      () => validateDocument(value),
      (error) => error.status === 422,
    );
  }
});
test('snapshot paths and sensitive contents never pass validation', () => {
  for (const name of [
    '/etc/passwd',
    '../file',
    'a/../file',
    'a//file',
    'C:/file',
    'a\\file',
    '.env',
    '.env.local',
    '.git/config',
    'node_modules/pkg/a.js',
    '.npmrc',
    'id_rsa',
    'cert.key',
    'bad\0file',
  ]) {
    assert.equal(safeProjectPath(name), false);
    const value = document();
    value.snapshot.files[name] = { type: 'file', content: 'fixture', isBinary: false };
    assert.throws(() => validateDocument(value));
  }
  for (const secret of [
    'sk-' + 'synthetic-only-not-a-real-secret-value',
    'LTAI' + 'SYNTHETICTESTVALUE12345',
    '-----BEGIN PRIVATE KEY-----',
    'postgres://test:fake-password@db.example.test/db',
  ]) {
    const value = document();
    value.messages[0].content = secret;
    assert.throws(
      () => validateDocument(value),
      (error) => error.code === 'SENSITIVE_PROJECT_CONTENT',
    );
  }
  assert.equal(safeProjectPath('.env.example'), true);
});
test('oversized files and invalid mutation identities/revisions are rejected', () => {
  const value = document();
  value.snapshot.files['src/App.jsx'].content = 'x'.repeat(1024 * 1024 + 1);
  assert.throws(
    () => validateDocument(value),
    (error) => error.status === 413,
  );
  const route = { id: randomUUID(), action: 'checkpoint' };
  for (const revision of [undefined, 0, -1, 1.5, '1', 2147483647])
    assert.throws(() =>
      validateMutation(route, { requestId: randomUUID(), baseRevision: revision, document: document() }),
    );
  assert.throws(() =>
    validateMutation(route, { requestId: randomUUID(), baseRevision: 1, document: document(), ownerId: randomUUID() }),
  );
});
test('route allowlist is exact and idempotency hashes logical JSON independent of key order', () => {
  const id = randomUUID();
  assert.deepEqual(projectRoute(`/api/projects/${id}/checkpoint`), { id, action: 'checkpoint' });
  for (const path of [
    '/api/projects/1',
    '/API/projects',
    '/api/projects/',
    `/api/projects/${id}/purge`,
    '/api/projects/export-api-keys',
  ])
    assert.equal(projectRoute(path), null);
  assert.equal(mutationDigest({ b: { z: 2, a: 1 }, a: 3 }), mutationDigest({ a: 3, b: { a: 1, z: 2 } }));
});
test('DB configuration is optional, server-only and defaults to verified TLS with a small pool', () => {
  assert.equal(databaseOptions({}), null);
  const env = {
    WORKBENCH_OWNER_ID: randomUUID(),
    JINGYUE_DATABASE_URL: 'postgresql://fixture:fake-password@fixture.pg.rds.aliyuncs.com/jingyue',
  };
  const options = databaseOptions(env);
  assert.equal(options.pool.ssl.rejectUnauthorized, true);
  assert.equal(options.pool.stream, undefined);
  assert.equal(options.pool.max, 2);
  assert.equal(options.pool.connectionTimeoutMillis, 3000);
  assert.throws(() => databaseOptions({ ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }));
  for (const url of [
    'postgres://fixture:fake-password@evil.example/jingyue',
    env.JINGYUE_DATABASE_URL + '?sslmode=disable',
    env.JINGYUE_DATABASE_URL + '#fragment',
  ])
    assert.throws(() => databaseOptions({ ...env, JINGYUE_DATABASE_URL: url }));
});

test('pg driver constructs a lazy pool without opening connections, and invalid config does not break the app', async () => {
  const logs = [];
  const store = await createProjectStore(
    {
      WORKBENCH_OWNER_ID: randomUUID(),
      JINGYUE_DATABASE_URL: 'postgres://fixture:fake-password@fixture.pg.rds.aliyuncs.com/jingyue',
    },
    (event) => logs.push(event),
  );
  assert.ok(store);
  assert.equal(store.pool.totalCount, 0);
  await store.close();
  assert.equal(
    await createProjectStore(
      { WORKBENCH_OWNER_ID: randomUUID(), JINGYUE_DATABASE_URL: 'not-a-url-with-fake-credential' },
      (event) => logs.push(event),
    ),
    null,
  );
  assert.deepEqual(logs, ['project_database_configuration_unavailable']);
});
