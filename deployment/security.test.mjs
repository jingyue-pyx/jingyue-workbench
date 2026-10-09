import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, authenticated, safePath, apiAllowed, safeModelRequest, modelCatalog } from './security.mjs';

const fixture = {
  JINGYUE_PUBLIC_ORIGIN: 'https://example.test',
  WORKBENCH_ACCESS_USER: 'tester',
  WORKBENCH_ACCESS_PASSWORD: 'not-a-real-password-test-only',
  DASHSCOPE_API_KEY: 'fake-test-key',
};
test('only an explicit zero disables a daily model limit, not account capacity or other safeguards', () => {
  const defaults = configuration(fixture);
  assert.equal(defaults.userDailyRequests, 20);
  assert.equal(defaults.globalDailyRequests, 100);
  const unlimited = configuration({...fixture, JINGYUE_USER_DAILY_REQUESTS:'0', JINGYUE_GLOBAL_DAILY_REQUESTS:'0'});
  assert.equal(unlimited.userDailyRequests, 0);
  assert.equal(unlimited.globalDailyRequests, 0);
  assert.equal(unlimited.maxAccounts, defaults.maxAccounts);
  assert.equal(unlimited.registrationOpen, false);
  assert.throws(() => configuration({...fixture, JINGYUE_MAX_ACCOUNTS:'0'}));
  for (const value of ['-1', 'NaN', 'Infinity', '0.5', '', '  ', '1000']) {
    assert.throws(() => configuration({...fixture, JINGYUE_USER_DAILY_REQUESTS:value}));
  }
});
test('production refuses missing credentials, insecure origin and custom model host', () => {
  assert.throws(() => configuration({ ...fixture, WORKBENCH_ACCESS_PASSWORD: '' }));
  assert.throws(() => configuration({ ...fixture, JINGYUE_PUBLIC_ORIGIN: 'http://example.test' }));
  assert.throws(() => configuration({ ...fixture, DASHSCOPE_BASE_URL: 'https://example.test/v1' }));
  assert.throws(() => configuration({ ...fixture, DASHSCOPE_API_KEY: '' }));
});
test('local exceptions are restricted to loopback', () => {
  assert.throws(() =>
    configuration({
      ...fixture,
      JINGYUE_LOCAL_TEST: '1',
      JINGYUE_PUBLIC_ORIGIN: 'http://127.0.0.1:9000',
      HOST: '0.0.0.0',
    }),
  );
  assert.equal(
    configuration({ ...fixture, JINGYUE_LOCAL_TEST: '1', JINGYUE_PUBLIC_ORIGIN: 'http://127.0.0.1:9000' }).host,
    '127.0.0.1',
  );
});
test('access authentication fails closed', () => {
  const config = configuration(fixture);
  assert.equal(authenticated(undefined, config), false);
  assert.equal(authenticated('Basic ' + Buffer.from('tester:wrong').toString('base64'), config), false);
  assert.equal(
    authenticated('Basic ' + Buffer.from('tester:' + fixture.WORKBENCH_ACCESS_PASSWORD).toString('base64'), config),
    true,
  );
  assert.equal(JSON.stringify(config).includes(fixture.WORKBENCH_ACCESS_PASSWORD), false);
});
test('secret export, arbitrary proxy, integrations and diagnostics are unavailable', () => {
  for (const path of [
    '/api/export-api-keys',
    '/api/git-proxy/github.com',
    '/api/system/diagnostics',
    '/api/supabase',
    '/api/vercel-deploy',
  ])
    assert.equal(apiAllowed(path), false);
  assert.equal(apiAllowed('/api/chat'), true);
  assert.equal(apiAllowed('/chat/1'), true);
});
test('encoded private files and ambiguous paths are rejected', () => {
  for (const path of ['/%2edev.vars', '/a/../secret', '/a%5Cb', '/%252eenv', '/a%00b', '/%xx'])
    assert.equal(safePath(path), null);
  assert.equal(safePath('/api/%65xport-api-keys'), '/api/export-api-keys');
  assert.equal(apiAllowed(safePath('/api/%65xport-api-keys')), false);
});
test('only configured models and provider survive validation', () => {
  assert.equal(
    safeModelRequest(
      { messages: [{ content: '[Model: qwen3-coder-next]\n\n[Provider: Bailian]\n\nHello' }] },
      '/api/chat',
    ),
    true,
  );
  assert.equal(safeModelRequest({ messages: [{ content: '[Model: other]\n\nHello' }] }, '/api/chat'), false);
  assert.equal(safeModelRequest({ messages: [{ content: '[Provider: OpenAI]\n\nHello' }] }, '/api/chat'), false);
  assert.equal(safeModelRequest({ messages: [] }, '/api/chat'), false);
  const body = {
    provider: { name: 'Bailian' },
    model: 'qwen-plus',
    apiKeys: { Bailian: 'client-key' },
    providerSettings: { Bailian: { baseUrl: 'https://example.test' } },
  };
  assert.equal(safeModelRequest(body, '/api/llmcall'), true);
  assert.equal('apiKeys' in body, false);
  assert.equal('providerSettings' in body, false);
  assert.deepEqual(
    modelCatalog().providers.map((p) => p.name),
    ['Bailian'],
  );
});

test('UI text-only content parts normalize to the existing string contract without changing message metadata', () => {
  const content = '[Model: qwen3-coder-next]\n\n[Provider: Bailian]\n\nChange the title.';
  const body = {
    messages: [
      { id: 'ui-append', role: 'user', content: [{ type: 'text', text: content }] },
      { id: 'assistant', role: 'assistant', content: 'Previous response.' },
      {
        id: 'ui-reload',
        role: 'user',
        content: [
          { type: 'text', text: '[Model: qwen-plus]\n\n' },
          { type: 'text', text: '[Provider: Bailian]\n\nContinue.' },
        ],
      },
    ],
  };
  assert.equal(safeModelRequest(body, '/api/chat'), true);
  assert.deepEqual(body.messages[0], { id: 'ui-append', role: 'user', content });
  assert.equal(body.messages[1].content, 'Previous response.');
  assert.equal(body.messages[2].content, '[Model: qwen-plus]\n\n[Provider: Bailian]\n\nContinue.');
});

test('content arrays reject malformed, empty, multimodal, tool and non-allowlisted requests', () => {
  const invalidContents = [
    [],
    [null],
    ['text'],
    [{}],
    [{ type: 'text' }],
    [{ type: 'text', text: 1 }],
    [{ type: 'text', text: '  ' }],
    [{ type: 'image', image: 'https://example.test/image.png' }],
    [{ type: 'tool-call', toolName: 'fixture' }],
    [{ type: 'text', text: 'hello', image: 'https://example.test/image.png' }],
    [
      { type: 'text', text: 'hello' },
      { type: 'image', image: 'https://example.test/image.png' },
    ],
    [{ type: 'text', text: '[Model: other]\n\n[Provider: Bailian]\n\nHello' }],
    [{ type: 'text', text: '[Model: qwen-plus]\n\n[Provider: OpenAI]\n\nHello' }],
    [
      { type: 'text', text: '[Model: ' },
      { type: 'text', text: 'other]\n\nHello' },
    ],
  ];
  for (const content of invalidContents)
    assert.equal(safeModelRequest({ messages: [{ role: 'user', content }] }, '/api/chat'), false);
  for (const message of [null, 1, 'text', []])
    assert.equal(safeModelRequest({ messages: [message] }, '/api/chat'), false);
});
