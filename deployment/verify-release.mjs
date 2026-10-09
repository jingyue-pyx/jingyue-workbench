import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { inspectRelease } from './scan.mjs';
import { modelCatalog } from './security.mjs';
import { DEMO_DATABASE_HOST } from './private-database-network.mjs';

// `node` is classified as a bot by the app and awaits all SSR work. Real users
// take the streaming browser branch, so release checks must use a browser UA.
const browserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const fetch = (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('user-agent', browserAgent);
  return globalThis.fetch(input, { ...init, headers });
};

const directory = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass the generated release directory.');
const probe = createServer().listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const origin = `http://127.0.0.1:${port}`;
const username = 'release-smoke-only';
const password = 'not-a-real-password-smoke-only';
const fakeKey = 'not-a-real-model-key-smoke-only';
const fakeDatabasePassword = 'not-a-real-database-password-smoke-only';
const databaseCase = process.env.VERIFY_DATABASE_CASE || 'unconfigured';
const sourceRecoveryCase = process.env.VERIFY_SOURCE_RECOVERY === '1';
assert.ok(['unconfigured', 'demo-dns-denied', 'demo-config-conflict'].includes(databaseCase));
const runtimeNode = execFileSync(process.env.VERIFY_NODE_BINARY || process.execPath, ['--version'], {
  encoding: 'utf8',
}).trim();
const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
const preload = fileURLToPath(new URL('./mock-model-preload.mjs', import.meta.url));
const child = spawn(process.env.VERIFY_NODE_BINARY || process.execPath, ['--import', preload, 'server.mjs'], {
  cwd: directory,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    JINGYUE_LOCAL_TEST: '1',
    JINGYUE_PUBLIC_ORIGIN: origin,
    PORT: String(port),
    HOST: '127.0.0.1',
    WORKBENCH_ACCESS_USER: username,
    WORKBENCH_ACCESS_PASSWORD: password,
    DASHSCOPE_API_KEY: fakeKey,
    ...(databaseCase === 'unconfigured'
      ? {}
      : {
          VERIFY_DATABASE_CASE: databaseCase,
          WORKBENCH_OWNER_ID: '99193743-e6b3-4565-8339-65c7f478122b',
          JINGYUE_DATABASE_URL: `postgresql://fixture:${fakeDatabasePassword}@${DEMO_DATABASE_HOST}/jingyue`,
          JINGYUE_DEMO_PRIVATE_PLAINTEXT: '1',
          JINGYUE_DEMO_PRIVATE_HOST: DEMO_DATABASE_HOST,
          ...(databaseCase === 'demo-config-conflict' ? { JINGYUE_DATABASE_CA: 'fixture-conflicting-CA' } : {}),
        }),
  },
});
let logs = '';
const modelEvents = [];
child.on('message', (event) => modelEvents.push(event));
child.stdout.on('data', (data) => {
  logs += data;
});
child.stderr.on('data', (data) => {
  logs += data;
});
let checks = 0;
try {
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Release startup timed out.')), 15000);
    const check = () => {
      if (logs.includes('private_preview_ready')) {
        clearTimeout(timer);
        resolveReady();
      }
    };
    child.stderr.on('data', check);
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Release process exited before readiness: ' + logs.slice(0, 1200)));
    });
  });
  for (const path of ['/', '/api/models', '/api/chat', '/api/projects']) {
    assert.equal((await fetch(origin + path)).status, 401);
    checks++;
  }
  const root = await fetch(origin + '/', { headers: { authorization: auth } });
  assert.equal(root.status, 200);
  const html = await root.text();
  assert.ok(html.includes('<html'));
  assert.ok(!html.includes(fakeKey) && !html.includes(password));
  assert.equal(root.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(root.headers.get('cross-origin-embedder-policy'), 'require-corp');
  assert.equal(root.headers.get('referrer-policy'), 'strict-origin');
  checks++;
  const storageUnavailable = await fetch(origin + '/api/projects', { headers: { authorization: auth } });
  assert.equal(storageUnavailable.status, 503);
  assert.equal(storageUnavailable.headers.get('retry-after'), '5');
  assert.equal((await storageUnavailable.json()).error.code, 'PERSISTENCE_UNAVAILABLE');
  checks++;
  if (databaseCase !== 'unconfigured') {
    const deadline = Date.now() + 1000;
    while (
      databaseCase === 'demo-dns-denied' &&
      !modelEvents.some((e) => e.event === 'mock_database_dns_denied') &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 10));
    const dnsEvents = modelEvents.filter((event) => event.event === 'mock_database_dns');
    if (databaseCase === 'demo-dns-denied') {
      assert.equal(dnsEvents.length, 1);
      assert.equal(dnsEvents[0].all, true);
      assert.ok(modelEvents.some((e) => e.event === 'mock_database_dns_denied' && e.denied));
      assert.ok(!modelEvents.some((e) => e.event === 'mock_database_guard_missing'));
    } else {
      assert.equal(dnsEvents.length, 0);
      assert.ok(logs.includes('project_database_configuration_unavailable'));
    }
    checks++;
  }
  const assets = [
    ...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g)].map((match) => match[1])),
  ];
  assert.ok(assets.some((asset) => asset.endsWith('.js')) && assets.some((asset) => asset.endsWith('.css')));
  for (const path of assets.slice(0, 8)) {
    const response = await fetch(origin + path, { headers: { authorization: auth } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin');
    assert.ok((await response.arrayBuffer()).byteLength > 0);
    checks++;
  }
  const keyStatus = await fetch(origin + '/api/check-env-key?provider=Bailian', { headers: { authorization: auth } });
  assert.deepEqual(await keyStatus.json(), { isSet: true });
  checks++;
  for (const path of ['/api/models', '/api/models/Bailian']) {
    const catalog = await fetch(origin + path, { headers: { authorization: auth } });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.headers.get('referrer-policy'), 'strict-origin');
    assert.match(catalog.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await catalog.json(), modelCatalog());
    checks++;
  }
  const manifestJson = html.match(/window\.__remixManifest\s*=\s*([\s\S]*?);/);
  assert.ok(manifestJson, 'SSR must provide a route manifest');
  const manifestVersion = JSON.parse(manifestJson[1]).version;
  const manifestPath = `/__manifest?version=${encodeURIComponent(manifestVersion)}&p=%2Fchat%2Ffixture`;
  const staleManifest = await fetch(origin + '/__manifest?version=stale-fixture&p=%2Fchat%2Ffixture', {
    headers: { authorization: auth },
  });
  assert.equal(staleManifest.status, 204);
  assert.equal(staleManifest.headers.get('x-remix-reload-document'), 'true');
  checks++;
  const navigationData = await fetch(origin + '/chat/fixture?_data=routes%2Fchat.%24id', {
    headers: { authorization: auth },
  });
  assert.equal(navigationData.status, 200);
  assert.deepEqual(await navigationData.json(), { id: 'fixture' });
  checks++;
  const assertPageResource = async (index) => {
    const path = ['/api/models', '/api/models/Bailian', manifestPath, assets[0]][index % 4];
    const result = await fetch(origin + path, { headers: { authorization: auth } });
    assert.equal(result.status, 200, `Concurrent resource failed: ${path.split('?')[0]}`);
    assert.equal(result.headers.get('referrer-policy'), 'strict-origin');
    if (path.startsWith('/api/models')) assert.deepEqual(await result.json(), modelCatalog());
    else if (path.startsWith('/__manifest')) assert.ok((await result.json())['routes/chat.$id']);
    else assert.ok((await result.arrayBuffer()).byteLength > 0);
  };
  await Promise.all(Array.from({ length: 20 }, (_, index) => assertPageResource(index)));
  checks += 20;
  // Exercise browser-style navigation cancellations without any model request.
  await Promise.all(
    Array.from({ length: 20 }, async (_, index) => {
      const stop = new AbortController();
      const pending = fetch(origin + '/chat/cancel-fixture', { headers: { authorization: auth }, signal: stop.signal });
      const timer = setTimeout(() => stop.abort(), index % 4);
      try {
        const response = await pending;
        await response.arrayBuffer();
      } catch (error) {
        if (error.name !== 'AbortError') throw error;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  await Promise.all(Array.from({ length: 20 }, (_, index) => assertPageResource(index)));
  checks += 20;
  for (const path of [
    '/api/export-api-keys',
    '/API/EXPORT-API-KEYS',
    '/api/%65xport-api-keys',
    '/?_data=routes%2Fapi.export-api-keys',
  ]) {
    assert.equal((await fetch(origin + path, { headers: { authorization: auth } })).status, 404);
    checks++;
  }
  // Exercise the actual packaged Remix route and AI SDK, but replace the final
  // network transport before import so there is no real API call or spending.
  for (const content of [
    [],
    [
      { type: 'text', text: 'Hello' },
      { type: 'image', image: 'https://example.test/image.png' },
    ],
    [{ type: 'tool-call', toolName: 'fixture' }],
    [{ type: 'text', text: '[Model: other]\n\nHello' }],
    [{ type: 'text', text: '[Model: qwen-plus]\n\n[Provider: OpenAI]\n\nHello' }],
  ]) {
    const rejected = await fetch(origin + '/api/chat', {
      method: 'POST',
      headers: { authorization: auth, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content }], files: {}, contextOptimization: false }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(modelEvents.filter((event) => event.event === 'mock_model_call').length, 0);
    await rejected.arrayBuffer();
    checks++;
  }
  const failedCallsBefore = modelEvents.filter((event) => event.event === 'mock_model_call').length;
  const managedFailure = await fetch(origin + '/api/chat', {
    method: 'POST',
    headers: { authorization: auth, origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      managedPhase: 'intent',
      contextOptimization: false,
      messages: [
        { role: 'user', content: '[Model: qwen3-coder-next]\n\n[Provider: Bailian]\n\nfixture-provider-unavailable' },
      ],
    }),
  });
  const failedBody = await managedFailure.text();
  assert.ok(failedBody.includes('JINGYUE_MODEL_UNAVAILABLE'));
  assert.ok(!failedBody.includes('private-provider-canary'));
  assert.equal(modelEvents.filter((event) => event.event === 'mock_model_call').length - failedCallsBefore, 1);
  assert.ok(logs.includes('managed_model_intent_JINGYUE_MODEL_UNAVAILABLE'));
  assert.ok(!logs.includes('private-provider-canary'));
  checks += 5;
  // Separate fresh-process pass: do not exhaust or weaken the real 10/min gateway limit.
  for (const { mode, single } of sourceRecoveryCase ? [{ mode: 'source', single: true }] : [
    { mode: 'content', single: false }, { mode: 'edits', single: false },
    { mode: 'content', single: true }, { mode: 'edits', single: true },
  ]) {
    const modelCount = modelEvents.filter((event) => event.event === 'mock_model_call').length;
    const output = await fetch(origin + '/api/chat', {
      method: 'POST',
      headers: { authorization: auth, origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        managedPhase: 'generate', managedFileOutput: mode, managedSingleFile: single, managedBatchMode: 'file', contextOptimization: false,
        messages: [{ role: 'user', content: '[Model: qwen3-coder-next]\n\n[Provider: Bailian]\n\nfixture-file-output-contract' }],
      }),
    });
    assert.equal(output.status, 200);
    assert.ok((await output.text()).includes('stop'));
    assert.equal(modelEvents.filter((event) => event.event === 'mock_model_call').length - modelCount, 1);
    const contract = modelEvents.filter((event) => event.event === 'mock_file_output_contract').at(-1);
    assert.ok(contract?.guardsPresent);
    assert.equal(contract.complete, mode === 'content');
    assert.equal(contract.edits, mode === 'edits');
    assert.equal(contract.contradictoryEditExample, mode === 'edits');
    assert.equal(contract.single, single && mode !== 'source');
    assert.equal(contract.filesExample, !single);
    assert.equal(contract.source, mode === 'source');
    assert.equal(contract.contradictoryJson, mode !== 'source');
    checks += 11;
  }
  for (const invalid of sourceRecoveryCase ? [
    { managedPhase: 'generate', managedFileOutput: 'source' },
    { managedPhase: 'generate', managedFileOutput: 'source', managedSingleFile: false },
    { managedPhase: 'plan', managedFileOutput: 'source', managedSingleFile: true },
  ] : [
    { managedPhase: 'generate', managedFileOutput: 'content', managedSingleFile: 'true' },
    { managedPhase: 'intent', managedFileOutput: 'content', managedSingleFile: true },
    { managedPhase: 'generate', managedSingleFile: true },
  ]) {
    const response = await fetch(origin + '/api/chat', {
      method: 'POST', headers: { authorization: auth, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ ...invalid, messages: [{ role: 'user', content: '[Model: qwen3-coder-next]\n\n[Provider: Bailian]\n\nfixture' }] }),
    });
    assert.equal(response.status, 400);
    await response.arrayBuffer();
    checks++;
  }
  const invalidMode = await fetch(origin + '/api/chat', {
    method: 'POST', headers: { authorization: auth, origin, 'content-type': 'application/json' },
    body: JSON.stringify({ managedPhase: 'generate', managedFileOutput: ['content'], messages: [{ role: 'user', content: '[Model: qwen3-coder-next]\n\n[Provider: Bailian]\n\nfixture' }] }),
  });
  assert.equal(invalidMode.status, 400);
  await invalidMode.arrayBuffer();
  checks++;
  const stop = new AbortController();
  const response = await fetch(origin + '/api/chat', {
    method: 'POST',
    signal: stop.signal,
    headers: { authorization: auth, origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          id: 'fixture',
          role: 'user',
          content: [
            { type: 'text', text: '[Model: qwen3-coder-next]\n\n[Provider: Bailian]\n\nReply with a short greeting.' },
          ],
        },
      ],
      files: {},
      contextOptimization: false,
    }),
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  let streamed = '';
  const timeout = setTimeout(() => stop.abort(), 5000);
  try {
    while (!streamed.includes('Mock model stream reached the real app.')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      streamed += new TextDecoder().decode(chunk.value);
    }
    assert.ok(streamed.includes('Mock model stream reached the real app.'));
    stop.abort();
    const deadline = Date.now() + 1500;
    while (!modelEvents.some((e) => e.event === 'mock_model_cancelled') && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 20));
    assert.ok(modelEvents.some((e) => e.event === 'mock_model_call' && e.allowed && e.authenticated && e.cancellable));
    assert.ok(modelEvents.some((e) => e.event === 'mock_model_cancelled'));
    const health = await fetch(origin + '/healthz');
    assert.deepEqual(await health.json(), { status: 'ok' });
    const release = JSON.parse(await readFile(resolve(directory, 'release.json'), 'utf8'));
    assert.match(release.releaseId, /^[a-f0-9]{64}$/);
    assert.equal(health.headers.get('x-jingyue-release'), release.releaseId);
    const head = await fetch(origin + '/healthz', { method: 'HEAD', redirect: 'manual' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('x-jingyue-release'), release.releaseId);
    assert.equal(await head.text(), '');
    assert.equal((await fetch(origin + '/api/models/Bailian', { headers: { authorization: auth } })).status, 200);
    checks += 10;
  } finally {
    clearTimeout(timeout);
    stop.abort();
  }
  assert.ok(!logs.includes(fakeKey) && !logs.includes(password) && !logs.includes(fakeDatabasePassword));
  checks++;
  const inspection = await inspectRelease(directory);
  if (child.exitCode !== null || child.signalCode !== null) {
    const diagnostic = logs
      .split('\n')
      .filter((line) => /Error|DOMException|Abort/.test(line))
      .slice(-8)
      .join('\n');
    throw new Error('Packaged server exited after cancellation: ' + diagnostic);
  }
  // Minimal Node Linux images need not ship procps; /proc is authoritative there.
  const rssKiB =
    process.platform === 'linux'
      ? Number((await readFile(`/proc/${child.pid}/status`, 'utf8')).match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1])
      : Number(execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(child.pid)], { encoding: 'utf8' }).trim());
  assert.ok(Number.isFinite(rssKiB) && rssKiB > 0, 'Packaged process RSS must be observable');
  const rssMiB = rssKiB / 1024;
  process.stdout.write(
    JSON.stringify({
      ok: true,
      checks,
      staticAssetsFound: assets.length,
      ...inspection,
      actualModelCalls: 0,
      actualDatabaseCalls: 0,
      databaseCase,
      mockModelCalls: modelEvents.filter((e) => e.event === 'mock_model_call').length,
      upstreamCancellationVerified: true,
      sampledRssMiB: Math.round(rssMiB),
      hostPlatform: process.platform,
      runtimeNode,
      linuxVerified: process.platform === 'linux',
    }) + '\n',
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited.catch(() => {});
  }
}
