// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachDemoDataBridge } from './bridge';

const project = '11111111-1111-4111-8111-111111111111';
const account = '22222222-2222-4222-8222-222222222222';
const origin = 'https://preview.example.test';
const prefix = `jingyue:demo-data:${account}:${project}:orders`;
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  document.body.innerHTML = '';
  localStorage.clear();
});

function setup() {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);

  const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  const fetcher = vi.fn(async () => Response.json({ revision: 0, value: null, updatedAt: null }));
  cleanup.push(
    attachDemoDataBridge({
      target: window,
      iframe: () => frame,
      origin,
      projectId: project,
      accountId: account,
      storage: localStorage,
      fetcher,
    }),
  );

  const send = async (body: object, overrides: Partial<MessageEventInit> = {}) => {
    const id = crypto.randomUUID();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow!,
        origin,
        data: { type: 'jingyue:data-request', id, body },
        ...overrides,
      }),
    );
    await vi.waitFor(() => expect(post.mock.calls.some(([msg]) => msg.id === id)).toBe(true));

    return post.mock.calls.find(([msg]) => msg.id === id)![0];
  };

  return { frame, post, fetcher, send };
}
describe('credential-free preview storage bridge', () => {
  it('acknowledges a nonce-only handshake only from the mounted preview', async () => {
    const f = setup();
    const id = crypto.randomUUID();
    const data = { type: 'jingyue:data-connect', id };
    window.dispatchEvent(new MessageEvent('message', { source: window, origin, data }));
    window.dispatchEvent(
      new MessageEvent('message', { source: f.frame.contentWindow!, origin: 'https://other.test', data }),
    );
    expect(f.post).not.toHaveBeenCalled();
    window.dispatchEvent(new MessageEvent('message', { source: f.frame.contentWindow!, origin, data }));
    expect(f.post).toHaveBeenCalledWith({ type: 'jingyue:data-connected', id }, origin);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('rejects foreign windows, incorrect origins and ownership fields', async () => {
    const f = setup();
    const data = { type: 'jingyue:data-request', id: crypto.randomUUID(), body: { action: 'read', key: 'orders' } };
    window.dispatchEvent(new MessageEvent('message', { source: window, origin, data }));
    window.dispatchEvent(
      new MessageEvent('message', { source: f.frame.contentWindow!, origin: 'https://other.test', data }),
    );
    await Promise.resolve();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.post).not.toHaveBeenCalled();
    expect((await f.send({ action: 'read', key: 'orders', ownerId: account })).error.code).toBe('INVALID_DATA');
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('sends authenticated same-origin requests using the host-selected project only', async () => {
    const f = setup();
    await f.send({ action: 'read', key: 'orders' });

    const [url, init] = f.fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/demo-data/${project}`);
    expect(init.credentials).toBe('same-origin');
    expect(new Headers(init.headers).get('X-Jingyue-User')).toBe(account);
    expect(f.post.mock.calls[0][1]).toBe(origin);
    expect(JSON.stringify(f.post.mock.calls)).not.toContain(account);
  });
  it('retains newest draft while an older write is in flight and clears only acknowledged content', async () => {
    const f = setup();
    await f.send({ action: 'draft', key: 'orders', value: { count: 1 }, baseRevision: 0 });
    expect(f.fetcher).not.toHaveBeenCalled();

    let complete!: (response: Response) => void;
    f.fetcher.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );

    const pending = f.send({
      action: 'write',
      key: 'orders',
      value: { count: 1 },
      baseRevision: 0,
      requestId: crypto.randomUUID(),
    });
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce());
    await f.send({ action: 'draft', key: 'orders', value: { count: 2 }, baseRevision: 0 });
    complete(Response.json({ revision: 1, value: { count: 1 }, updatedAt: null }));
    await pending;
    expect(JSON.parse(localStorage.getItem(prefix)!)).toMatchObject({ value: { count: 2 }, baseRevision: 1 });
    expect(localStorage.getItem(prefix + ':pending')).toBeNull();
    f.fetcher.mockResolvedValueOnce(Response.json({ revision: 1, value: { count: 1 }, updatedAt: null }));

    const recovered = await f.send({ action: 'read', key: 'orders' });
    expect(recovered.result.draft).toMatchObject({ value: { count: 2 }, baseRevision: 1 });
    expect(recovered.result.conflict).toBe(false);
  });
  it('recovers lost acknowledgements while preserving newer edits across refresh', async () => {
    const f = setup();
    localStorage.setItem(
      prefix,
      JSON.stringify({ action: 'draft', key: 'orders', value: { count: 2 }, baseRevision: 0 }),
    );
    localStorage.setItem(
      prefix + ':pending',
      JSON.stringify({
        action: 'write',
        key: 'orders',
        value: { count: 1 },
        baseRevision: 0,
        requestId: crypto.randomUUID(),
      }),
    );
    f.fetcher.mockResolvedValueOnce(Response.json({ revision: 1, value: { count: 1 }, updatedAt: null }));

    const result = await f.send({ action: 'read', key: 'orders' });
    expect(result.result.draft).toMatchObject({ value: { count: 2 }, baseRevision: 1 });
    expect(result.result.conflict).toBe(false);
  });
  it('does not discard drafts after conflict, server outage or client disposal', async () => {
    const f = setup();
    await f.send({ action: 'draft', key: 'orders', value: { count: 3 }, baseRevision: 0 });
    f.fetcher.mockResolvedValueOnce(
      Response.json({ error: { code: 'DATA_CONFLICT', message: 'do not trust raw upstream text' } }, { status: 409 }),
    );

    const result = await f.send({
      action: 'write',
      key: 'orders',
      value: { count: 3 },
      baseRevision: 0,
      requestId: crypto.randomUUID(),
    });
    expect(result.error.code).toBe('DATA_CONFLICT');
    expect(result.error.message).not.toContain('upstream');
    expect(localStorage.getItem(prefix)).not.toBeNull();
    expect(localStorage.getItem(prefix + ':pending')).not.toBeNull();
  });
  it('recognizes a lost acknowledgement when JSONB returns object keys in a different order', async () => {
    const f = setup();
    const value = { orders: [{ quantity: 2, name: 'paper' }], count: 1 };
    localStorage.setItem(prefix, JSON.stringify({ action: 'draft', key: 'orders', value, baseRevision: 0 }));
    localStorage.setItem(
      prefix + ':pending',
      JSON.stringify({ action: 'write', key: 'orders', value, baseRevision: 0, requestId: crypto.randomUUID() }),
    );
    f.fetcher.mockResolvedValueOnce(
      Response.json({ revision: 1, value: { count: 1, orders: [{ name: 'paper', quantity: 2 }] }, updatedAt: null }),
    );

    const recovered = await f.send({ action: 'read', key: 'orders' });
    expect(recovered.result.draft).toBeUndefined();
    expect(localStorage.getItem(prefix)).toBeNull();
    expect(localStorage.getItem(prefix + ':pending')).toBeNull();
  });
});
