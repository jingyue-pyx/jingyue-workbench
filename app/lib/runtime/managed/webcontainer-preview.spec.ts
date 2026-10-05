// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import { reloadPreview } from '@webcontainer/api/utils';
import {
  previewProbeScript,
  previewServerScript,
  waitForPreviewFrame,
  WebContainerRuntime,
} from './webcontainer-runtime';

vi.mock('@webcontainer/api/utils', () => ({ reloadPreview: vi.fn().mockResolvedValue(undefined) }));

const files = {
  'package.json': JSON.stringify({ dependencies: { react: '18.3.1', 'react-dom': '18.3.1', vite: '5.4.21' } }),
  'index.html': '<div id="root"></div>',
};

function fixture() {
  const visible = document.createElement('iframe');
  visible.title = 'preview';
  visible.src = 'https://preview.example.test';
  document.body.appendChild(visible);

  let ready: (_port: number, _url: string) => void = () => {};
  const kill = vi.fn();
  const runtime = new WebContainerRuntime(
    Promise.resolve({
      fs: {
        readFile: vi.fn().mockResolvedValue('{}'),
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
      },
      setPreviewScript: vi.fn().mockResolvedValue(undefined),
      on: (_event: string, listener: typeof ready) => {
        ready = listener;
        return vi.fn();
      },
      spawn: vi.fn(async () => {
        queueMicrotask(() => ready(5173, 'https://preview.example.test'));
        return {
          kill,
          exit: new Promise(() => {}),
          output: new ReadableStream({
            start(c) {
              c.close();
            },
          }),
        };
      }),
    } as unknown as WebContainer),
  );
  vi.spyOn(runtime, 'command').mockResolvedValue(undefined);

  return runtime;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.mocked(reloadPreview).mockClear();
});

describe('preview verification handshake', () => {
  it('reconnects after a transport failure without reinstalling or rebuilding unchanged source', async () => {
    vi.useFakeTimers();

    const runtime = fixture();
    const first = runtime.verify(files, new AbortController().signal, vi.fn()).catch((e) => e);
    await vi.advanceTimersByTimeAsync(75001);
    expect(await first).toMatchObject({ category: 'preview-network' });

    const commandCount = vi.mocked(runtime.command).mock.calls.length;
    const stage = vi.fn();
    const second = runtime.verify(files, new AbortController().signal, stage);
    await vi.advanceTimersByTimeAsync(1);

    const frame = document.querySelector('iframe')!;
    const url = new URL(frame.src);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow!,
        origin: url.origin,
        data: {
          type: 'jingyue:runtime-check',
          runId: url.searchParams.get('__jingyue_check'),
          attempt: url.searchParams.get('__jingyue_attempt'),
          ok: true,
        },
      }),
    );
    await expect(second).resolves.toBe('https://preview.example.test');
    expect(vi.mocked(runtime.command).mock.calls).toHaveLength(commandCount);
    expect(stage.mock.calls.every(([phase]) => phase === 'previewing')).toBe(true);
    runtime.stop();
  });
  it('serves a self-contained probe without editing user HTML or replacing Vite configuration', () => {
    const script = previewServerScript(previewProbeScript('test-run', 'https://workbench.test'));
    expect(script).toContain("import { createServer } from 'vite'");
    expect(script).toContain("injectTo: 'head-prepend'");
    expect(script).toContain('jingyue:runtime-ready');
    expect(script).toContain('strictPort: true');
    expect(script).not.toContain('configFile: false');
  });
  it('requires the expected iframe, origin and run id before reporting success', async () => {
    const runtime = fixture();
    let complete = false;
    const result = runtime.verify(files, new AbortController().signal, vi.fn()).then((url) => {
      complete = true;
      return url;
    });
    await vi.waitFor(() => expect(document.querySelector('iframe')!.src).toContain('__jingyue_attempt'));

    const frame = document.querySelector('iframe')!;
    expect(frame.title).toBe('preview');
    expect(document.querySelectorAll('iframe').length).toBe(1);

    const runId = new URL(frame.src).searchParams.get('__jingyue_check');
    const data = {
      type: 'jingyue:runtime-check',
      runId,
      attempt: new URL(frame.src).searchParams.get('__jingyue_attempt'),
      ok: true,
    };
    window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'https://preview.example.test', data }));
    window.dispatchEvent(
      new MessageEvent('message', { source: frame.contentWindow!, origin: 'https://wrong.test', data }),
    );
    await Promise.resolve();
    expect(complete).toBe(false);
    window.dispatchEvent(
      new MessageEvent('message', { source: frame.contentWindow!, origin: 'https://preview.example.test', data }),
    );
    expect(await result).toBe('https://preview.example.test');
    expect(document.querySelector('iframe')).toBe(frame);
    runtime.stop();
  });
  it('classifies an unreachable preview as infrastructure failure, not model-repairable code', async () => {
    vi.useFakeTimers();

    const runtime = fixture();
    const result = runtime.verify(files, new AbortController().signal, vi.fn()).catch((error) => error);
    await vi.advanceTimersByTimeAsync(75001);
    expect(await result).toMatchObject({ category: 'preview-network', repairable: false });
    expect(document.querySelector('iframe')!.title).toBe('preview');
    expect(reloadPreview).toHaveBeenCalledTimes(3);
    runtime.stop();
  });
  it('tries SDK reconnection but never equates a reload acknowledgement with a mounted page', async () => {
    vi.useFakeTimers();

    const runtime = fixture();
    const abort = new AbortController();
    let complete = false;
    const result = runtime.verify(files, abort.signal, vi.fn()).then(
      () => {
        complete = true;
      },
      (error) => error,
    );
    await vi.advanceTimersByTimeAsync(8001);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(complete).toBe(false);
    abort.abort(new Error('stopped'));
    expect((await result).message).toBe('stopped');
    await vi.advanceTimersByTimeAsync(75000);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    runtime.stop();
  });
  it('stops checking immediately when cancelled without removing the user preview', async () => {
    const runtime = fixture();
    const abort = new AbortController();
    const result = runtime.verify(files, abort.signal, vi.fn()).catch((error) => error);
    await vi.waitFor(() => expect(document.querySelector('iframe')!.src).toContain('__jingyue_attempt'));

    const frame = document.querySelector('iframe');
    abort.abort(new Error('stopped'));
    expect((await result).message).toBe('stopped');
    expect(document.querySelector('iframe')).toBe(frame);
    runtime.stop();
  });
  it('does not reload a connected slow page at the old twelve-second deadline', async () => {
    vi.useFakeTimers();

    const runtime = fixture();
    const result = runtime.verify(files, new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(1);

    const frame = document.querySelector('iframe')!;
    const url = new URL(frame.src);
    const base = { runId: url.searchParams.get('__jingyue_check'), attempt: url.searchParams.get('__jingyue_attempt') };
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow!,
        origin: url.origin,
        data: { ...base, type: 'jingyue:runtime-ready' },
      }),
    );
    await vi.advanceTimersByTimeAsync(16000);
    expect(frame.src).toBe(url.href);
    expect(reloadPreview).not.toHaveBeenCalled();
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow!,
        origin: url.origin,
        data: { ...base, type: 'jingyue:runtime-check', ok: true },
      }),
    );
    await expect(result).resolves.toBe('https://preview.example.test');
    runtime.stop();
  });
  it('retries only the connection, rejects an old attempt, and accepts the current handshake', async () => {
    vi.useFakeTimers();

    const runtime = fixture();
    const result = runtime.verify(files, new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(1);

    const frame = document.querySelector('iframe')!;
    const first = new URL(frame.src);
    await vi.advanceTimersByTimeAsync(25000);

    const second = new URL(frame.src);
    expect(second.searchParams.get('__jingyue_attempt')).not.toBe(first.searchParams.get('__jingyue_attempt'));

    const send = (url: URL) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow!,
          origin: url.origin,
          data: {
            type: 'jingyue:runtime-check',
            runId: url.searchParams.get('__jingyue_check'),
            attempt: url.searchParams.get('__jingyue_attempt'),
            ok: true,
          },
        }),
      );
    send(first);
    expect(document.querySelector('iframe')).toBe(frame);
    send(second);
    await expect(result).resolves.toBe('https://preview.example.test');
    runtime.stop();
  });
});

describe('visible preview mount coordination', () => {
  it('waits for the real frame to mount and its source to match the current server', async () => {
    const result = waitForPreviewFrame('https://preview.example.test', new AbortController().signal);
    const frame = document.createElement('iframe');
    frame.title = 'preview';
    frame.src = 'https://old-preview.example.test';
    document.body.appendChild(frame);

    let complete = false;
    void result.then(() => {
      complete = true;
    });
    await Promise.resolve();
    expect(complete).toBe(false);
    frame.src = 'https://preview.example.test';
    expect(await result).toBe(frame);
    expect(document.querySelectorAll('iframe').length).toBe(1);
  });

  it('bounds mount waiting and permits cancellation without adding a hidden app instance', async () => {
    vi.useFakeTimers();

    const abort = new AbortController();
    const result = waitForPreviewFrame('https://preview.example.test', abort.signal).catch((e) => e);
    abort.abort(new Error('cancelled'));
    expect((await result).message).toBe('cancelled');

    const timeout = waitForPreviewFrame('https://preview.example.test', new AbortController().signal).catch((e) => e);
    await vi.advanceTimersByTimeAsync(15001);
    expect(await timeout).toMatchObject({ category: 'preview-network', repairable: false });
    expect(document.querySelector('iframe')).toBeNull();
  });
});
