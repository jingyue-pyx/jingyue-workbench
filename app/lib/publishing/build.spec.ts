import { describe, expect, it, vi } from 'vitest';
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

describe('static publishing build boundary', () => {
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
