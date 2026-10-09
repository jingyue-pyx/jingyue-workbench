import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelRequestError, REQUEST_FAILURES, retryDelay, withRequestRecovery } from './request-errors';
import { failureCode } from './failure-code';
import { runMessage, runtimeEvent } from './presentation';
import { parseOutcomeAnnotation } from './outcome';
import type { RunState } from './protocol';

afterEach(() => vi.useRealTimers());

describe('coded model recovery', () => {
  it.each(Object.entries(REQUEST_FAILURES))('retries %s only when transient', async (code, policy) => {
    const error = new ModelRequestError(code as keyof typeof REQUEST_FAILURES);
    const attempt = vi.fn().mockRejectedValue(error);
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(withRequestRecovery(attempt, new AbortController().signal, { wait })).rejects.toBe(error);
    expect(attempt).toHaveBeenCalledTimes(policy.retryable ? 3 : 1);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual(
      policy.retryable ? (code === 'model_rate_limit' ? [60000, 60000] : [500, 1000]) : [],
    );
    expect(failureCode(error)).toBe(code);
  });

  it('shows a readable cause and preserves the exact finite code in history/log metadata', () => {
    for (const code of Object.keys(REQUEST_FAILURES)) {
      const state: RunState = {
        id: 'fixture',
        phase: 'failed',
        failureCode: code,
        detail: 'secret-canary',
        attempt: 0,
        maxRepairs: 2,
        events: [{ phase: 'generating', detail: '', at: 1 }],
        errors: [],
        changed: [],
        startedAt: 1,
      };
      expect(runMessage(state)).toContain('保留');
      expect(runMessage(state)).not.toMatch(/secret-canary|错误编号|未能完成页面准备|已就绪/);
      expect(runtimeEvent(state).reason).toBe(code);
      expect(parseOutcomeAnnotation(`managed-outcome:failed:generating:${code}:0`)?.reasonCode).toBe(code);
    }
  });

  it('resolves only a complete successful retry, not the failed first response', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new ModelRequestError('model_network')).mockResolvedValue('complete');
    await expect(withRequestRecovery(attempt, new AbortController().signal, { wait: async () => {} })).resolves.toBe(
      'complete',
    );
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('cancels backoff immediately without sending another request or leaking listeners', async () => {
    vi.useFakeTimers();

    const controller = new AbortController();
    const attempt = vi.fn().mockRejectedValue(new ModelRequestError('model_network'));
    const result = withRequestRecovery(attempt, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors a bounded server wait and does not retry a daily quota', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new ModelRequestError('model_rate_limit', 30000))
      .mockResolvedValue('ok');
    await expect(withRequestRecovery(attempt, new AbortController().signal, { wait })).resolves.toBe('ok');
    expect(wait).toHaveBeenCalledWith(30000, expect.any(AbortSignal));
    expect(new ModelRequestError('model_rate_limit', Infinity).retryAfterMs).toBe(60000);
    expect(new ModelRequestError('model_rate_limit', 999999999).retryAfterMs).toBe(60000);
    expect(new ModelRequestError('model_daily_limit', 1000).retryable).toBe(false);
  });

  it('does not classify an arbitrary error by its message', async () => {
    const attempt = vi.fn().mockRejectedValue(new Error('503 ECONNRESET'));
    await expect(withRequestRecovery(attempt, new AbortController().signal)).rejects.toThrow('503 ECONNRESET');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('honors an already-aborted signal before scheduling backoff', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => retryDelay(1000, controller.signal)).toThrow();
  });
});
