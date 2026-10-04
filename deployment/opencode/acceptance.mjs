// Opt-in LIVE acceptance through the authenticated local workbench gateway.
// Uses only the synthetic fixture; never reads a user's project or key file.
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fixture } from './smoke.mjs';

if (!process.argv.includes('--live')) throw new Error('Pass --live to consume the local test account model quota.');
const origin = 'http://127.0.0.1:9027';
let cookie;
let user;
async function request(path, body) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie, 'x-jingyue-user': user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Local acceptance request failed: ${path} (${response.status})`);
  return response;
}
const login = await request('/api/auth/login', { username: 'preview_alice', password: 'Local-test-password-7248' });
cookie = login.headers.get('set-cookie').split(';')[0];
user = (await login.json()).user.id;
assert.equal((await (await request('/api/agent-engine')).json()).engine, 'opencode');
const projectId = randomUUID();
const firstTask =
  '请直接实现一个精致的中文营销活动管理页面：有侧栏、统计卡片和活动列表；可用表单添加活动名称和预算，能暂停/恢复活动并正确更新统计。用真实可操作的前端状态与明确标注的演示数据，使用完整普通 CSS，不加新依赖、空链接或后端。保留已有编译配置。';
const messages = [{ id: 'seed', role: 'user', content: firstTask }];
let files = { ...fixture };
const document = () => ({
  schemaVersion: 1,
  title: 'OpenCode · 营销活动验收',
  messages,
  snapshot: {
    chatIndex: messages.at(-1).id,
    files: Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, { type: 'file', content, isBinary: false }]),
    ),
  },
});
let saved = await (await request('/api/projects', { requestId: randomUUID(), projectId, document: document() })).json();

for (const [index, task] of [
  firstTask,
  '在现有活动表单增加渠道选择（邮件、社交媒体、搜索广告），列表展示渠道；再增加按渠道筛选。保留添加预算和暂停恢复功能，用现有 CSS 做好样式，不改编译配置。',
].entries()) {
  const response = await request('/api/opencode', {
    projectId,
    runId: randomUUID(),
    phase: 'generate',
    task,
    files,
    errors: [],
    model: 'qwen3-coder-next',
    plan: { goal: task, decisions: [] },
  });
  let buffer = '';
  let result;
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === 'error') throw new Error(`${event.code}: ${event.message}`);
      if (event.type === 'result') result = event;
      if (event.type === 'progress' && event.stage !== 'coding')
        console.log(JSON.stringify({ turn: index + 1, stage: event.stage }));
    }
  }
  assert.ok(result?.patch.files.length);
  assert.deepEqual(result.checks, ['typecheck', 'build']);
  files = { ...files, ...Object.fromEntries(result.patch.files.map((file) => [file.path, file.content])) };
  if (index) messages.push({ id: randomUUID(), role: 'user', content: task });
  messages.push({ id: randomUUID(), role: 'assistant', content: result.patch.summary, annotations: ['managed-run'] });
  saved = await (
    await request(`/api/projects/${projectId}/checkpoint`, {
      requestId: randomUUID(),
      baseRevision: saved.revision,
      document: document(),
    })
  ).json();
  const restored = await (await request(`/api/projects/${projectId}`)).json();
  assert.equal(restored.revision, saved.revision);
  assert.deepEqual(restored.document.snapshot.files, document().snapshot.files);
  console.log(
    JSON.stringify({
      turn: index + 1,
      checks: result.checks,
      modelCalls: result.modelCalls,
      changed: result.patch.files.map((file) => file.path),
      revision: saved.revision,
      persisted: true,
    }),
  );
}
console.log(
  JSON.stringify({
    url: `${origin}/chat/${projectId}`,
    model: 'qwen3-coder-next',
    codeRestored: true,
    browserInteractionsVerified: false,
    productionChanged: false,
  }),
);
