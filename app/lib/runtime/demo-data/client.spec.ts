import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError, DemoDocument } from './client';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => vi.useRealTimers());

function fixture() {
  let revision = 0;
  let value: object | null = null;
  let writes = 0;
  const requests: any[] = [];
  const request = vi.fn(async <T>(body: any) => {
    requests.push(body);

    if (body.action === 'write') {
      revision++;
      writes++;
      value = body.value;
    }

    if (body.action === 'draft') {
      return { revision: body.baseRevision, value: body.value, updatedAt: null };
    }

    return { revision, value: value as T, updatedAt: null };
  });
  const publish = vi.fn();
  const store = new DemoDocument('orders', { count: 0 }, publish, request);

  return { store, publish, request, requests, writes: () => writes };
}

describe('generated-app autosave', () => {
  it('loads before editing and never writes seed state on mount', async () => {
    const f = fixture();
    f.store.update({ count: 5 });
    expect(f.store.state.data.count).toBe(0);
    await f.store.load();
    expect(f.store.state.ready).toBe(true);
    expect(f.store.state.status).toBe('ready');
    expect(f.writes()).toBe(0);
  });
  it('debounces edits and reports saved only after remote acknowledgement', async () => {
    vi.useFakeTimers();

    const f = fixture();
    await f.store.load();
    f.store.update({ count: 1 });
    f.store.update((previous) => ({ count: previous.count + 1 }));
    expect(f.store.state.status).toBe('saving');
    expect(f.writes()).toBe(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(f.writes()).toBe(1);
    expect(f.store.state.status).toBe('saved');
    expect(f.requests.at(-1).value).toEqual({ count: 2 });
    f.store.dispose();
  });
  it('serializes an edit made during a pending write without losing the newest value', async () => {
    const f = fixture();
    await f.store.load();

    let release!: (result: any) => void;
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(original).mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    f.store.update({ count: 1 });

    const saving = f.store.flush();
    await tick();
    f.store.update({ count: 2 });
    expect(f.store.state.status).toBe('saving');
    release({ revision: 1, value: { count: 1 }, updatedAt: null });
    f.request.mockImplementation(async (body: any) => ({
      revision: body.action === 'write' ? body.baseRevision + 1 : body.baseRevision,
      value: body.value,
      updatedAt: null,
    }));
    await saving;
    expect(f.store.state.data).toEqual({ count: 2 });
    expect(f.store.state.status).toBe('saved');

    const writes = f.request.mock.calls.filter(([body]) => body.action === 'write');
    expect(writes.map(([body]) => body.value.count)).toEqual([1, 2]);
    expect(writes[1][0].baseRevision).toBe(1);
    f.store.dispose();
  });
  it('retries a network failure with the same mutation ID and never retries revision conflict', async () => {
    vi.useFakeTimers();

    const f = fixture();
    await f.store.load();

    const original = f.request.getMockImplementation()!;
    let tries = 0;
    f.request.mockImplementation(async (body) => {
      if (body.action === 'write' && ++tries < 3) {
        throw new DataError('DATA_UNAVAILABLE', 'offline');
      }

      return original(body);
    });
    f.store.update({ count: 3 });

    const run = f.store.flush();
    await vi.advanceTimersByTimeAsync(1600);
    await run;

    const writes = f.request.mock.calls.filter(([body]) => body.action === 'write');
    expect(writes).toHaveLength(3);
    expect(new Set(writes.map(([body]) => body.requestId)).size).toBe(1);
    expect(f.store.state.status).toBe('saved');
    f.request.mockImplementation(async (body) => {
      if (body.action === 'write') {
        throw new DataError('DATA_CONFLICT', 'conflict');
      }

      return original(body);
    });
    f.store.update({ count: 4 });
    await f.store.flush();
    expect(f.store.state.status).toBe('conflict');

    const count = f.request.mock.calls.length;
    await f.store.retry();
    expect(f.request.mock.calls).toHaveLength(count);
    expect(f.store.state.data).toEqual({ count: 4 });
    f.store.dispose();
  });
  it('recovers the in-flight write and newer local draft after reload without auto-overwriting', async () => {
    const f = fixture();
    f.request.mockResolvedValueOnce({
      revision: 1,
      value: { count: 0 },
      updatedAt: null,
      draft: { action: 'write', key: 'orders', value: { count: 1 }, baseRevision: 1, requestId: crypto.randomUUID() },
      latestValue: { count: 2 },
    } as any);
    await f.store.load();
    expect(f.store.state.data).toEqual({ count: 2 });
    expect(f.store.state.status).toBe('error');
    expect(f.writes()).toBe(0);
    f.request.mockImplementation(async (body) => ({
      revision: body.baseRevision + 1,
      value: body.value,
      updatedAt: null,
    }));
    await f.store.retry();
    expect(f.request.mock.calls.filter(([body]) => body.action === 'write').map(([body]) => body.value.count)).toEqual([
      1, 2,
    ]);
    expect(f.store.state.status).toBe('saved');
    f.store.dispose();
  });
  it('stops pending debounce on dispose and does not publish a late acknowledgement', async () => {
    vi.useFakeTimers();

    const f = fixture();
    await f.store.load();
    f.store.update({ count: 1 });
    f.store.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.writes()).toBe(0);
  });
});
