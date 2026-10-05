import { atom } from 'nanostores';
import type { Message } from 'ai';
import { currentAccount } from '~/lib/auth/account-context';
import { chatId, description } from '~/lib/persistence';
import { webcontainer } from '~/lib/webcontainer';
import { workbenchStore } from '~/lib/stores/workbench';
import { instrumentSource } from '~/lib/visual/source';
import { ManagedRunController } from './controller';
import { managedModelRequest } from './model-client';
import { WebContainerRuntime } from './webcontainer-runtime';
import { checkpoint } from './checkpoints';
import {
  formatTechnicalPlan,
  resolvePlanAnswers,
  RunError,
  safeDiagnostic,
  terminalPhase,
  type PlanAnswers,
  type RunPhase,
  type RunState,
  type SourceFiles,
} from './protocol';
import { PlanReviewGate, validatePlanAdjustment } from './plan-review';
import { reportModelBatch, reportRuntime, runMessage } from './presentation';
import { toast } from 'react-toastify';
import { outcomeAnnotation } from './conversation';
import { runActivity, recordWrittenFile } from './activity';
import { compileCandidate } from './candidate-workspace';
import { createBatchedModel } from './file-batches';
import { localAgentEngine, openCodeRequest } from './opencode-client';
import { previewAppAuthEnabled } from '~/lib/runtime/app-auth/bridge';

const planReview = new PlanReviewGate();
export const planReviewReady = atom(false);

export function confirmManagedPlan(answers?: PlanAnswers) {
  const state = runState.get();

  if (state.phase !== 'reviewing' || !state.plan || !planReviewReady.get()) {
    throw new RunError('方案尚未就绪或已失效。');
  }

  if (state.plan.questions.length) {
    resolvePlanAnswers(state.plan, answers || {});
  }

  if (!planReview.confirm(state.id, answers)) {
    throw new RunError('方案已失效，请重新提交需求。');
  }

  planReviewReady.set(false);
}

export function adjustManagedPlan(feedback: string) {
  const state = runState.get();

  if (state.phase !== 'reviewing' || !state.plan || !planReviewReady.get()) {
    throw new RunError('方案尚未就绪或已失效。');
  }

  const text = validatePlanAdjustment(feedback);

  if (!planReview.adjust(state.id, text)) {
    throw new RunError('方案已失效，请重新提交需求。');
  }

  planReviewReady.set(false);
}

export const runState = atom<RunState>({
  id: '',
  phase: 'idle',
  detail: '',
  attempt: 0,
  maxRepairs: 2,
  events: [],
  errors: [],
  changed: [],
  startedAt: 0,
});

const recordRuntimeOutput = (output: string) => {
  const state = runState.get();

  if (!terminalPhase(state.phase) && /[\p{L}\p{N}]{3}/u.test(output)) {
    runState.set({ ...state, detail: safeDiagnostic(output).slice(-1800) });
  }
};
const runtime = new WebContainerRuntime(webcontainer, recordRuntimeOutput);
let controller: ManagedRunController | undefined;
let restoreAbort: AbortController | undefined;
let stopReason = '';
const invalidateVerifiedSource = () => {
  const state = runState.get();

  if (state.phase === 'succeeded') {
    runState.set({ ...state, phase: 'idle', detail: '源码已修改，之前的编译结果已过期；保存后请重新检查。' });
  }
};
const relevant = (path: string) =>
  !path.split('/').some((part) => part.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage'].includes(part));

export function captureSources(): SourceFiles {
  return Object.fromEntries(
    Object.entries(workbenchStore.files.get()).flatMap(([path, file]) => {
      const relative = path.replace(/^\/home\/project\//, '');
      return relevant(relative) && file?.type === 'file' && !file.isBinary ? [[relative, file.content]] : [];
    }),
  );
}

export async function applySources(files: SourceFiles, signal: AbortSignal) {
  const wc = await runtime.ready(signal);

  /*
   * Stop the old terminal-owned server only when approved changes are about
   * to be applied, never while the user is reading or adjusting a plan.
   */
  workbenchStore.boltTerminal.terminal?.input('\x03');
  runtime.stop();

  if (Object.keys(files).some((path) => workbenchStore.files.get()[`${wc.workdir}/${path}`]?.isLocked)) {
    throw new RunError('改动涉及已锁定文件，已停止自动写入。');
  }

  for (const [path, original] of Object.entries(files)) {
    signal.throwIfAborted();

    const full = `${wc.workdir}/${path}`;
    const current = workbenchStore.files.get()[full];

    if (current?.isLocked) {
      throw new RunError('改动涉及已锁定文件，已停止自动写入。');
    }

    const content = prepareSource(path, original, wc.workdir);

    await runtime.writeSource(path, content, signal);
    signal.throwIfAborted();
    workbenchStore.files.setKey(full, { type: 'file', content, isBinary: false });
    workbenchStore.setDocuments(workbenchStore.files.get());
    workbenchStore.setShowWorkbench(true);
    recordWrittenFile(path, current?.type === 'file');
  }
  workbenchStore.setDocuments(workbenchStore.files.get());
  workbenchStore.setShowWorkbench(true);
}

function prepareSource(path: string, content: string, root: string) {
  if (/\.[jt]sx?$/.test(path)) {
    try {
      return instrumentSource(content, `${root}/${path}`);
    } catch {
      /* Compiler reports invalid source. */
    }
  }

  return content;
}

export function stopManagedRun(reason = '任务已停止，当前草稿保留。') {
  stopReason = reason;
  controller?.cancel(reason);

  if (restoreAbort) {
    restoreAbort.abort(new RunError(reason));
    runtime.stop();
  } else if (!controller) {
    runtime.stop();
  }
}

async function exclusive<T>(task: () => Promise<T>): Promise<T> {
  // Locks are account-scoped and held for the whole pipeline, not only writes.
  const name = `jingyue-run:${currentAccount?.id || 'legacy'}:${chatId.get() || 'new'}`;

  if (!navigator.locks) {
    throw new RunError('浏览器不支持项目执行锁，请使用支持 Web Locks 的浏览器。');
  }

  return navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
    if (!lock) {
      throw new RunError('另一个标签页正在运行这个项目，请先停止另一页的任务。');
    }

    return task();
  });
}

export async function runManagedTask(
  task: string,
  options: {
    model: string;
    provider: string;
    history?: Message[];
    reviewPlan?: boolean;
    saveDraft?: () => Promise<void>;
    record: (message: Message) => Promise<void>;
  },
) {
  if (!terminalPhase(runState.get().phase)) {
    throw new RunError('任务仍在运行。');
  }

  stopReason = '';
  runActivity.set({ receivedChars: 0, files: [] });

  return exclusive(async () => {
    await workbenchStore.whenActionsSettled();

    if (workbenchStore.unsavedFiles.get().size) {
      throw new RunError('源码编辑器有未保存改动，请先保存后再运行任务。');
    }

    const project = chatId.get() || 'new';
    const appAuthEnabled = !!currentAccount && (await previewAppAuthEnabled(project, currentAccount.id));
    const revision = workbenchStore.manualEditVersion;
    const engine = await localAgentEngine(options.model);
    const batchedModel = createBatchedModel(
      (phase, payload, signal) => {
        runActivity.set({ ...runActivity.get(), receivedChars: 0 });
        return managedModelRequest(phase, payload, {
          ...options,
          projectId: chatId.get(),
          signal,
          onProgress: (receivedChars) => runActivity.set({ ...runActivity.get(), receivedChars }),
        });
      },
      {
        capture: captureSources,
        guard: () => {
          if (workbenchStore.manualEditVersion !== revision) {
            throw new RunError('检测到手动修改，自动任务已停止，避免覆盖你的内容。');
          }
        },
        retain: async (files) => {
          await checkpoint(project, 'candidate', files);
        },
        diagnostic: (input, code) => {
          void reportModelBatch(input, code, chatId.get());
        },
      },
    );
    let planVersion = 0;
    controller = new ManagedRunController(
      {
        appAuthEnabled,
        capture: captureSources,
        revision: () => workbenchStore.manualEditVersion,
        prepare: async (signal) => {
          await runtime.ready(signal);
        },
        checkpoint: async (files) => {
          await checkpoint(project, 'before', files);
        },
        retainCandidate: async (files) => {
          /*
           * A rejected candidate is recoverable locally, but must never replace
           * the current editor, cloud snapshot, or visible preview.
           */
          await checkpoint(project, 'candidate', files);
        },
        compileCandidate: async (files, signal, stage) => {
          const wc = await runtime.ready(signal);
          await compileCandidate(webcontainer, files, signal, stage, {
            log: recordRuntimeOutput,
            prepare: (path, content) => prepareSource(path, content, wc.workdir),
          });
        },
        review: async (plan, signal) => {
          const approved = planReview.wait(runState.get().id, signal);
          approved.catch(() => {});

          try {
            await options.record({
              id: `${runState.get().id}-plan-${++planVersion}`,
              role: 'assistant',
              content: formatTechnicalPlan(plan),
              annotations: ['managed-run', 'managed-plan'],
            });
            signal.throwIfAborted();
            planReviewReady.set(true);

            const decision = await approved;

            if (decision.kind === 'adjust') {
              await options.record({
                id: crypto.randomUUID(),
                role: 'user',
                content: decision.feedback,
                annotations: ['managed-run', 'managed-plan-adjustment'],
              });
              signal.throwIfAborted();
            }

            return decision;
          } finally {
            planReviewReady.set(false);

            // Clear the gate on a persistence failure as well as cancellation.
            planReview.confirm(runState.get().id);
          }
        },
        model: (phase, payload, signal) => {
          if (engine === 'opencode' && (phase === 'generate' || phase === 'repair')) {
            return openCodeRequest(phase, payload, {
              model: options.model,
              projectId: chatId.get(),
              signal,
              onProgress: (receivedChars, detail) => {
                runActivity.set({ ...runActivity.get(), receivedChars });

                if (detail && !terminalPhase(runState.get().phase)) {
                  runState.set({ ...runState.get(), detail });
                }
              },
            });
          }

          return batchedModel(phase, payload, signal);
        },
        apply: async (files, signal) => {
          await applySources(files, signal);
          await options.saveDraft?.();
        },
        verify: (files, signal, stage) => runtime.verify(files, signal, stage),
        stop: () => runtime.stop(),
        record: async (state) => {
          void reportRuntime(state, chatId.get());

          if (state.plan && (!description.get() || description.get() === '未命名项目')) {
            description.set(state.plan.goal.slice(0, 100));
          }

          if (state.phase === 'succeeded') {
            workbenchStore.currentView.set('preview');

            try {
              await checkpoint(chatId.get() || project, 'verified', captureSources());
            } catch {
              /* Main project still saves independently. */
            }
          }

          await options.record({
            id: state.id,
            role: 'assistant',
            content: runMessage(state),
            annotations: ['managed-run', outcomeAnnotation(state)],
          });
        },
      },
      (state) => runState.set(state),
    );
    workbenchStore.onManualEdit = () => stopManagedRun('检测到手动编辑，已取消自动修改；请保存后重新提交需求。');

    try {
      return await controller.run(task, { reviewPlan: options.reviewPlan });
    } finally {
      controller = undefined;
      workbenchStore.onManualEdit = invalidateVerifiedSource;
    }
  });
}

export async function verifyRestoredProject(record?: (message: Message) => Promise<void>) {
  if (!terminalPhase(runState.get().phase)) {
    return;
  }

  await exclusive(async () => {
    runActivity.set({ receivedChars: 0, files: [] });
    restoreAbort = new AbortController();

    const signal = restoreAbort.signal;
    const deadline = setTimeout(
      () => stopManagedRun('源码恢复检查达到时间上限；已保存文件保留，请刷新后重试。'),
      8 * 60 * 1000,
    );
    workbenchStore.onManualEdit = () => stopManagedRun('检测到手动编辑，恢复检查已停止；保存后可重新检查。');

    const initial: RunState = {
      id: crypto.randomUUID(),
      phase: 'installing',
      detail: '',
      attempt: 0,
      maxRepairs: 2,
      events: [],
      errors: [],
      changed: [],
      startedAt: Date.now(),
    };
    runState.set(initial);

    const update = (phase: RunPhase, detail: string) =>
      runState.set({
        ...runState.get(),
        phase,
        detail: safeDiagnostic(detail),
        events: [...runState.get().events, { phase, detail: safeDiagnostic(detail), at: Date.now() }].slice(-40),
      });

    try {
      workbenchStore.boltTerminal.terminal?.input('\x03');

      const url = await runtime.verify(captureSources(), signal, update);
      signal.throwIfAborted();
      runState.set({ ...runState.get(), previewUrl: url });
      update('succeeded', '已保存源码重新编译和预览检查通过；没有调用模型。');
      workbenchStore.currentView.set('preview');
    } catch (error) {
      if (signal.aborted || !(error instanceof RunError) || error.category !== 'preview-network') {
        runtime.stop();
      }

      update(
        signal.aborted ? 'cancelled' : 'failed',
        signal.aborted ? stopReason || '恢复检查已停止。' : (error as Error).message,
      );
    } finally {
      clearTimeout(deadline);
      void reportRuntime(runState.get());

      const result = runState.get();
      restoreAbort = undefined;
      workbenchStore.onManualEdit = invalidateVerifiedSource;

      if (record && result.phase !== 'cancelled') {
        await record({
          id: result.id,
          role: 'assistant',
          content: runMessage(result),
          annotations: ['managed-run', outcomeAnnotation(result)],
        });
      }

      if (runState.get().phase === 'failed') {
        toast.info(runMessage(runState.get()));
      }
    }
  });
}

export async function restoreBeforeRun() {
  if (!terminalPhase(runState.get().phase)) {
    throw new RunError('请先停止当前任务。');
  }

  const files = await checkpoint(chatId.get() || 'new', 'before');

  if (!files) {
    throw new RunError('当前浏览器没有这个项目的执行前恢复点。');
  }

  // Restore is a user-requested overlay. Do not silently delete new files.
  await exclusive(() => applySources(files, new AbortController().signal));
  runState.set({ ...runState.get(), phase: 'idle', detail: '已恢复执行前同名文件；新增文件未删除，请检查并保存。' });
}

if (typeof window !== 'undefined') {
  workbenchStore.onManualEdit = invalidateVerifiedSource;
  window.addEventListener('pagehide', () => stopManagedRun('页面已离开，任务中断；恢复后需重新检查。'));
}
