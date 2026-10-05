import { z } from 'zod';
import {
  ExactEditError,
  OutputLimitError,
  parsePatch,
  RunError,
  safeDiagnostic,
  sourcePath,
  type FileTask,
  type ManagedModelInput,
  type ManagedPhase,
  type SourceFiles,
} from './protocol';
import { assertSameSources, sourceRevision, sourceSnapshot } from './source-revision';
import { managedOutputTokens, MANAGED_TASK_BUDGET } from './request-policy';
import type { BatchFailureCode } from './batch-failure';

const manifestSchema = z
  .object({
    status: z.enum(['changed', 'unchanged']),
    summary: z.string().trim().min(1).max(2000),
    files: z
      .array(
        z
          .object({
            path: z.string().refine(sourcePath),
            instruction: z.string().trim().min(1).max(1200),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

export function parseFileManifest(text: string) {
  try {
    const result = manifestSchema.parse(
      JSON.parse(
        text
          .trim()
          .replace(/^```(?:json)?\s*\n/, '')
          .replace(/\n```\s*$/, ''),
      ),
    );

    if (
      new Set(result.files.map((file) => file.path)).size !== result.files.length ||
      (result.status === 'unchanged') !== (result.files.length === 0)
    ) {
      throw new Error('manifest invariant');
    }

    return result;
  } catch {
    throw new RunError('文件清单格式校验失败，请返回唯一、安全的文件路径和具体修改说明。', false, 'manifest');
  }
}

type Request = (phase: ManagedPhase, input: ManagedModelInput, signal: AbortSignal) => Promise<string>;
export type BatchDiagnostic = 'output_limit' | 'manifest' | BatchFailureCode;

/** One instance per user task. Every request still traverses the authenticated quota gateway. */
export function createBatchedModel(
  request: Request,
  options: {
    guard(): void;
    capture?(): SourceFiles;
    retain?(candidate: SourceFiles): Promise<void>;
    progress?(completed: number, total: number): void;
    diagnostic?(input: ManagedModelInput, code: BatchDiagnostic): void;
    maxCalls?: number;
    maxReservedTokens?: number;
  },
): Request {
  let calls = 0;
  let reservedTokens = 0;
  let batchId = 0;
  const ask: Request = async (phase, input, signal) => {
    signal.throwIfAborted();
    options.guard();

    const tokens = managedOutputTokens(phase, input.batch?.recovery ? 'recovery' : 'file');

    if (
      calls >= (options.maxCalls ?? MANAGED_TASK_BUDGET.maxCalls) ||
      reservedTokens + tokens > (options.maxReservedTokens ?? MANAGED_TASK_BUDGET.maxReservedTokens)
    ) {
      throw new RunError(
        '分批生成达到本次请求或输出预算上限，已完成候选批次保留，当前工程未替换。',
        false,
        'batch-budget',
      );
    }

    calls++;
    reservedTokens += tokens;

    const result = await request(phase, input, signal);
    signal.throwIfAborted();
    options.guard();

    return result;
  };

  return async (phase, input, signal) => {
    if (phase !== 'generate' && phase !== 'repair') {
      return ask(phase, input, signal);
    }

    const live = options.capture ? sourceSnapshot(options.capture()) : undefined;
    const guard = () => {
      signal.throwIfAborted();
      options.guard();

      if (live && options.capture) {
        assertSameSources(live, options.capture());
      }
    };
    const checkedAsk: Request = async (nextPhase, payload, requestSignal) => {
      guard();

      const result = await ask(nextPhase, payload, requestSignal);
      guard();

      return result;
    };
    let manifest: ReturnType<typeof parseFileManifest> | undefined;
    let manifestError: string[] = [];

    for (let correction = 0; correction < 2; correction++) {
      try {
        manifest = parseFileManifest(
          await checkedAsk(
            'manifest',
            { ...input, batch: undefined, errors: [...input.errors, ...manifestError] },
            signal,
          ),
        );
        break;
      } catch (error) {
        if (!(error instanceof OutputLimitError) && !(error instanceof RunError && error.category === 'manifest')) {
          throw error;
        }

        options.diagnostic?.(input, 'manifest');

        if (correction) {
          throw new RunError('文件清单格式校验失败，有限纠正仍未完成；当前源码未替换。', false, 'manifest');
        }

        manifestError = ['文件清单无效或被截断。只返回简短文件清单，不要源码；最多 16 个文件。'];
      }
    }

    if (!manifest) {
      throw new RunError('文件清单未完成。');
    }

    if (manifest.status === 'unchanged') {
      return JSON.stringify(manifest);
    }

    let candidate = sourceSnapshot(input.files);
    let completed = 0;
    const changes = new Map<string, string>();
    const unchangedReasons: string[] = [];
    const generate = async (
      tasks: FileTask[],
      recovery = false,
      priorError = '',
      fullFilePaths = input.fullFilePaths || [],
    ): Promise<void> => {
      guard();

      const batchInput: ManagedModelInput = {
        ...input,
        files: candidate,
        sourceRevision: await sourceRevision(candidate),
        errors: [...input.errors, ...(priorError ? [priorError] : [])],
        fullFilePaths,
        filePlan: manifest!.files,
        batch: {
          id: ++batchId,
          files: tasks,
          recovery,
          editOnlyPaths: tasks
            .filter(({ path }) => (candidate[path]?.length || 0) >= 6000 && !fullFilePaths.includes(path))
            .map(({ path }) => path),
        },
      };

      try {
        const raw = await checkedAsk(phase, batchInput, signal);
        const patch = parsePatch(raw, candidate, fullFilePaths, batchInput.batch?.editOnlyPaths);
        const allowed = new Set(tasks.map((task) => task.path));

        /*
         * A planner can over-select an existing stylesheet/config. An explicit,
         * valid no-op may skip it, but can never stand in for creating a new file.
         */
        if (patch.status === 'unchanged' && tasks.every(({ path }) => Object.hasOwn(candidate, path))) {
          guard();
          unchangedReasons.push(patch.summary);
          completed += tasks.length;
          options.progress?.(completed, manifest!.files.length);

          return;
        }

        if (patch.files.some((file) => !allowed.has(file.path))) {
          throw new RunError(
            `文件批次包含未指定路径。当前仅允许：${JSON.stringify([...allowed])}；本次返回：${JSON.stringify(patch.files.map((file) => file.path))}。请只修正本批次，其他文件由独立批次处理；不要照抄示例路径。`,
            true,
            'batch-scope',
          );
        }

        if (patch.status !== 'changed' || tasks.some((task) => !patch.files.some((file) => file.path === task.path))) {
          throw new RunError(
            `文件批次缺少清单要求的文件；请完整返回：${JSON.stringify([...allowed])}。`,
            true,
            'batch-missing',
          );
        }

        /*
         * A manifest may repeat a type/config that already matches. Its valid
         * complete response is a no-op, not malformed JSON. Continue to the
         * later integration batch; never spend recovery retrying identical text.
         */
        const effective = patch.files.filter((file) => candidate[file.path] !== file.content);

        if (!effective.length) {
          guard();
          unchangedReasons.push('返回文件与当前源码一致，本批次未修改代码，未验证需求已完成。');
          completed += tasks.length;
          options.progress?.(completed, manifest!.files.length);

          return;
        }

        // Entire batch is valid before retaining it. Never parse/salvage truncated JSON.
        const next = { ...candidate, ...Object.fromEntries(patch.files.map((file) => [file.path, file.content])) };

        // Reuse the existing aggregate size, path and protected-config safeguards.
        parsePatch(
          JSON.stringify({
            summary: manifest!.summary,
            files: Object.entries(next)
              .filter(([path, content]) => input.files[path] !== content)
              .map(([path, content]) => ({ path, content })),
          }),
          input.files,
        );
        guard();
        candidate = sourceSnapshot(next);

        for (const file of effective) {
          changes.set(file.path, file.content);
        }
        await options.retain?.(candidate);
        guard();
        completed += tasks.length;
        options.progress?.(completed, manifest!.files.length);
      } catch (error) {
        guard();

        const correctable =
          error instanceof OutputLimitError ||
          (error instanceof RunError &&
            error.repairable &&
            ['format', 'batch-scope', 'batch-missing', 'no-change'].includes(error.category));

        if (!correctable) {
          throw error;
        }

        const code: BatchDiagnostic =
          error instanceof OutputLimitError
            ? 'output_limit'
            : error instanceof ExactEditError
              ? 'patch_mismatch'
              : error.category === 'batch-scope'
                ? 'batch_scope'
                : error.category === 'batch-missing'
                  ? 'batch_missing'
                  : 'patch_format';
        options.diagnostic?.(batchInput, code);

        if (tasks.length > 1) {
          // Completed earlier batches remain intact. Retry only this batch, now one file per request.
          const required =
            error instanceof ExactEditError ? [...new Set([...fullFilePaths, error.filePath])] : fullFilePaths;

          for (const task of tasks) {
            await generate([task], false, safeDiagnostic(error.message), required);
          }

          return;
        }

        if (!recovery) {
          await generate(
            tasks,
            true,
            safeDiagnostic(error.message),
            error instanceof ExactEditError ? [...new Set([...fullFilePaths, error.filePath])] : fullFilePaths,
          );
          return;
        }

        if (error instanceof OutputLimitError) {
          throw error;
        }

        throw new RunError(
          `文件批次校验仍未通过（${code}），有限纠正已结束；已完成候选批次保留，当前源码未替换。`,
          false,
          'batch-format',
        );
      }
    };

    // Existing-file modifications are atomic single-file calls; only new small modules may share a batch.
    for (let i = 0; i < manifest.files.length; ) {
      const first = manifest.files[i++];
      const tasks = [first];
      const next = manifest.files[i];

      if (next && !Object.hasOwn(candidate, first.path) && !Object.hasOwn(candidate, next.path)) {
        tasks.push(next);
        i++;
      }

      await generate(tasks);
    }

    return JSON.stringify({
      status: changes.size ? 'changed' : 'unchanged',
      summary: changes.size ? manifest.summary : unchangedReasons.join('；').slice(0, 2000),
      files: [...changes].map(([path, content]) => ({ path, content })),
    });
  };
}
