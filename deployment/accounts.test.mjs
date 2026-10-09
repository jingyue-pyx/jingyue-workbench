import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { AccountStore, verifyPassword, readSession, sessionCookie } from './accounts.mjs';
import { configuration } from './security.mjs';
import { PostgresProjectStore } from './project-store.mjs';
import { createGateway } from './gateway.mjs';

let db, pool, store, projects, alice, bob, server, directory, origin, config;
const oldOwner = randomUUID();
const password = 'Test-only-long-password-7248';
before(async () => {
  db = await PGlite.create();
  for (const file of ['001-projects.sql', '003-accounts.sql'])
    await db.exec(await readFile(new URL(`./sql/${file}`, import.meta.url), 'utf8'));
  let previous = Promise.resolve();
  pool = {
    async connect() {
      const wait = previous;
      let release;
      previous = new Promise((r) => {
        release = r;
      });
      await wait;
      return { query: (sql, args) => db.query(sql, args), release };
    },
    async query(sql, args) {
      const client = await this.connect();
      try {
        return await client.query(sql, args);
      } finally {
        client.release();
      }
    },
  };
  config = configuration({
    JINGYUE_PUBLIC_ORIGIN: 'http://127.0.0.1',
    JINGYUE_LOCAL_TEST: '1',
    WORKBENCH_ACCESS_USER: 'original-owner',
    WORKBENCH_ACCESS_PASSWORD: password,
    JINGYUE_AUTH_MODE: 'accounts',
    JINGYUE_REGISTRATION_OPEN: '1',
  });
  store = new AccountStore(pool, config, oldOwner);
  projects = new PostgresProjectStore(pool, oldOwner);
  alice = await store.register({ username: 'Alice', displayName: '小月', password }, 'test-peer');
  bob = await store.register({ username: 'bob', displayName: '小鲸', password }, 'test-peer');
  directory = await mkdtemp(join(tmpdir(), 'jingyue-account-test-'));
  server = await createGateway({
    config,
    accountStore: store,
    projectStore: projects,
    clientDirectory: directory,
    handler: async (_request, context) => new Response(JSON.stringify({ account: context.accountUser })),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = config.origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((r) => server.close(r));
  await db?.close();
  if (directory) await rm(directory, { recursive: true });
});
const cookie = (result) => sessionCookie(result.token, true).split(';')[0];
const request = (path, user, body, extra = {}) =>
  fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: {
      ...(user ? { Cookie: cookie(user), 'X-Jingyue-User': user.user.id } : {}),
      ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const document = (title) => ({
  schemaVersion: 1,
  title,
  messages: [{ id: 'm', role: 'assistant', content: title }],
  snapshot: {
    chatIndex: 'm',
    files: { 'src/App.jsx': { type: 'file', content: '<h1>' + title + '</h1>', isBinary: false } },
  },
});

test('registration creates separate immutable identities and salted hashes, never claims existing projects', async () => {
  assert.equal(alice.user.username, 'alice');
  assert.equal(alice.user.displayName, '小月');
  assert.notEqual(alice.user.id, bob.user.id);
  assert.notEqual(alice.user.id, oldOwner);
  assert.equal(alice.user.legacyOwner, false);
  const { rows } = await pool.query('SELECT password_hash FROM jingyue.accounts ORDER BY username');
  assert.notEqual(rows[0].password_hash, password);
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  assert.equal(await verifyPassword(password, rows[0].password_hash), true);
  assert.equal(await verifyPassword('wrong password', rows[0].password_hash), false);
  assert.equal(JSON.stringify(alice.user).includes('password'), false);
});
test('Passport login normalizes account, rejects incorrect credentials and reserved-name registration', async () => {
  const result = await store.login({ username: ' ALICE ', password }, 'test-login');
  assert.equal(result.user.id, alice.user.id);
  await assert.rejects(store.login({ username: 'alice', password: 'wrong' }, 'test-login'), (e) => e.status === 401);
  await assert.rejects(store.login({ username: 'unknown', password }, 'test-login'), (e) => e.status === 401);
  await assert.rejects(
    store.register({ username: 'ALICE', displayName: 'copy', password }, 'test-login'),
    (e) => e.status === 409,
  );
  await assert.rejects(
    store.register({ username: 'original-owner', displayName: 'copy', password }, 'test-login'),
    (e) => e.status === 409,
  );
});
test('old workspace ownership requires proof of the original credential, not first signup', async () => {
  const record = {
    action: 'create',
    projectId: randomUUID(),
    requestId: randomUUID(),
    document: document('Old private project'),
  };
  await projects.mutate(record);
  assert.deepEqual((await projects.forOwner(alice.user.id).list({})).items, []);
  const owner = await store.login({ username: 'original-owner', password }, 'old-peer');
  assert.equal(owner.user.id, oldOwner);
  assert.equal(owner.user.legacyOwner, true);
  assert.equal((await projects.forOwner(owner.user.id).get(record.projectId)).document.title, 'Old private project');
});
test('session cookies are HttpOnly/Secure, duplicates rejected, tokens hashed and revocable', async () => {
  assert.match(
    sessionCookie(alice.token, false),
    /^__Host-jingyue_session=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200; Secure$/,
  );
  assert.equal(readSession(cookie(alice), true), alice.token);
  assert.equal(readSession(cookie(alice) + '; ' + cookie(alice), true), null);
  const { rows } = await pool.query('SELECT token_hash FROM jingyue.account_sessions');
  assert.ok(rows.every((row) => row.token_hash !== alice.token && /^[0-9a-f]{64}$/.test(row.token_hash)));
  const extra = await store.login({ username: 'bob', password }, 'session-peer');
  await store.logout(extra.token);
  assert.equal(await store.authenticate(extra.token), null);
  assert.equal((await store.authenticate(bob.token)).id, bob.user.id);
});
test('new entry pages are real forms, no Basic challenge; protected APIs reject unauthenticated callers', async () => {
  const page = await request('/register');
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /name="displayName"/);
  assert.match(html, /name="username"/);
  assert.match(html, /name="password"/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await request('/')).headers.get('location'), '/login');
  const api = await request('/api/projects');
  assert.equal(api.status, 401);
  assert.equal(api.headers.get('www-authenticate'), null);
  const basic = 'Basic ' + Buffer.from('original-owner:' + password).toString('base64');
  assert.equal((await request('/api/projects', null, undefined, { Authorization: basic })).status, 401);
});
test('auth API rejects CSRF, excess fields, excess payload and short password', async () => {
  assert.equal(
    (await request('/api/auth/login', null, { username: 'alice', password }, { Origin: 'https://foreign.invalid' }))
      .status,
    403,
  );
  assert.equal(
    (await request('/api/auth/login', null, { username: 'alice', password, ownerId: oldOwner })).status,
    422,
  );
  assert.equal(
    (await request('/api/auth/register', null, { username: 'short', displayName: 'short', password: 'short' })).status,
    422,
  );
  assert.equal((await request('/api/auth/login', null, { username: 'x'.repeat(5000), password })).status, 413);
});
test('display name can change but account/id cannot be changed or supplied through profile API', async () => {
  const renamed = await request('/api/auth/profile', alice, { displayName: '新的显示名' });
  assert.equal(renamed.status, 200);
  const data = await renamed.json();
  assert.equal(data.user.displayName, '新的显示名');
  assert.equal(data.user.id, alice.user.id);
  assert.equal(data.user.username, 'alice');
  assert.equal((await request('/api/auth/profile', alice, { displayName: 'x', username: 'bob' })).status, 422);
  assert.equal((await request('/api/auth/profile', alice, { displayName: ' ' })).status, 422);
});
test('every project read, checkpoint, delete and restore is bound to authenticated owner', async () => {
  const id = randomUUID();
  const create = await request('/api/projects', alice, {
    projectId: id,
    requestId: randomUUID(),
    document: document('Alice only'),
  });
  assert.equal(create.status, 201);
  assert.equal((await request('/api/projects/' + id, bob)).status, 404);
  assert.deepEqual((await (await request('/api/projects', bob)).json()).items, []);
  for (const action of ['checkpoint', 'delete', 'restore']) {
    const result = await request('/api/projects/' + id + '/' + action, bob, {
      requestId: randomUUID(),
      baseRevision: 1,
      ...(action === 'checkpoint' ? { document: document('stolen') } : {}),
    });
    assert.equal(result.status, 404, action);
  }
  const own = await request('/api/projects/' + id, alice);
  assert.equal((await own.json()).document.title, 'Alice only');
  assert.equal(
    (
      await request('/api/projects', alice, {
        projectId: randomUUID(),
        requestId: randomUUID(),
        ownerId: bob.user.id,
        document: document('forged'),
      })
    ).status,
    422,
  );
});
test('stale tabs and forged account headers cannot read/write using a newly switched cookie', async () => {
  for (const path of ['/api/projects', '/api/models', '/api/check-env-key']) {
    const response = await request(path, bob, undefined, { 'X-Jingyue-User': alice.user.id });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'ACCOUNT_CHANGED');
  }
  const parallel = await Promise.all([request('/', alice), request('/', bob)]);
  assert.equal((await parallel[0].json()).account.id, alice.user.id);
  assert.equal((await parallel[1].json()).account.id, bob.user.id);
  assert.equal(projects.ownerId, oldOwner);
});
test('closed registration, account capacity and persistent model budgets are enforced', async () => {
  const closed = new AccountStore(pool, { ...config, registrationOpen: false }, oldOwner);
  await assert.rejects(
    closed.register({ username: 'closed', displayName: 'closed', password }, 'limits'),
    (e) => e.status === 403,
  );
  const full = new AccountStore(pool, { ...config, maxAccounts: 1 }, oldOwner);
  await assert.rejects(
    full.register({ username: 'full', displayName: 'full', password }, 'limits'),
    (e) => e.code === 'REGISTRATION_CAPACITY',
  );
  const limited = new AccountStore(pool, { ...config, userDailyRequests: 1, globalDailyRequests: 10 }, oldOwner);
  await limited.allowModel(alice.user);
  await assert.rejects(limited.allowModel(alice.user), (e) => e.status === 429);
  await limited.allowModel(bob.user);
});
test('login/registration rate-limit counters persist across account-store instances', async () => {
  const restarted = new AccountStore(pool, config, oldOwner);
  for (let i = 0; i < 10; i++) await restarted.guardAttempt('login', 'rate-user', 'rate-peer');
  await assert.rejects(store.guardAttempt('login', 'rate-user', 'rate-peer'), (e) => e.status === 429);
});
test('explicitly disabled daily counters skip quota consumption without clearing existing counters', async () => {
  const unlimited = new AccountStore(pool, {...config, userDailyRequests:0, globalDailyRequests:0}, oldOwner);
  const before = await pool.query('SELECT bucket,count FROM jingyue.account_limits ORDER BY bucket');
  for (let i=0; i<110; i++) await unlimited.allowModel(alice.user);
  const after = await pool.query('SELECT bucket,count FROM jingyue.account_limits ORDER BY bucket');
  assert.deepEqual(after.rows, before.rows);
  // Auth attempt limits are independent from model quotas.
  for (let i=0; i<10; i++) await unlimited.guardAttempt('login','unlimited-user','unlimited-peer');
  await assert.rejects(unlimited.guardAttempt('login','unlimited-user','unlimited-peer'), e => e.status === 429);
});
test('each daily counter can remain enabled independently', async () => {
  const calls=[];
  const userOnly = new AccountStore(pool, {...config, userDailyRequests:5, globalDailyRequests:0}, oldOwner);
  userOnly.consume = async (...args) => {calls.push(args);};
  await userOnly.allowModel(alice.user);
  assert.deepEqual(calls, [[`model-user:${alice.user.id}`,5,86400]]);
  calls.length=0;
  const globalOnly = new AccountStore(pool, {...config, userDailyRequests:0, globalDailyRequests:10}, oldOwner);
  globalOnly.consume = async (...args) => {calls.push(args);};
  await globalOnly.allowModel(alice.user);
  assert.deepEqual(calls, [['model-global',10,86400]]);
});
test('logout and expired/disabled sessions cannot access data', async () => {
  const extra = await store.login({ username: 'bob', password }, 'expiry');
  const out = await request('/api/auth/logout', extra, {});
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/api/projects', extra)).status, 401);
  await pool.query(
    "UPDATE jingyue.account_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
    [bob.user.id],
  );
  assert.equal((await request('/api/projects', bob)).status, 401);
  await pool.query('UPDATE jingyue.accounts SET disabled=true WHERE id=$1', [alice.user.id]);
  assert.equal((await request('/api/projects', alice)).status, 401);
});
