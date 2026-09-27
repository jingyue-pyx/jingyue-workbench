import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitorBoot } from './boot-status';

afterEach(() => vi.useRealTimers());

describe('WebContainer startup feedback', () => {
  it('reports a stalled handshake instead of an empty preview forever', async () => {
    vi.useFakeTimers();
    const update = vi.fn();
    monitorBoot(new Promise(() => {}), update);
    expect(update).toHaveBeenLastCalledWith('loading');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(update).toHaveBeenLastCalledWith('slow');
  });

  it('keeps waiting and recovers if startup eventually succeeds', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const boot = new Promise<void>((resolve) => (finish = resolve));
    const update = vi.fn();
    monitorBoot(boot, update);
    await vi.advanceTimersByTimeAsync(30_000);
    finish();
    await boot;
    expect(update).toHaveBeenLastCalledWith('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the warning timer on immediate success', async () => {
    vi.useFakeTimers();
    const update = vi.fn();
    monitorBoot(Promise.resolve(), update);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(update.mock.calls).toEqual([['loading'], ['ready']]);
  });

  it('reports a generic failure without exposing SDK error details', async () => {
    vi.useFakeTimers();
    const update = vi.fn();
    monitorBoot(Promise.reject(new Error('private upstream details')), update);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(update.mock.calls).toEqual([['loading'], ['error']]);
  });
});
