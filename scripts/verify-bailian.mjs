// Local smoke test: never log configuration values, SDK error objects, or request headers.
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

try {
  const config = parse(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'));
  const endpoint = new URL(config.DASHSCOPE_BASE_URL);
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.aliyuncs.com') ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !config.DASHSCOPE_API_KEY) {
    throw new Error('Unsafe or incomplete local configuration');
  }

  const provider = createOpenAI({ baseURL: endpoint.href.replace(/\/$/, ''), apiKey: config.DASHSCOPE_API_KEY });
  const result = streamText({
    model: provider('qwen3-coder-next'),
    prompt: 'Reply with exactly the word READY.',
    maxTokens: 16,
    temperature: 0,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(45000),
    onError: () => {},
  });
  let output = '';
  for await (const part of result.textStream) output += part;
  const usage = await result.usage;
  const ok = output.trim().length > 0;
  console.log(JSON.stringify({ ok, streamedResponse: ok, exactCheck: output.trim() === 'READY', usage }));
  if (!ok) process.exitCode = 1;
} catch (error) {
  // Deliberately omit error.message, responseBody, requestBodyValues and cause.
  console.log(JSON.stringify({ ok: false, httpStatus: typeof error?.statusCode === 'number' ? error.statusCode : null,
    timedOut: error?.name === 'TimeoutError' || error?.name === 'AbortError' }));
  process.exitCode = 1;
}
