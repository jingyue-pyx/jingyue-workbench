import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MANAGED_BUILD_TIMEOUT_MS, WebContainerRuntime } from './webcontainer-runtime';
import { RunError } from './protocol';

function processFixture(exit: Promise<number>, output = '', log?: (text: string) => void) {
  const kill = vi.fn();
  const process = {
    exit,
    kill,
    output: new ReadableStream<string>({
      start(controller) {
        controller.enqueue(output);
        controller.close();
      },
    }),
  } as unknown as WebContainerProcess;
  const spawn = vi.fn().mockResolvedValue(process);
  const wc = { workdir: '/home/project', spawn } as unknown as WebContainer;

  return { runtime: new WebContainerRuntime(Promise.resolve(wc), log), process, spawn, kill };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('independent runtime processes', () => {
  it('makes complete redacted compiler evidence available only to the local log callback', async () => {
    const log = vi.fn();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { runtime } = processFixture(
        Promise.resolve(2),
        'src/App.tsx(12,8): error TS2345: canary api_key=secret-value',
        log,
      );
      await expect(
        runtime.command('node', ['node_modules/typescript/bin/tsc'], new AbortController().signal, 1000),
      ).rejects.toMatchObject({ category: 'compile' });

      const complete = log.mock.calls.find(([text]) => text.startsWith('[类型检查诊断]'))?.[0];
      expect(complete).toContain('src/App.tsx(12,8): error TS2345');
      expect(complete).not.toContain('secret-value');
      expect(JSON.stringify(warning.mock.calls)).not.toContain('canary');
    } finally {
      warning.mockRestore();
    }
  });
  it('enriches missing icon errors with installed export names before model repair', async () => {
    const readFile = vi
      .fn()
      .mockImplementation(async (path: string) =>
        path.endsWith('index.d.ts')
          ? 'export declare const FaBullseye: IconType;\nexport declare const FaUsers: IconType;'
          : '{}',
      );
    const runtime = new WebContainerRuntime(
      Promise.resolve({ fs: { readFile } } as unknown as WebContainer),
      undefined,
      '.jingyue-candidates/test',
    );
    vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);

    const command = vi.spyOn(runtime, 'command').mockImplementation(async (_command, args) => {
      if (args[0] === 'node_modules/typescript/bin/tsc') {
        throw new RunError(
          'src/App.tsx(1,1): error TS2305: Module "react-icons/fa" has no exported member \'FaTarget\'.',
          true,
          'compile',
        );
      }
    });
    await expect(
      runtime.compile(
        {
          'package.json': JSON.stringify({
            dependencies: {
              react: '18.3.1',
              'react-dom': '18.3.1',
              vite: '5.4.21',
              typescript: '5.5.2',
              '@types/react': '18.3.3',
              '@types/react-dom': '18.3.0',
            },
          }),
          'src/App.tsx': 'export default function App() { return <h1>Hello</h1>; }',
          'index.html': '<div id="root"></div>',
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('FaBullseye');
    expect(readFile).toHaveBeenCalledWith('.jingyue-candidates/test/node_modules/react-icons/fa/index.d.ts', 'utf8');
    expect(command.mock.calls.filter(([name]) => name === 'npm')).toHaveLength(1);
  });
  it('passes the observed updater/value mismatch to repair without changing source or weakening type checks', async () => {
    const runtime = new WebContainerRuntime(
      Promise.resolve({ fs: { readFile: vi.fn().mockResolvedValue('{}') } } as unknown as WebContainer),
    );
    const write = vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);
    const diagnostic =
      "src/components/MarketingForm.tsx(26,17): error TS2345: Argument of type '(prev: string[]) => string[]' is not assignable to parameter of type 'string[]'.";
    vi.spyOn(runtime, 'command').mockImplementation(async (_command, args) => {
      if (args[0] === 'node_modules/typescript/bin/tsc') {
        throw new RunError(diagnostic, true, 'compile');
      }
    });
    await expect(
      runtime.compile(
        {
          'package.json': JSON.stringify({
            dependencies: {
              react: '18.3.1',
              'react-dom': '18.3.1',
              vite: '5.4.21',
              typescript: '5.5.2',
              '@types/react': '18.3.3',
              '@types/react-dom': '18.3.0',
            },
          }),
          'src/App.tsx': 'export default function App() { return <h1>Hello</h1>; }',
          'index.html': '<div id="root"></div>',
        },
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toMatchObject({
      category: 'compile',
      repairable: true,
      message: expect.stringContaining(diagnostic + '\nCALLBACK CONTRACT MISMATCH'),
    });
    expect(write.mock.calls.every(([path]) => path.startsWith('.jingyue-runtime/'))).toBe(true);

    const config = write.mock.calls.find(([path]) => path.endsWith('tsconfig.json'));
    expect(JSON.parse(config![1]).compilerOptions.strict).toBe(true);
  });
  it.each([130, 134, 137, 139, 143])('does not ask AI to repair a terminated sandbox process (%s)', async (code) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { runtime } = processFixture(Promise.resolve(code), 'private-source-canary');
      await expect(
        runtime.command('node', ['node_modules/typescript/bin/tsc'], new AbortController().signal, 1000),
      ).rejects.toMatchObject({ category: 'sandbox', repairable: false });
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private-source-canary');
      expect(warning).toHaveBeenCalledWith(
        '[Managed command failure]',
        JSON.stringify({ tool: 'typecheck', exitCode: code, typeScriptCodes: [], diagnosticOrigins: [] }),
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('records finite TypeScript diagnostic codes, never compiler source excerpts', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { runtime } = processFixture(
        Promise.resolve(2),
        'src/Private.tsx(3,1): error TS2305: private-source-canary\nsrc/Private.tsx(4,1): error TS2305: another-name\nerror TS2322: identifier',
      );
      await expect(
        runtime.command('node', ['node_modules/typescript/bin/tsc'], new AbortController().signal, 1000),
      ).rejects.toMatchObject({ category: 'compile', repairable: true });
      expect(warning).toHaveBeenCalledWith(
        '[Managed command failure]',
        JSON.stringify({
          tool: 'typecheck',
          exitCode: 2,
          typeScriptCodes: ['TS2305', 'TS2322'],
          diagnosticOrigins: ['source', 'other'],
        }),
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private-source-canary');
      expect(JSON.stringify(warning.mock.calls)).not.toContain('Private.tsx');
    } finally {
      warning.mockRestore();
    }
  });
  it('classifies dependency syntax damage separately from application syntax errors', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const dependency = processFixture(
        Promise.resolve(2),
        'node_modules/react-icons/fa/index.d.ts(10,1): error TS1005: token expected',
      );
      await expect(
        dependency.runtime.command('node', ['node_modules/typescript/bin/tsc'], new AbortController().signal, 1000),
      ).rejects.toMatchObject({ category: 'dependencies', repairable: false });

      const source = processFixture(Promise.resolve(2), 'src/App.tsx(10,1): error TS1005: token expected');
      await expect(
        source.runtime.command('node', ['node_modules/typescript/bin/tsc'], new AbortController().signal, 1000),
      ).rejects.toMatchObject({ category: 'compile', repairable: true });
    } finally {
      warning.mockRestore();
    }
  });

  it.each([false, true])(
    'reinstalls syntactically broken dependencies once without rewriting source (persistent=%s)',
    async (persistent) => {
      const fs = { readFile: vi.fn().mockResolvedValue('{}'), rm: vi.fn().mockResolvedValue(undefined) };
      const runtime = new WebContainerRuntime(
        Promise.resolve({ fs } as unknown as WebContainer),
        undefined,
        '.jingyue-candidates/test',
      );
      const write = vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);
      let checks = 0;
      const command = vi.spyOn(runtime, 'command').mockImplementation(async (_command, args) => {
        if (args[0] === 'node_modules/typescript/bin/tsc' && (++checks === 1 || persistent)) {
          throw new RunError('依赖包语法失败', false, 'dependencies');
        }
      });
      const files = {
        'package.json': JSON.stringify({
          dependencies: {
            react: '18.3.1',
            'react-dom': '18.3.1',
            vite: '5.4.21',
            typescript: '5.5.2',
            '@types/react': '18.3.3',
            '@types/react-dom': '18.3.0',
          },
        }),
        'index.html': '<div id="root"></div>',
        'src/App.tsx': 'export default function App(){return <main/>}',
      };
      const pending = runtime.compile(files, new AbortController().signal, vi.fn());

      if (persistent) {
        await expect(pending).rejects.toMatchObject({ category: 'dependencies', repairable: false });
      } else {
        await pending;
      }

      expect(checks).toBe(2);
      expect(fs.rm).toHaveBeenCalledOnce();
      expect(fs.rm).toHaveBeenCalledWith('.jingyue-candidates/test/node_modules', {
        recursive: true,
        force: true,
      });
      expect(command.mock.calls.filter(([cmd]) => cmd === 'npm')).toHaveLength(2);
      expect(write.mock.calls.some(([path]) => path.startsWith('src/'))).toBe(false);
    },
  );
  it('scopes candidate writes and spawned processes without touching the live cwd', async () => {
    const fs = { mkdir: vi.fn(), writeFile: vi.fn() };
    const { process } = processFixture(Promise.resolve(0));
    const spawn = vi.fn().mockResolvedValue(process);
    const runtime = new WebContainerRuntime(
      Promise.resolve({ fs, spawn } as unknown as WebContainer),
      undefined,
      '.jingyue-candidates/test',
    );
    await runtime.writeSource('src/App.tsx', 'candidate', new AbortController().signal);
    await runtime.command('node', ['--version'], new AbortController().signal, 1000);
    expect(fs.writeFile).toHaveBeenCalledWith('.jingyue-candidates/test/src/App.tsx', 'candidate');
    expect(spawn).toHaveBeenCalledWith('node', ['--version'], { cwd: '.jingyue-candidates/test' });
  });
  it('compiles candidates without opening a preview server or installing preview hooks', async () => {
    const setPreviewScript = vi.fn();
    const on = vi.fn();
    const readFile = vi.fn().mockResolvedValue('{}');
    const runtime = new WebContainerRuntime(
      Promise.resolve({ fs: { readFile }, setPreviewScript, on } as unknown as WebContainer),
      undefined,
      '.jingyue-candidates/test',
    );
    vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);

    const command = vi.spyOn(runtime, 'command').mockResolvedValue(undefined);
    await runtime.compile(
      {
        'package.json': JSON.stringify({ dependencies: { react: '18.3.1', 'react-dom': '18.3.1', vite: '5.4.21' } }),
        'index.html': '<div id="root"></div>',
      },
      new AbortController().signal,
      vi.fn(),
    );
    expect(readFile).toHaveBeenCalledWith('.jingyue-candidates/test/package-lock.json', 'utf8');
    expect(command.mock.calls.some(([, args]) => args.includes('build'))).toBe(true);
    expect(setPreviewScript).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
  });
  it('never type-checks disposable candidates as part of the live project', async () => {
    const runtime = new WebContainerRuntime(
      Promise.resolve({ fs: { readFile: vi.fn().mockResolvedValue('{}') } } as unknown as WebContainer),
    );
    const write = vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);
    vi.spyOn(runtime, 'command').mockResolvedValue(undefined);
    await runtime.compile(
      {
        'package.json': JSON.stringify({
          dependencies: {
            react: '18.3.1',
            'react-dom': '18.3.1',
            vite: '5.4.21',
            typescript: '5.5.2',
            '@types/react': '18.3.3',
            '@types/react-dom': '18.3.0',
          },
        }),
        'src/App.tsx': 'export default function App(){return <main/>}',
        'index.html': '<div id="root"></div>',
      },
      new AbortController().signal,
      vi.fn(),
    );

    const configuration = write.mock.calls.find(([path]) => path === '.jingyue-runtime/tsconfig.json');
    expect(JSON.parse(configuration![1]).exclude).toContain('../.jingyue-candidates');
    expect(JSON.parse(configuration![1]).compilerOptions.strict).toBe(true);
  });
  it.each(['..', '/home/project', '.jingyue-candidates/../live', '.jingyue-candidates'])(
    'rejects unsafe execution cwd %s',
    (cwd) => {
      expect(() => new WebContainerRuntime(Promise.resolve({} as WebContainer), undefined, cwd)).toThrow(
        '非法候选工作目录',
      );
    },
  );
  it('classifies a boot timeout as a sandbox failure, not a generation failure', async () => {
    vi.useFakeTimers();

    const runtime = new WebContainerRuntime(new Promise(() => {}));
    const result = runtime.ready(new AbortController().signal).catch((error) => error);
    await vi.advanceTimersByTimeAsync(45001);
    expect(await result).toMatchObject({ category: 'sandbox', repairable: false });
  });
  it('does not disclose raw SDK boot failures', async () => {
    const runtime = new WebContainerRuntime(Promise.reject(new Error('private-canary')));
    await expect(runtime.ready(new AbortController().signal)).rejects.toMatchObject({
      category: 'sandbox',
      message: '浏览器沙箱启动失败，请检查浏览器支持和网络后重试。',
    });
  });

  const jsFiles = {
    'package.json': JSON.stringify({ dependencies: { react: '18.3.1', 'react-dom': '18.3.1', vite: '5.4.21' } }),
    'index.html': '<div id="root"></div>',
  };
  it.each(['recovers', 'times-out', 'source-error', 'cancelled'])('bounds unchanged build retry: %s', async (mode) => {
    const runtime = new WebContainerRuntime(
      Promise.resolve({ fs: { readFile: vi.fn().mockResolvedValue('{}') } } as unknown as WebContainer),
    );
    vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);

    const abort = new AbortController();
    let builds = 0;
    const stage = vi.fn();
    vi.spyOn(runtime, 'command').mockImplementation(async (_command, args, _signal, timeoutMs) => {
      if (args[0] !== 'node_modules/vite/bin/vite.js') {
        return;
      }

      expect(timeoutMs).toBe(MANAGED_BUILD_TIMEOUT_MS);
      builds++;

      if (mode === 'cancelled') {
        abort.abort(new Error('explicit stop'));
      }

      if (mode === 'source-error') {
        throw new RunError('Invalid import', true, 'compile');
      }

      if (builds === 1 || mode === 'times-out') {
        throw new RunError('stalled worker', false, 'timeout');
      }
    });

    const result = runtime.compile(jsFiles, abort.signal, stage);

    if (mode === 'recovers') {
      await expect(result).resolves.toBeUndefined();
    } else if (mode === 'cancelled') {
      await expect(result).rejects.toThrow('explicit stop');
    } else {
      await expect(result).rejects.toMatchObject({ category: mode === 'source-error' ? 'compile' : 'timeout' });
    }

    expect(builds).toBe(mode === 'cancelled' || mode === 'source-error' ? 1 : 2);
  });

  it('reuses an install when the saved snapshot omits the runtime-generated lockfile', async () => {
    const runtime = new WebContainerRuntime(
      Promise.resolve({ fs: { readFile: vi.fn().mockResolvedValue('{}') } } as unknown as WebContainer),
    );
    vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);

    const command = vi.spyOn(runtime, 'command').mockResolvedValue(undefined);
    await runtime.compile(jsFiles, new AbortController().signal, vi.fn());
    await runtime.compile(jsFiles, new AbortController().signal, vi.fn());
    expect(command.mock.calls.filter(([cmd]) => cmd === 'npm')).toHaveLength(1);
    expect(command.mock.calls.filter(([, args]) => args[0] === '.jingyue-runtime/check-install.mjs')).toHaveLength(2);

    const changed = { ...jsFiles, 'package.json': jsFiles['package.json'].replace('18.3.1', '18.2.0') };
    await runtime.compile(changed, new AbortController().signal, vi.fn());
    expect(command.mock.calls.filter(([cmd]) => cmd === 'npm')).toHaveLength(2);
  });
  it('finishes an exited command even when the SDK leaves the output stream open', async () => {
    vi.useFakeTimers();

    const cancel = vi.fn();
    const wc = {
      spawn: vi.fn().mockResolvedValue({
        exit: Promise.resolve(0),
        kill: vi.fn(),
        output: new ReadableStream({
          start(c) {
            c.enqueue('added 149 packages');
          },
          cancel,
        }),
      }),
    } as unknown as WebContainer;
    const result = new WebContainerRuntime(Promise.resolve(wc)).command(
      'npm',
      ['install'],
      new AbortController().signal,
      120000,
    );
    await vi.advanceTimersByTimeAsync(1001);
    await expect(result).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalled();
  });
  it('retains a nonzero exit failure even when output never closes', async () => {
    vi.useFakeTimers();

    const wc = {
      spawn: vi.fn().mockResolvedValue({
        exit: Promise.resolve(1),
        kill: vi.fn(),
        output: new ReadableStream({
          start(c) {
            c.enqueue('TS2322: invalid value');
          },
        }),
      }),
    } as unknown as WebContainer;
    const result = new WebContainerRuntime(Promise.resolve(wc))
      .command('node', ['tsc'], new AbortController().signal, 120000)
      .catch((e) => e);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toMatchObject({ category: 'compile', message: expect.stringContaining('TS2322') });
  });
  it.each(['network', 'timeout'])(
    'retries %s installs, then reports installation failure without changing source',
    async (category) => {
      vi.useFakeTimers();

      const runtime = new WebContainerRuntime(Promise.resolve({} as WebContainer));
      vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);

      const command = vi
        .spyOn(runtime, 'command')
        .mockRejectedValue(new RunError('connection stalled', false, category));
      const stage = vi.fn();
      const result = runtime.verify(jsFiles, new AbortController().signal, stage).catch((e) => e);
      await vi.advanceTimersByTimeAsync(4000);
      expect(command).toHaveBeenCalledTimes(3);
      expect(
        command.mock.calls.every(
          ([cmd, args]) => cmd === 'npm' && args.includes('--ignore-scripts') && args.includes('--fetch-timeout=30000'),
        ),
      ).toBe(true);
      expect(await result).toMatchObject({
        repairable: false,
        category: 'network',
        message: expect.stringContaining('三次尝试'),
      });
      expect(stage.mock.calls.every(([phase]) => phase === 'installing')).toBe(true);
    },
  );
  it('does not retry dependency conflicts or cancelled installation', async () => {
    const runtime = new WebContainerRuntime(Promise.resolve({} as WebContainer));
    vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);

    const command = vi
      .spyOn(runtime, 'command')
      .mockRejectedValue(new RunError('ERESOLVE dependency conflict', true, 'compile'));
    await expect(runtime.verify(jsFiles, new AbortController().signal, vi.fn())).rejects.toMatchObject({
      category: 'compile',
    });
    expect(command).toHaveBeenCalledTimes(1);

    const abort = new AbortController();
    command.mockImplementation(async () => {
      abort.abort(new Error('user stopped'));
      throw new RunError('timeout', false, 'timeout');
    });
    await expect(runtime.verify(jsFiles, abort.signal, vi.fn())).rejects.toThrow('user stopped');
    expect(command).toHaveBeenCalledTimes(2);
  });
  it('cancels a lockfile read that hangs after installation succeeds', async () => {
    const readFile = vi.fn(() => new Promise<string>(() => {}));
    const runtime = new WebContainerRuntime(Promise.resolve({ fs: { readFile } } as unknown as WebContainer));
    vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);
    vi.spyOn(runtime, 'command').mockResolvedValue(undefined);

    const abort = new AbortController();
    const result = runtime.verify(jsFiles, abort.signal, vi.fn()).catch((error) => error);
    await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
    abort.abort(new Error('stop during lockfile read'));
    expect((await result).message).toBe('stop during lockfile read');
    await expect(runtime.ready(new AbortController().signal)).rejects.toMatchObject({ category: 'sandbox' });
  });
  it('bounds preview-script setup instead of waiting forever after the build', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { location: { origin: 'http://example.test' } });

    const setPreviewScript = vi.fn(() => new Promise<void>(() => {}));
    const runtime = new WebContainerRuntime(
      Promise.resolve({
        fs: { readFile: vi.fn().mockResolvedValue('{}') },
        setPreviewScript,
      } as unknown as WebContainer),
    );
    vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);
    vi.spyOn(runtime, 'command').mockResolvedValue(undefined);

    const result = runtime.verify(jsFiles, new AbortController().signal, vi.fn()).catch((error) => error);
    await vi.advanceTimersByTimeAsync(30001);
    expect(setPreviewScript).toHaveBeenCalled();
    expect(await result).toMatchObject({
      category: 'sandbox',
      repairable: false,
      message: expect.stringContaining('配置预览检查超时'),
    });
  });
  it('cancels while spawn is pending and kills any late process', async () => {
    let finishSpawn: (process: WebContainerProcess) => void = () => {};
    const spawn = vi.fn(
      () =>
        new Promise<WebContainerProcess>((resolve) => {
          finishSpawn = resolve;
        }),
    );
    const runtime = new WebContainerRuntime(Promise.resolve({ spawn } as unknown as WebContainer));
    const controller = new AbortController();
    const result = runtime.command('npm', ['install'], controller.signal, 1000).catch((error) => error);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    controller.abort(new Error('user stopped'));
    expect((await result).message).toContain('user stopped');

    const { process, kill } = processFixture(new Promise(() => {}));
    finishSpawn(process);
    await vi.waitFor(() => expect(kill).toHaveBeenCalled());
  });
  it('does not send a failed integrity check to source-code repair', async () => {
    const { runtime } = processFixture(Promise.resolve(86), 'JINGYUE_INSTALL_INCOMPLETE');
    await expect(
      runtime.command('node', ['.jingyue-runtime/check-install.mjs'], new AbortController().signal, 1000),
    ).rejects.toMatchObject({ category: 'dependencies', repairable: false });
  });
  it('rebuilds only the dependency directory and bounds integrity retries', async () => {
    vi.useFakeTimers();

    const rm = vi.fn().mockResolvedValue(undefined);
    const runtime = new WebContainerRuntime(Promise.resolve({ fs: { rm } } as unknown as WebContainer));
    vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);

    const command = vi.spyOn(runtime, 'command').mockImplementation(async (cmd) => {
      if (cmd === 'node') {
        throw new RunError('依赖安装不完整', false, 'dependencies');
      }
    });
    const stage = vi.fn();
    const result = runtime.verify(jsFiles, new AbortController().signal, stage).catch((e) => e);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toMatchObject({ category: 'dependencies', repairable: false });
    expect(command.mock.calls.filter(([cmd]) => cmd === 'npm')).toHaveLength(3);
    expect(command.mock.calls.filter(([cmd]) => cmd === 'node')).toHaveLength(3);
    expect(rm.mock.calls).toEqual([
      ['node_modules', { recursive: true, force: true }],
      ['node_modules', { recursive: true, force: true }],
    ]);
    expect(stage.mock.calls.every(([phase]) => phase === 'installing')).toBe(true);
  });
  it('stops during dependency cleanup without starting another installer', async () => {
    const rm = vi.fn(() => new Promise<void>(() => {}));
    const runtime = new WebContainerRuntime(Promise.resolve({ fs: { rm } } as unknown as WebContainer));
    vi.spyOn(runtime, 'writeSource').mockResolvedValue(undefined);

    const command = vi.spyOn(runtime, 'command').mockImplementation(async (cmd) => {
      if (cmd === 'node') {
        throw new RunError('依赖安装不完整', false, 'dependencies');
      }
    });
    const abort = new AbortController();
    const result = runtime.verify(jsFiles, abort.signal, vi.fn()).catch((e) => e);
    await vi.waitFor(() => expect(rm).toHaveBeenCalled());
    abort.abort(new Error('stop cleanup'));
    expect((await result).message).toBe('stop cleanup');
    expect(command.mock.calls.filter(([cmd]) => cmd === 'npm')).toHaveLength(1);
  });
  it('bounds the process creation step, not only the running command', async () => {
    vi.useFakeTimers();

    const runtime = new WebContainerRuntime(
      Promise.resolve({ spawn: () => new Promise(() => {}) } as unknown as WebContainer),
    );
    const result = runtime.command('npm', ['install'], new AbortController().signal, 1000).catch((error) => error);
    await vi.advanceTimersByTimeAsync(30001);
    expect((await result).message).toContain('沙箱启动进程超时');
  });
  it('aborts a stuck filesystem write and prevents sandbox reuse', async () => {
    let finishWrite: () => void = () => {};
    const writeFile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const wc = { fs: { mkdir: vi.fn().mockResolvedValue(undefined), writeFile } } as unknown as WebContainer;
    const runtime = new WebContainerRuntime(Promise.resolve(wc));
    const controller = new AbortController();
    const result = runtime.writeSource('src/App.tsx', 'test', controller.signal).catch((error) => error);
    await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());
    controller.abort(new Error('user stopped'));
    expect((await result).message).toBe('user stopped');
    finishWrite();
    await expect(runtime.ready(new AbortController().signal)).rejects.toMatchObject({ category: 'sandbox' });
    await expect(runtime.writeSource('src/App.tsx', 'newer', new AbortController().signal)).rejects.toBeDefined();
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
  it('times out a stuck filesystem operation without starting the next write', async () => {
    vi.useFakeTimers();

    const writeFile = vi.fn();
    const wc = { fs: { mkdir: vi.fn(() => new Promise(() => {})), writeFile } } as unknown as WebContainer;
    const runtime = new WebContainerRuntime(Promise.resolve(wc));
    const result = runtime.writeSource('src/App.tsx', 'test', new AbortController().signal).catch((error) => error);
    await vi.advanceTimersByTimeAsync(30001);
    expect(await result).toMatchObject({ category: 'sandbox', repairable: false });
    expect(writeFile).not.toHaveBeenCalled();
  });
  it('waits for actual command exit and captures output failures', async () => {
    const { runtime, spawn, kill } = processFixture(Promise.resolve(2), 'TS2322: incompatible type');
    await expect(runtime.command('node', ['tsc'], new AbortController().signal, 1000)).rejects.toMatchObject({
      repairable: true,
      category: 'compile',
      message: expect.stringContaining('TS2322'),
    });
    expect(spawn).toHaveBeenCalledWith('node', ['tsc']);
    expect(kill).toHaveBeenCalled();
  });
  it('does not send package registry network failures to model repair', async () => {
    const { runtime } = processFixture(Promise.resolve(1), 'npm ERR! ECONNRESET registry unavailable');
    await expect(runtime.command('npm', ['install'], new AbortController().signal, 1000)).rejects.toMatchObject({
      repairable: false,
      category: 'network',
    });
  });
  it('stops a hanging command at the configured timeout', async () => {
    vi.useFakeTimers();

    const { runtime, kill } = processFixture(new Promise(() => undefined));
    const result = runtime.command('node', ['build'], new AbortController().signal, 100).catch((error) => error);
    await vi.advanceTimersByTimeAsync(101);
    expect(await result).toMatchObject({ category: 'timeout', repairable: false });
    expect(kill).toHaveBeenCalled();
  });
  it('does not kill a valid browser build that takes longer than 90 seconds', async () => {
    vi.useFakeTimers();

    let finish!: (code: number) => void;
    const { runtime, kill } = processFixture(
      new Promise<number>((resolve) => {
        finish = resolve;
      }),
    );
    const result = runtime.command(
      'node',
      ['node_modules/vite/bin/vite.js', 'build'],
      new AbortController().signal,
      MANAGED_BUILD_TIMEOUT_MS,
    );
    await vi.advanceTimersByTimeAsync(120000);
    expect(kill).not.toHaveBeenCalled();
    finish(0);
    await expect(result).resolves.toBeUndefined();
  });
  it('still kills a genuinely stuck build at the finite browser build cap', async () => {
    vi.useFakeTimers();

    const { runtime, kill } = processFixture(new Promise(() => undefined));
    const result = runtime
      .command(
        'node',
        ['node_modules/vite/bin/vite.js', 'build'],
        new AbortController().signal,
        MANAGED_BUILD_TIMEOUT_MS,
      )
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(MANAGED_BUILD_TIMEOUT_MS + 1);
    expect(await result).toMatchObject({ category: 'timeout', repairable: false });
    expect(kill).toHaveBeenCalled();
  });
  it('cancels an active process without waiting for exit', async () => {
    const { runtime, kill, spawn } = processFixture(new Promise(() => undefined));
    const controller = new AbortController();
    const result = runtime.command('npm', ['install'], controller.signal, 1000).catch((error) => error);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    controller.abort(new Error('user stopped'));
    expect((await result).message).toBe('user stopped');
    expect(kill).toHaveBeenCalled();
  });
  it('does not start any process when already cancelled', async () => {
    const { runtime, spawn } = processFixture(Promise.resolve(0));
    const controller = new AbortController();
    controller.abort();
    await expect(runtime.command('npm', ['install'], controller.signal, 1000)).rejects.toBeDefined();
    expect(spawn).not.toHaveBeenCalled();
  });
  it('requires successful exit before command completion', async () => {
    const { runtime } = processFixture(Promise.resolve(0), 'built');
    await expect(runtime.command('node', ['build'], new AbortController().signal, 1000)).resolves.toBeUndefined();
  });
});
