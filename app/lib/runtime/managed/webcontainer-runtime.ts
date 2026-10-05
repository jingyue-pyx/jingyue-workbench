import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { reloadPreview } from '@webcontainer/api/utils';
import { visualPreviewScript } from '~/lib/visual/preview-script';
import { inspectProject, RunError, safeDiagnostic, type RunPhase, type SourceFiles } from './protocol';
import { validateStyles } from './styles';
import { installIntegrityScript } from './install-integrity';
import { managedTypecheckConfig } from './typecheck';

export function previewProbeScript(runId: string, parentOrigin: string) {
  return `(() => {
    const runId=${JSON.stringify(runId)}, target=${JSON.stringify(parentOrigin)};
    if (window.__jingyueProbeRun === runId) return;
    window.__jingyueProbeRun = runId;
    const attempt=new URL(location.href).searchParams.get('__jingyue_attempt');
    window.parent.postMessage({type:'jingyue:runtime-ready',runId,attempt},target);
    let failed=false, sent=false, mountedAt=0;
    function send(ok, detail) {
      if (sent) return; sent=true;
      window.parent.postMessage({type:'jingyue:runtime-check',runId,attempt,ok,detail},target);
    }
    window.addEventListener('error',e=>{failed=true;send(false,String(e.message||'页面运行错误'));});
    window.addEventListener('unhandledrejection',()=>{failed=true;send(false,'页面存在未处理的异步错误');});
    const started=Date.now();
    const timer=setInterval(()=>{
      const overlay=document.querySelector('vite-error-overlay');
      if (overlay) {failed=true;send(false,overlay.shadowRoot?.textContent?.slice(-6000)||'Vite 编译错误');}
      const root=document.querySelector('#root') || document.querySelector('#app');
      if (root && root.children.length && !failed) {
        mountedAt ||= Date.now();
        if (Date.now()-mountedAt>=1500) send(true,'应用已挂载，初始观察期内未发现致命错误');
      } else mountedAt=0;
      if (Date.now()-started>15000) send(false,'预览未在时限内挂载到 #root 或 #app');
      if (sent) clearInterval(timer);
    },100);
  })();`;
}

/*
 * Serve the probe as part of the actual HTML, not only via the SDK's optional
 * preview injection. Keep it in the excluded runtime directory so project
 * sources, exports and the model context never gain verification machinery.
 */
export function previewServerScript(script: string) {
  return `import { createServer } from 'vite';
const server = await createServer({
  server: { host: '0.0.0.0', port: 5173, strictPort: true, watch: { ignored: ['**/.jingyue-candidates/**'] } },
  plugins: [{
    name: 'jingyue-preview-probe',
    transformIndexHtml: {
      order: 'pre',
      handler() { return [{ tag: 'script', children: ${JSON.stringify(script)}, injectTo: 'head-prepend' }]; }
    }
  }]
});
await server.listen();
server.printUrls();
`;
}

/*
 * Verify the actual workbench preview. A second hidden preview can be healthy
 * while the visible proxy remains disconnected (and mounts the user app twice).
 */
export function waitForPreviewFrame(url: string, signal: AbortSignal): Promise<HTMLIFrameElement> {
  signal.throwIfAborted();

  const origin = new URL(url).origin;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      observer.disconnect();
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const inspect = () => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="preview"]');

      if (frame?.src && new URL(frame.src).origin === origin) {
        cleanup();
        resolve(frame);
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    signal.addEventListener('abort', abort, { once: true });

    const timer = setTimeout(() => {
      cleanup();
      reject(new RunError('预览连接检查超时：预览窗口尚未挂载，源码和编译结果保留。', false, 'preview-network'));
    }, 15000);
    inspect();
  });
}

export class WebContainerRuntime {
  #processes = new Set<WebContainerProcess>();
  #dev?: WebContainerProcess;
  #installed = '';
  #installedInput = '';
  #compiledSources = '';
  #preview?: { url: string; runId: string };
  #latestOutput = '';
  #unavailable = '';
  constructor(
    private _container: Promise<WebContainer>,
    private _log: (text: string) => void = () => {},
    private _directory = '.',
  ) {
    if (_directory !== '.' && !/^\.jingyue-candidates\/[a-zA-Z0-9-]+$/.test(_directory)) {
      throw new RunError('非法候选工作目录。', false, 'sandbox');
    }
  }

  private _path(path: string) {
    return this._directory === '.' ? path : `${this._directory}/${path}`;
  }

  stop() {
    for (const process of this.#processes) {
      process.kill();
    }
    this.#processes.clear();
    this.#dev = undefined;
    this.#preview = undefined;
  }

  async ready(signal: AbortSignal): Promise<WebContainer> {
    signal.throwIfAborted();

    if (this.#unavailable) {
      throw new RunError(this.#unavailable, false, 'sandbox');
    }

    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason || new RunError('任务已取消。'));
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(
        () => reject(new RunError('浏览器沙箱启动超时，请检查浏览器支持和网络后重试。', false, 'sandbox')),
        45000,
      );
    });

    try {
      return await Promise.race([this._container, cancelled]);
    } catch (error) {
      signal.throwIfAborted();

      if (error instanceof RunError) {
        throw error;
      }

      throw new RunError('浏览器沙箱启动失败，请检查浏览器支持和网络后重试。', false, 'sandbox');
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener('abort', onAbort!);
    }
  }

  async writeSource(path: string, content: string, signal: AbortSignal): Promise<void> {
    const wc = await this.ready(signal);

    /*
     * The SDK filesystem API is not abortable. Stop waiting promptly, but never
     * reuse that sandbox after an interrupted write: a late SDK completion could
     * otherwise overwrite a newer task. The saved project can be reloaded safely.
     */
    const operation = async (task: () => Promise<unknown>) => {
      signal.throwIfAborted();

      let timer: ReturnType<typeof setTimeout>;
      let abort: () => void;
      const interrupted = new Promise<never>((_, reject) => {
        const fail = (reason: unknown) => {
          this.#unavailable = '沙箱文件写入中断，请刷新后从已保存源码恢复，再继续任务。';
          this.stop();
          reject(reason);
        };
        abort = () => fail(signal.reason || new RunError('任务已停止。'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(
          () => fail(new RunError(this.#unavailable || '沙箱文件写入超时，请刷新后恢复。', false, 'sandbox')),
          30000,
        );
      });

      try {
        await Promise.race([task(), interrupted]);
        signal.throwIfAborted();
      } finally {
        clearTimeout(timer!);
        signal.removeEventListener('abort', abort!);
      }
    };

    const destination = this._path(path);
    await operation(() => wc.fs.mkdir(destination.split('/').slice(0, -1).join('/') || '.', { recursive: true }));
    await operation(() => wc.fs.writeFile(destination, content));
    signal.throwIfAborted();
  }

  async command(command: string, args: string[], signal: AbortSignal, timeoutMs: number): Promise<void> {
    const wc = await this.ready(signal);
    signal.throwIfAborted();

    // WebContainer cwd is relative to workdir, not an absolute host-style path.
    let process: WebContainerProcess;

    try {
      process = await this._spawn(wc, command, args, signal);
    } catch (error) {
      const detail = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
      throw new RunError('无法启动沙箱进程：' + safeDiagnostic(detail));
    }
    this.#processes.add(process);

    let output = '';
    const outputAbort = new AbortController();
    const drain = process.output
      .pipeTo(
        new WritableStream({
          write: (chunk) => {
            output = (output + chunk).slice(-24000);
            this.#latestOutput = output;
            this._log(safeDiagnostic(chunk));
          },
        }),
        { signal: outputAbort.signal },
      )
      .catch(() => {});
    let timer: ReturnType<typeof setTimeout>;
    let onAbort: () => void;
    const stop = new Promise<never>((_, reject) => {
      onAbort = () => {
        process.kill();
        reject(signal.reason || new RunError('任务已取消。'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        process.kill();
        reject(new RunError('执行超时，已停止进程。\n' + safeDiagnostic(output), false, 'timeout'));
      }, timeoutMs);

      if (signal.aborted) {
        onAbort();
      }
    });

    try {
      const code = await Promise.race([process.exit, stop]);

      /*
       * WebContainer can deliver the exit event without closing its output
       * stream. Exit is authoritative; allow final diagnostics to arrive, but
       * do not turn a completed install into a three-minute false timeout.
       */
      let flushTimer: ReturnType<typeof setTimeout> | undefined;

      try {
        await Promise.race([
          drain,
          stop,
          new Promise<void>((resolve) => {
            flushTimer = setTimeout(resolve, 1000);
          }),
        ]);
      } finally {
        clearTimeout(flushTimer);
      }
      signal.throwIfAborted();

      if (code !== 0) {
        if (code === 86 && command === 'node' && args[0] === '.jingyue-runtime/check-install.mjs') {
          throw new RunError(
            '依赖安装不完整：检测到缺失或空的依赖包，需重新安装，不能通过修改业务源码修复。',
            false,
            'dependencies',
          );
        }

        if (command === 'npm') {
          /*
           * Keep package error lines in this browser's console for diagnosis;
           * never send raw output, project source or credentials to telemetry.
           */
          const errors = output
            .split(/[\r\n]/)
            .filter((line) => /npm (?:ERR!|error)/i.test(line))
            .slice(0, 5);
          console.warn('[Managed install]', code, safeDiagnostic(errors.join('\n')).slice(0, 1200));
        }

        const network =
          /ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ENOTFOUND|E429|\b429\s+Too Many Requests/i.test(
            output,
          );
        throw new RunError(
          `${command} ${args.join(' ')} 退出码 ${code}\n${safeDiagnostic(output)}`,
          !network,
          network ? 'network' : 'compile',
        );
      }
    } finally {
      outputAbort.abort();
      clearTimeout(timer!);
      signal.removeEventListener('abort', onAbort!);
      this.#processes.delete(process);
      process.kill();
    }
  }

  async compile(
    files: SourceFiles,
    signal: AbortSignal,
    stage: (phase: RunPhase, detail: string) => void,
  ): Promise<void> {
    this.#compiledSources = '';

    const profile = inspectProject(files);
    validateStyles(files);

    const wc = await this.ready(signal);
    this.stop();
    stage('installing', '检查依赖；仅依赖变化或新沙箱才重新安装');

    if (this.#installed !== profile.dependencyKey && this.#installedInput !== profile.dependencyKey) {
      this.#installed = '';
      this.#installedInput = '';
      await this.writeSource('.jingyue-runtime/check-install.mjs', installIntegrityScript, signal);

      for (let retry = 0; ; retry++) {
        try {
          await this.command(
            'npm',
            [
              'install',
              '--ignore-scripts',
              '--no-audit',
              '--no-fund',
              '--prefer-offline',
              '--fetch-timeout=30000',
              '--fetch-retries=1',
              '--fetch-retry-mintimeout=1000',
              '--fetch-retry-maxtimeout=3000',
            ],
            signal,
            120000,
          );
          await this.command('node', ['.jingyue-runtime/check-install.mjs'], signal, 30000);
          break;
        } catch (error) {
          signal.throwIfAborted();

          if (!(error instanceof RunError) || !['network', 'timeout', 'dependencies'].includes(error.category)) {
            throw error;
          }

          if (retry >= 2) {
            throw new RunError(
              (error.category === 'dependencies'
                ? '依赖安装不完整，三次尝试未完成；源码保留，未进入编译。\n'
                : '依赖安装连接失败或超时，三次尝试未完成；源码保留，未进入编译。\n') + safeDiagnostic(error.message),
              false,
              error.category === 'dependencies' ? 'dependencies' : 'network',
            );
          }

          if (error.category === 'dependencies') {
            stage('installing', `依赖包不完整，正在重建依赖 ${retry + 1}/2；源码不变`);

            /*
             * Only the reproducible dependency directory, never source, locks,
             * project data, npm credentials or a broad workspace path.
             */
            await this._waitForSDK(
              () => wc.fs.rm(this._path('node_modules'), { recursive: true, force: true }),
              signal,
              '清理损坏依赖',
            );
          } else {
            stage('installing', `依赖安装连接失败或超时，正在重试 ${retry + 1}/2；不会重新生成代码`);
          }

          await this._pause(1000 * 2 ** retry, signal);
        }
      }

      const lockfile = await this._waitForSDK(
        () => wc.fs.readFile(this._path('package-lock.json'), 'utf8'),
        signal,
        '读取依赖锁文件',
      );
      this.#installed = inspectProject({ ...files, 'package-lock.json': lockfile }).dependencyKey;

      /*
       * A restored source snapshot can omit the runtime-generated lockfile.
       * Rechecking unchanged sources in this sandbox must not reinstall again.
       */
      this.#installedInput = profile.dependencyKey;
    } else {
      stage('installing', '复用当前沙箱依赖，检查安装完整性；不重新下载');

      try {
        await this.command('node', ['.jingyue-runtime/check-install.mjs'], signal, 30000);
      } catch (error) {
        signal.throwIfAborted();

        if (!(error instanceof RunError) || error.category !== 'dependencies') {
          throw error;
        }

        this.#installed = '';
        this.#installedInput = '';

        await this.compile(files, signal, stage);

        return;
      }
    }

    signal.throwIfAborted();

    if (profile.typed) {
      stage('typechecking', '执行独立 TypeScript 类型检查（不能由模型关闭）');
      await this.writeSource('.jingyue-runtime/tsconfig.json', JSON.stringify(managedTypecheckConfig()), signal);
      await this.command(
        'node',
        ['node_modules/typescript/bin/tsc', '--project', '.jingyue-runtime/tsconfig.json'],
        signal,
        90000,
      );
    } else {
      stage('typechecking', '此工程为 JavaScript；语法与模块检查由下一步构建执行');
    }

    stage('building', '执行 Vite 正式构建，不使用模型提供的 shell 命令');
    await this.command('node', ['node_modules/vite/bin/vite.js', 'build', '--outDir', '.jingyue-build'], signal, 90000);
    this.#compiledSources = JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  }

  async verify(files: SourceFiles, signal: AbortSignal, stage: (phase: RunPhase, detail: string) => void) {
    signal.throwIfAborted();

    const sourceKey = JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));

    if (this.#dev && this.#preview && this.#compiledSources === sourceKey) {
      const { url, runId } = this.#preview;
      const dev = this.#dev;
      stage('previewing', '源码未变，重新连接已有预览；不重复安装、编译或调用模型');
      await Promise.race([
        this._checkPreview(url, runId, signal, stage),
        dev.exit.then(() => {
          throw new RunError('预览服务已退出，请重新检查启动。', false, 'sandbox');
        }),
      ]);
      signal.throwIfAborted();

      return url;
    }

    await this.compile(files, signal, stage);

    const wc = await this.ready(signal);
    stage('starting', '启动独立开发进程，等待实际服务就绪');

    const runId = crypto.randomUUID();
    await this._waitForSDK(
      () =>
        wc.setPreviewScript(
          visualPreviewScript(window.location.origin) + '\n' + previewProbeScript(runId, window.location.origin),
        ),
      signal,
      '配置预览检查',
    );
    await this.writeSource(
      '.jingyue-runtime/serve.mjs',
      previewServerScript(
        visualPreviewScript(window.location.origin) + '\n' + previewProbeScript(runId, window.location.origin),
      ),
      signal,
    );

    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout>;
    let abort = () => {};
    const ready = new Promise<string>((resolve, reject) => {
      unsubscribe = wc.on('server-ready', (port, url) => {
        if (port === 5173) {
          resolve(url);
        }
      });
      abort = () => reject(signal.reason || new RunError('启动已取消。'));
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(
        () => reject(new RunError('开发服务未就绪。\n' + safeDiagnostic(this.#latestOutput), true)),
        45000,
      );
    });

    // Attach a rejection handler immediately while spawn is pending.
    ready.catch(() => {});

    try {
      signal.throwIfAborted();

      const dev = await this._spawn(wc, 'node', ['.jingyue-runtime/serve.mjs'], signal);
      this.#dev = dev;
      this.#processes.add(dev);
      this.#latestOutput = '';
      dev.output
        .pipeTo(
          new WritableStream({
            write: (chunk) => {
              this.#latestOutput = (this.#latestOutput + chunk).slice(-24000);
              this._log(safeDiagnostic(chunk));
            },
          }),
        )
        .catch(() => {});

      if (signal.aborted) {
        dev.kill();
        signal.throwIfAborted();
      }

      const exited = dev.exit.then(() => {
        if (this.#dev === dev) {
          this.#dev = undefined;
          this.#preview = undefined;
        }

        throw new RunError('开发服务提前退出。\n' + safeDiagnostic(this.#latestOutput), true);
      });
      exited.catch(() => {});

      const url = await Promise.race([ready, exited]);
      this.#preview = { url, runId };
      stage('previewing', '检查页面初始挂载、运行异常和构建错误');
      await Promise.race([this._checkPreview(url, runId, signal, stage), exited]);

      return url;
    } finally {
      unsubscribe();
      clearTimeout(timer!);
      signal.removeEventListener('abort', abort);
    }
  }

  private async _spawn(wc: WebContainer, command: string, args: string[], signal: AbortSignal) {
    signal.throwIfAborted();

    let interrupted = false;
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void;
    const pending = (
      this._directory === '.' ? wc.spawn(command, args) : wc.spawn(command, args, { cwd: this._directory })
    ).then((process) => {
      if (interrupted || signal.aborted) {
        process.kill();
      }

      return process;
    });
    const stopped = new Promise<never>((_, reject) => {
      abort = () => {
        interrupted = true;
        reject(signal.reason || new RunError('任务已停止。'));
      };
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => {
        interrupted = true;
        reject(new RunError('沙箱启动进程超时，请刷新后重试。', false, 'sandbox'));
      }, 30000);

      if (signal.aborted) {
        abort();
      }
    });

    try {
      return await Promise.race([pending, stopped]);
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener('abort', abort!);
    }
  }

  /*
   * Auxiliary SDK calls can also stall even after npm/build exits successfully.
   * Keep them within the same cancellation contract as file writes and processes.
   */
  private async _waitForSDK<T>(task: () => Promise<T>, signal: AbortSignal, label: string): Promise<T> {
    signal.throwIfAborted();

    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      const fail = (reason: unknown) => {
        this.#unavailable = `沙箱${label}中断，请刷新后从已保存源码恢复。`;
        this.stop();
        reject(reason);
      };
      abort = () => fail(signal.reason || new RunError('任务已停止。'));
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => fail(new RunError(`沙箱${label}超时，请刷新后恢复。`, false, 'sandbox')), 30000);
    });

    try {
      const value = await Promise.race([task(), interrupted]);
      signal.throwIfAborted();

      return value;
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener('abort', abort!);
    }
  }

  private _pause(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, ms);
      signal.addEventListener('abort', abort, { once: true });

      if (signal.aborted) {
        abort();
      }
    });
  }

  private async _checkPreview(
    url: string,
    runId: string,
    signal: AbortSignal,
    stage: (phase: RunPhase, detail: string) => void,
  ): Promise<void> {
    const iframe = await waitForPreviewFrame(url, signal);
    signal.throwIfAborted();

    return new Promise((resolve, reject) => {
      const origin = new URL(url).origin;
      let attemptTimer: ReturnType<typeof setTimeout>;
      let reconnectTimer: ReturnType<typeof setTimeout>;
      let loads = 0;
      let connected = false;
      let attemptId = '';

      const cleanup = () => {
        clearTimeout(attemptTimer);
        clearTimeout(reconnectTimer);
        window.removeEventListener('message', receive);
        signal.removeEventListener('abort', abort);

        /*
         * The visible preview belongs to React, not this check. Preserve it on
         * success, failure or cancellation; never remove the user's workspace.
         */
      };
      const fail = (message: string) => {
        cleanup();
        reject(new RunError(message, true, 'preview'));
      };
      const receive = (event: MessageEvent) => {
        if (
          event.source !== iframe.contentWindow ||
          event.origin !== origin ||
          event.data?.runId !== runId ||
          event.data?.attempt !== attemptId ||
          !['jingyue:runtime-ready', 'jingyue:runtime-check'].includes(event.data?.type)
        ) {
          return;
        }

        if (event.data.type === 'jingyue:runtime-ready') {
          // The proxy is reachable. Do not reload a slow app while it is mounting.
          if (!connected) {
            connected = true;
            clearTimeout(attemptTimer);
            clearTimeout(reconnectTimer);
            stage('previewing', '预览连接已建立，正在等待页面挂载');
            attemptTimer = setTimeout(() => {
              cleanup();
              reject(
                new RunError(
                  '预览检查响应超时，源码和编译结果保留；可打开右侧预览手动检查。',
                  false,
                  'preview-network',
                ),
              );
            }, 20000);
          }

          return;
        }

        if (event.data.ok === true) {
          cleanup();
          resolve();
        } else {
          fail(safeDiagnostic(String(event.data.detail || '预览检查未通过。')));
        }
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const load = () => {
        loads++;
        connected = false;
        attemptId = runId + '-' + loads;
        stage('previewing', `正在连接预览（第 ${loads}/3 次），不重新生成代码`);
        iframe.src =
          url + (url.includes('?') ? '&' : '?') + '__jingyue_check=' + runId + '&__jingyue_attempt=' + attemptId;

        /*
         * Ask the SDK's proxy to reconnect before replacing the whole frame.
         * A reload acknowledgement is not evidence that React has mounted:
         * only the validated probe message below can complete this check.
         */
        reconnectTimer = setTimeout(() => {
          if (!connected && !signal.aborted) {
            stage('previewing', '网页服务已启动，正在重新连接预览代理；不修改源码');
            void reloadPreview(iframe).catch(() => {
              // The existing bounded transport retries remain the fallback.
            });
          }
        }, 8000);
        attemptTimer = setTimeout(() => {
          if (loads < 3) {
            load();
          } else {
            cleanup();
            reject(
              new RunError(
                '预览连接检查超时，三次连接尝试仍未收到页面握手；源码、编译结果和开发服务保留。',
                false,
                'preview-network',
              ),
            );
          }
        }, 25000);
      };

      /*
       * A port can be announced before the preview proxy/service worker is
       * reachable. Retry that transport handshake, not model-generated code.
       */
      window.addEventListener('message', receive);
      signal.addEventListener('abort', abort, { once: true });
      load();

      if (signal.aborted) {
        abort();
      }
    });
  }
}
