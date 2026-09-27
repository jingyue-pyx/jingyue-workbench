import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createGateway } from './gateway.mjs';
import { configuration } from './security.mjs';
import { ProjectError } from './project-protocol.mjs';

const auth = 'Basic ' + Buffer.from('test:fake-test-password-not-a-secret').toString('base64');
const document = { schemaVersion: 1, title: 'Fixture', messages: [], snapshot: null };
async function fixture(t, store = null) {
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-project-api-'));
  const config = configuration({
    JINGYUE_PUBLIC_ORIGIN: 'http://127.0.0.1',
    JINGYUE_LOCAL_TEST: '1',
    WORKBENCH_ACCESS_USER: 'test',
    WORKBENCH_ACCESS_PASSWORD: 'fake-test-password-not-a-secret',
  });
  const server = await createGateway({
    config,
    clientDirectory: directory,
    projectStore: store,
    handler: () => {
      throw new Error('Project APIs must not invoke Remix/model handlers');
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const request = (path, body, extra = {}) =>
    fetch(config.origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: auth, origin: config.origin, 'content-type': 'application/json', ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { origin: config.origin, request };
}
test('unconfigured projects return controlled unavailable without disrupting catalog or leaking config', async (t) => {
  const { request } = await fixture(t);
  const response = await request('/api/projects');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '5');
  assert.equal((await response.json()).error.code, 'PERSISTENCE_UNAVAILABLE');
  assert.equal((await request('/api/models')).status, 200);
  assert.equal((await request('/healthz')).status, 200);
});
test('project APIs require auth and same-origin JSON and reject bypasses or supplied owners', async (t) => {
  let calls = 0;
  const { origin, request } = await fixture(t, {
    mutate: async () => {
      calls++;
      return {};
    },
  });
  const body = { projectId: randomUUID(), requestId: randomUUID(), document };
  assert.equal((await fetch(origin + '/api/projects')).status, 401);
  assert.equal((await request('/api/projects', body, { origin: 'https://other.test' })).status, 403);
  assert.equal((await request('/api/projects', body, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await request('/api/projects', { ...body, ownerId: randomUUID() })).status, 422);
  for (const path of [
    '/API/projects',
    '/api/projects/1',
    '/api/projects/export-api-keys',
    '/api/projects?_data=routes%2Fapi.projects',
    '/api/projects/../export-api-keys',
  ])
    assert.equal((await request(path)).status, 404);
  assert.equal(calls, 0);
});
test('project contract routes independently of model body validation and preserves soft-delete information', async (t) => {
  const projectId = randomUUID();
  const requestId = randomUUID();
  const mutations = [];
  const result = { projectId, revision: 1, updatedAt: new Date().toISOString(), deletedAt: null };
  const store = {
    mutate: async (operation) => {
      mutations.push(operation);
      return result;
    },
    get: async (id) => ({
      ...result,
      projectId: id,
      document,
      createdAt: result.updatedAt,
      deletedAt: result.updatedAt,
    }),
    list: async (options) => {
      assert.equal(options.deleted, true);
      return { items: [], nextCursor: null };
    },
  };
  const { request } = await fixture(t, store);
  const created = await request('/api/projects', { projectId, requestId, document });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), result);
  assert.deepEqual(mutations[0], { action: 'create', projectId, requestId, document });
  const saved = await request(`/api/projects/${projectId}/checkpoint`, {
    requestId: randomUUID(),
    baseRevision: 1,
    document,
  });
  assert.equal(saved.status, 200);
  assert.equal(mutations[1].action, 'checkpoint');
  assert.ok((await (await request(`/api/projects/${projectId}`)).json()).deletedAt);
  assert.deepEqual(await (await request('/api/projects?deleted=1')).json(), { items: [], nextCursor: null });
  assert.equal((await request('/api/projects?limit=100')).status, 422);
  assert.equal((await request(`/api/projects/${projectId}/delete`)).status, 405);
});
test('project CAS errors are structured and raw database exceptions are redacted', async (t) => {
  const { request } = await fixture(t, {
    mutate: async () => {
      throw new ProjectError(409, 'REVISION_CONFLICT', 'Project changed', 4);
    },
    get: async () => {
      throw new Error('database-credential-canary');
    },
  });
  const id = randomUUID();
  const conflict = await request(`/api/projects/${id}/delete`, { requestId: randomUUID(), baseRevision: 1 });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), {
    error: { code: 'REVISION_CONFLICT', message: 'Project changed', currentRevision: 4 },
  });
  const failed = await request(`/api/projects/${id}`);
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('retry-after'), '5');
  assert.equal((await failed.text()).includes('credential-canary'), false);
});
test('unsafe paths, secrets and size limits fail before storage calls', async (t) => {
  let calls = 0;
  const { request } = await fixture(t, {
    mutate: async () => {
      calls++;
      return {};
    },
  });
  const secret = 'sk-' + 'test-only-fake-secret-value-long-enough';
  for (const content of [secret, 'x'.repeat(4 * 1024 * 1024)]) {
    const response = await request('/api/projects', {
      projectId: randomUUID(),
      requestId: randomUUID(),
      document: { ...document, messages: [{ id: 'm', role: 'user', content }] },
    });
    assert.ok([413, 422].includes(response.status));
  }
  assert.equal(calls, 0);
});
