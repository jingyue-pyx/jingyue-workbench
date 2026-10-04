import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentConfig, changedFiles, sourcePath, validateInput } from './opencode/protocol.mjs';
import { readCandidate } from './opencode/runner.mjs';
import { createAgentModelProxy } from './opencode/model-proxy.mjs';
import { createServeClient } from './opencode/serve-client.mjs';
import { handleAgentApi } from './opencode/api.mjs';
import { readSession, sessionCookie } from './accounts.mjs';
import { missingStyleImports } from './opencode/styles.mjs';
import { Readable } from 'node:stream';

const id = '00000000-0000-4000-8000-000000000001';
test('style entry checks catch orphan CSS and follow component/module/CSS imports', () => {
  const files = {
    'index.html': '<script type="module" src="/src/main.tsx"></script>',
    'src/main.tsx': 'import App from "./App";',
    'src/App.tsx': 'export default 1;',
    'src/App.css': '.card { color:red; }',
  };
  assert.match(missingStyleImports(files), /src\/App.css/);
  assert.equal(missingStyleImports({ ...files, 'src/App.tsx': 'import "./App.css"; export default 1;' }), '');
  assert.equal(
    missingStyleImports({ ...files, 'src/App.tsx': 'import classes from "./App.css?inline"; export default classes;' }),
    '',
  );
  assert.equal(
    missingStyleImports({ ...files, 'src/App.tsx': 'import "./base.css";', 'src/base.css': '@import "./App.css";' }),
    '',
  );
  assert.match(missingStyleImports({ ...files, 'src/unmounted.ts': 'import "./App.css";' }), /未被页面入口引用/);
});
test('local OpenCode sign-in is cookie-isolated without changing production authentication', () => {
  const token = 'a'.repeat(43);
  const normal = sessionCookie(token, true);
  const isolated = sessionCookie(token, true, false, 'opencode-9027');
  assert.equal(readSession(normal, true, 'opencode-9027'), null);
  assert.equal(readSession(isolated, true), null);
  assert.equal(readSession(isolated, true, 'opencode-9027'), token);
  assert.equal(sessionCookie(token, false, false, 'opencode-9027'), sessionCookie(token, false));
});
const input = () => ({
  projectId: id,
  runId: id,
  phase: 'generate',
  task: 'Add a demo',
  model: 'qwen3-coder-next',
  files: { 'package.json': '{}', 'src/App.tsx': 'export default function App() {return null;}' },
  errors: [],
});

test('agent input rejects traversal, agent configuration, credentials and unsupported requests', () => {
  assert.equal(validateInput(input()).projectId, id);
  for (const path of [
    '../secret',
    '/app.ts',
    '.env',
    'AGENTS.md',
    'src/opencode.json',
    'node_modules/x.js',
    'x\\y',
    'x//y',
  ]) {
    assert.equal(sourcePath(path), false, path);
    assert.throws(() => validateInput({ ...input(), files: { [path]: 'x' } }));
  }
  assert.throws(() => validateInput({ ...input(), runId: 'arbitrary' }));
  assert.throws(() => validateInput({ ...input(), model: 'unmetered-model' }));
  assert.throws(() =>
    validateInput({
      ...input(),
      files: { 'package.json': '{}', 'key.ts': 'sk-' + 'synthetic-secret-canary-not-real' },
    }),
  );
});

test('configuration contains only a task capability and constrained tools', () => {
  const config = agentConfig('http://host.docker.internal:9999/v1', 'task-capability', 'qwen3-coder-next');
  assert.equal(config.permission['*'], 'deny');
  assert.equal(config.permission.bash['*'], 'deny');
  assert.deepEqual(Object.keys(config.permission.bash), ['*']);
  assert.equal(config.permission.external_directory, 'deny');
  assert.equal(config.permission.question, 'deny');
  assert.equal(config.permission.task, 'deny');
  assert.equal(config.share, 'disabled');
  assert.deepEqual(config.enabled_providers, ['jingyue']);
  assert.equal(config.provider.jingyue.options.apiKey, 'task-capability');
});

test('file diff is generated from actual files, rejects deletions, and retains no-op', () => {
  assert.throws(() => changedFiles({ 'a.ts': 'old' }, {}), /删除/);
  const pkg = JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', build: 'vite build' } });
  const before = { 'package.json': pkg, 'a.ts': 'x' };
  assert.deepEqual(changedFiles(before, before).files, []);
  assert.deepEqual(changedFiles(before, { ...before, 'a.ts': 'y' }).files, [{ path: 'a.ts', content: 'y' }]);
  assert.throws(() => changedFiles(before, { ...before, 'package.json': '{"scripts":{"build":"echo ok"}}' }), /不得/);
  assert.throws(
    () =>
      changedFiles(before, {
        ...before,
        'package.json': JSON.stringify({
          ...JSON.parse(pkg),
          scripts: { ...JSON.parse(pkg).scripts, prebuild: 'echo bypass' },
        }),
      }),
    /生命周期/,
  );
  assert.throws(
    () =>
      changedFiles(before, {
        ...before,
        'package.json': JSON.stringify({
          ...JSON.parse(pkg),
          overrides: { typescript: 'file:./fake-compiler' },
        }),
      }),
    /依赖覆盖/,
  );
});

test('candidate collector rejects symlinks and hardlinks without following them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jingyue-agent-collector-'));
  const target = join(directory, 'target.ts');
  await writeFile(target, 'safe');
  assert.equal((await readCandidate(directory))['target.ts'], 'safe');
  await symlink(target, join(directory, 'alias.ts'));
  await assert.rejects(readCandidate(directory), /文件路径/);
  const second = await mkdtemp(join(tmpdir(), 'jingyue-agent-hardlink-'));
  await link(target, join(second, 'alias.ts'));
  await assert.rejects(readCandidate(second), /文件类型/);
});

async function proxyFixture(t, { charge = async () => {}, transport } = {}) {
  let forwarded;
  const config = {
    modelEnv: {
      DASHSCOPE_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      DASHSCOPE_API_KEY: 'server-only-canary',
    },
  };
  const proxy = await createAgentModelProxy({
    config,
    transport:
      transport ||
      (async (url, options) => {
        forwarded = { url, options };
        return new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      }),
  });
  t.after(() => proxy.close());
  const controller = new AbortController();
  const grant = proxy.issue({ signal: controller.signal, model: 'qwen3-coder-next', charge });
  const send = (body = {}, token = grant.token, path = '/v1/chat/completions') =>
    fetch(`http://127.0.0.1:${proxy.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model: 'qwen3-coder-next',
        stream: true,
        messages: [{ role: 'user', content: 'Synthetic test' }],
        ...body,
      }),
    });
  return { proxy, grant, controller, send, forwarded: () => forwarded };
}

test('proxy injects server key only upstream, charges every request and caps output', async (t) => {
  let charges = 0;
  const f = await proxyFixture(t, {
    charge: async () => {
      charges++;
    },
  });
  const response = await f.send({ max_tokens: 999999 });
  assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /server-only-canary/);
  assert.equal(charges, 1);
  assert.equal(f.forwarded().options.headers.Authorization, 'Bearer server-only-canary');
  assert.equal(JSON.parse(f.forwarded().options.body).max_tokens, 8000);
  assert.equal(f.grant.stats.budget.reserved, 8000);
});

test('proxy rejects foreign/revoked capabilities, arbitrary endpoints and other models', async (t) => {
  const f = await proxyFixture(t);
  assert.equal((await f.send({}, 'wrong')).status, 403);
  assert.equal((await f.send({}, f.grant.token, '/v1/models')).status, 403);
  assert.equal((await f.send({ model: 'other' })).status, 400);
  f.grant.revoke();
  assert.equal((await f.send()).status, 403);
  assert.equal(f.forwarded(), undefined);
});

test('completed streams settle reserved output against provider usage; incomplete streams remain reserved', async (t) => {
  const f = await proxyFixture(t, {
    transport: async () => new Response('data: {"usage":{"completion_tokens":120}}\n\ndata: [DONE]\n\n'),
  });
  await (await f.send()).text();
  assert.equal(f.grant.stats.budget.reserved, 120);
  assert.equal(f.grant.stats.budget.calls, 1);
  const broken = await proxyFixture(t, {
    transport: async () => new Response('data: {"usage":{"completion_tokens":120}}\n\n'),
  });
  await (await broken.send()).text();
  assert.equal(broken.grant.stats.budget.reserved, 8000);
  const invalid = await proxyFixture(t, {
    transport: async () => new Response('data: {"usage":{"completion_tokens":-1}}\n\ndata: [DONE]\n\n'),
  });
  await (await invalid.send()).text();
  assert.equal(invalid.grant.stats.budget.reserved, 8000);
});

test('serve error diagnostics expose only finite kind/status, never provider messages', async () => {
  const events = [];
  const client = createServeClient({
    origin: 'http://127.0.0.1:4096',
    password: 'synthetic',
    report: (event) => events.push(event),
    transport: async () =>
      Response.json({
        info: {
          error: {
            name: 'APIError',
            data: { statusCode: 429, message: 'private-response-body' },
          },
        },
      }),
  });
  await assert.rejects(client.prompt('ses_test', 'qwen3-coder-next', 'test'), (error) => {
    assert.doesNotMatch(error.message, /private-response/);
    assert.match(error.message, /429/);
    return true;
  });
  assert.deepEqual(events, ['opencode_error_APIError_429']);
});

test('proxy stops at task budget and preserves quota failures without leaking upstream errors', async (t) => {
  const f = await proxyFixture(t);
  f.grant.stats.budget.reserved = 80000;
  assert.equal((await f.send()).status, 429);
  assert.equal(f.forwarded(), undefined);
  assert.equal(f.grant.stats.failure, 'AGENT_BUDGET');
  const quota = await proxyFixture(t, {
    charge: async () => {
      throw new Error('private-database-detail');
    },
  });
  const response = await quota.send();
  assert.equal(response.status, 429);
  assert.doesNotMatch(await response.text(), /private-database/);
  assert.equal(quota.forwarded(), undefined);
  assert.equal(quota.grant.stats.budget.calls, 0);
  assert.equal(quota.grant.stats.budget.reserved, 0);
});

test('cancelled runs cannot call the model and retries share the reserved budget', async (t) => {
  const f = await proxyFixture(t);
  f.controller.abort();
  assert.equal((await f.send()).status, 403);
  assert.equal(f.forwarded(), undefined);
  const budget = { calls: 16, reserved: 1000 };
  const grant = f.proxy.issue({
    signal: new AbortController().signal,
    model: 'qwen3-coder-next',
    charge: async () => {},
    budget,
  });
  assert.equal((await f.send({}, grant.token)).status, 429);
  assert.equal(budget.calls, 16);
});

test('proxy releases concurrency after failure and sanitizes provider response bodies', async (t) => {
  let releases = 0;
  const f = await proxyFixture(t, {
    charge: async () => () => {
      releases++;
    },
    transport: async () => new Response('private-upstream-error', { status: 500 }),
  });
  const response = await f.send();
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /private-upstream-error/);
  assert.equal(releases, 1);
});

test('serve client rejects non-loopback servers and never follows redirects', async () => {
  assert.throws(() => createServeClient({ origin: 'https://attacker.invalid', password: 'x' }));
  let options;
  const client = createServeClient({
    origin: 'http://127.0.0.1:4096',
    password: 'synthetic',
    transport: async (_url, init) => {
      options = init;
      return Response.json({ healthy: true });
    },
  });
  assert.equal((await client.health()).healthy, true);
  assert.equal(options.redirect, 'error');
});

test('agent route stays disabled in production and rejects foreign project ownership before running', async () => {
  let status;
  let called = false;
  const common = {
    req: Readable.from([Buffer.from(JSON.stringify(input()))]),
    pathname: '/api/opencode',
    config: { localTest: false },
    runner: {
      run: async () => {
        called = true;
      },
    },
    user: { id: 'alice' },
    send: (value) => {
      status = value;
    },
    report: () => {},
  };
  common.req.method = 'POST';
  await handleAgentApi(common);
  assert.equal(status, 404);
  assert.equal(called, false);
  await handleAgentApi({
    ...common,
    config: { localTest: true },
    res: { headersSent: false },
    projects: {
      forOwner: (owner) => {
        assert.equal(owner, 'alice');
        return {
          get: async () => {
            throw Error('foreign');
          },
        };
      },
    },
  });
  assert.equal(status, 404);
  assert.equal(called, false);
});
