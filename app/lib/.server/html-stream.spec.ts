import { describe, expect, it, vi } from 'vitest';
import { frameHtmlStream } from './html-stream';

describe('SSR HTML streaming', () => {
  it('frames successful content exactly once', async () => {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('content'));
        controller.close();
      },
    });
    expect(await new Response(frameHtmlStream(source, '<body>', '</body>')).text()).toBe('<body>content</body>');
    expect(source.locked).toBe(false);
  });

  it('cancels the owning reader while a read is pending without a locked-stream rejection', async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });
    const reader = frameHtmlStream(source, '<body>', '</body>').getReader();
    await reader.read();
    const pending = reader.read();
    await expect(reader.cancel('navigation')).resolves.toBeUndefined();
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(cancel).toHaveBeenCalledWith('navigation');
    expect(source.locked).toBe(false);
  });

  it('propagates source errors without creating a second unhandled cancellation rejection', async () => {
    const failure = new Error('render failed');
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(failure);
      },
    });
    await expect(new Response(frameHtmlStream(source, '<body>', '</body>')).text()).rejects.toBe(failure);
    expect(source.locked).toBe(false);
  });

  it('settles cancellation even if the source cancel callback rejects', async () => {
    const source = new ReadableStream<Uint8Array>({
      cancel() {
        return Promise.reject(new Error('source already aborted'));
      },
    });
    await expect(frameHtmlStream(source, '<body>', '</body>').cancel()).resolves.toBeUndefined();
    expect(source.locked).toBe(false);
  });
});
