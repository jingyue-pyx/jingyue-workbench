// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { PreviewsStore } from './previews';
import type { WebContainer } from '@webcontainer/api';

afterEach(() => vi.unstubAllGlobals());

async function connectedStore() {
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      onmessage = null;
      postMessage = vi.fn();
    },
  );

  const listeners = new Map<string, (...args: any[]) => void>();
  const store = new PreviewsStore(
    Promise.resolve({
      on: (name: string, listener: (...args: any[]) => void) => {
        listeners.set(name, listener);
      },
      internal: { watchPaths: vi.fn() },
    } as unknown as WebContainer),
  );
  await Promise.resolve();

  return { store, emit: (name: string, ...args: any[]) => listeners.get(name)!(...args) };
}

it('does not mount a preview until server-ready, and ignores a late port-open event', async () => {
  const { store, emit } = await connectedStore();
  emit('port', 5173, 'open', 'https://preview.test');
  expect(store.previews.get()[0].ready).toBe(false);
  emit('server-ready', 5173, 'https://preview.test');
  expect(store.previews.get()[0].ready).toBe(true);

  const preview = store.previews.get()[0];
  emit('port', 5173, 'open', 'https://preview.test');
  expect(store.previews.get()[0]).toBe(preview);
});

it('revisions same-URL restarts without switching selected port order', async () => {
  const { store, emit } = await connectedStore();
  emit('server-ready', 5173, 'https://one.test');
  emit('server-ready', 5174, 'https://two.test');

  const revision = store.previews.get()[0].revision!;
  emit('server-ready', 5173, 'https://one.test');
  expect(store.previews.get().map((preview) => preview.port)).toEqual([5173, 5174]);
  expect(store.previews.get()[0].revision).toBeGreaterThan(revision);
});

it('removes a closed port and does not add unknown close events', async () => {
  const { store, emit } = await connectedStore();
  emit('port', 9999, 'close', 'https://unknown.test');
  expect(store.previews.get()).toEqual([]);
  emit('server-ready', 5173, 'https://preview.test');
  emit('port', 5173, 'close', 'https://preview.test');
  expect(store.previews.get()).toEqual([]);
});

it('does not broadcast account storage or reload sandbox iframes on DOM mutations', () => {
  const channels: string[] = [];

  class Channel {
    onmessage = null;
    constructor(name: string) {
      channels.push(name);
    }
    postMessage = vi.fn();
  }

  const observe = vi.fn();
  vi.stubGlobal('BroadcastChannel', Channel);
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe = observe;
    },
  );

  const store = new PreviewsStore(new Promise<WebContainer>(() => undefined));
  expect(store.previews.get()).toEqual([]);
  expect(channels).toEqual(['preview-updates']);
  expect(observe).not.toHaveBeenCalled();
});
