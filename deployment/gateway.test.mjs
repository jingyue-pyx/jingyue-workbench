import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createGateway, failureDetails } from './gateway.mjs';
import { configuration, modelCatalog } from './security.mjs';
import { createModelNetwork } from './network.mjs';
import { hasCredentialLiteral, inspectRelease } from './scan.mjs';

const user = 'test-only-user';
const password = 'test-only-not-a-real-access-password';
const auth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
const fakeKey = 'fake-model-key-not-real';
const chatBody = {
  messages: [{ role: 'user', content: '[Model: qwen3-coder-next]\n\n[Provider: Bailian]\n\nHello' }],
  contextOptimization: false,
};

test('failure diagnostics expose only finite labels, never upstream error text or credentials', () => {
  const error = Object.assign(new TypeError('credential-canary'), {
    code: 'ERR_INVALID_STATE',
    stack: 'credential-canary',
    headers: { authorization: 'credential-canary' },
  });
  assert.deepEqual(failureDetails(error), { errorType: 'TypeError', errorCode: 'ERR_INVALID_STATE' });
  assert.deepEqual(failureDetails({ name: 'credential-canary', code: 'credential-canary' }), {
    errorType: 'Other',
    errorCode: 'OTHER',
  });
  assert.deepEqual(failureDetails(null), { errorType: 'Other', errorCode: 'OTHER' });
  assert.deepEqual(
    failureDetails({
      get name() {
        throw error;
      },
    }),
    { errorType: 'Other', errorCode: 'OTHER' },
  );
});

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-gateway-test-'));
  await writeFile(join(directory, 'asset.js'), 'window.fixture = true;');
  let received;
  const config = configuration({
    JINGYUE_PUBLIC_ORIGIN: 'http://127.0.0.1',
    JINGYUE_LOCAL_TEST: '1',
    WORKBENCH_ACCESS_USER: user,
    WORKBENCH_ACCESS_PASSWORD: password,
    DASHSCOPE_API_KEY: fakeKey,
  });
  const server = await createGateway({
    config,
    clientDirectory: directory,
    handler: async (request, context) => {
      received = {
        cookie: request.headers.get('cookie'),
        authorization: request.headers.get('authorization'),
        environmentNames: Object.keys(context.cloudflare.env),
        body: request.method === 'POST' ? await request.json() : null,
      };
      return new Response('<html>SSR fixture</html>', {
        headers: {
          'Content-Type': 'text/html',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp',
        },
      });
    },
    ...options,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, config, origin: config.origin, received: () => received };
}

test('gateway authenticates every surface except minimal health status', async (t) => {
  const { origin } = await fixture(t);
  for (const path of ['/', '/asset.js', '/api/models', '/api/chat', '/api/export-api-keys']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /^Basic /);
  }
  const health = await fetch(origin + '/healthz');
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal((await fetch(origin + '/', { headers: { authorization: 'Basic d3Jvbmc6d3Jvbmc=' } })).status, 401);
});

test('release provenance is a safe digest header, never arbitrary configuration', async (t) => {
  const valid = await fixture(t, { releaseId: 'a'.repeat(64) });
  const response = await fetch(valid.origin + '/healthz');
  assert.equal(response.headers.get('x-jingyue-release'), 'a'.repeat(64));
  assert.deepEqual(await response.json(), { status: 'ok' });
  const invalid = await fixture(t, { releaseId: 'private-canary' });
  assert.equal((await fetch(invalid.origin + '/healthz')).headers.get('x-jingyue-release'), null);
});

test('template and chat entry share server model status without exposing the key', async (t) => {
  const { origin, received } = await fixture(t);
  for (const referer of ['/', '/git?url=https://github.com/example/template.git', '/chat/example']) {
    const response = await fetch(origin + '/api/check-env-key?provider=Bailian', {
      headers: { authorization: auth, referer: origin + referer },
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { isSet: true });
    assert.ok(!body.includes(fakeKey));
  }
  assert.equal((await fetch(origin + '/api/check-env-key?provider=Bailian')).status, 401);
  assert.equal(received(), undefined);
});

test('legacy connector, publishing and git proxy APIs remain unavailable without widening access', async (t) => {
  const { origin, received } = await fixture(t);
  for (const path of ['/api/supabase', '/api/supabase/variables', '/api/netlify-deploy', '/api/vercel-deploy', '/api/git-proxy', '/api/system/diagnostics']) {
    const response = await fetch(origin + path, { headers: { authorization: auth } });
    assert.equal(response.status, 404, path);
  }
  assert.equal(received(), undefined);
});

test('runtime events require authentication and same origin, contain finite labels only, and do not call the model', async (t) => {
  const events = [];
  const { origin, received } = await fixture(t, { report: (event) => events.push(event) });
  const data = { outcome: 'failed', stage: 'planning', reason: 'plan_format', attempt: 0 };
  const request = (body, overrides = {}) =>
    fetch(origin + '/api/runtime-events', {
      method: 'POST',
      headers: { authorization: auth, origin, 'content-type': 'application/json', ...overrides },
      body: JSON.stringify(body),
    });
  assert.equal((await request(data, { authorization: '' })).status, 401);
  assert.equal((await request(data, { origin: 'https://other.test' })).status, 403);
  assert.equal((await fetch(origin + '/api/runtime-events', { headers: { authorization: auth } })).status, 405);
  assert.equal((await request(data)).status, 200);
  assert.deepEqual(events, ['client_runtime_failed_planning_plan_format_repair_0']);
  assert.equal(received(), undefined);
  for (const body of [
    { ...data, message: 'credential-canary' },
    { ...data, stage: 'credential-canary' },
    { ...data, attempt: 3 },
    { ...data, reason: 'credential-canary' },
  ])
    assert.equal((await request(body)).status, 400);
  assert.equal((await request({ ...data, message: 'x'.repeat(1024) })).status, 413);
  assert.deepEqual(events, ['client_runtime_failed_planning_plan_format_repair_0']);
});

test('runtime event ingestion has an independent bounded rate limit', async (t) => {
  const { origin } = await fixture(t);
  const send = () =>
    fetch(origin + '/api/runtime-events', {
      method: 'POST',
      headers: { authorization: auth, origin, 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: 'cancelled', stage: 'planning', reason: 'none', attempt: 0 }),
    });
  for (let i = 0; i < 30; i++) assert.equal((await send()).status, 200);
  assert.equal((await send()).status, 429);
});

test('SSR, static assets, model catalog and isolation headers work after authentication', async (t) => {
  const { origin } = await fixture(t);
  for (const path of ['/', '/chat/1', '/asset.js', '/api/models/Bailian']) {
    const response = await fetch(origin + path, { headers: { authorization: auth } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
  }
  const asset = await fetch(origin + '/asset.js', { headers: { authorization: auth } });
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await asset.text(), 'window.fixture = true;');
  const head = await fetch(origin + '/asset.js', { method: 'HEAD', headers: { authorization: auth } });
  assert.equal(await head.text(), '');
});

test('only authenticated fingerprinted build assets are privately cached; HTML and APIs never are', async (t) => {
  const { directory, origin } = await fixture(t);
  await mkdir(join(directory, 'assets'));
  for (const name of ['entry-aB12cd34.js', 'style-aB12cd34.css', 'entry.js', 'entry-aB12cd34.js.map', 'data-aB12cd34.json']) {
    await writeFile(join(directory, 'assets', name), 'test fixture');
  }
  for (const name of ['entry-aB12cd34.js', 'style-aB12cd34.css']) {
    const url = origin + '/assets/' + name;
    const denied = await fetch(url);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('cache-control'), 'private, no-store');
    for (const method of ['GET', 'HEAD']) {
      const allowed = await fetch(url, { method, headers: { authorization: auth } });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get('cache-control'), 'private, max-age=31536000, immutable');
      assert.equal(allowed.headers.get('cross-origin-embedder-policy'), 'require-corp');
      await allowed.arrayBuffer();
    }
  }
  for (const path of ['/', '/chat/test', '/api/models', '/assets/entry.js', '/assets/entry-aB12cd34.js.map', '/assets/data-aB12cd34.json']) {
    const response = await fetch(origin + path, { headers: { authorization: auth } });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    await response.arrayBuffer();
  }
});

test('origin-only referrer policy covers all surfaces and overrides upstream disclosure policies', async (t) => {
  const { origin } = await fixture(t, {
    handler: async () => new Response('<html>fixture</html>', { headers: { 'Referrer-Policy': 'unsafe-url' } }),
  });
  for (const [path, authenticatedRequest, status] of [
    ['/', true, 200],
    ['/chat/private-project?private-query=fixture', true, 200],
    ['/asset.js', true, 200],
    ['/api/models', true, 200],
    ['/api/models/Bailian', true, 200],
    ['/api/export-api-keys', true, 404],
    ['/healthz', false, 200],
    ['/', false, 401],
  ]) {
    const response = await fetch(origin + path, { headers: authenticatedRequest ? { authorization: auth } : {} });
    assert.equal(response.status, status);
    // Exact equality also rejects duplicate/comma-joined upstream policies.
    assert.equal(response.headers.get('referrer-policy'), 'strict-origin');
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(response.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    await response.arrayBuffer();
  }
});

test('model catalog contract is exact and stable for both routes under 20 concurrent requests', async (t) => {
  let handlerCalls = 0;
  const { origin } = await fixture(t, {
    handler: async () => {
      handlerCalls++;
      throw new Error('Catalog must not call Remix or providers');
    },
  });
  await Promise.all(
    Array.from({ length: 20 }, async (_, index) => {
      const path = index % 2 === 0 ? '/api/models' : '/api/models/Bailian';
      const response = await fetch(origin + path, { headers: { authorization: auth } });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^application\/json/);
      const value = await response.json();
      assert.deepEqual(value, modelCatalog());
      assert.ok(Array.isArray(value.modelList) && value.modelList.length === 2);
      assert.ok(value.modelList.every((model) => typeof model.name === 'string' && model.provider === 'Bailian'));
    }),
  );
  assert.equal(handlerCalls, 0);
  const rejected = await fetch(origin + '/api/models');
  assert.equal(rejected.status, 401);
  assert.equal('modelList' in (await rejected.json()), false);
});

test('model catalog and assets remain available while chat concurrency is full and one caller disconnects', async (t) => {
  let entered = 0;
  let cancelled = 0;
  const { origin } = await fixture(t, {
    handler: async (request) => {
      entered++;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('stream-start'));
            request.signal.addEventListener(
              'abort',
              () => {
                cancelled++;
                controller.error(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            );
          },
        }),
      );
    },
  });
  const stops = [new AbortController(), new AbortController(), new AbortController()];
  t.after(() => stops.forEach((stop) => stop.abort()));
  const post = (stop) =>
    fetch(origin + '/api/chat', {
      method: 'POST',
      signal: stop.signal,
      headers: { authorization: auth, origin, 'content-type': 'application/json' },
      body: JSON.stringify(chatBody),
    });
  const first = await post(stops[0]);
  const second = await post(stops[1]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await post(stops[2])).status, 429);
  await Promise.all(
    Array.from({ length: 20 }, async (_, index) => {
      const response = await fetch(origin + (index % 2 ? '/api/models' : '/asset.js'), {
        headers: { authorization: auth },
      });
      assert.equal(response.status, 200);
      if (index % 2) assert.deepEqual(await response.json(), modelCatalog());
      else assert.equal(await response.text(), 'window.fixture = true;');
    }),
  );
  stops[0].abort();
  const deadline = Date.now() + 1000;
  while (!cancelled && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(cancelled, 1);
  assert.equal((await post(stops[2])).status, 200);
  assert.equal(entered, 3);
});

test('export and bypass variants stay blocked, cross-origin and oversize writes are rejected', async (t) => {
  const { origin, received } = await fixture(t);
  for (const path of [
    '/api/export-api-keys',
    '/API/EXPORT-API-KEYS',
    '/api/%65xport-api-keys',
    '/api/export-api-keys/',
    '/api/llmcall',
    '/?_data=routes%2Fapi.export-api-keys',
    '/api/git-proxy/github.com',
    '/api/system/diagnostics',
  ]) {
    assert.equal((await fetch(origin + path, { headers: { authorization: auth } })).status, 404);
  }
  const post = (extra, body = JSON.stringify(chatBody)) =>
    fetch(origin + '/api/chat', {
      method: 'POST',
      headers: { authorization: auth, 'content-type': 'application/json', ...extra },
      body,
    });
  assert.equal((await post({ origin: 'https://other.example' })).status, 403);
  assert.equal((await post({ origin })).status, 200);
  assert.equal((await post({ origin }, 'x'.repeat(4 * 1024 * 1024 + 1))).status, 413);
  assert.equal((await post({ origin }, 'invalid-json')).status, 400);
  assert.equal(received().authorization, null);
});

test('provider/key cookies and connector payloads never reach the Remix handler', async (t) => {
  const { origin, received } = await fixture(t);
  const body = {
    ...chatBody,
    apiKeys: { Bailian: 'client-key' },
    providerSettings: { Bailian: { baseUrl: 'https://other.example' } },
    supabase: { credentials: { anonKey: 'client-connector-key' } },
  };
  const response = await fetch(origin + '/api/chat', {
    method: 'POST',
    headers: {
      authorization: auth,
      origin,
      'content-type': 'application/json',
      cookie: 'apiKeys=client-key; providers=malicious',
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  assert.equal(received().cookie, null);
  assert.equal(received().body.apiKeys, undefined);
  assert.equal(received().body.providerSettings, undefined);
  assert.equal(received().body.supabase, undefined);
  assert.deepEqual(received().environmentNames.sort(), ['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL']);
});

test('real UI text-part requests reach Remix as strings while invalid part shapes fail before the handler', async (t) => {
  const { origin, received } = await fixture(t);
  const content = chatBody.messages[0].content;
  const post = (parts) =>
    fetch(origin + '/api/chat', {
      method: 'POST',
      headers: { authorization: auth, origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        ...chatBody,
        messages: [{ id: 'ui-append', role: 'user', content: parts }],
        apiKeys: { Bailian: 'client-key' },
        providerSettings: { Bailian: { baseUrl: 'https://example.test' } },
      }),
    });
  assert.equal((await post([{ type: 'text', text: content }])).status, 200);
  const forwarded = received();
  assert.deepEqual(forwarded.body.messages, [{ id: 'ui-append', role: 'user', content }]);
  assert.equal(forwarded.body.apiKeys, undefined);
  assert.equal(forwarded.body.providerSettings, undefined);
  for (const parts of [
    [],
    [{ type: 'image', image: 'https://example.test/fixture' }],
    [{ type: 'tool-call', toolName: 'fixture' }],
    [{ type: 'text', text: '[Model: other]\n\nHello' }],
    [{ type: 'text', text: '[Provider: OpenAI]\n\nHello' }],
  ]) {
    assert.equal((await post(parts)).status, 400);
    assert.equal(received(), forwarded);
  }
});

test('real HTTP disconnect aborts the scoped upstream fetch without waiting for stream completion', async (t) => {
  let aborted;
  let resolveAbort;
  const cancellation = new Promise((resolve) => {
    resolveAbort = resolve;
  });
  const config = configuration({
    JINGYUE_PUBLIC_ORIGIN: 'http://127.0.0.1',
    JINGYUE_LOCAL_TEST: '1',
    WORKBENCH_ACCESS_USER: user,
    WORKBENCH_ACCESS_PASSWORD: password,
    DASHSCOPE_API_KEY: fakeKey,
  });
  const network = createModelNetwork(config, async (_url, options) => {
    assert.equal(options.headers.get('Authorization'), `Bearer ${fakeKey}`);
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first-chunk'));
          options.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              controller.error(new DOMException('Aborted', 'AbortError'));
              resolveAbort();
            },
            { once: true },
          );
        },
      }),
    );
  });
  const { origin } = await fixture(t, {
    requestScope: network.run,
    handler: () =>
      network.fetch(config.modelEnv.DASHSCOPE_BASE_URL + '/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'qwen3-coder-next' }),
      }),
  });
  const stop = new AbortController();
  const response = await fetch(origin + '/api/chat', {
    method: 'POST',
    signal: stop.signal,
    headers: { authorization: auth, origin, 'content-type': 'application/json' },
    body: JSON.stringify(chatBody),
  });
  assert.equal(response.headers.get('transfer-encoding'), 'chunked');
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first-chunk');
  assert.equal(aborted, undefined);
  stop.abort();
  await Promise.race([
    cancellation,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Cancellation not propagated')), 1500)),
  ]);
  assert.equal(aborted, true);
});

test('network boundary rejects other hosts, models and calls without request context', async () => {
  let calls = 0;
  const config = configuration({
    JINGYUE_PUBLIC_ORIGIN: 'https://example.test',
    WORKBENCH_ACCESS_USER: user,
    WORKBENCH_ACCESS_PASSWORD: password,
    DASHSCOPE_API_KEY: fakeKey,
  });
  const network = createModelNetwork(config, async () => {
    calls++;
    return new Response('ok');
  });
  const url = config.modelEnv.DASHSCOPE_BASE_URL + '/chat/completions';
  const options = { method: 'POST', body: JSON.stringify({ model: 'qwen-plus' }) };
  await assert.rejects(network.fetch(url, options));
  await network.run(new AbortController().signal, async () => {
    await assert.rejects(network.fetch('https://other.example/chat/completions', options));
    await assert.rejects(network.fetch(url, { ...options, body: JSON.stringify({ model: 'other' }) }));
    for (let i = 0; i < 5; i++) assert.equal((await network.fetch(url, options)).status, 200);
    await assert.rejects(network.fetch(url, options));
  });
  assert.equal(calls, 5);
});

test('secret scanner still blocks key canaries, private files and symlinks', async (t) => {
  const canary = 'sk-' + 'synthetic-test-key-value-123456789';
  assert.equal(hasCredentialLiteral(canary, 'client/assets/emacs-lisp-tested.js'), true);
  assert.equal(hasCredentialLiteral(canary, 'server.mjs'), true);
  assert.equal(hasCredentialLiteral('LTAI' + 'ABCDEFGHIJKLM12345', 'client/data.bin'), true);
  assert.equal(
    hasCredentialLiteral('postgresql://fixture:fake-password@fixture.rds.aliyuncs.com/jingyue', 'server.mjs'),
    true,
  );
  assert.equal(
    hasCredentialLiteral(
      'postgres://fixture:fake-password@fixture.rds.aliyuncs.com/jingyue',
      'persistence.env.example',
    ),
    true,
  );
  const dbTemplate = 'postgresql://jingyue_app:<percent-encoded-password>@<official-rds-host>:5432/jingyue';
  assert.equal(hasCredentialLiteral(dbTemplate, 'persistence.env.example'), false);
  assert.equal(hasCredentialLiteral(dbTemplate, 'client/settings.js'), true);
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-scanner-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, '.dev.vars'), 'FAKE=1');
  await assert.rejects(inspectRelease(directory));
  await rm(join(directory, '.dev.vars'));
  await symlink('/private/tmp', join(directory, 'link'));
  await assert.rejects(inspectRelease(directory));
});
