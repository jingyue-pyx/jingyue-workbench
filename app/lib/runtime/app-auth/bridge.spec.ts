// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { attachAppAuthBridge, previewAppAuthEnabled } from './bridge';

const project = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const origin = 'https://preview.example.test';
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((fn) => fn());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);

  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  const fetcher = vi.fn(async () =>
    Response.json({ user: { id: 'user', username: 'demo', displayName: 'Demo' }, access_token: 'must-not-leak' }),
  );
  const dispose = attachAppAuthBridge({
    target: window,
    iframe: () => frame,
    origin,
    projectId: project,
    accountId: account,
    fetcher,
  });
  disposers.push(dispose);

  const dispatch = (data: object, overrides: Partial<MessageEventInit> = {}) =>
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow!, origin, data, ...overrides }));
  const send = async (body: object) => {
    const id = crypto.randomUUID();
    dispatch({ type: 'jingyue:auth-request', id, body });
    await vi.waitFor(() => expect(post.mock.calls.some(([m]) => m.id === id)).toBe(true));

    return post.mock.calls.find(([m]) => m.id === id)![0];
  };

  return { frame, post, fetcher, dispatch, send, dispose };
}
it('binds to the mounted preview origin and never broadcasts credentials', async () => {
  const f = setup();
  const id = crypto.randomUUID();
  const data = { type: 'jingyue:auth-connect', id };
  f.dispatch(data, { source: window });
  f.dispatch(data, { origin: 'https://foreign.test' });
  f.dispatch({ ...data, password: 'should-not-be-accepted' });
  expect(f.post).not.toHaveBeenCalled();
  f.dispatch(data);
  expect(f.post).toHaveBeenCalledWith({ type: 'jingyue:auth-connected', id }, origin);
  expect(f.fetcher).not.toHaveBeenCalled();
});
it('uses only parent-selected account/project, same-origin cookies and a profile-only response', async () => {
  const f = setup();
  const body = { action: 'login', username: 'demo', password: 'Synthetic-only-7248' };
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const result = await f.send(body);
  const [url, init] = f.fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`/api/app-auth/${project}`);
  expect(init.credentials).toBe('same-origin');
  expect(new Headers(init.headers).get('X-Jingyue-User')).toBe(account);
  expect(JSON.parse(String(init.body))).toEqual(body);
  expect(result.result.user.username).toBe('demo');
  expect(JSON.stringify(result)).not.toMatch(/token|password|secret/);
  expect(storage).not.toHaveBeenCalled();
});
it('rejects forged scope, admin operations and prototype action names', async () => {
  const f = setup();

  for (const body of [
    { action: 'session', projectId: project },
    { action: 'status' },
    { action: 'sql' },
    { action: 'toString' },
    { action: '__proto__' },
  ]) {
    expect((await f.send(body)).error.code).toBe('APP_AUTH_INVALID');
  }
  expect(f.fetcher).not.toHaveBeenCalled();
});
it('sanitizes upstream errors and blocks late responses after preview disposal', async () => {
  const f = setup();
  f.fetcher.mockResolvedValueOnce(
    Response.json({ error: { code: 'APP_AUTH_CREDENTIALS', message: 'secret upstream' } }, { status: 401 }),
  );
  expect((await f.send({ action: 'login', username: 'demo', password: 'wrong' })).error.message).toBe(
    '账号或密码不正确。',
  );

  let done!: (value: Response) => void;
  f.fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  f.dispatch({ type: 'jingyue:auth-request', id: crypto.randomUUID(), body: { action: 'session' } });

  const calls = f.post.mock.calls.length;
  f.dispose();
  done(Response.json({ user: null }));
  await Promise.resolve();
  await Promise.resolve();
  expect(f.post.mock.calls.length).toBe(calls);
});
it('fails closed unless the server confirms the exact preview-only capability', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ enabled: true, provider: 'supabase-auth', scope: 'workbench-preview' }));
  vi.stubGlobal('fetch', fetcher);
  expect(await previewAppAuthEnabled(project, account)).toBe(true);
  fetcher.mockResolvedValueOnce(Response.json({ enabled: true, provider: 'supabase-auth', scope: 'public' }));
  expect(await previewAppAuthEnabled(project, account)).toBe(false);
  fetcher.mockRejectedValueOnce(new Error('offline'));
  expect(await previewAppAuthEnabled(project, account)).toBe(false);
});
