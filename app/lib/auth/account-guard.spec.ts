// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';

const alice = {
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  username: 'alice',
  displayName: 'Alice',
  legacyOwner: false,
};
const originalFetch = window.fetch;
afterEach(() => {
  window.fetch = originalFetch;
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixture() {
  vi.resetModules();

  const meta = document.createElement('meta');
  meta.name = 'jingyue-account';
  meta.content = JSON.stringify(alice);
  document.head.appendChild(meta);
  document.body.innerHTML = '<div id="root">Private project</div>';
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage = null;
    },
  );

  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ user: alice }), { headers: { 'Content-Type': 'application/json' } }),
  );
  window.fetch = fetcher;

  // Capture lifecycle listeners without leaking installed guards across tests.
  const windowEvents = vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
  vi.spyOn(document, 'addEventListener').mockImplementation(() => undefined);

  const { installAccountGuard } = await import('./account-guard.client');
  const navigate = vi.fn();
  installAccountGuard(navigate);
  await new Promise((resolve) => setTimeout(resolve, 0));
  fetcher.mockClear();

  const checkOnFocus = async () => {
    const listener = windowEvents.mock.calls.find(([event]) => String(event) === 'focus')?.[1] as EventListener;
    listener(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  return { fetcher, navigate, checkOnFocus };
}
it('explicitly installs the guard and adds expected account headers only to same-origin API requests', async () => {
  const { fetcher, navigate } = await fixture();
  await window.fetch('/api/models');
  expect(
    new Headers((fetcher.mock.calls as unknown as [unknown, RequestInit][])[0][1].headers).get('X-Jingyue-User'),
  ).toBe(alice.id);
  await window.fetch('https://other.example/api/data');
  expect((fetcher.mock.calls as unknown as [unknown, RequestInit | undefined][])[1][1]).toBeUndefined();
  expect(navigate).not.toHaveBeenCalled();
});
it.each([
  ['SESSION_EXPIRED', 401],
  ['ACCOUNT_CHANGED', 409],
])('redirects %s directly to login without a warning panel or deleting drafts', async (code, status) => {
  const { fetcher, navigate } = await fixture();
  localStorage.setItem('alice:draft', 'unsaved project');
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code } }), { status: Number(status) }));
  await window.fetch('/api/projects');
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith('/login');
  expect(document.getElementById('root')?.style.visibility).toBe('hidden');
  expect(document.getElementById('root')?.inert).toBe(true);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).not.toContain('登录已过期或账号已切换');
  expect(localStorage.getItem('alice:draft')).toBe('unsaved project');
  await expect(window.fetch('/api/projects', { method: 'POST' })).rejects.toThrow('账号已切换');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('redirects only once when concurrent requests detect expiration', async () => {
  const { fetcher, navigate, checkOnFocus } = await fixture();
  fetcher.mockImplementation(
    async () => new Response(JSON.stringify({ error: { code: 'SESSION_EXPIRED' } }), { status: 401 }),
  );
  await Promise.all([window.fetch('/api/projects'), window.fetch('/api/models')]);
  await checkOnFocus();
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith('/login');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('a normal project revision conflict does not log the user out or hide their draft', async () => {
  const { fetcher, navigate } = await fixture();
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { code: 'REVISION_CONFLICT' } }), { status: 409 }),
  );
  await window.fetch('/api/projects');
  expect(document.getElementById('root')?.style.visibility).not.toBe('hidden');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

it.each([null, { ...alice, id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' }])(
  'redirects when a session recheck confirms logout or an account switch',
  async (user) => {
    const { fetcher, navigate, checkOnFocus } = await fixture();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ user })));
    await checkOnFocus();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login');
  },
);

it('keeps the same account usable after a session recheck', async () => {
  const { navigate, checkOnFocus } = await fixture();
  await checkOnFocus();
  expect(navigate).not.toHaveBeenCalled();
  expect(document.getElementById('root')?.style.visibility).not.toBe('hidden');
});

it('does not redirect on database outages, offline checks or invalid session responses', async () => {
  const { fetcher, navigate, checkOnFocus } = await fixture();
  fetcher.mockResolvedValueOnce(new Response('Service unavailable', { status: 503 }));
  await checkOnFocus();
  fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await checkOnFocus();
  fetcher.mockResolvedValueOnce(new Response('not JSON'));
  await checkOnFocus();
  expect(navigate).not.toHaveBeenCalled();
  expect(document.getElementById('root')?.style.visibility).not.toBe('hidden');
});
