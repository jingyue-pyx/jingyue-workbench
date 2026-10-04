import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';

// The container receives only a per-run revocable capability. The real model
// key never enters its image, workspace, environment or OpenCode configuration.
export async function createAgentModelProxy({ config, transport = globalThis.fetch, report = () => {} }) {
  const grants = new Map();
  const server = createServer(async (req, res) => {
    const send = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message, type: 'agent_gateway' } }));
    };
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    const grant = grants.get(token);
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions' || !grant || grant.signal.aborted)
      return send(403, 'Agent capability unavailable');
    if (grant.active) return send(429, 'Only one model request is allowed per agent');
    grant.active = true;
    const disconnected = new AbortController();
    let release;
    res.on('close', () => disconnected.abort());
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) return send(413, 'Agent context limit reached');
        chunks.push(chunk);
      }
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks));
      } catch {
        return send(400, 'Invalid model request');
      }
      if (data.model !== grant.model || !Array.isArray(data.messages) || data.stream !== true)
        return send(400, 'Unsupported model request');
      const tokens = Math.min(Number(data.max_tokens || data.max_completion_tokens || 8000), 8000);
      if (!Number.isInteger(tokens) || tokens < 1) return send(400, 'Invalid output limit');
      if (grant.budget.calls >= 16 || grant.budget.reserved + tokens > 80000) {
        grant.failure = 'AGENT_BUDGET';
        return send(429, 'Agent task budget exhausted');
      }
      try {
        release = await grant.charge();
      } catch {
        grant.failure = 'AGENT_QUOTA';
        return send(429, 'Workbench quota exhausted');
      }
      // Reserve after admission but before the upstream call. A locally
      // rejected request has not consumed provider tokens or a model call.
      grant.calls++;
      grant.budget.calls++;
      grant.budget.reserved += tokens;
      data.max_tokens = tokens;
      delete data.max_completion_tokens;
      data.stream_options = { include_usage: true };
      const upstream = await transport(`${config.modelEnv.DASHSCOPE_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.modelEnv.DASHSCOPE_API_KEY}` },
        body: JSON.stringify(data),
        signal: AbortSignal.any([grant.signal, disconnected.signal, AbortSignal.timeout(180000)]),
        redirect: 'error',
      });
      report('opencode_model_call');
      if (!upstream.ok || !upstream.body) {
        grant.failure = 'AGENT_MODEL';
        report(`opencode_provider_failed_${upstream.status}`);
        await upstream.body?.cancel();
        return send(upstream.status === 429 ? 429 : 502, 'Model provider unavailable');
      }
      grant.failure = null;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      // Reserve the maximum before starting; settle only after a complete
      // upstream stream with trusted usage. Missing/broken streams keep the
      // whole reservation. Short read/tool calls should not consume 8k tokens.
      let usage;
      let completed = false;
      let pending = '';
      const decoder = new TextDecoder();
      const meter = new Transform({
        transform(chunk, _encoding, next) {
          pending += decoder.decode(chunk, { stream: true });
          let end;
          while ((end = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, end).trim();
            pending = pending.slice(end + 1);
            if (!line.startsWith('data:')) continue;
            const value = line.slice(5).trim();
            if (value === '[DONE]') {
              completed = true;
              continue;
            }
            try {
              const valueUsage = JSON.parse(value).usage?.completion_tokens;
              if (Number.isSafeInteger(valueUsage) && valueUsage >= 0 && valueUsage <= tokens) usage = valueUsage;
            } catch {
              /* Ignore unrelated stream events, never record content. */
            }
          }
          if (pending.length > 4 * 1024 * 1024) return next(new Error('Model event too large'));
          next(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(upstream.body), meter, res);
      if (completed && usage !== undefined) grant.budget.reserved -= tokens - usage;
    } catch {
      grant.failure ||= 'AGENT_MODEL';
      if (!res.headersSent) send(502, 'Agent model connection failed');
      else res.destroy();
    } finally {
      release?.();
      grant.active = false;
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    issue({ signal, model, charge, budget = { calls: 0, reserved: 0 } }) {
      const token = randomBytes(32).toString('hex');
      const grant = { signal, model, charge, calls: 0, budget, active: false, failure: null };
      grants.set(token, grant);
      return { token, stats: grant, revoke: () => grants.delete(token) };
    },
    async close() {
      grants.clear();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
