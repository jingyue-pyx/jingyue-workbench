import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishingDelay, publishingReady } from './polling';
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
  it('bounds a hung sandbox boot and clears its timer', async () => {
    vi.useFakeTimers();

    const result = publishingReady(new Promise(() => {}), new AbortController().signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(30000);
    expect(await result).toMatchObject({ message: expect.stringContaining('沙箱未就绪') });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels startup promptly while leaving the shared operation alone', async () => {
    vi.useFakeTimers();

    const abort = new AbortController();
    let ready: (value: number) => void = () => {};
    const shared = new Promise<number>((resolve) => {
      ready = resolve;
    });
    const result = publishingReady(shared, abort.signal).catch((e) => e);
    abort.abort(new Error('stopped'));
    expect((await result).message).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
    ready(42);
    expect(await shared).toBe(42);
  });
});
