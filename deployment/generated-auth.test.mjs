import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import {
  AppAuthService,
  AppAuthError,
  createSupabaseAppAuth,
  createAppAuthService,
  appAuthRoute,
  appSessionCookie,
  readAppSession,
  validateAppAuth,
} from './app-auth.mjs';
import { createGateway } from './gateway.mjs';
import { configuration } from './security.mjs';
import { validateArtifacts } from './publishing/protocol.mjs';

let db, pool;
before(async () => {
  db = await PGlite.create();
  for (const file of ['001-projects.sql', '006-app-auth.sql'])
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
      const c = await this.connect();
      try {
        return await c.query(sql, args);
      } finally {
        c.release();
      }
    },
  };
});
after(async () => db?.close());
const credentials = { username: 'demo_user', password: 'Synthetic-password-7248', displayName: '演示账号' };
const env = {
  JINGYUE_APP_AUTH_ENABLED: '1',
  JINGYUE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  JINGYUE_SUPABASE_SERVICE_KEY: 'sb_secret_synthetic_fixture_never_real',
};
async function fixture() {
  const owner = randomUUID(),
    project = randomUUID(),
    otherProject = randomUUID();
  for (const id of [project, otherProject])
    await pool.query('INSERT INTO jingyue.projects(owner_id,id,revision,document,byte_count) VALUES($1,$2,1,$3,2)', [
      owner,
      id,
      {},
    ]);
  const users = new Map();
  const provider = {
    async register(o, p, b) {
      const key = `${o}:${p}:${b.username}`;
      if (users.has(key)) throw new AppAuthError(409, 'APP_AUTH_EXISTS', 'exists');
      const user = {
        id: randomUUID(),
        username: b.username,
        displayName: b.displayName || b.username,
        version: 'v1',
        password: b.password,
      };
      users.set(key, user);
      return user;
    },
    async login(o, p, b) {
      const user = users.get(`${o}:${p}:${b.username}`);
      if (user?.password !== b.password) throw new AppAuthError(401, 'APP_AUTH_CREDENTIALS', 'invalid');
      return user;
    },
    async user(o, p, id) {
      return [...users.entries()].find(([key, u]) => key.startsWith(`${o}:${p}:`) && u.id === id)?.[1] || null;
    },
  };
  return { owner, project, otherProject, provider, users, service: new AppAuthService(pool, provider) };
}
test('generated auth is opt-in, validates configuration and rejects extra authority fields', () => {
  assert.equal(createSupabaseAppAuth({}), null);
  assert.throws(() => createSupabaseAppAuth({ ...env, JINGYUE_SUPABASE_URL: 'http://example.com' }));
  assert.throws(() => createAppAuthService(env, null));
  for (const body of [
    null,
    [],
    { action: 'sql' },
    { action: 'session', projectId: randomUUID() },
    { action: 'register', ...credentials, role: 'admin' },
    { action: 'login', ...credentials, password: 'short' },
  ])
    assert.throws(() => validateAppAuth(body));
  assert.equal(
    validateAppAuth({ action: 'login', username: 'Demo_User', password: credentials.password }).username,
    'demo_user',
  );
  assert.equal(appAuthRoute(`/api/app-auth/${randomUUID()}`)?.length, 36);
  assert.equal(appAuthRoute('/api/app-auth/../../x'), null);
});
test('Supabase adapter namespaces identities, checks server metadata, closes upstream session and never returns tokens', async () => {
  const owner = randomUUID(),
    project = randomUUID(),
    id = randomUUID();
  const calls = [];
  const user = {
    id,
    updated_at: 'v1',
    app_metadata: { jingyue_owner: owner, jingyue_project: project, jingyue_username: 'demo_user' },
    user_metadata: { display_name: '演示账号' },
  };
  const provider = createSupabaseAppAuth(env, async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/token?'))
      return Response.json({ user, access_token: 'synthetic-user-token', refresh_token: 'must-not-persist' });
    if (String(url).includes('/logout?')) return new Response(null, { status: 204 });
    return Response.json(user);
  });
  const registered = await provider.register(owner, project, credentials);
  assert.equal(registered.id, id);
  const body = JSON.parse(calls[0].init.body);
  assert.match(body.email, /@jingyue-app.invalid$/);
  assert.equal(body.email_confirm, true);
  const result = await provider.login(owner, project, credentials);
  assert.equal(result.username, 'demo_user');
  assert.ok(calls.some((call) => call.url.endsWith('/logout?scope=local')));
  assert.ok(
    calls.every(
      (call) => call.init.redirect === 'error' && call.init.headers.apikey === env.JINGYUE_SUPABASE_SERVICE_KEY,
    ),
  );
  assert.doesNotMatch(JSON.stringify(result), /token|password|secret/);
  assert.equal(await provider.user(owner, randomUUID(), id), null);
});
test('upstream errors are sanitized and invalid credentials are not a service outage', async () => {
  const provider = createSupabaseAppAuth(env, async () =>
    Response.json({ error: 'private secret raw error' }, { status: 400 }),
  );
  await assert.rejects(
    provider.login(randomUUID(), randomUUID(), credentials),
    (e) => e.code === 'APP_AUTH_CREDENTIALS' && !e.message.includes('private'),
  );
  const broken = createSupabaseAppAuth(env, async () => {
    throw new Error(env.JINGYUE_SUPABASE_SERVICE_KEY);
  });
  await assert.rejects(
    broken.register(randomUUID(), randomUUID(), credentials),
    (e) => e.code === 'APP_AUTH_UNAVAILABLE' && !e.message.includes('secret'),
  );
});
test('real SQL persists identities/sessions across service instances without passwords or raw tokens', async () => {
  const f = await fixture();
  const result = await f.service.execute(f.owner, f.project, { action: 'register', ...credentials });
  const saved = await pool.query('SELECT * FROM jingyue.app_auth_sessions WHERE owner_id=$1', [f.owner]);
  assert.equal(saved.rows[0].token_hash, createHash('sha256').update(result.token).digest('hex'));
  assert.doesNotMatch(JSON.stringify(saved.rows), new RegExp(result.token + '|' + credentials.password));
  const restarted = new AppAuthService(pool, f.provider);
  assert.deepEqual(await restarted.execute(f.owner, f.project, { action: 'session' }, result.token), {
    user: result.user,
  });
  await assert.rejects(
    restarted.execute(f.owner, f.project, { action: 'register', ...credentials }),
    (e) => e.code === 'APP_AUTH_EXISTS',
  );
  await assert.rejects(
    restarted.execute(f.owner, f.project, {
      action: 'login',
      username: credentials.username,
      password: 'Wrong-password-7248',
    }),
    (e) => e.code === 'APP_AUTH_CREDENTIALS',
  );
  const login = await restarted.execute(
    f.owner,
    f.project,
    { action: 'login', username: credentials.username, password: credentials.password },
    result.token,
  );
  assert.equal(login.user.id, result.user.id);
  assert.equal((await restarted.execute(f.owner, f.project, { action: 'session' }, result.token)).user, null);
  await restarted.execute(f.owner, f.project, { action: 'logout' }, login.token);
  assert.equal((await restarted.execute(f.owner, f.project, { action: 'session' }, login.token)).user, null);
});
test('same username in two applications is separate; foreign projects/accounts cannot reuse a session', async () => {
  const f = await fixture();
  const a = await f.service.execute(f.owner, f.project, { action: 'register', ...credentials });
  const b = await f.service.execute(f.owner, f.otherProject, { action: 'register', ...credentials });
  assert.notEqual(a.user.id, b.user.id);
  assert.equal((await f.service.execute(f.owner, f.otherProject, { action: 'session' }, a.token)).user, null);
  assert.equal((await f.service.execute(randomUUID(), f.project, { action: 'session' }, a.token)).user, null);
  assert.equal((await f.service.execute(f.owner, f.project, { action: 'session' }, a.token)).user.id, a.user.id);
});
test('expiry, remote deletion and password/profile version changes revoke saved sessions', async () => {
  for (const mode of ['expired', 'deleted', 'changed']) {
    const f = await fixture();
    const a = await f.service.execute(f.owner, f.project, { action: 'register', ...credentials });
    if (mode === 'expired')
      await pool.query(
        "UPDATE jingyue.app_auth_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE owner_id=$1",
        [f.owner],
      );
    if (mode === 'deleted') f.users.clear();
    if (mode === 'changed') [...f.users.values()][0].version = 'v2';
    assert.equal((await f.service.execute(f.owner, f.project, { action: 'session' }, a.token)).user, null);
  }
});
test('attempt limits survive restart and app cookies are HttpOnly/path-scoped without workbench-cookie collisions', async () => {
  const f = await fixture();
  for (let i = 0; i < 10; i++) await f.service.consume(f.owner, f.project, 'login', 'target');
  await assert.rejects(
    new AppAuthService(pool, f.provider).consume(f.owner, f.project, 'login', 'target'),
    (e) => e.code === 'APP_AUTH_RATE_LIMIT',
  );
  const cookie = appSessionCookie(f.project, 'a'.repeat(43), false);
  assert.match(cookie, /HttpOnly; SameSite=Strict; Max-Age=86400; Secure/);
  assert.ok(cookie.includes(`Path=/api/app-auth/${f.project}`));
  assert.equal(readAppSession(cookie, false), 'a'.repeat(43));
  assert.equal(readAppSession(cookie + '; ' + cookie, false), null);
  assert.match(appSessionCookie(f.project, '', true, true), /Max-Age=0/);
});
test('registration reservations enforce project capacity under concurrency without granting a wider backend', async () => {
  const f = await fixture();
  await Promise.all(Array.from({ length: 20 }, (_, i) => f.service.reserve(f.owner, f.project, `user_${i}`)));
  await assert.rejects(f.service.reserve(f.owner, f.project, 'user_extra'), (e) => e.code === 'APP_AUTH_CAPACITY');
});
test('preview-only auth artifacts cannot be published as standalone sites', () => {
  assert.throws(
    () => validateArtifacts([{ path: 'index.html', base64: Buffer.from('jingyue:auth-connect').toString('base64') }]),
    (e) => e.code === 'PREVIEW_STORAGE_ONLY',
  );
});
test('gateway requires workbench authentication, ownership, same origin and derives model capability server-side', async (t) => {
  const owner = randomUUID(),
    other = randomUUID(),
    project = randomUUID();
  let calls = 0,
    received;
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-app-auth-gateway-'));
  const config = configuration({
    JINGYUE_LOCAL_TEST: '1',
    JINGYUE_AUTH_MODE: 'accounts',
    JINGYUE_PUBLIC_ORIGIN: 'http://127.0.0.1:9035',
    WORKBENCH_ACCESS_USER: 'test',
    WORKBENCH_ACCESS_PASSWORD: 'Synthetic-password-12345',
    DASHSCOPE_API_KEY: 'synthetic-fixture-only',
  });
  const server = await createGateway({
    config,
    clientDirectory: directory,
    accountStore: { authenticate: async (token) => (token ? { id: owner } : null), allowModel: async () => {} },
    projectStore: {
      forOwner: () => ({
        get: async (id) => {
          if (id !== project) throw Object.assign(new Error(), { code: 'PROJECT_NOT_FOUND' });
          return { deletedAt: null };
        },
      }),
    },
    appAuthService: {
      execute: async () => {
        calls++;
        return { user: { id: randomUUID(), username: 'demo', displayName: 'Demo' }, token: 'b'.repeat(43) };
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
    'x-jingyue-user': owner,
    origin: config.origin,
    'content-type': 'application/json',
  };
  const request = (path, body, extra = {}) =>
    fetch(config.origin + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const path = `/api/app-auth/${project}`;
  assert.equal((await request(path, { action: 'session' }, { cookie: '' })).status, 401);
  assert.equal((await request(path, { action: 'session' }, { 'x-jingyue-user': other })).status, 409);
  assert.equal((await request(path, { action: 'session' }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await request(`/api/app-auth/${other}`, { action: 'session' })).status, 404);
  assert.equal(calls, 0);
  const success = await request(path, { action: 'session' });
  assert.equal(success.status, 200);
  assert.ok(success.headers.get('set-cookie').includes('HttpOnly'));
  assert.ok(!(await success.text()).includes('b'.repeat(43)));
  const model = (id) =>
    request('/api/chat', { messages: [{ role: 'user', content: 'test' }], managedProjectId: id, managedAppAuth: true });
  assert.equal((await model(other)).status, 200);
  assert.equal(received.managedAppAuth, undefined);
  assert.equal((await model(project)).status, 200);
  assert.equal(received.managedAppAuth, true);
});
