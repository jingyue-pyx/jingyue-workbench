import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  DEMO_DATABASE_HOST,
  approvedDatabaseAddress,
  privateDatabaseLookup,
  createPrivateDatabaseStream,
} from './private-database-network.mjs';
import { databaseOptions, createProjectStore } from './project-store.mjs';

const fixture = () => ({
  WORKBENCH_OWNER_ID: randomUUID(),
  JINGYUE_DATABASE_URL: `postgresql://fixture:fake-password@${DEMO_DATABASE_HOST}/jingyue`,
  JINGYUE_DEMO_PRIVATE_PLAINTEXT: '1',
  JINGYUE_DEMO_PRIVATE_HOST: DEMO_DATABASE_HOST,
});
const lookupResult = (records, options = {}) =>
  new Promise((resolve, reject) => {
    privateDatabaseLookup((_host, _options, callback) => callback(null, records))(
      DEMO_DATABASE_HOST,
      options,
      (error, address, family) => (error ? reject(error) : resolve({ address, family })),
    );
  });

test('plaintext requires explicit server flags and only the approved RDS host and port', () => {
  const env = fixture();
  const options = databaseOptions(env);
  assert.equal(options.pool.host, DEMO_DATABASE_HOST);
  assert.equal(options.pool.port, 5432);
  assert.equal(options.pool.ssl, false);
  assert.equal(typeof options.pool.stream, 'function');
  assert.equal(options.pool.max, 2);
  const socket = options.pool.stream();
  assert.equal(socket.connecting, false);
  socket.destroy();
  for (const patch of [
    { JINGYUE_DEMO_PRIVATE_PLAINTEXT: 'true' },
    { JINGYUE_DEMO_PRIVATE_PLAINTEXT: '' },
    { JINGYUE_DEMO_PRIVATE_PLAINTEXT: '0' },
    { JINGYUE_DEMO_PRIVATE_PLAINTEXT: undefined },
    { JINGYUE_DEMO_PRIVATE_HOST: undefined },
    { JINGYUE_DEMO_PRIVATE_HOST: 'different.rds.aliyuncs.com' },
    { JINGYUE_DATABASE_CA: 'fixture CA' },
    { JINGYUE_DATABASE_CA: '' },
    { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    { JINGYUE_DATABASE_URL: env.JINGYUE_DATABASE_URL.replace(DEMO_DATABASE_HOST, 'different.rds.aliyuncs.com') },
    { JINGYUE_DATABASE_URL: env.JINGYUE_DATABASE_URL.replace(DEMO_DATABASE_HOST, '172.26.0.10') },
    { JINGYUE_DATABASE_URL: env.JINGYUE_DATABASE_URL.replace(DEMO_DATABASE_HOST, DEMO_DATABASE_HOST + ':443') },
    { JINGYUE_DATABASE_URL: env.JINGYUE_DATABASE_URL + '?sslmode=disable' },
    { JINGYUE_DATABASE_URL: env.JINGYUE_DATABASE_URL + '#ssl=false' },
  ])
    assert.throws(
      () => databaseOptions({ ...env, ...patch }),
      (error) => error.code === 'PERSISTENCE_UNAVAILABLE',
    );
});

test('the approved demo hostname still requires verified TLS when both flags are absent', () => {
  const { JINGYUE_DEMO_PRIVATE_PLAINTEXT, JINGYUE_DEMO_PRIVATE_HOST, ...env } = fixture();
  for (const patch of [{}, { JINGYUE_DEMO_PRIVATE_PLAINTEXT: '0' }, { JINGYUE_DATABASE_CA: 'fixture CA' }]) {
    const { pool } = databaseOptions({ ...env, ...patch });
    assert.equal(pool.ssl.rejectUnauthorized, true);
    assert.equal(pool.stream, undefined);
  }
});

test('CIDR validation accepts only canonical IPv4 addresses in 172.26.0.0/20', () => {
  for (const address of ['172.26.0.0', '172.26.0.1', '172.26.9.4', '172.26.15.255'])
    assert.equal(approvedDatabaseAddress(address), true);
  for (const address of [
    '172.26.16.0',
    '172.27.0.1',
    '172.25.255.255',
    '127.0.0.1',
    '198.18.0.1',
    '8.8.8.8',
    '169.254.169.254',
    '::1',
    '::ffff:172.26.0.1',
    '172.26.00.1',
    '172.26.0.256',
    '172.26.1',
    '',
    null,
    1,
  ])
    assert.equal(approvedDatabaseAddress(address), false);
});

test('DNS socket lookup checks every answer and returns only that checked resolution', async () => {
  const records = [
    { address: '172.26.0.10', family: 4 },
    { address: '172.26.15.20', family: 4 },
  ];
  assert.deepEqual(await lookupResult(records), { address: '172.26.0.10', family: 4 });
  assert.deepEqual(await lookupResult(records, { all: true }), { address: records, family: undefined });
  for (const rejected of [
    [],
    null,
    [{ address: '172.26.0.10', family: 6 }],
    [{ address: '172.26.16.10', family: 4 }],
    [...records, { address: '8.8.8.8', family: 4 }],
    [...records, { address: '::ffff:172.26.0.10', family: 6 }],
    [null],
  ]) {
    await assert.rejects(lookupResult(rejected), { code: 'EPRIVATEADDRESS' });
  }
});

test('DNS failures and wrong host are asynchronous, sanitized and do not retry another destination', async () => {
  let calls = 0;
  for (const resolver of [
    (_host, _options, callback) => {
      calls++;
      callback(new Error('private fixture error must not escape'));
    },
    () => {
      calls++;
      throw new Error('private fixture error must not escape');
    },
  ]) {
    await assert.rejects(
      new Promise((resolve, reject) => {
        privateDatabaseLookup(resolver)(DEMO_DATABASE_HOST, {}, (error, address) =>
          error ? reject(error) : resolve(address),
        );
      }),
      (error) => error.code === 'EPRIVATEADDRESS' && !error.message.includes('fixture'),
    );
  }
  assert.equal(calls, 2);
  let callbackWasAsync = false;
  await new Promise((resolve) => {
    privateDatabaseLookup(() => {
      calls++;
    })('evil.example', {}, (error) => {
      assert.equal(callbackWasAsync, true);
      assert.equal(error.code, 'EPRIVATEADDRESS');
      resolve();
    });
    callbackWasAsync = true;
  });
  assert.equal(calls, 2);
});

test('pg socket pins destination, disables alternate address selection and resolves only once', async () => {
  let connectionOptions;
  let lookups = 0;
  const fakeSocket = {
    connect(options) {
      connectionOptions = options;
      return this;
    },
  };
  const socket = createPrivateDatabaseStream({
    createSocket: () => fakeSocket,
    resolver(host, options, callback) {
      lookups++;
      assert.equal(host, DEMO_DATABASE_HOST);
      assert.deepEqual(options, { all: true, verbatim: true });
      callback(null, [{ address: '172.26.2.30', family: 4 }]);
    },
  });
  assert.equal(socket.connect(5432, DEMO_DATABASE_HOST), socket);
  assert.equal(connectionOptions.host, DEMO_DATABASE_HOST);
  assert.equal(connectionOptions.port, 5432);
  assert.equal(connectionOptions.family, 4);
  assert.equal(connectionOptions.autoSelectFamily, false);
  const result = await new Promise((resolve, reject) =>
    connectionOptions.lookup(connectionOptions.host, {}, (error, address, family) =>
      error ? reject(error) : resolve({ address, family }),
    ),
  );
  assert.deepEqual(result, { address: '172.26.2.30', family: 4 });
  assert.equal(lookups, 1);
});

test('real Node sockets and pg driver reject out-of-subnet DNS without making a DB connection', async () => {
  for (const [port, host] of [
    [5433, DEMO_DATABASE_HOST],
    [5432, 'evil.example'],
    [5432, '172.26.2.30'],
  ]) {
    let lookups = 0;
    const socket = createPrivateDatabaseStream({
      resolver() {
        lookups++;
      },
    });
    const error = once(socket, 'error');
    socket.connect(port, host);
    assert.equal((await error)[0].code, 'EPRIVATEADDRESS');
    assert.equal(lookups, 0);
    assert.equal(socket.destroyed, true);
  }
  const { Client } = await import('pg');
  let lookups = 0;
  const client = new Client({
    ...databaseOptions(fixture()).pool,
    stream: () =>
      createPrivateDatabaseStream({
        resolver(_host, _options, callback) {
          lookups++;
          callback(null, [{ address: '127.0.0.1', family: 4 }]);
        },
      }),
  });
  await assert.rejects(client.connect(), { code: 'EPRIVATEADDRESS' });
  await client.end();
  assert.equal(lookups, 1);
});

test('demo pool is lazy and conflicting demo configuration leaves the application available', async () => {
  const logs = [];
  const store = await createProjectStore(fixture(), (event) => logs.push(event));
  assert.ok(store);
  assert.equal(store.pool.totalCount, 0);
  await store.close();
  assert.equal(
    await createProjectStore({ ...fixture(), JINGYUE_DATABASE_CA: 'fixture conflict' }, (event) => logs.push(event)),
    null,
  );
  assert.deepEqual(logs, ['project_database_configuration_unavailable']);
});
