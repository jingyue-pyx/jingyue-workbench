import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from '~/utils/constants';

describe('Bailian provider configuration', () => {
  it('is the default with a known static model and requires no model-list request', () => {
    expect(DEFAULT_PROVIDER.name).toBe('Bailian');
    expect(DEFAULT_PROVIDER.staticModels.some((model) => model.name === DEFAULT_MODEL)).toBe(true);
    expect(DEFAULT_PROVIDER.getDynamicModels).toBeUndefined();
  });

  it('fails clearly when no key is supplied and rejects insecure endpoints', () => {
    const resolve = vi.spyOn(DEFAULT_PROVIDER, 'getProviderBaseUrlAndKey');
    try {
      resolve.mockReturnValue({ baseUrl: DEFAULT_PROVIDER.config.baseUrl, apiKey: undefined });
      expect(() => DEFAULT_PROVIDER.getModelInstance({ model: DEFAULT_MODEL, serverEnv: {} as Env })).toThrow(
        'API Key',
      );
      resolve.mockReturnValue({ baseUrl: 'http://example.com', apiKey: 'test-not-a-real-key' });
      expect(() => DEFAULT_PROVIDER.getModelInstance({ model: DEFAULT_MODEL, serverEnv: {} as Env })).toThrow('HTTPS');
    } finally {
      resolve.mockRestore();
    }
  });

  it('constructs an OpenAI-compatible client without sending any request', () => {
    const model = DEFAULT_PROVIDER.getModelInstance({
      model: DEFAULT_MODEL,
      serverEnv: {} as Env,
      apiKeys: { Bailian: 'test-not-a-real-key' },
    });
    expect(model.modelId).toBe(DEFAULT_MODEL);
    expect(model.provider).toContain('openai');
  });
});
