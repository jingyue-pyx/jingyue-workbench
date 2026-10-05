import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { createDemoDataStore, demoDataRoute, validateDemoRequest } from './demo-data.mjs';
import { createGateway } from './gateway.mjs';
import { configuration } from './security.mjs';

const alice = randomUUID(),
  bob = randomUUID(),
  projectId = randomUUID();
const env = {
  JINGYUE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  JINGYUE_SUPABASE_SERVICE_KEY: 'sb_secret_test_canary_not_a_real_key',
  JINGYUE_DEMO_WORKBENCH_PROJECT: projectId,
};
const mutation = (extra = {}) => ({
  action: 'write',
  key: 'orders',
  value: { orders: [] },
  baseRevision: 0,
  requestId: randomUUID(),
  ...extra,
});
let db;
before(async () => {
  db = await PGlite.create();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(await readFile(new URL('./supabase/001-demo-data.sql', import.meta.url), 'utf8'));
});
after(async () => db?.close());
const rpc = async (owner, project, body) =>
  (
    await db.query('SELECT public.jingyue_demo_data($1,$2,$3,$4,$5,$6,$7) AS result', [
      owner,
      project,
      body.key,
      body.action,
      body.value ?? null,
      body.baseRevision ?? 0,
      body.requestId ?? null,
    ])
  ).rows[0].result;

test('Supabase demo configuration fails closed and does not accept caller-controlled endpoints', () => {
  assert.equal(createDemoDataStore({}), null);
  for (const url of [
    'http://abcdefghijklmnopqrst.supabase.co',
    'https://example.com',
    env.JINGYUE_SUPABASE_URL + '/other',
    env.JINGYUE_SUPABASE_URL + '?leak=1',
    'https://u:p@abcdefghijklmnopqrst.supabase.co',
  ])
    assert.throws(() => createDemoDataStore({ ...env, JINGYUE_SUPABASE_URL: url }));
  assert.throws(() => createDemoDataStore({ JINGYUE_DEMO_WORKBENCH_PROJECT: projectId }));
  assert.throws(() => createDemoDataStore({ ...env, JINGYUE_SUPABASE_SERVICE_KEY: '' }));
  assert.throws(() => createDemoDataStore({ ...env, JINGYUE_DEMO_WORKBENCH_PROJECT: '*' }));
  assert.equal(demoDataRoute(`/api/demo-data/${projectId}/status`).projectId, projectId);
  assert.equal(demoDataRoute('/api/demo-data/../../secrets'), null);
});

test('auth-only Supabase configuration does not implicitly enable project data storage', () => {
  const authOnly = {
    JINGYUE_APP_AUTH_ENABLED: '1',
    JINGYUE_SUPABASE_URL: env.JINGYUE_SUPABASE_URL,
    JINGYUE_SUPABASE_SERVICE_KEY: env.JINGYUE_SUPABASE_SERVICE_KEY,
  };
  assert.equal(createDemoDataStore(authOnly), null);
  assert.equal(createDemoDataStore({ ...authOnly, JINGYUE_DEMO_WORKBENCH_PROJECT: '' }), null);
  assert.equal(createDemoDataStore({ ...authOnly, JINGYUE_APP_AUTH_ENABLED: '0' }), null);
  assert.ok(createDemoDataStore({ ...authOnly, JINGYUE_DEMO_WORKBENCH_PROJECT: projectId }));
});

test('demo requests reject SQL, owner/project overrides, oversized data and missing revisions', () => {
  for (const body of [
    null,
    { action: 'sql', key: 'orders' },
    { action: 'read', key: 'orders', ownerId: bob },
    mutation({ baseRevision: -1 }),
    mutation({ value: 'text' }),
    mutation({ requestId: 'invalid' }),
    mutation({ key: 'orders&owner=other' }),
    mutation({ value: { text: 'x'.repeat(65536) } }),
  ])
    assert.throws(() => validateDemoRequest(body));
  assert.equal(validateDemoRequest(mutation()).action, 'write');
});

test('real PostgreSQL migration supports reload, isolation, CAS and lost-response retry', async () => {
  const id = randomUUID();
  const first = mutation({ value: { budget: 8000, orders: [{ id: 'p1', quantity: 2 }] } });
  assert.deepEqual(await rpc(alice, id, { action: 'read', key: 'orders' }), {
    revision: 0,
    value: null,
    updatedAt: null,
  });
  const saved = await rpc(alice, id, first);
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.value, first.value);
  assert.deepEqual(await rpc(alice, id, first), saved);
  assert.deepEqual(await rpc(alice, id, { ...first, value: {} }), { error: 'conflict' });
  assert.deepEqual((await rpc(alice, id, { action: 'read', key: 'orders' })).value, first.value);
  assert.equal((await rpc(bob, id, { action: 'read', key: 'orders' })).revision, 0);
  assert.equal((await rpc(alice, randomUUID(), { action: 'read', key: 'orders' })).revision, 0);
  assert.deepEqual(await rpc(alice, id, mutation()), { error: 'conflict' });
  assert.equal((await rpc(alice, id, mutation({ baseRevision: 1, value: { orders: [] } }))).revision, 2);
});

test('anonymous and authenticated Supabase roles cannot read table or invoke privileged RPC', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    try {
      await assert.rejects(db.query('SELECT * FROM public.jingyue_demo_documents'), /permission denied/);
      await assert.rejects(rpc(alice, projectId, { action: 'read', key: 'orders' }), /permission denied/);
    } finally {
      await db.exec('RESET ROLE');
    }
  }
  await db.exec('SET ROLE service_role');
  try {
    await assert.rejects(db.query('SELECT * FROM public.jingyue_demo_documents'), /permission denied/);
    assert.equal((await rpc(alice, projectId, { action: 'read', key: 'orders' })).revision, 0);
  } finally {
    await db.exec('RESET ROLE');
  }
});

test('per-project data keys and document sizes are bounded in PostgreSQL, independently of gateway', async () => {
  const id = randomUUID();
  for (let i = 0; i < 20; i++) assert.equal((await rpc(alice, id, mutation({ key: `data${i}` }))).revision, 1);
  assert.deepEqual(await rpc(alice, id, mutation({ key: 'overflow' })), { error: 'quota' });
  assert.deepEqual(await rpc(alice, id, mutation({ value: { text: 'x'.repeat(70001) } })), { error: 'quota' });
});

test('adapter sends only scoped RPC, captures secret server-side, and sanitizes upstream failures', async () => {
  let captured;
  const store = createDemoDataStore(env, async (url, init) => {
    captured = { url: String(url), ...init };
    return Response.json({ revision: 1, value: { saved: true }, updatedAt: '2026-01-01T00:00:00Z' });
  });
  await store.execute(alice, projectId, mutation());
  assert.equal(captured.url, env.JINGYUE_SUPABASE_URL + '/rest/v1/rpc/jingyue_demo_data');
  assert.equal(captured.redirect, 'error');
  assert.equal(captured.headers.apikey, env.JINGYUE_SUPABASE_SERVICE_KEY);
  assert.equal('Authorization' in captured.headers, false); // New secret keys are not JWTs.
  assert.equal(JSON.parse(captured.body).p_owner, alice);
  assert.equal(JSON.stringify(store).includes(env.JINGYUE_SUPABASE_SERVICE_KEY), false);
  await assert.rejects(store.execute(alice, randomUUID(), mutation()), (e) => e.code === 'DATA_NOT_ENABLED');
  const failed = createDemoDataStore(env, async () => new Response(env.JINGYUE_SUPABASE_SERVICE_KEY, { status: 500 }));
  await assert.rejects(
    failed.execute(alice, projectId, mutation()),
    (e) => e.code === 'DATA_UNAVAILABLE' && !e.message.includes('canary'),
  );
});

test('gateway enforces session, stale-tab identity, origin and project ownership before business data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-demo-gateway-'));
  const config = configuration({
    JINGYUE_LOCAL_TEST: '1',
    JINGYUE_PUBLIC_ORIGIN: 'http://127.0.0.1',
    WORKBENCH_ACCESS_USER: 'preview_owner',
    WORKBENCH_ACCESS_PASSWORD: 'test-only-password-long-enough',
    JINGYUE_AUTH_MODE: 'accounts',
  });
  let calls = 0,
    deleted = false,
    received;
  const server = await createGateway({
    config,
    clientDirectory: directory,
    accountStore: {
      authenticate: async (token) =>
        token === 'a'.repeat(43) ? { id: alice } : token === 'b'.repeat(43) ? { id: bob } : null,
      allowModel: async () => {},
    },
    projectStore: {
      forOwner: (id) => ({
        get: async (pid) => {
          if (id !== alice || pid !== projectId) throw Object.assign(new Error(), { code: 'PROJECT_NOT_FOUND' });
          return { deletedAt: deleted ? 'deleted' : null };
        },
      }),
    },
    demoDataStore: {
      projectId,
      execute: async (owner) => {
        calls++;
        assert.equal(owner, alice);
        return { revision: 1, value: {}, updatedAt: null };
      },
    },
    handler: async (req) => {
      received = await req.json();
      return Response.json({ ok: true });
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true, force: true });
  });
  const headers = {
    cookie: `jingyue_session_test=${'a'.repeat(43)}`,
    'x-jingyue-user': alice,
    origin: config.origin,
    'content-type': 'application/json',
  };
  const request = (overrides = {}, path = `/api/demo-data/${projectId}`) =>
    fetch(config.origin + path, {
      method: 'POST',
      headers: { ...headers, ...overrides },
      body: JSON.stringify(mutation()),
    });
  assert.equal((await request({ cookie: '' })).status, 401);
  assert.equal((await request({ 'x-jingyue-user': bob })).status, 409);
  assert.equal((await request({ origin: 'https://other.test' })).status, 403);
  assert.equal(
    (await request({ cookie: `jingyue_session_test=${'b'.repeat(43)}`, 'x-jingyue-user': bob })).status,
    404,
  );
  assert.equal(calls, 0);
  assert.equal((await request()).status, 200);
  assert.equal(calls, 1);
  deleted = true;
  assert.equal((await request()).status, 404);
  deleted = false;
  const status = await fetch(config.origin + `/api/demo-data/${projectId}/status`, { headers });
  assert.deepEqual(await status.json(), { enabled: true, provider: 'supabase' });
  const chat = async (id) =>
    fetch(config.origin + '/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test' }],
        managedProjectId: id,
        managedDemoStorage: true,
      }),
    });
  assert.equal((await chat(randomUUID())).status, 200);
  assert.equal(received.managedDemoStorage, undefined);
  assert.equal((await chat(projectId)).status, 200);
  assert.equal(received.managedDemoStorage, true);
});
