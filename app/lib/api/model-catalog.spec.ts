import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchModelCatalog } from './model-catalog';

const model = { name: 'qwen-plus', label: 'Qwen Plus', provider: 'Bailian', maxTokenAllowed: 8000 };

afterEach(() => vi.unstubAllGlobals());

describe('model catalog response boundary', () => {
  it('returns validated models and forwards cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ modelList: [model] }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    expect(await fetchModelCatalog('Bailian', controller.signal)).toEqual([model]);
    expect(fetchMock).toHaveBeenCalledWith('/api/models/Bailian', { signal: controller.signal });
  });

  it.each([401, 429, 502])('rejects HTTP %s without leaking the upstream response', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'private diagnostic' }, { status })));
    await expect(fetchModelCatalog()).rejects.toThrow(`HTTP ${status}`);
  });

  it.each([undefined, null, {}, { error: 'upstream failed' }, { modelList: null }, { modelList: [{}] }])(
    'rejects malformed catalogs before they reach list state: %j',
    async (payload) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))));
      await expect(fetchModelCatalog()).rejects.toThrow('响应格式异常');
    },
  );

  it('accepts an empty list and permits a subsequent successful retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ error: 'busy' }, { status: 502 }))
        .mockResolvedValueOnce(Response.json({ modelList: [] }))
        .mockResolvedValueOnce(Response.json({ modelList: [model] })),
    );
    await expect(fetchModelCatalog()).rejects.toThrow('HTTP 502');
    expect(await fetchModelCatalog()).toEqual([]);
    expect(await fetchModelCatalog()).toEqual([model]);
  });
});
