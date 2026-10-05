// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { appAuthRequest, useAppAuth, createAppAuthState } from './client';

const origin = 'http://127.0.0.1:9035';
const user = { id: 'test-user', username: 'demo', displayName: '演示用户' };
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function transport() {
  let session: typeof user | null = null;
  const calls: any[] = [];
  const parent = {
    postMessage: vi.fn((message: any, target: string) => {
      calls.push({ message, target });
      queueMicrotask(() => {
        const send = (body: object) =>
          window.dispatchEvent(
            new MessageEvent('message', { source: parent as any, origin, data: { id: message.id, ...body } }),
          );

        if (message.type === 'jingyue:auth-connect') {
          send({ type: 'jingyue:auth-connected' });
        } else {
          const { action, password } = message.body;

          if (action === 'login' && password === 'wrong') {
            send({ type: 'jingyue:auth-response', error: { message: '账号或密码不正确。' } });
            return;
          }

          if (action === 'register' || action === 'login') {
            session = user;
          }

          if (action === 'logout') {
            session = null;
          }

          send({ type: 'jingyue:auth-response', result: { user: session } });
        }
      });
    }),
  };
  vi.stubGlobal('parent', parent);

  return { calls };
}
it('supports register, refresh/remount, logout and wrong-password errors without browser storage', async () => {
  const f = transport();
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const first = renderHook(() => useAppAuth(), { wrapper: StrictMode });
  await waitFor(() => expect(first.result.current.loading).toBe(false));
  expect(first.result.current.user).toBeNull();
  await act(async () => {
    expect(await first.result.current.register('demo', 'Synthetic-only-7248', '演示用户')).toBe(true);
  });
  expect(first.result.current.user).toEqual(user);
  first.unmount();

  const next = renderHook(() => useAppAuth());
  const guard = renderHook(() => useAppAuth());
  await waitFor(() => expect(next.result.current.user).toEqual(user));
  await act(async () => {
    expect(await next.result.current.logout()).toBe(true);
  });
  expect(next.result.current.user).toBeNull();
  expect(guard.result.current.user).toBeNull();
  await act(async () => {
    expect(await next.result.current.login('demo', 'wrong')).toBe(false);
  });
  expect(next.result.current.error).toBe('账号或密码不正确。');
  expect(next.result.current.user).toBeNull();
  await act(async () => {
    expect(await next.result.current.login('demo', 'Synthetic-only-7248')).toBe(true);
  });
  expect(next.result.current.user).toEqual(user);
  expect(guard.result.current.user).toEqual(user);
  expect(write).not.toHaveBeenCalled();

  for (const call of f.calls) {
    if (call.target === '*') {
      expect(Object.keys(call.message).sort()).toEqual(['id', 'type']);
    } else {
      expect(call.target).toBe(origin);
    }
  }
});
it('deduplicates concurrent session checks and queues logout after an in-flight refresh', async () => {
  let finish!: (result: { user: typeof user | null }) => void;
  const request = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ user: null });
  const store = createAppAuthState(request);
  const a = store.run({ action: 'session' });
  const b = store.run({ action: 'session' });
  const logout = store.run({ action: 'logout' });
  await Promise.resolve();
  expect(request).toHaveBeenCalledOnce();
  finish({ user });
  expect(await a).toBe(true);
  expect(await b).toBe(true);
  expect(await logout).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][0]).toEqual({ action: 'logout' });
  expect(store.snapshot().user).toBeNull();
});
it('refuses standalone use instead of claiming a local mock login succeeded', async () => {
  await expect(appAuthRequest({ action: 'session' })).rejects.toThrow('仅在已登录的鲸月工作台预览中可用');
});
it('background session refresh does not hide the route or swallow the focused button', async () => {
  let finish!: (value: { user: typeof user }) => void;
  const request = vi
    .fn()
    .mockResolvedValueOnce({ user })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const store = createAppAuthState(request);
  await store.run({ action: 'session' });

  const refresh = store.run({ action: 'session' });
  await Promise.resolve();
  expect(store.snapshot()).toMatchObject({ user, loading: false });
  finish({ user });
  await refresh;
});
