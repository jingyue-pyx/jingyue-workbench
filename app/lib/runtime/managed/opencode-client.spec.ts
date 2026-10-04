import { afterEach, describe, expect, it, vi } from 'vitest';
import { localAgentEngine, openCodeRequest } from './opencode-client';

afterEach(() => vi.unstubAllGlobals());

const payload = { task: 'Synthetic change', files: { 'package.json': '{}' }, errors: [] };
const options = () => ({ model: 'qwen3-coder-next', projectId: 'test-project', signal: new AbortController().signal });

describe('optional OpenCode client', () => {
  it('does not send runtime lockfiles as agent-editable sources or remove them locally', async () => {
    const files = { 'package.json': '{}', 'src/App.tsx': 'test', 'package-lock.json': 'original-lock' };
    const request = vi.fn(async () => new Response('{"type":"result","patch":{"files":[]}}\n'));
    vi.stubGlobal('fetch', request);
    await openCodeRequest('generate', { ...payload, files }, options());

    const body = JSON.parse((request.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.files).toEqual({ 'package.json': '{}', 'src/App.tsx': 'test' });
    expect(files['package-lock.json']).toBe('original-lock');
  });
  it('uses the original engine only when disabled, not on auth or network failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('', { status: 404 }))
        .mockResolvedValueOnce(new Response('', { status: 401 })),
    );
    expect(await localAgentEngine('qwen3-coder-next')).toBe('managed');
    await expect(localAgentEngine('qwen3-coder-next')).rejects.toThrow('执行引擎');
  });

  it('selects only server-enabled models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ engine: 'opencode', models: ['qwen3-coder-next'] }))),
    );
    expect(await localAgentEngine('qwen3-coder-next')).toBe('opencode');
    expect(await localAgentEngine('qwen-plus')).toBe('managed');
  });

  it('accepts only a complete result and reports bounded progress', async () => {
    const patch = { status: 'changed', summary: 'Updated', files: [{ path: 'src/App.tsx', content: 'test' }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            [
              '',
              JSON.stringify({ type: 'progress', stage: 'coding', chars: 12 }),
              JSON.stringify({ type: 'result', patch }),
              '',
            ].join('\n'),
          ),
      ),
    );

    const onProgress = vi.fn();
    expect(JSON.parse(await openCodeRequest('generate', payload, { ...options(), onProgress }))).toEqual(patch);
    expect(onProgress).toHaveBeenCalledWith(12, expect.stringContaining('OpenCode'));
  });

  it.each([
    '{"type":"result","patch":',
    '{"type":"progress","stage":"coding"}\n',
    '{"type":"error","message":"额度不足"}\n',
  ])('does not salvage incomplete or failed streams', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    );
    await expect(openCodeRequest('generate', payload, options())).rejects.toThrow();
  });

  it('does not accept completion after user cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        return new Response('{"type":"result","patch":{"files":[]}}\n');
      }),
    );
    await expect(openCodeRequest('generate', payload, { ...options(), signal: controller.signal })).rejects.toThrow();
  });
});
