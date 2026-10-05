// Explicit, opt-in integration check. Creates ONE isolated synthetic Supabase
// Auth user and deletes that exact user on completion. Never emits credentials.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { parse } from 'dotenv';
import { PGlite } from '@electric-sql/pglite';
import { AppAuthService, createSupabaseAppAuth } from './app-auth.mjs';

if (process.env.JINGYUE_RUN_AUTH_LIVE !== '1') throw new Error('Live check requires explicit opt-in.');
const env = {
  ...parse(await readFile(new URL('../.supabase.local.env', import.meta.url), 'utf8')),
  JINGYUE_APP_AUTH_ENABLED: '1',
};
const db = await PGlite.create();
let userId;
try {
  for (const file of ['001-projects.sql', '006-app-auth.sql'])
    await db.exec(await readFile(new URL(`./sql/${file}`, import.meta.url), 'utf8'));
  const pool = {
    query: (s, a) => db.query(s, a),
    connect: async () => ({ query: (s, a) => db.query(s, a), release() {} }),
  };
  const owner = randomUUID(),
    project = randomUUID();
  await pool.query('INSERT INTO jingyue.projects(owner_id,id,revision,document,byte_count) VALUES($1,$2,1,$3,2)', [
    owner,
    project,
    {},
  ]);
  const provider = createSupabaseAppAuth(env);
  const service = new AppAuthService(pool, provider);
  const input = {
    username: 'live_acceptance',
    password: randomBytes(24).toString('base64url'),
    displayName: '隔离认证验收',
  };
  const registered = await service.execute(owner, project, { action: 'register', ...input });
  userId = registered.user.id;
  assert.equal((await service.execute(owner, project, { action: 'session' }, registered.token)).user.id, userId);
  await assert.rejects(
    service.execute(owner, project, { action: 'register', ...input }),
    (e) => e.code === 'APP_AUTH_EXISTS',
  );
  await assert.rejects(
    service.execute(owner, project, {
      action: 'login',
      username: input.username,
      password: randomBytes(24).toString('base64url'),
    }),
    (e) => e.code === 'APP_AUTH_CREDENTIALS',
  );
  await service.execute(owner, project, { action: 'logout' }, registered.token);
  assert.equal((await service.execute(owner, project, { action: 'session' }, registered.token)).user, null);
  const login = await service.execute(owner, project, {
    action: 'login',
    username: input.username,
    password: input.password,
  });
  assert.equal(login.user.id, userId);
  const restarted = new AppAuthService(pool, createSupabaseAppAuth(env));
  assert.equal((await restarted.execute(owner, project, { action: 'session' }, login.token)).user.id, userId);
  assert.equal((await restarted.execute(owner, randomUUID(), { action: 'session' }, login.token)).user, null);
  await restarted.execute(owner, project, { action: 'logout' }, login.token);
  console.log(
    JSON.stringify({
      realSupabaseAuth: true,
      registration: true,
      duplicateRejected: true,
      wrongPasswordRejected: true,
      reloginSameIdentity: true,
      sessionRestore: true,
      logoutRevoked: true,
      projectIsolation: true,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      liveAuthPassed: false,
      code: error.code || 'CHECK_FAILED',
      message: error.code?.startsWith('APP_AUTH_') ? error.message : 'Live authentication check failed.',
    }),
  );
  process.exitCode = 1;
} finally {
  if (userId) {
    const secret = env.JINGYUE_SUPABASE_SERVICE_KEY;
    const response = await fetch(`${env.JINGYUE_SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      headers: { apikey: secret, ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}) },
    });
    console.log(JSON.stringify({ syntheticUserRemoved: response.ok }));
    if (!response.ok) process.exitCode = 1;
  }
  await db.close();
}
