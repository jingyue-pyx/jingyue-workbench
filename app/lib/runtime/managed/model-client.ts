import { processDataStream, type Message } from 'ai';
import {
  PlanValidationError,
  OutputLimitError,
  RunError,
  sourceEnvelope,
  type ManagedPhase,
  type ManagedModelInput,
} from './protocol';
import type { ConversationPhase } from './conversation';
import { MODEL_FAILURES } from './model-errors';
import { ModelRequestError, type RequestFailure } from './request-errors';
import { buildConversationContext } from './conversation-context';

export async function managedModelRequest(
  phase: ManagedPhase | ConversationPhase,
  payload: ManagedModelInput,
  options: {
    model: string;
    provider: string;
    signal: AbortSignal;
    history?: Message[];
    onProgress?: (chars: number) => void;
    projectId?: string;
  },
) {
  const target =
    (phase === 'generate' || phase === 'repair') && payload.batch?.files.length === 1
      ? payload.batch.files[0]
      : undefined;
  const editTarget =
    target && payload.batch?.editOnlyPaths?.includes(target.path) && !payload.fullFilePaths?.includes(target.path);
  const sourceFrame = target && payload.batch?.sourceToken ? sourceEnvelope(payload.batch.sourceToken) : undefined;
  const context = buildConversationContext(options.history, !!target);
  const content =
    `[Model: ${options.model}]\n\n[Provider: ${options.provider}]\n\n` +
    JSON.stringify({
      ...payload,
      task: target
        ? `只完成当前文件 ${target.path}：${target.instruction}`
        : phase === 'manifest' && payload.operation === 'repair'
          ? '只为 input.errors 中当前仍存在的问题生成最小修复清单。原项目已经生成，不要重新实现 projectGoal，不要重写无关模块。'
          : payload.task,
      projectGoal: target || payload.operation === 'repair' ? payload.task : undefined,
      repairContract:
        payload.operation === 'repair'
          ? {
              instruction:
                '当前诊断优先于原始实现任务。定位错误文件与必要的依赖/调用方，只修改根因。已经存在且无错误的模块不要重新生成。不能用 unchanged 跳过诊断，也不能删除功能、禁用检查或添加 any 来掩盖类型错误。',
              currentDiagnostics: payload.errors,
            }
          : undefined,
      targetFile: target,
      conversation: context.conversation,
      conversationContext: context.context,
      files: Object.fromEntries(
        Object.entries(payload.files).filter(
          ([path]) => !/^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path),
        ),
      ),

      // Put the exact output scope after the large read-only source context.
      outputContract: target
        ? sourceFrame
          ? {
              instruction:
                '只输出当前目标文件的完整原始源码。第一行与最后一行分别使用 start 和 end；不要 JSON 包装、转义源码或附加 Markdown/说明。',
              targetPath: target.path,
              ...sourceFrame,
            }
          : {
              instruction:
                '当前只实现 targetFile，其他文件仅供参考。路径由程序绑定，不返回 files 数组或 path。新文件不可跳过。',
              targetPath: target.path,
              changedResponse: {
                status: 'changed',
                summary: '仅说明本文件的修改，不声称已验证',
                ...(editTarget
                  ? { edits: [{ search: '当前目标文件中唯一匹配的原文', replace: '完整替换片段' }] }
                  : { content: '目标文件的完整内容，不含省略' }),
              },
              unchangedResponse: { status: 'unchanged', summary: '仅当当前已有目标文件确实无需改动时说明原因' },
            }
        : phase === 'manifest' && payload.decomposition
          ? {
              instruction:
                '只拆分 targetPath 的职责，返回简短清单，不返回源码、不重做项目。先列 1–4 个未占用的 src 小模块或样式文件，最后必须是原目标文件并实际接入它们。保留原导出和已有功能，不增加依赖或修改其他文件。',
              targetPath: payload.decomposition.target.path,
              maxNewFiles: payload.decomposition.maxNewFiles,
              response: {
                status: 'changed',
                summary: '本文件的拆分说明',
                files: [
                  { path: '新的 src 模块路径', instruction: '职责与明确的导出、类型和 props' },
                  { path: payload.decomposition.target.path, instruction: '保持原导出，接入新增模块' },
                ],
              },
            }
          : payload.batch
            ? {
                instruction:
                  '只实现 files 中的逐文件指令，返回本批次指定路径的合法 JSON 改动；全局需求由全部批次合并完成。其他源码仅供参考，不能返回示例路径或已完成的其他批次文件。changed 时必须完整返回本批次所有文件；如果本批次全是已有文件且确实无需修改，可返回 unchanged 和空 files，并解释原因，这不代表整个任务已完成。新文件不可跳过。',
                files: payload.batch.files,
                changedResponse: {
                  status: 'changed',
                  summary: '本批次具体修改，不声称编译通过',
                  files: payload.batch.files.map(({ path }) =>
                    payload.batch!.editOnlyPaths?.includes(path) && !payload.fullFilePaths?.includes(path)
                      ? { path, edits: [{ search: '当前文件中唯一匹配的原文', replace: '完整替换片段' }] }
                      : { path, content: '此路径的完整文件内容，不含占位或省略' },
                  ),
                },
                fullContentPaths: payload.fullFilePaths?.filter((path) =>
                  payload.batch!.files.some((file) => file.path === path),
                ),
                editOnlyPaths: payload.batch.editOnlyPaths,
              }
            : undefined,
    });

  if (new TextEncoder().encode(content).byteLength > 650000) {
    throw new RunError('项目上下文超过本期自动处理上限，请拆分工程；源码未删除。', false, 'source-size');
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'same-origin',
    signal: options.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      managedPhase: phase,
      managedProjectId: options.projectId,
      managedBatchMode: payload.batch ? (payload.batch.recovery ? 'recovery' : 'file') : undefined,
      managedSingleFile: target ? true : undefined,
      managedFileOutput: sourceFrame
        ? 'source'
        : payload.batch
          ? payload.batch.files.every(
              ({ path }) => !payload.batch!.editOnlyPaths?.includes(path) || payload.fullFilePaths?.includes(path),
            )
            ? 'content'
            : 'edits'
          : undefined,
      managedTrace: {
        projectId: options.projectId,
        runId: payload.runId,
        attempt: payload.attempt,
        batch: payload.batch?.id,
      },
      managedPlanFinalization: phase === 'plan' && !!payload.plan?.decisions?.length,
      contextOptimization: false,
      messages: [{ id: crypto.randomUUID(), role: 'user', content }],
    }),
  }).catch(() => {
    options.signal.throwIfAborted();
    throw new ModelRequestError('model_network');
  });

  if (!response.ok) {
    if (response.status === 429) {
      const kind = response.headers.get('x-jingyue-model-limit');
      const seconds = response.headers.get('retry-after') || '';
      throw new ModelRequestError(
        kind === 'minute' ? 'model_rate_limit' : kind === 'daily' ? 'model_daily_limit' : 'model_limit',
        /^\d{1,5}$/.test(seconds) ? Number(seconds) * 1000 : 60000,
      );
    }

    throw new ModelRequestError(
      response.status === 401
        ? 'session_expired'
        : response.status === 403
          ? 'request_denied'
          : [408, 500, 502, 503, 504].includes(response.status)
            ? 'model_unavailable'
            : 'model_request',
    );
  }

  if (!response.body) {
    throw new ModelRequestError('model_incomplete');
  }

  let text = '';
  let finish = '';
  let lastProgress = 0;

  try {
    await processDataStream({
      stream: response.body,
      onTextPart: (part) => {
        text += part;

        if (text.length > 1200000) {
          throw new RunError('模型输出超过文件处理上限。');
        }

        if (Date.now() - lastProgress >= 250) {
          options.signal.throwIfAborted();
          options.onProgress?.(text.length);
          lastProgress = Date.now();
        }
      },
      onErrorPart: (error) => {
        const reasons: Record<keyof typeof MODEL_FAILURES, RequestFailure> = {
          JINGYUE_MODEL_NETWORK: 'model_network',
          JINGYUE_MODEL_LIMIT: 'model_limit',
          JINGYUE_MODEL_AUTH: 'model_auth',
          JINGYUE_MODEL_REQUEST: 'model_request',
          JINGYUE_MODEL_UNAVAILABLE: 'model_unavailable',
          JINGYUE_MODEL_UNKNOWN: 'model_unknown',
        };
        throw new ModelRequestError(
          Object.hasOwn(reasons, error) ? reasons[error as keyof typeof reasons] : 'model_unknown',
        );
      },
      onFinishMessagePart: (part) => {
        finish = part.finishReason;
      },
    });
  } catch (error) {
    options.signal.throwIfAborted();

    if (error instanceof RunError) {
      throw error;
    }

    throw new ModelRequestError('model_network');
  }
  options.signal.throwIfAborted();
  options.onProgress?.(text.length);

  if (finish !== 'stop') {
    if (!finish) {
      // EOF without a finish marker is transport loss, not a token overflow.
      throw new ModelRequestError('model_incomplete');
    }

    if (finish === 'content-filter') {
      throw new ModelRequestError('model_policy');
    }

    if (phase === 'plan' && finish === 'length') {
      throw new PlanValidationError(['JSON：方案输出被长度限制截断，请精简各字段并返回完整对象']);
    }

    if (finish === 'length' && ['generate', 'repair', 'manifest'].includes(phase)) {
      // Only the file scheduler may retry this. Never feed partial JSON into the compiler-repair loop.
      throw new OutputLimitError();
    }

    throw new RunError(
      payload.fullFilePaths?.length
        ? '模型输出未完整结束，本次候选未写入。fullFilePaths 中的文件仍须返回完整 content，不得回到已失败的 edits；请缩小本轮修改范围，保留当前文件的其它功能，不要省略代码。'
        : '模型输出未完整结束，未执行半成品文件；请缩小本轮修改范围。新文件和小文件返回完整 content；仅对当前源码中较大文件的小改动使用唯一匹配的 search/replace edits，保留现有功能。',
      false,
      'model-output',
    );
  }

  if (!text.trim()) {
    throw new ModelRequestError('model_incomplete');
  }

  return text;
}
