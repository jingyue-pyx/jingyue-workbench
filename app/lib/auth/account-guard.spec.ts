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

  const { installAccountGuard } = await import('./account-guard.client');
  installAccountGuard();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fetcher.mockClear();

  return fetcher;
}
it('explicitly installs the guard and adds expected account headers only to same-origin API requests', async () => {
  const fetcher = await fixture();
  await window.fetch('/api/models');
  expect(
    new Headers((fetcher.mock.calls as unknown as [unknown, RequestInit][])[0][1].headers).get('X-Jingyue-User'),
  ).toBe(alice.id);
  await window.fetch('https://other.example/api/data');
  expect((fetcher.mock.calls as unknown as [unknown, RequestInit | undefined][])[1][1]).toBeUndefined();
});
it('locks stale pages after server rejects account mismatch and blocks subsequent writes', async () => {
  const fetcher = await fixture();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'ACCOUNT_CHANGED' } }), { status: 409 }));
  await window.fetch('/api/projects');
  expect(document.getElementById('root')?.style.visibility).toBe('hidden');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('本机草稿未删除');
  await expect(window.fetch('/api/projects', { method: 'POST' })).rejects.toThrow('账号已切换');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('a normal project revision conflict does not log the user out or hide their draft', async () => {
  const fetcher = await fixture();
  fetcher.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { code: 'REVISION_CONFLICT' } }), { status: 409 }),
  );
  await window.fetch('/api/projects');
  expect(document.getElementById('root')?.style.visibility).not.toBe('hidden');
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
