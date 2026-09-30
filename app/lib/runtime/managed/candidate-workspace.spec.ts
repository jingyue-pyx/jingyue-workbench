import type { WebContainer } from '@webcontainer/api';
import { describe, expect, it, vi } from 'vitest';
import { compileCandidate } from './candidate-workspace';
import { RunError } from './protocol';

function fixture() {
  const rm = vi.fn().mockResolvedValue(undefined);
  const container = Promise.resolve({ fs: { rm } } as unknown as WebContainer);
  const runtime = {
    writeSource: vi.fn().mockResolvedValue(undefined),
    compile: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  };
  const runtimeFactory = vi.fn((_directory: string) => runtime);

  return { rm, container, runtime, runtimeFactory };
}
describe('isolated candidate compilation', () => {
  it('uses a unique staging directory, prepares exactly the compiled bytes and removes only that directory', async () => {
    const f = fixture();
    const files = { 'src/App.tsx': 'original' };
    await compileCandidate(f.container, files, new AbortController().signal, vi.fn(), {
      runtimeFactory: f.runtimeFactory,
      prepare: (_path, content) => content + ' instrumented',
    });

    const directory = f.runtimeFactory.mock.calls[0][0];
    expect(directory).toMatch(/^\.jingyue-candidates\/[\da-f-]+$/);
    expect(f.runtime.writeSource).toHaveBeenCalledWith('src/App.tsx', 'original instrumented', expect.any(AbortSignal));
    expect(f.runtime.compile).toHaveBeenCalledWith(
      { 'src/App.tsx': 'original instrumented' },
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(files).toEqual({ 'src/App.tsx': 'original' });
    expect(f.rm).toHaveBeenCalledOnce();
    expect(f.rm).toHaveBeenCalledWith(directory, { recursive: true, force: true });
    expect(f.runtime.stop).toHaveBeenCalledOnce();
  });
  it('preserves the compiler error even if staging cleanup fails', async () => {
    const f = fixture();
    f.runtime.compile.mockRejectedValue(new RunError('TS2322 candidate failed', true, 'compile'));
    f.rm.mockRejectedValue(new Error('cleanup failed'));
    await expect(
      compileCandidate(f.container, { 'src/App.tsx': 'source' }, new AbortController().signal, vi.fn(), f),
    ).rejects.toMatchObject({ message: 'TS2322 candidate failed', category: 'compile' });
    expect(f.runtime.stop).toHaveBeenCalledOnce();
  });
  it('cancels staging without continuing into compilation', async () => {
    const f = fixture();
    const abort = new AbortController();
    f.runtime.writeSource.mockImplementation(async () => {
      abort.abort(new Error('stop staging'));
    });
    await expect(compileCandidate(f.container, { 'src/App.tsx': 'source' }, abort.signal, vi.fn(), f)).rejects.toThrow(
      'stop staging',
    );
    expect(f.runtime.compile).not.toHaveBeenCalled();
    expect(f.runtime.stop).toHaveBeenCalledOnce();
  });
  it.each(['../live.ts', '/private.ts', '.jingyue-candidates/other/file.ts', 'node_modules/private.ts'])(
    'rejects out-of-scope source path %s before writing',
    async (path) => {
      const f = fixture();
      await expect(
        compileCandidate(f.container, { [path]: 'source' }, new AbortController().signal, vi.fn(), f),
      ).rejects.toThrow('候选源码路径非法');
      expect(f.runtime.writeSource).not.toHaveBeenCalled();
    },
  );
});
