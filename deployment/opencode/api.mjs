import { AgentError, validateInput } from './protocol.mjs';

export async function handleAgentApi({
  req,
  res,
  pathname,
  runner,
  config,
  user,
  projects,
  signal,
  charge,
  headers,
  send,
  report,
}) {
  if (pathname !== '/api/agent-engine' && pathname !== '/api/opencode') return false;
  if (!config.localTest || !runner) {
    send(404, { error: 'Local agent experiment is disabled' });
    return true;
  }
  if (!user) {
    send(401, { error: 'Account sign-in required' });
    return true;
  }
  if (pathname === '/api/agent-engine') {
    if (req.method !== 'GET') send(405, { error: 'Method not allowed' });
    else send(200, { engine: 'opencode', version: runner.version, models: ['qwen3-coder-next'] });
    return true;
  }
  if (req.method !== 'POST') {
    send(405, { error: 'Method not allowed' });
    return true;
  }
  let heartbeat;
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 900000) throw new AgentError('AGENT_INPUT', '项目超过本轮 Agent 大小上限。', 413);
      chunks.push(chunk);
    }
    let input;
    try {
      input = JSON.parse(Buffer.concat(chunks));
    } catch {
      throw new AgentError('AGENT_INPUT', '请求不是有效 JSON。', 400);
    }
    validateInput(input);
    // Do not trust owner/session/directory fields supplied by the browser.
    try {
      const project = await projects.forOwner(user.id).get(input.projectId);
      if (project.deletedAt) throw new Error('deleted');
    } catch {
      throw new AgentError('AGENT_PROJECT', '项目不存在或不属于当前账号。', 404);
    }
    res.writeHead(200, { ...headers, 'Content-Type': 'application/x-ndjson; charset=utf-8' });
    res.flushHeaders();
    const emit = (event) => {
      if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n');
    };
    heartbeat = setInterval(() => {
      if (!res.destroyed) res.write('\n');
    }, 10000);
    const result = await runner.run(input, { owner: user.id, signal, charge, progress: emit });
    signal.throwIfAborted();
    emit({ type: 'result', ...result });
    res.end();
  } catch (error) {
    const failure =
      error instanceof AgentError ? error : new AgentError('AGENT_FAILED', 'OpenCode 请求未完成，已有源码保留。');
    report(`opencode_request_failed_${failure.code}`);
    const body = { type: 'error', code: failure.code, message: failure.message };
    if (!res.headersSent) send(failure.status, body);
    else if (!res.destroyed) res.end(JSON.stringify(body) + '\n');
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
