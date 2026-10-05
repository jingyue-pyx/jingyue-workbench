import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { Snapshot } from '~/lib/persistence/types';
import { excludedProjectPath, relativeProjectPath } from '~/lib/persistence/project-document';
import { publishingDelay } from './polling';
import { validateStyles } from '~/lib/runtime/managed/styles';
import { managedTypecheckConfig } from '~/lib/runtime/managed/typecheck';

class PublishBuildError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface PublishArtifact {
  path: string;
  base64: string;
}
export function binaryBase64(bytes: Uint8Array): string {
  let value = '';

  for (let index = 0; index < bytes.length; index += 32768) {
    value += String.fromCharCode(...bytes.subarray(index, index + 32768));
  }

  return btoa(value);
}

export function publishingSources(snapshot: Snapshot): Record<string, Uint8Array | string> {
  const sources: Record<string, Uint8Array | string> = {};

  for (const [name, file] of Object.entries(snapshot.files)) {
    if (file?.type !== 'file') {
      continue;
    }

    const path = relativeProjectPath(name);

    if (excludedProjectPath(path) || /^(?:dist|build|out)\//.test(path)) {
      continue;
    }

    if (file.isBinary) {
      const decoded = atob(file.content);
      sources[path] = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    } else {
      sources[path] = file.content;
    }
  }

  let manifest;

  try {
    manifest = JSON.parse(String(sources['package.json']));
  } catch {
    throw new Error('缺少有效 package.json，不能构建。');
  }

  if (
    !manifest ||
    typeof manifest !== 'object' ||
    !(manifest.devDependencies?.vite || manifest.dependencies?.vite) ||
    !manifest.dependencies?.react ||
    manifest.dependencies?.next ||
    manifest.dependencies?.express ||
    manifest.dependencies?.fastify
  ) {
    throw new Error('首期仅支持 React + Vite 静态网页，不支持独立后端或 SSR。');
  }

  // Bundling can succeed even if Tailwind directives never produced CSS.
  validateStyles(
    Object.fromEntries(
      Object.entries(sources).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
  );

  return sources;
}

/*
 * Work in a separate WebContainer directory. Never interrupt the editor's
 * terminal/dev server, change its files, or execute generated code on the host.
 */
export async function buildPublishArtifacts(
  container: WebContainer,
  snapshot: Snapshot,
  userSignal: AbortSignal,
  progress: (text: string) => void,
): Promise<PublishArtifact[]> {
  const signal = AbortSignal.any([userSignal, AbortSignal.timeout(5 * 60000)]);
  signal.throwIfAborted();

  const sources = publishingSources(snapshot);
  const directory = `/tmp/jingyue-publish-${crypto.randomUUID()}`;
  let process: WebContainerProcess | undefined;
  const abort = () => process?.kill();
  signal.addEventListener('abort', abort);

  const bounded = async <T>(operation: Promise<T>, ms = 20000): Promise<T> => {
    signal.throwIfAborted();

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};

    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          cancel = () => reject(new Error('已停止本地构建，现有预览不受影响。'));
          signal.addEventListener('abort', cancel, { once: true });
          timer = setTimeout(() => {
            process?.kill();
            reject(new PublishBuildError('发布构建超时，请检查依赖后重试。', true));
          }, ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  };
  const run = async (args: string[], message: string) => {
    progress(message);

    let abandoned = false;
    const spawned = container.spawn('npm', args, { cwd: directory }).then((child) => {
      if (signal.aborted || abandoned) {
        child.kill();
        throw new Error('发布构建已停止。');
      }

      return child;
    });
    const child = await bounded(spawned).catch((error) => {
      abandoned = true;
      throw error;
    });
    process = child;

    /*
     * Drain output to avoid backpressure. Do not send raw build logs/secrets
     * to the publishing service or render them as HTML.
     */
    let tail = '';
    const outputAbort = new AbortController();
    const output = child.output
      .pipeTo(
        new WritableStream({
          write(chunk) {
            tail = (tail + chunk).slice(-8000);
          },
        }),
        { signal: outputAbort.signal },
      )
      .catch(() => {});
    let flushTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const code = await bounded(child.exit, 180000);

      // Process exit is authoritative even when the SDK keeps stdout open.
      await bounded(
        Promise.race([
          output,
          new Promise<void>((resolve) => {
            flushTimer = setTimeout(resolve, 1000);
          }),
        ]),
      );
      signal.throwIfAborted();

      if (code !== 0) {
        const network =
          /ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ENOTFOUND|E429|\b429\s+Too Many Requests/i.test(
            tail,
          );
        throw new PublishBuildError(`${message}失败（退出码 ${code}），未上传。请在原预览中修复后重试。`, network);
      }
    } finally {
      clearTimeout(flushTimer);
      outputAbort.abort();
      child.kill();
      process = undefined;
    }
  };

  try {
    progress('准备已保存源码的独立构建副本');
    await bounded(container.fs.mkdir(directory, { recursive: true }));

    for (const [path, content] of Object.entries(sources)) {
      if (path.includes('/')) {
        await bounded(container.fs.mkdir(`${directory}/${path.slice(0, path.lastIndexOf('/'))}`, { recursive: true }));
      }

      await bounded(container.fs.writeFile(`${directory}/${path}`, content));
    }

    for (let retry = 0; ; retry++) {
      try {
        await run(
          [
            sources['package-lock.json'] ? 'ci' : 'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--prefer-offline',
            '--fetch-timeout=30000',
            '--fetch-retries=1',
          ],
          '安装发布依赖',
        );
        break;
      } catch (error) {
        signal.throwIfAborted();

        if (retry >= 1 || !(error instanceof PublishBuildError) || !error.retryable) {
          throw error;
        }

        progress('依赖网络暂时不可用，重试 1/1；保留源码，不重新生成，也不会重复建站。');
        await publishingDelay(1000, signal);
      }
    }

    if (Object.keys(sources).some((path) => /\.(?:ts|tsx)$/.test(path) && !path.endsWith('.d.ts'))) {
      const manifest = JSON.parse(String(sources['package.json']));

      if (!(manifest.dependencies?.typescript || manifest.devDependencies?.typescript)) {
        throw new Error('TypeScript 工程缺少编译器依赖，不能跳过类型检查发布。');
      }

      await bounded(container.fs.mkdir(`${directory}/.jingyue-runtime`, { recursive: true }));
      await bounded(
        container.fs.writeFile(`${directory}/.jingyue-runtime/tsconfig.json`, JSON.stringify(managedTypecheckConfig())),
      );
      await run(['exec', '--no', '--', 'tsc', '--project', '.jingyue-runtime/tsconfig.json'], '检查类型');
    }

    await run(
      ['exec', '--no', '--', 'vite', 'build', '--outDir', 'dist', '--emptyOutDir', '--base', '/'],
      '构建静态网站',
    );

    const files: PublishArtifact[] = [];
    let bytes = 0;
    const visit = async (relative = '') => {
      const entries = await bounded(container.fs.readdir(`${directory}/dist/${relative}`, { withFileTypes: true }));

      for (const entry of entries) {
        const path = relative + entry.name;

        if (entry.isDirectory()) {
          await visit(`${path}/`);
          continue;
        }

        if (!entry.isFile()) {
          throw new Error('产物包含链接或非普通文件，已停止发布。');
        }

        const content = await bounded(container.fs.readFile(`${directory}/dist/${path}`));
        bytes += content.length;

        if (bytes > 8 * 1024 * 1024 || files.length >= 300) {
          throw new Error('首期限制为 300 个文件、共 8 MiB。');
        }

        files.push({ path, base64: binaryBase64(content) });
      }
    };
    await visit();

    if (!files.some((file) => file.path === 'index.html')) {
      throw new Error('没有生成静态首页，未上传。');
    }

    return files;
  } finally {
    signal.removeEventListener('abort', abort);
    process?.kill();

    // Only this call's random temporary folder, never a project/user directory.
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      container.fs.rm(directory, { recursive: true, force: true }).catch(() => {}),
      new Promise<void>((resolve) => {
        cleanupTimer = setTimeout(resolve, 2000);
      }),
    ]);
    clearTimeout(cleanupTimer);
  }
}
