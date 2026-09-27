import { AsyncLocalStorage } from 'node:async_hooks';
import { MODEL_LIST } from './security.mjs';

// The upstream chat route does not propagate its Request.signal to every
// summary/selection/continuation SDK call. Scope all outbound fetches instead.
export function createModelNetwork(config, transport = globalThis.fetch) {
  const scope = new AsyncLocalStorage();
  const allowedUrl = `${config.modelEnv.DASHSCOPE_BASE_URL}/chat/completions`;
  const scopedFetch = async (input, init = {}) => {
    const context = scope.getStore();
    const url = input instanceof Request ? input.url : String(input);
    if (!context || context.signal.aborted || url !== allowedUrl) throw new Error('Model network request blocked.');
    if (++context.calls > 6) throw new Error('Per-request model call limit reached.');
    const method = init.method || (input instanceof Request ? input.method : 'GET');
    if (method !== 'POST' || typeof init.body !== 'string') throw new Error('Model network request blocked.');
    let data;
    try {
      data = JSON.parse(init.body);
    } catch {
      throw new Error('Model network request blocked.');
    }
    if (!MODEL_LIST.some((model) => model.name === data.model)) throw new Error('Model network request blocked.');
    const requestHeaders = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    requestHeaders.set('Authorization', `Bearer ${config.modelEnv.DASHSCOPE_API_KEY}`);
    const signals = [context.signal, init.signal, input instanceof Request ? input.signal : undefined].filter(Boolean);
    return transport(input, { ...init, headers: requestHeaders, signal: AbortSignal.any(signals) });
  };
  return {
    fetch: scopedFetch,
    run: (signal, operation) => scope.run({ signal, calls: 0 }, operation),
  };
}
