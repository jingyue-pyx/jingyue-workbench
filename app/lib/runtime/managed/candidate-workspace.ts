import type { WebContainer } from '@webcontainer/api';
import { RunError, type RunPhase, type SourceFiles } from './protocol';
import { WebContainerRuntime } from './webcontainer-runtime';

/** Execution staging, not a security boundary: candidates share the browser VM. */
export async function compileCandidate(
  container: Promise<WebContainer>,
  files: SourceFiles,
  signal: AbortSignal,
  stage: (phase: RunPhase, detail: string) => void,
  options: {
    prepare?: (path: string, content: string) => string;
    log?: (output: string) => void;
    runtimeFactory?: (directory: string) => Pick<WebContainerRuntime, 'writeSource' | 'compile' | 'stop'>;
  } = {},
) {
  signal.throwIfAborted();

  const directory = `.jingyue-candidates/${crypto.randomUUID()}`;
  const runtime = options.runtimeFactory?.(directory) || new WebContainerRuntime(container, options.log, directory);
  const candidate: SourceFiles = {};

  try {
    for (const [path, content] of Object.entries(files)) {
      signal.throwIfAborted();

      if (
        !path ||
        path.startsWith('/') ||
        /[\\\x00-\x1f]/.test(path) ||
        path.split('/').some((part) => !part || part.startsWith('.') || part === 'node_modules')
      ) {
        throw new RunError('候选源码路径非法，未写入当前工程。', false, 'sandbox');
      }

      candidate[path] = options.prepare?.(path, content) ?? content;
      await runtime.writeSource(path, candidate[path], signal);
    }
    signal.throwIfAborted();

    /*
     * No server, preview injection, editor-store write or cloud save here.
     * The live runtime belongs to a different instance and is not stopped.
     */
    await runtime.compile(candidate, signal, (phase, detail) => stage(phase, `候选检查：${detail}`));
    signal.throwIfAborted();
  } finally {
    runtime.stop();

    /*
     * Only this invocation's generated staging directory is disposable. A late
     * SDK operation can never affect the live project or a newer candidate.
     */
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        container.then((wc) => wc.fs.rm(directory, { recursive: true, force: true })),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 5000);
        }),
      ]);
    } catch {
      // Cleanup failure must not replace the original compiler diagnostic.
    } finally {
      clearTimeout(timer);
    }
  }
}
