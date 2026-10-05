import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/auth/account-context', () => ({ currentAccount: { id: 'test-owner' } }));
import { netlifyAuthorizationURL, publishRequest } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('publishing response integrity', () => {
  it.each(['<html>Login</html>', '', 'null', '{}', '{"pending":false}'])(
    'never treats an incomplete authorization response as success: %s',
    async (body) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
      await expect(publishRequest({ action: 'authorize', attemptId: 'test' })).rejects.toThrow(/响应|连接/);
    },
  );
  it('rejects unknown deployment states rather than polling blindly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ phase: 'done' })));
    await expect(publishRequest({ action: 'advance', projectId: 'test' })).rejects.toThrow(/响应/);
  });
  it('preserves cancellation while reading the response body', async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          abort.abort();
          throw abort.signal.reason;
        },
      }),
    );
    await expect(publishRequest(undefined, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('accepts valid statuses and pending/confirmed authorization', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ enabled: true, connected: false }))
      .mockResolvedValueOnce(Response.json({ pending: true }))
      .mockResolvedValueOnce(Response.json({ pending: false, connected: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(publishRequest()).resolves.toMatchObject({ enabled: true, connected: false });
    await expect(publishRequest({ action: 'authorize' })).resolves.toEqual({ pending: true });
    await expect(publishRequest({ action: 'authorize' })).resolves.toEqual({ pending: false, connected: true });
  });
  it('reports session expiry without exposing a login page as API data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Login</html>', { status: 401 })));
    await expect(publishRequest()).rejects.toThrow(/登录已过期/);
  });
});

describe('official Netlify authorization destination', () => {
  it('accepts only the official ticket authorization endpoint', () => {
    const url = 'https://app.netlify.com/authorize?response_type=ticket&ticket=example_123-abc';
    expect(netlifyAuthorizationURL(url)).toBe(url);
  });
  it.each([
    null,
    '',
    'javascript:alert(1)',
    'http://app.netlify.com/authorize?response_type=ticket&ticket=a',
    'https://app.netlify.com.evil.test/authorize?response_type=ticket&ticket=a',
    'https://user:pass@app.netlify.com/authorize?response_type=ticket&ticket=a',
    'https://app.netlify.com/other?response_type=ticket&ticket=a',
    'https://app.netlify.com/authorize?response_type=token&ticket=a',
    'https://app.netlify.com/authorize?response_type=ticket&ticket=a&redirect_uri=https://evil.test',
    'https://app.netlify.com/authorize?response_type=ticket&ticket=a&ticket=b',
    'https://app.netlify.com/authorize?response_type=ticket&ticket=a#fragment',
  ])('rejects invalid destinations: %s', (url) => expect(netlifyAuthorizationURL(url)).toBeNull());
});
