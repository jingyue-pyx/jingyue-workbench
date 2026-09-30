// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { previewDataRequest } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('broadcasts only a nonce and sends data only after an exact parent handshake', async () => {
  const parent = { postMessage: vi.fn() };
  vi.stubGlobal('parent', parent);

  const value = { action: 'read', key: 'orders' };
  const result = previewDataRequest(value);
  const [hello, target] = parent.postMessage.mock.calls[0];
  expect(target).toBe('*');
  expect(Object.keys(hello).sort()).toEqual(['id', 'type']);

  const connected = { type: 'jingyue:data-connected', id: hello.id };
  window.dispatchEvent(
    new MessageEvent('message', { source: window, origin: 'https://untrusted.test', data: connected }),
  );
  expect(parent.postMessage).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new MessageEvent('message', { source: parent as any, origin: 'null', data: connected }));
  expect(parent.postMessage).toHaveBeenCalledTimes(1);
  window.dispatchEvent(
    new MessageEvent('message', { source: parent as any, origin: 'https://workbench.test', data: connected }),
  );
  expect(parent.postMessage).toHaveBeenLastCalledWith(
    { type: 'jingyue:data-request', id: hello.id, body: value },
    'https://workbench.test',
  );

  const payload = { revision: 1, value: { count: 2 }, updatedAt: null };
  window.dispatchEvent(
    new MessageEvent('message', {
      source: parent as any,
      origin: 'https://workbench.test',
      data: { type: 'jingyue:data-response', id: hello.id, result: payload },
    }),
  );
  await expect(result).resolves.toEqual(payload);
});

it('rejects standalone pages without a workbench parent', async () => {
  await expect(previewDataRequest({ action: 'read', key: 'orders' })).rejects.toMatchObject({ code: 'NO_WORKBENCH' });
});
