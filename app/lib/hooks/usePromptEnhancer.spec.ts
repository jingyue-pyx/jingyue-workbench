// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { requestEnhancedPrompt, usePromptEnhancer } from './usePromptEnhancer';
import type { ProviderInfo } from '~/types/model';

const provider = { name: 'Bailian' } as ProviderInfo;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('sends JSON and commits only a completed text response', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('清晰的优化需求'));
  vi.stubGlobal('fetch', fetcher);

  const { result } = renderHook(usePromptEnhancer);
  const commit = vi.fn();
  await act(async () => {
    await result.current.enhancePrompt('原需求', commit, 'qwen', provider);
  });
  expect(fetcher.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
  expect(commit).toHaveBeenCalledOnce();
  expect(commit).toHaveBeenCalledWith('清晰的优化需求');
  expect(result.current).toMatchObject({ enhancingPrompt: false, promptEnhanced: true });
});

it.each([400, 401, 429, 500])('preserves draft and resets loading on HTTP %s', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'JSON required' }, { status })));

  const { result } = renderHook(usePromptEnhancer);
  const commit = vi.fn();
  await act(async () => {
    await expect(result.current.enhancePrompt('原需求', commit, 'qwen', provider)).rejects.toThrow('原输入已保留');
  });
  expect(commit).not.toHaveBeenCalled();
  expect(result.current).toMatchObject({ enhancingPrompt: false, promptEnhanced: false });
});

it.each(['', '{"error":"JSON required"}'])('rejects empty/error text without modifying the input', async (text) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(text)));
  await expect(requestEnhancedPrompt('原需求', 'qwen', provider)).rejects.toThrow('有效文本');
});

it('keeps original draft on a network or stream failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failure')));

  const { result } = renderHook(usePromptEnhancer);
  const commit = vi.fn();
  await act(async () => {
    await expect(result.current.enhancePrompt('原需求', commit, 'qwen', provider)).rejects.toThrow();
  });
  expect(commit).not.toHaveBeenCalled();
  expect(result.current.enhancingPrompt).toBe(false);
});

it('does not overwrite a newer input rejected by the commit guard', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('优化文本')));

  const { result } = renderHook(usePromptEnhancer);
  await act(async () => {
    await expect(
      result.current.enhancePrompt(
        '旧需求',
        () => {
          throw new Error('input changed');
        },
        'qwen',
        provider,
      ),
    ).rejects.toThrow('input changed');
  });
  expect(result.current.promptEnhanced).toBe(false);
});
