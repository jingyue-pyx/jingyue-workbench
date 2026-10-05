import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import type { Snapshot } from '~/lib/persistence/types';
import { binaryBase64, buildPublishArtifacts, publishingSources } from './build';

const snapshot = (): Snapshot => ({
  chatIndex: 'test',
  files: {
    'package.json': {
      type: 'file',
      isBinary: false,
      content: JSON.stringify({ dependencies: { react: '18.3.1' }, devDependencies: { vite: '5.4.21' } }),
    },
    'src/main.jsx': { type: 'file', isBinary: false, content: 'export default 1' },
    '.env': { type: 'file', isBinary: false, content: 'PRIVATE=must-not-copy' },
    'public/a.png': { type: 'file', isBinary: true, content: 'AP+A' },
  },
});

const fakeContainer = (exit = 0) => {
  const writes: string[] = [];
  const spawn = vi.fn(async (_command: string, _args: string[], _options: unknown) => ({
    exit: Promise.resolve(exit),
    kill: vi.fn(),
    output: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  }));
  const fs = {
    mkdir: vi.fn(async () => {}),
    writeFile: vi.fn(async (path: string) => {
      writes.push(path);
    }),
    rm: vi.fn(async () => {}),
    readdir: vi.fn(async () => [
      { name: 'index.html', isFile: () => true, isDirectory: () => false },
      { name: 'a.png', isFile: () => true, isDirectory: () => false },
    ]),
    readFile: vi.fn(async (path: string) =>
      path.endsWith('.png') ? Uint8Array.from([0, 255, 128]) : new TextEncoder().encode('<h1>Demo</h1>'),
    ),
  };

  return { container: { spawn, fs } as unknown as WebContainer, spawn, fs, writes };
};
afterEach(() => vi.useRealTimers());

describe('static publishing build boundary', () => {
  it('uses process exit even when the SDK never closes stdout', async () => {
    vi.useFakeTimers();

    const f = fakeContainer();
    f.spawn.mockImplementation(async () => ({
      exit: Promise.resolve(0),
      kill: vi.fn(),
      output: new ReadableStream({
        start(c) {
          c.enqueue('done');
        },
      }),
    }));

    const result = buildPublishArtifacts(f.container, snapshot(), new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(2500);
    await expect(result).resolves.toHaveLength(2);
    expect(f.spawn).toHaveBeenCalledTimes(2);
  });
  it('retries only a transient install failure and never duplicates the build', async () => {
    vi.useFakeTimers();

    const f = fakeContainer();
    f.spawn.mockResolvedValueOnce({
      exit: Promise.resolve(1),
      kill: vi.fn(),
      output: new ReadableStream({
        start(c) {
          c.enqueue('npm error ECONNRESET');
          c.close();
        },
      }),
    });

    const result = buildPublishArtifacts(f.container, snapshot(), new AbortController().signal, vi.fn());
    await vi.advanceTimersByTimeAsync(1100);
    await expect(result).resolves.toHaveLength(2);
    expect(f.spawn.mock.calls.filter(([, args]) => args[0] === 'install')).toHaveLength(2);
    expect(f.spawn.mock.calls.filter(([, args]) => args.includes('build'))).toHaveLength(1);
  });
  it('does not retry a package conflict', async () => {
    const f = fakeContainer(1);
    await expect(buildPublishArtifacts(f.container, snapshot(), new AbortController().signal, vi.fn())).rejects.toThrow(
      '未上传',
    );
    expect(f.spawn).toHaveBeenCalledTimes(1);
  });
  it('copies only the frozen snapshot and preserves binary content', () => {
    const files = publishingSources(snapshot());
    expect(files['.env']).toBeUndefined();
    expect(files['public/a.png']).toEqual(Uint8Array.from([0, 255, 128]));
    expect(binaryBase64(files['public/a.png'] as Uint8Array)).toBe('AP+A');
  });
  it('rejects missing packages, path traversal and full backend frameworks', () => {
    const bad = snapshot();
    bad.files['../outside'] = { type: 'file', content: 'x', isBinary: false };
    expect(() => publishingSources(bad)).toThrow();
    expect(() => publishingSources({ chatIndex: 'x', files: {} })).toThrow();

    const next = snapshot();
    next.files['package.json'] = { type: 'file', isBinary: false, content: '{"dependencies":{"next":"1"}}' };
    expect(() => publishingSources(next)).toThrow('React + Vite');
  });
  it('builds in a separate directory, never invokes generated build scripts, collects bytes and cleans up', async () => {
    const f = fakeContainer();
    const files = await buildPublishArtifacts(f.container, snapshot(), new AbortController().signal, vi.fn());
    expect(files.find((file) => file.path === 'a.png')?.base64).toBe('AP+A');
    expect(f.writes.every((path) => path.startsWith('/tmp/jingyue-publish-'))).toBe(true);
    expect(f.writes.some((path) => path.endsWith('/.env'))).toBe(false);
    expect(f.spawn).toHaveBeenCalledTimes(2);
    expect(f.spawn.mock.calls[1]?.[1]).toEqual([
      'exec',
      '--no',
      '--',
      'vite',
      'build',
      '--outDir',
      'dist',
      '--emptyOutDir',
      '--base',
      '/',
    ]);
    expect(f.fs.rm).toHaveBeenCalledTimes(1);
  });
  it('build failure or cancellation never returns an uploadable candidate', async () => {
    const f = fakeContainer(1);
    await expect(buildPublishArtifacts(f.container, snapshot(), new AbortController().signal, vi.fn())).rejects.toThrow(
      '未上传',
    );
    expect(f.fs.readdir).not.toHaveBeenCalled();

    const cancelled = new AbortController();
    cancelled.abort();
    await expect(buildPublishArtifacts(f.container, snapshot(), cancelled.signal, vi.fn())).rejects.toThrow();
  });
  it('rejects symlinks in output rather than following them outside dist', async () => {
    const f = fakeContainer();
    f.fs.readdir.mockResolvedValue([{ name: 'outside', isFile: () => false, isDirectory: () => false }]);
    await expect(buildPublishArtifacts(f.container, snapshot(), new AbortController().signal, vi.fn())).rejects.toThrow(
      '非普通文件',
    );
  });
});
