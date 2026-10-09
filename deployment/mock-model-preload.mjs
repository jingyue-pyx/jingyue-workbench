// Test-only transport. Never included in a release, and never contacts a model.
import dns from 'node:dns';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

if (process.env.VERIFY_DATABASE_CASE) {
  // Only synthetic DNS is permitted in this test process. A second guard in
  // Socket.connect blocks DB transport even if the packaged validation regresses.
  const originalLookup = dns.lookup;
  dns.lookup = (host, options, callback) => {
    // Node also uses lookup while binding the test HTTP listener. Numeric
    // loopback is local-only and must not be counted as a database resolution.
    if (host === '127.0.0.1') return originalLookup(host, options, callback);
    const done = typeof options === 'function' ? options : callback;
    process.send?.({ event: 'mock_database_dns', all: options?.all === true });
    queueMicrotask(() => done(null, [{ address: '127.0.0.1', family: 4 }]));
  };
  const originalConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const options = args[0];
    const port = typeof options === 'object' ? options.port : options;
    if (Number(port) !== 5432) return originalConnect.apply(this, args);
    const deny = () => queueMicrotask(() => this.destroy(new Error('Mock database transport blocked')));
    if (typeof options?.lookup !== 'function') {
      process.send?.({ event: 'mock_database_guard_missing' });
      deny();
      return this;
    }
    // Exercise the packaged lookup, but never pass its result to a real connect.
    options.lookup(options.host, {}, (error) => {
      process.send?.({ event: 'mock_database_dns_denied', denied: error?.code === 'EPRIVATEADDRESS' });
      deny();
    });
    return this;
  };
  syncBuiltinESMExports();
}

const expectedKey = 'not-a-real-model-key-smoke-only';
globalThis.fetch = async (input, options = {}) => {
  const url = input instanceof Request ? input.url : String(input);
  const allowed = url === 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const authenticated = new Headers(options.headers).get('authorization') === `Bearer ${expectedKey}`;
  process.send?.({ event: 'mock_model_call', allowed, authenticated, cancellable: !!options.signal });
  if (!allowed || !authenticated) throw new Error('Mock transport rejected request');
  if (typeof options.body === 'string' && options.body.includes('fixture-provider-unavailable')) {
    return Response.json({ error: { message: 'private-provider-canary' } }, { status: 503 });
  }
  if (typeof options.body === 'string' && options.body.includes('fixture-file-output-contract')) {
    const body = JSON.parse(options.body);
    const system = (body.messages || []).filter((message) => message.role === 'system').map((message) => message.content).join('\n');
    process.send?.({
      event: 'mock_file_output_contract',
      complete: system.includes('REQUIRED COMPLETE-FILE OUTPUT'),
      edits: system.includes('REQUIRED LARGE-FILE OUTPUT FORMAT'),
      contradictoryEditExample: system.includes('PREFER') || system.includes('"edits":'),
      guardsPresent: system.includes('Do not weaken type checks') && system.includes('Never include secrets'),
      single: system.includes('SINGLE-FILE RESPONSE CONTRACT'),
      source: system.includes('SINGLE-FILE SOURCE RECOVERY'),
      contradictoryJson: system.includes('ONLY valid JSON'),
      filesExample: system.includes('"files":'),
    });
    const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'qwen3-coder-next', choices: [{ index: 0, delta: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  }
  return new Response(
    new ReadableStream({
      start(controller) {
        const chunk = {
          id: 'fixture',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'qwen3-coder-next',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Mock model stream reached the real app.' },
              finish_reason: null,
            },
          ],
        };
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
        options.signal?.addEventListener(
          'abort',
          () => {
            process.send?.({ event: 'mock_model_cancelled' });
            controller.error(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  );
};
