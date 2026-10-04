import { useEffect, useRef, useState } from 'react';
import type { ProviderInfo } from '~/types/model';

export async function requestEnhancedPrompt(
  input: string,
  model: string,
  provider: ProviderInfo,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/enhancer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
    body: JSON.stringify({ message: input, model, provider }),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? '模型额度或频率已达限制，请稍后再试。原输入已保留。'
        : `提示词优化失败（HTTP ${response.status}），原输入已保留。`,
    );
  }

  const text = await response.text();
  signal?.throwIfAborted();

  if (
    !text.trim() ||
    /application\/json|text\/html/i.test(response.headers.get('content-type') || '') ||
    /^\s*\{\s*"error"\s*:/.test(text)
  ) {
    throw new Error('优化服务没有返回有效文本，原输入已保留。');
  }

  return text;
}

export function usePromptEnhancer() {
  const [enhancingPrompt, setEnhancingPrompt] = useState(false);
  const [promptEnhanced, setPromptEnhanced] = useState(false);
  const active = useRef<AbortController>();
  useEffect(() => () => active.current?.abort(), []);

  const resetEnhancer = () => {
    active.current?.abort();
    active.current = undefined;
    setEnhancingPrompt(false);
    setPromptEnhanced(false);
  };

  const enhancePrompt = async (
    input: string,
    setInput: (value: string) => void,
    model: string,
    provider: ProviderInfo,
  ) => {
    if (active.current) {
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('优化请求超时，原输入已保留，请稍后重试。')), 60000);
    active.current = controller;
    setEnhancingPrompt(true);
    setPromptEnhanced(false);

    try {
      // Commit only a complete successful response. Errors never replace a user's draft.
      const text = await requestEnhancedPrompt(input, model, provider, controller.signal);
      setInput(text);
      setPromptEnhanced(true);

      return true;
    } finally {
      clearTimeout(timer);

      if (active.current === controller) {
        active.current = undefined;
        setEnhancingPrompt(false);
      }
    }
  };

  return { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer };
}
