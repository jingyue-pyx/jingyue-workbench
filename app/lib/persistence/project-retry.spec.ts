import { afterEach, describe, expect, it, vi } from 'vitest';
import { visibleProjectRetry } from './project-retry';

afterEach(() => vi.useRealTimers());
describe('visible-only bounded cloud retry', () => {
  it('retries at most five times and cancels on unmount', async () => {
    vi.useFakeTimers();

    const retry = vi.fn().mockResolvedValue(true);
    const stop = visibleProjectRetry(retry, { isVisible: () => true, subscribe: () => () => {} });
    await vi.advanceTimersByTimeAsync(95000);
    expect(retry).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(300000);
    expect(retry).toHaveBeenCalledTimes(5);
    stop();
  });
  it('does not run in a hidden page and stops when a conflict or success ends retryability', async () => {
    vi.useFakeTimers();

    let visible = false;
    let listener = () => {};
    const retry = vi.fn().mockResolvedValue(false);
    const stop = visibleProjectRetry(retry, {
      isVisible: () => visible,
      subscribe: (fn) => {
        listener = fn;

        return () => {};
      },
    });
    await vi.advanceTimersByTimeAsync(300000);
    expect(retry).not.toHaveBeenCalled();
    visible = true;
    listener();
    await vi.advanceTimersByTimeAsync(5000);
    expect(retry).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300000);
    expect(retry).toHaveBeenCalledOnce();
    stop();
  });
  it('cancels its timer when the page becomes hidden', async () => {
    vi.useFakeTimers();

    let visible = true;
    let listener = () => {};
    const retry = vi.fn().mockResolvedValue(true);
    const stop = visibleProjectRetry(retry, {
      isVisible: () => visible,
      subscribe: (fn) => {
        listener = fn;

        return () => {};
      },
    });
    visible = false;
    listener();
    await vi.advanceTimersByTimeAsync(10000);
    expect(retry).not.toHaveBeenCalled();
    stop();
  });
});
