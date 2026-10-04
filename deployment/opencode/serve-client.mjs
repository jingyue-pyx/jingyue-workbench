import { AgentError } from './protocol.mjs';

export function createServeClient({ origin, password, transport = fetch, report = () => {} }) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/')
    throw new AgentError('AGENT_CONFIG', 'Agent 服务必须绑定本机回环地址。');
  const headers = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
  const request = async (path, { method = 'GET', body, signal } = {}) => {
    const response = await transport(new URL(path, origin), {
      method,
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new AgentError('AGENT_SERVICE', `OpenCode 服务请求失败（${response.status}），已有源码保留。`);
    }
    return response;
  };
  return {
    async health(signal) {
      return (await request('/global/health', { signal })).json();
    },
    async session(signal) {
      return (await request('/session', { method: 'POST', body: { title: 'Workbench candidate' }, signal })).json();
    },
    async prompt(session, model, text, signal) {
      const response = await request(`/session/${encodeURIComponent(session)}/message`, {
        method: 'POST',
        body: { agent: 'build', model: { providerID: 'jingyue', modelID: model }, parts: [{ type: 'text', text }] },
        signal,
      });
      const result = await response.json();
      if (result.info?.error) {
        // Upstream error bodies may contain prompts or credentials. Record only
        // a finite category and numeric status, never the raw message/body.
        const failure = result.info.error;
        const kinds = [
          'APIError',
          'MessageOutputLengthError',
          'ProviderAuthError',
          'MessageAbortedError',
          'ContextOverflowError',
          'StructuredOutputError',
          'UnknownError',
        ];
        const kind = kinds.includes(failure.name) ? failure.name : 'UnknownError';
        const status = Number(failure.data?.statusCode);
        report(
          `opencode_error_${kind}${Number.isInteger(status) && status >= 100 && status <= 599 ? `_${status}` : ''}`,
        );
        const messages = {
          MessageOutputLengthError: 'OpenCode 的本轮模型输出达到长度上限，候选未写入。',
          ContextOverflowError: 'OpenCode 的上下文超过模型上限，候选未写入。',
          ProviderAuthError: 'OpenCode 的模型连接认证失败，候选未写入。',
          MessageAbortedError: 'OpenCode 执行被中止，候选未写入。',
        };
        throw new AgentError(
          'AGENT_EXECUTION',
          messages[kind] ||
            `OpenCode 本轮执行未完成（${kind}${Number.isInteger(status) ? ` / ${status}` : ''}），候选未写入。`,
        );
      }
      return result;
    },
    async abort(session) {
      await request(`/session/${encodeURIComponent(session)}/abort`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
    },
    async events(session, signal, receive) {
      const response = await request('/event', { signal });
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          if (buffer.length > 2 * 1024 * 1024) throw new AgentError('AGENT_EVENTS', 'Agent 事件超过大小限制。');
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = block
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('\n');
            if (!data) continue;
            let event;
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }
            const props = event.properties || {};
            if ((props.sessionID || props.part?.sessionID || props.info?.sessionID) !== session) continue;
            // Only finite progress labels and counts leave the agent. No raw
            // prompts, commands, tool output, filesystem paths or credentials.
            if (event.type === 'message.part.updated') {
              const part = props.part;
              if (part?.type === 'tool') {
                const tool = ['read', 'edit', 'write', 'apply_patch', 'bash', 'grep', 'glob'].includes(part.tool)
                  ? part.tool
                  : 'tool';
                const status = ['pending', 'running', 'completed', 'error'].includes(part.state?.status)
                  ? part.state.status
                  : 'unknown';
                if (status === 'completed' || status === 'error') report(`opencode_tool_${tool}_${status}`);
                receive({ type: 'progress', stage: 'coding', tool, status });
              }
            }
            if (event.type === 'message.part.delta' && typeof props.delta === 'string')
              receive({ type: 'progress', stage: 'coding', chars: props.delta.length });
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
  };
}
