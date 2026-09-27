import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureHealthLatency } from './health';
import { checkConnection } from './connection';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('deployed health response boundary', () => {
  it('measures GET /healthz only after validating the JSON response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(127);
    expect(await measureHealthLatency()).toBe(27);
    expect(fetchMock).toHaveBeenCalledWith('/healthz', {
      method: 'GET',
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([{}, null, [], { status: 'error' }, { status: true }])(
    'rejects invalid health contract: %j',
    async (payload) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload)));
      await expect(measureHealthLatency()).rejects.toThrow('invalid response');
    },
  );

  it('does not accept an HTML page as a successful health response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>login</html>')));
    await expect(measureHealthLatency()).rejects.toThrow();
  });

  it('reports disconnected on HTTP failure without retrying a page or making up latency', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }, { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await checkConnection()).toMatchObject({ connected: false, latency: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports validated connectivity and skips requests when offline', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: true });
    expect(await checkConnection()).toMatchObject({ connected: true });
    vi.stubGlobal('navigator', { onLine: false });
    expect(await checkConnection()).toMatchObject({ connected: false, latency: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
