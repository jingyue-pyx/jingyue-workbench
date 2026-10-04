import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { PGlite } from '@electric-sql/pglite';
import { validateArtifacts, publicSiteURL, PublishingError } from './publishing/protocol.mjs';
import { PublishingStore, credentialVault } from './publishing/store.mjs';
import { createPublishingService, PublishingService } from './publishing/service.mjs';
import { NetlifyProvider } from './publishing/netlify.mjs';
import { createGateway } from './gateway.mjs';
import { configuration } from './security.mjs';

let database, pool;
before(async () => {
  database = await PGlite.create();
  await database.exec('CREATE SCHEMA jingyue');
  await database.exec(await readFile(new URL('./sql/005-publishing.sql', import.meta.url), 'utf8'));
  let previous = Promise.resolve();
  pool = {
    async connect() {
      const wait = previous;
      let release;
      previous = new Promise((r) => {
        release = r;
      });
      await wait;
      return { query: (sql, values) => database.query(sql, values), release };
    },
    async query(sql, values) {
      const c = await this.connect();
      try {
        return await c.query(sql, values);
      } finally {
        c.release();
      }
    },
  };
});
after(async () => database?.close());
const artifact = (path = 'index.html', content = '<h1>Demo</h1>') => ({
  path,
  base64: Buffer.from(content).toString('base64'),
});

function fixture() {
  const owner = randomUUID(),
    projectId = randomUUID(),
    token = 'synthetic-provider-token-only-for-tests';
  const store = new PublishingStore(pool);
  const vault = credentialVault(randomBytes(32).toString('base64'));
  const calls = [];
  let ready = false;
  let deploy;
  let site;
  const provider = {
    async ticket() {
      return { id: 'ticket1' };
    },
    async ticketStatus() {
      return { authorized: true };
    },
    async exchange() {
      return { access_token: token, user_id: 'provider-user' };
    },
    async user() {
      return { id: 'provider-user', full_name: 'Test user' };
    },
    async accounts() {
      return [{ id: 'team1', slug: 'team-one', name: 'Team one', billing_email: 'private-test@example.invalid' }];
    },
    async site() {
      return site;
    },
    async siteByName() {
      return site;
    },
    async createSite(_token, team, name) {
      calls.push('site');
      site = { id: 'site1', name, account_id: 'team1' };
      return site;
    },
    async deploy(_token, siteId, title, files) {
      calls.push('deploy');
      deploy = {
        id: 'deploy1',
        site_id: siteId,
        title,
        required: files.map((f) => f.digest),
        ssl_url: 'https://test-site.netlify.app',
      };
      return deploy;
    },
    async deployments() {
      return [deploy];
    },
    async deployment() {
      return { ...deploy, state: ready ? 'ready' : 'uploading' };
    },
    async upload(_token, id, file) {
      calls.push(['upload', file.path, Buffer.from(file.base64, 'base64')]);
      deploy.required = deploy.required.filter((d) => d !== file.digest);
      ready = !deploy.required.length;
      return {};
    },
  };
  const projects = {
    forOwner(user) {
      return {
        async get(id) {
          if (user !== owner || id !== projectId) throw Object.assign(new Error('not found'), { status: 404 });
          return { revision: 1, deletedAt: null };
        },
      };
    },
  };
  const service = new PublishingService({
    store,
    vault,
    projects,
    provider,
    clientId: 'our-app',
    fetchImpl: async () => new Response((await store.get(owner, `project:${projectId}`)).job.id),
  });
  const connect = async () => {
    const attempt = await service.connect(owner, 'session1');
    await service.authorize(owner, 'session1', attempt.attemptId);
    return attempt;
  };
  const prepare = (extra = {}) =>
    service.prepare(owner, {
      projectId,
      revision: 1,
      teamId: 'team1',
      requestId: randomUUID(),
      confirmPublic: true,
      files: [artifact()],
      ...extra,
    });
  return { owner, projectId, token, store, vault, provider, service, connect, prepare, calls };
}

test('disabled by default; no implicit keys, arbitrary endpoints or missing storage', () => {
  assert.equal(createPublishingService({}, null), null);
  assert.throws(() => createPublishingService({ JINGYUE_NETLIFY_ENABLED: '1' }, null));
  assert.throws(() => credentialVault('short'));
});
test('vault is randomized, owner-bound and tamper-resistant', () => {
  const vault = credentialVault(randomBytes(32).toString('base64'));
  const sealed = vault.seal('a', 'token');
  assert.equal(sealed.includes('token'), false);
  assert.notEqual(vault.seal('a', 'token'), sealed);
  assert.equal(vault.open('a', sealed), 'token');
  assert.throws(() => vault.open('b', sealed));
  assert.throws(() => vault.open('a', sealed.slice(1)));
});
test('binary roundtrip, path traversal, duplicate paths, functions and secrets', () => {
  const binary = Buffer.from([0, 255, 43, 128, 13, 10]);
  const files = validateArtifacts([artifact(), artifact('assets/a.png', binary)]);
  assert.deepEqual(Buffer.from(files[1].base64, 'base64'), binary);
  for (const path of ['../x', '/x', 'a\\b', '.env', 'src/x.map', 'functions/a.js', '_redirects', 'package.json'])
    assert.throws(() => validateArtifacts([artifact(), artifact(path)]));
  assert.throws(() => validateArtifacts([artifact(), artifact()]));
  assert.throws(() => validateArtifacts([artifact('x.html')]));
  assert.throws(() => validateArtifacts([artifact('index.html', `sk-${'x'.repeat(30)}`)]));
  assert.throws(() => validateArtifacts([artifact('index.html', 'jingyue:data-request')]));
  assert.throws(() => validateArtifacts([{ path: 'index.html', base64: '%%%bad' }]));
  assert.throws(() => validateArtifacts([artifact('index.html', 'x'.repeat(8 * 1024 * 1024 + 1))]));
});
test('public URLs allow only default Netlify HTTPS hosts, never redirects/internal endpoints', () => {
  assert.equal(publicSiteURL('https://test.netlify.app/'), 'https://test.netlify.app');
  for (const value of [
    'http://test.netlify.app',
    'https://netlify.app.evil.test',
    'https://user:pass@test.netlify.app',
    'https://127.0.0.1',
    'https://test.netlify.app/path',
    'https://test.netlify.app/?x=1',
  ])
    assert.equal(publicSiteURL(value), null);
});
test('real PostgreSQL storage isolates owners, serializes leases and rolls back failed updates', async () => {
  const store = new PublishingStore(pool),
    owner = randomUUID();
  await store.change(owner, 'x', () => ({ value: 1 }));
  assert.equal(await store.get(randomUUID(), 'x'), null);
  const lease = await store.lease(owner, 'x');
  await assert.rejects(store.lease(owner, 'x'), (e) => e.code === 'PUBLISH_BUSY');
  await lease.save({ value: 2 });
  await assert.rejects(
    store.change(owner, 'x', () => {
      throw new Error('rollback');
    }),
  );
  assert.equal((await store.get(owner, 'x')).value, 2);
});
test('ticket authorization is session-bound, single-use and never exposes credentials', async () => {
  const f = fixture();
  const attempt = await f.service.connect(f.owner, 'session1');
  assert.match(attempt.authorizeUrl, /^https:\/\/app.netlify.com\/authorize\?response_type=ticket&ticket=/);
  const result = await f.service.authorize(f.owner, 'session1', attempt.attemptId);
  assert.equal(result.connected, true);
  assert.equal(JSON.stringify(await f.store.get(f.owner, 'netlify')).includes(f.token), false);
  assert.equal(JSON.stringify(await f.service.status(f.owner)).includes(f.token), false);
  await assert.rejects(f.service.authorize(f.owner, 'session1', attempt.attemptId));
  const g = fixture(),
    a = await g.service.connect(g.owner, 'session1');
  await assert.rejects(g.service.authorize(g.owner, 'other-session', a.attemptId), (e) => e.code === 'AUTH_EXPIRED');
});
test('pending/cancelled authorization cannot silently connect; teams return minimal fields', async () => {
  const f = fixture();
  f.provider.ticketStatus = async () => ({ authorized: false });
  const a = await f.service.connect(f.owner, 'session1');
  assert.deepEqual(await f.service.authorize(f.owner, 'session1', a.attemptId), { pending: true });
  await f.service.disconnect(f.owner);
  await assert.rejects(f.service.authorize(f.owner, 'session1', a.attemptId));
  const g = fixture();
  await g.connect();
  const teams = await g.service.teams(g.owner);
  assert.equal(JSON.stringify(teams).includes('billing'), false);
});
test('publishing requires ownership, saved revision, team and explicit public confirmation', async () => {
  const f = fixture();
  await f.connect();
  await assert.rejects(f.service.advance(f.owner, f.projectId), (e) => e.code === 'PUBLISH_NOT_FOUND');
  await assert.rejects(f.prepare({ confirmPublic: false }), (e) => e.code === 'PUBLISH_CONFIRMATION');
  await assert.rejects(f.prepare({ revision: 0 }), (e) => e.code === 'SOURCE_CHANGED');
  await assert.rejects(f.prepare({ teamId: 'other' }), (e) => e.code === 'TEAM_FORBIDDEN');
  await assert.rejects(f.service.job(randomUUID(), f.projectId));
  assert.deepEqual(f.calls, []);
});
test('idempotent prepare, binary upload, polling to public marker; updates use the same site', async () => {
  const f = fixture();
  await f.connect();
  const requestId = randomUUID();
  const first = await f.prepare({ requestId, files: [artifact(), artifact('a.png', Buffer.from([0, 255, 128]))] });
  assert.equal(
    (await f.prepare({ requestId, files: [artifact(), artifact('a.png', Buffer.from([0, 255, 128]))] })).id,
    first.id,
  );
  await assert.rejects(f.prepare({ requestId }), (e) => e.code === 'REQUEST_REUSED');
  await assert.rejects(f.prepare(), (e) => e.code === 'PUBLISH_BUSY');
  let status;
  for (let i = 0; i < 9; i++) status = await f.service.advance(f.owner, f.projectId);
  assert.equal(status.phase, 'published');
  assert.equal(status.lastPublished.url, 'https://test-site.netlify.app');
  assert.deepEqual(f.calls.find((c) => c[1] === 'a.png')[2], Buffer.from([0, 255, 128]));
  assert.equal((await f.store.get(f.owner, `project:${f.projectId}`)).job.files, undefined);
  await f.prepare();
  await f.service.advance(f.owner, f.projectId);
  assert.equal(f.calls.filter((c) => c === 'site').length, 1);
  assert.equal(f.calls.filter((c) => c === 'deploy').length, 2);
});
test('unknown create/deploy responses are reconciled, never blindly duplicated', async () => {
  const f = fixture();
  await f.connect();
  await f.prepare();
  const create = f.provider.createSite;
  f.provider.createSite = async (...args) => {
    await create(...args);
    throw new Error('network lost');
  };
  await assert.rejects(f.service.advance(f.owner, f.projectId));
  assert.equal((await f.service.job(f.owner, f.projectId)).phase, 'creating_site');
  await f.service.advance(f.owner, f.projectId);
  const deploy = f.provider.deploy;
  f.provider.deploy = async (...args) => {
    await deploy(...args);
    throw new Error('network lost');
  };
  await assert.rejects(f.service.advance(f.owner, f.projectId));
  await f.service.advance(f.owner, f.projectId);
  assert.equal(f.calls.filter((c) => c === 'site').length, 1);
  assert.equal(f.calls.filter((c) => c === 'deploy').length, 1);
});
test('async manifest is persisted even when later provider responses hide all required files', async () => {
  const f = fixture();
  await f.connect();
  await f.prepare({ files: [artifact(), artifact('copy.html'), artifact('a.png', Buffer.from([0, 255]))] });
  const deployment = f.provider.deployment;
  f.provider.deployment = async () => ({ ...(await deployment()), required: [] });
  let status;
  for (let i = 0; i < 12; i++) status = await f.service.advance(f.owner, f.projectId);
  assert.equal(status.phase, 'published');
  assert.equal(status.uploaded, status.fileCount);
  assert.equal(f.calls.filter((call) => Array.isArray(call)).length, 4); // duplicate content uploaded once
});
test('preparing response cannot initialize an empty upload queue', async () => {
  const f = fixture();
  await f.connect();
  await f.prepare();
  const deploy = f.provider.deploy,
    deployment = f.provider.deployment;
  f.provider.deploy = async (...args) => ({ ...(await deploy(...args)), state: 'preparing', required: [] });
  await f.service.advance(f.owner, f.projectId);
  await f.service.advance(f.owner, f.projectId);
  f.provider.deployment = async () => ({ ...(await deployment()), state: 'preparing', required: [] });
  await f.service.advance(f.owner, f.projectId);
  assert.equal((await f.store.get(f.owner, `project:${f.projectId}`)).job.pendingDigests, undefined);
  f.provider.deployment = deployment;
  let status;
  for (let i = 0; i < 7; i++) status = await f.service.advance(f.owner, f.projectId);
  assert.equal(status.phase, 'published');
});
test('lost upload response retries immutable PUT without duplicating deploy or skipping files', async () => {
  const f = fixture();
  await f.connect();
  await f.prepare();
  await f.service.advance(f.owner, f.projectId);
  await f.service.advance(f.owner, f.projectId);
  const upload = f.provider.upload;
  f.provider.upload = async (...args) => {
    await upload(...args);
    throw new Error('lost response');
  };
  await assert.rejects(f.service.advance(f.owner, f.projectId));
  assert.equal((await f.store.get(f.owner, `project:${f.projectId}`)).job.pendingDigests.length, 3);
  f.provider.upload = upload;
  const resumed = new PublishingService({ ...f.service, store: new PublishingStore(pool) });
  let status;
  for (let i = 0; i < 7; i++) status = await resumed.advance(f.owner, f.projectId);
  assert.equal(status.phase, 'published');
  assert.equal(f.calls.filter((call) => call === 'deploy').length, 1);
});
test('legacy partially uploaded jobs recover the full manifest on the same deployment', async () => {
  const f = fixture();
  await f.connect();
  await f.prepare();
  for (let i = 0; i < 3; i++) await f.service.advance(f.owner, f.projectId);
  await f.store.change(f.owner, `project:${f.projectId}`, (state) => {
    delete state.job.pendingDigests;
    state.job.phase = 'waiting';
    return state;
  });
  const deployment = f.provider.deployment;
  f.provider.deployment = async () => ({ ...(await deployment()), required: [] });
  let status;
  for (let i = 0; i < 7; i++) status = await f.service.advance(f.owner, f.projectId);
  assert.equal(status.phase, 'published');
  assert.equal(f.calls.filter((call) => call === 'deploy').length, 1);
});
test('ready is not public; a private/redirected response stays unverified', async () => {
  const f = fixture();
  await f.connect();
  await f.prepare();
  f.service.fetchImpl = async () => new Response('login', { status: 403 });
  let status;
  for (let i = 0; i < 9; i++) status = await f.service.advance(f.owner, f.projectId);
  assert.equal(status.phase, 'access_unverified');
  assert.equal(status.lastPublished, null);
  assert.equal(status.manageUrl, 'https://app.netlify.com/projects/site1/overview');
});
test('disconnect removes credential and prevents further upload, preserving site record', async () => {
  const f = fixture();
  await f.connect();
  await f.prepare();
  await f.service.advance(f.owner, f.projectId);
  await f.service.disconnect(f.owner);
  await assert.rejects(f.service.advance(f.owner, f.projectId), (e) => e.code === 'NOT_CONNECTED');
  assert.equal((await f.store.get(f.owner, `project:${f.projectId}`)).siteId, 'site1');
});
test('remote site transferred to another team fails closed', async () => {
  const f = fixture();
  await f.connect();
  await f.prepare();
  await f.service.advance(f.owner, f.projectId);
  f.provider.site = async () => ({ id: 'site1', account_id: 'other-team' });
  await assert.rejects(f.service.advance(f.owner, f.projectId), (e) => e.code === 'SITE_FORBIDDEN');
  assert.equal(f.calls.includes('deploy'), false);
});
test('provider sends native binary, disallows redirects and never relays upstream errors', async () => {
  let request;
  const provider = new NetlifyProvider(async (url, options) => {
    request = { url, ...options };
    return Response.json({});
  });
  await provider.upload('private-canary', 'deploy1', artifact('assets/image.png', Buffer.from([0, 255])));
  assert.equal(request.url, 'https://api.netlify.com/api/v1/deploys/deploy1/files/assets/image.png');
  assert.equal(request.redirect, 'error');
  assert.deepEqual(request.body, Buffer.from([0, 255]));
  const failed = new NetlifyProvider(async () => new Response('private-canary', { status: 401 }));
  await assert.rejects(
    failed.user('private-canary'),
    (e) => e instanceof PublishingError && !e.message.includes('canary'),
  );
  assert.throws(() => provider.site('token', '../user'));
});
test('gateway protects publishing with login, stale-tab identity, same-origin and a closed action schema', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-publishing-test-'));
  const owner = randomUUID();
  let called = 0;
  const config = configuration({
    JINGYUE_LOCAL_TEST: '1',
    JINGYUE_PUBLIC_ORIGIN: 'http://127.0.0.1',
    WORKBENCH_ACCESS_USER: 'test',
    WORKBENCH_ACCESS_PASSWORD: 'synthetic-password-for-tests',
    JINGYUE_AUTH_MODE: 'accounts',
  });
  const server = await createGateway({
    config,
    clientDirectory: directory,
    handler: () => new Response('unexpected'),
    accountStore: { authenticate: async (cookie) => (cookie === 'a'.repeat(43) ? { id: owner } : null) },
    publishingService: {
      status: async () => {
        called++;
        return { enabled: true };
      },
    },
  });
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/publishing`;
  const headers = {
    Cookie: `jingyue_session_test=${'a'.repeat(43)}`,
    'X-Jingyue-User': owner,
    Origin: config.origin,
    'Content-Type': 'application/json',
  };
  assert.equal((await fetch(url)).status, 401);
  assert.equal(
    (await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://other.invalid' }, body: '{}' })).status,
    403,
  );
  assert.equal((await fetch(url, { headers: { ...headers, 'X-Jingyue-User': randomUUID() } })).status, 409);
  assert.equal(
    (await fetch(url, { method: 'POST', headers, body: JSON.stringify({ action: 'status', token: 'injected' }) }))
      .status,
    400,
  );
  assert.equal((await fetch(url, { headers })).status, 200);
  assert.equal(called, 1);
});
