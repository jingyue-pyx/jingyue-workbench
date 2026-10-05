import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishingDelay } from './polling';
afterEach(() => vi.useRealTimers());
describe('bounded publishing wait', () => {
  it('cancels during backoff without waiting for the timer', async () => {
    vi.useFakeTimers();

    const abort = new AbortController();
    const result = publishingDelay(1500, abort.signal).catch((e) => e);
    abort.abort(new Error('stopped'));
    expect((await result).message).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not wait on an already-cancelled request', () => {
    const abort = new AbortController();
    abort.abort();
    expect(() => publishingDelay(1500, abort.signal)).toThrow();
  });
});
