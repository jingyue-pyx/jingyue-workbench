import { z } from 'zod';
import {
  ExactEditError,
  bindSingleFileResponse,
  bindFileSourceResponse,
  PatchValidationError,
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
import { withRequestRecovery, type retryDelay, type RequestFailure } from './request-errors';
import { stripGeneratedVisualMetadata } from '~/lib/visual/source';
import { validateSourceSyntax } from './preflight';
import { validateImports } from './dependencies';

/** Stable dependency-first output: integration files see the actual sibling exports. */
export function orderFilePlan(files: FileTask[]): FileTask[] {
  const rank = (path: string) =>
    /^src\/(?:main|index)\.[jt]sx?$/.test(path)
      ? 3
      : /^src\/App\.[jt]sx?$/.test(path)
        ? 2
        : /^src\/(?:types(?:\.[jt]s|\/)|(?:data|lib|utils)\/)/.test(path)
          ? 0
          : 1;

  /*
   * Preserve stylesheet/config slots and existing edit order when no module
   * precedes another. Only source modules have integration dependencies.
   */
  const source = files.filter(({ path }) => /\.[jt]sx?$/.test(path));
  source.sort((a, b) => rank(a.path) - rank(b.path));

  let index = 0;

  return files.map((file) => (/\.[jt]sx?$/.test(file.path) ? source[index++] : file));
}

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
export type BatchDiagnostic = 'output_limit' | 'manifest' | 'model_no_change' | BatchFailureCode | RequestFailure;

const MAX_DECOMPOSITIONS = 2;
const MAX_EXTRACTED_FILES = 4;

/** Extraction may add leaf modules, never reschedule unrelated files or change configuration. */
function validateDecomposition(text: string, target: FileTask, candidate: SourceFiles, filePlan: FileTask[]) {
  const result = parseFileManifest(text);
  const extracted = result.files.slice(0, -1);
  const occupied = new Set([...Object.keys(candidate), ...filePlan.map(({ path }) => path)]);

  if (
    result.status !== 'changed' ||
    result.files.at(-1)?.path !== target.path ||
    !extracted.length ||
    extracted.length > MAX_EXTRACTED_FILES ||
    extracted.some(
      ({ path }) =>
        !/^src\/.+\.(?:[jt]sx?|css)$/.test(path) ||
        occupied.has(path) ||
        /^src\/lib\/jingyue-(?:data|auth)\.ts$/.test(path),
    )
  ) {
    throw new RunError(
      '文件清单格式校验失败：只允许新增 1–4 个未占用的 src 小模块或样式文件，最后保留原目标文件负责集成；不得重排其他任务或修改配置。',
      false,
      'manifest',
    );
  }

  return result.files;
}

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
    wait?: typeof retryDelay;
  },
): Request {
  let calls = 0;
  let reservedTokens = 0;
  let batchId = 0;
  let decompositions = 0;
  let transportRetries = 0;
  const attemptRequest: Request = async (phase, input, signal) => {
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
  const ask: Request = async (phase, input, signal) => {
    const sources = options.capture ? sourceSnapshot(options.capture()) : undefined;
    return withRequestRecovery(
      async () => {
        if (sources && options.capture) {
          assertSameSources(sources, options.capture());
        }

        return attemptRequest(phase, input, signal);
      },
      signal,
      {
        wait: options.wait,
        retry: (error) => {
          options.guard();

          if (transportRetries >= 6) {
            return false;
          }

          /*
           * Retry only this request, never the whole project. Each attempt counts
           * against the existing task budget and traverses the quota gateway.
           */
          transportRetries++;
          options.diagnostic?.(input, error.reason);

          return true;
        },
      },
    );
  };

  return async (phase, input, signal) => {
    if (phase !== 'generate' && phase !== 'repair') {
      return ask(phase, input, signal);
    }

    /*
     * Exact edits must match the same canonical source that the model sees.
     * Keep live conflict detection on the unmodified editor snapshot below.
     */
    const files = sourceSnapshot(
      Object.fromEntries(
        Object.entries(input.files).map(([path, content]) => [
          path,
          /\.[jt]sx?$/.test(path) ? stripGeneratedVisualMetadata(content) : content,
        ]),
      ),
    );
    input = { ...input, files, sourceRevision: await sourceRevision(files), operation: phase };

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

    /*
     * A confirmed missing-package error needs a dependency edit, not a second
     * project planner that may rewrite every component. Recompute the diagnosis
     * against this exact candidate; arbitrary model/user text cannot choose it.
     */
    if (phase === 'repair' && input.errors.length === 1) {
      try {
        validateImports(files);
      } catch (error) {
        if (
          error instanceof RunError &&
          error.category === 'dependency' &&
          error.message.startsWith('源码导入了未声明的依赖：') &&
          !error.message.includes('\n') &&
          input.errors[0] === safeDiagnostic(error.message)
        ) {
          manifest = {
            status: 'changed',
            summary: '补齐源码已使用的依赖，保留页面与组件',
            files: [{ path: 'package.json', instruction: error.message }],
          };
        }
      }
    }

    let manifestError: string[] = [];

    for (let correction = 0; !manifest && correction < 2; correction++) {
      try {
        manifest = parseFileManifest(
          await checkedAsk(
            'manifest',
            { ...input, batch: undefined, errors: [...input.errors, ...manifestError] },
            signal,
          ),
        );

        if (phase === 'repair' && input.errors.length && manifest.status === 'unchanged') {
          throw new RunError('修复清单不能用无需修改跳过已确认的检查错误。', true, 'no-change');
        }

        break;
      } catch (error) {
        manifest = undefined;

        const noChange = error instanceof RunError && error.category === 'no-change';

        if (
          !(error instanceof OutputLimitError) &&
          !(error instanceof RunError && error.category === 'manifest') &&
          !noChange
        ) {
          throw error;
        }

        options.diagnostic?.(input, noChange ? 'model_no_change' : 'manifest');

        if (correction) {
          if (noChange) {
            throw new RunError('模型未提供实际改动，已确认的检查错误仍未解决。', false, 'no-change');
          }

          throw new RunError('文件清单格式校验失败，有限纠正仍未完成；当前源码未替换。', false, 'manifest');
        }

        manifestError = [
          noChange
            ? '上次返回 unchanged 无效：input.errors 是程序实际检查到、尚未解决的错误。请对照当前 input.files 定位根因，只列需要实际修正的文件及修正步骤，返回 changed 清单；不要重新规划整个项目或声称检查已通过。'
            : '文件清单无效或被截断。只返回简短文件清单，不要源码；最多 16 个文件。',
        ];
      }
    }

    if (!manifest) {
      throw new RunError('文件清单未完成。');
    }

    if (manifest.status === 'unchanged') {
      return JSON.stringify(manifest);
    }

    let candidate = sourceSnapshot(input.files);
    let filePlan = orderFilePlan(manifest.files);
    let completed = 0;
    const changes = new Map<string, string>();
    const unchangedReasons: string[] = [];
    const generate = async (
      tasks: FileTask[],
      recovery = false,
      priorError = '',
      fullFilePaths = input.fullFilePaths || [],
      allowDecomposition = true,
      sourceRecovery = false,
    ): Promise<void> => {
      guard();

      /*
       * Small files have no need for fragile exact-search patches. Use the same
       * complete-file contract on the first attempt and on recovery.
       */
      fullFilePaths = [
        ...new Set([
          ...fullFilePaths,
          ...tasks.filter(({ path }) => (candidate[path]?.length || 0) < 6000).map(({ path }) => path),
        ]),
      ];

      const batchInput: ManagedModelInput = {
        ...input,
        files: candidate,
        sourceRevision: await sourceRevision(candidate),
        errors: [...input.errors, ...(priorError ? [priorError] : [])],
        fullFilePaths,
        filePlan,
        batch: {
          id: ++batchId,
          files: tasks,
          recovery,
          editOnlyPaths: tasks
            .filter(({ path }) => (candidate[path]?.length || 0) >= 6000 && !fullFilePaths.includes(path))
            .map(({ path }) => path),
          ...(sourceRecovery ? { sourceToken: crypto.randomUUID() } : {}),
        },
      };

      try {
        const raw = await checkedAsk(phase, batchInput, signal);
        const patch = parsePatch(
          batchInput.batch?.sourceToken
            ? bindFileSourceResponse(raw, tasks[0].path, batchInput.batch.sourceToken)
            : tasks.length === 1
              ? bindSingleFileResponse(raw, tasks[0].path)
              : raw,
          candidate,
          fullFilePaths,
          batchInput.batch?.editOnlyPaths,
        );
        const allowed = new Set(tasks.map((task) => task.path));

        /*
         * A planner can over-select an existing stylesheet/config. An explicit,
         * valid no-op may skip it, but can never stand in for creating a new file.
         */
        if (
          allowDecomposition &&
          patch.status === 'unchanged' &&
          tasks.every(({ path }) => Object.hasOwn(candidate, path))
        ) {
          guard();
          unchangedReasons.push(patch.summary);
          completed += tasks.length;
          options.progress?.(completed, filePlan.length);

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

        for (const file of effective) {
          validateSourceSyntax(file.path, file.content);
        }

        if (!effective.length) {
          if (!allowDecomposition) {
            throw new RunError('拆分后的集成文件必须实际接入新增模块，不能返回未修改的原文件。', true, 'batch-missing');
          }

          guard();
          unchangedReasons.push('返回文件与当前源码一致，本批次未修改代码，未验证需求已完成。');
          completed += tasks.length;
          options.progress?.(completed, filePlan.length);

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
        options.progress?.(completed, filePlan.length);
      } catch (error) {
        guard();

        const correctable =
          error instanceof OutputLimitError ||
          (error instanceof RunError &&
            error.repairable &&
            ['format', 'batch-scope', 'batch-missing', 'no-change', 'syntax'].includes(error.category));

        if (!correctable) {
          throw error;
        }

        const code: BatchDiagnostic =
          error instanceof OutputLimitError
            ? 'output_limit'
            : error instanceof ExactEditError
              ? 'patch_mismatch'
              : error instanceof PatchValidationError
                ? error.reason
                : error.category === 'syntax'
                  ? 'source_syntax'
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
            await generate([task], false, safeDiagnostic(error.message), required, allowDecomposition);
          }

          return;
        }

        if (!recovery) {
          await generate(
            tasks,
            true,
            safeDiagnostic(error.message),
            error instanceof ExactEditError ? [...new Set([...fullFilePaths, error.filePath])] : fullFilePaths,
            allowDecomposition,
          );
          return;
        }

        if (
          error instanceof RunError &&
          ['format', 'batch-missing', 'no-change', 'syntax'].includes(error.category) &&
          !sourceRecovery
        ) {
          /*
           * Change the wire format, not merely the wording of the same failed JSON retry.
           * One final bounded request, still charged to the same task/gateway budget.
           */
          await generate(
            tasks,
            true,
            `上次文件未通过校验：${safeDiagnostic(error.message)}。改用指定边界包裹的单文件原文，修正所报语法或传输格式问题。目标文件必须完整返回，不能跳过；无需 JSON 包装或源码转义，仅实现当前目标并完整保留已有功能。`,
            [...new Set([...fullFilePaths, tasks[0].path])],
            allowDecomposition,
            true,
          );
          return;
        }

        if (error instanceof OutputLimitError) {
          const target = tasks[0];

          // JSON/config/HTML cannot be safely extracted like source modules. No blind continuation.
          if (
            !allowDecomposition ||
            decompositions >= MAX_DECOMPOSITIONS ||
            !/\.(?:[jt]sx?|css)$/.test(target.path) ||
            /(?:^|\/)(?:vite|postcss|tailwind)\.config\./.test(target.path)
          ) {
            throw error;
          }

          decompositions++;

          let split: FileTask[] | undefined;
          let correction = '单文件在独立生成及加长重试后仍被截断。将这个文件拆成小模块，不要继续输出同一个大文件。';

          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              split = validateDecomposition(
                await checkedAsk(
                  'manifest',
                  {
                    ...input,
                    files: sourceSnapshot(candidate),
                    sourceRevision: await sourceRevision(candidate),
                    batch: undefined,
                    filePlan,
                    decomposition: { target, maxNewFiles: MAX_EXTRACTED_FILES },
                    errors: [...input.errors, correction],
                  },
                  signal,
                ),
                target,
                candidate,
                filePlan,
              );
              break;
            } catch (failure) {
              guard();

              if (
                !(failure instanceof OutputLimitError) &&
                !(failure instanceof RunError && failure.category === 'manifest')
              ) {
                throw failure;
              }

              options.diagnostic?.(batchInput, 'manifest');

              if (attempt) {
                throw failure;
              }

              correction = safeDiagnostic(failure.message);
            }
          }

          if (split) {
            filePlan = filePlan.flatMap((task) => (task.path === target.path ? split! : [task]));
            options.progress?.(completed, filePlan.length);

            // Each extracted file has its own bounded call. Do not recursively expand a failed split.
            for (const task of split) {
              await generate([task], false, '', fullFilePaths, false);
            }

            return;
          }

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
    const scheduled = [...filePlan];

    for (let i = 0; i < scheduled.length; ) {
      const first = scheduled[i++];
      const tasks = [first];
      const next = scheduled[i];

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
