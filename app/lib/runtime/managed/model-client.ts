import { processDataStream, type Message } from 'ai';
import { PlanValidationError, OutputLimitError, RunError, type ManagedPhase, type ManagedModelInput } from './protocol';
import type { ConversationPhase } from './conversation';
import { MODEL_FAILURES } from './model-errors';

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
  const content =
    `[Model: ${options.model}]\n\n[Provider: ${options.provider}]\n\n` +
    JSON.stringify({
      ...payload,
      conversation: options.history
        ?.slice(-8)
        .map((message) => ({ role: message.role, content: String(message.content).slice(0, 3000) })),
      files: Object.fromEntries(
        Object.entries(payload.files).filter(
          ([path]) => !/^(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path),
        ),
      ),

      // Put the exact output scope after the large read-only source context.
      outputContract: payload.batch
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
    throw new RunError('项目上下文超过本期自动处理上限，请拆分工程；源码未删除。');
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
    throw new RunError('模型连接中断，尚未收到完整响应；已有源码保留，请重试。', false, 'network');
  });

  if (!response.ok) {
    throw new RunError(
      response.status === 429
        ? '模型额度或频率限制已触发，任务已停止。'
        : response.status === 401
          ? '登录已失效，请重新登录后继续。'
          : `模型服务暂时失败（${response.status}），草稿保留。`,
    );
  }

  if (!response.body) {
    throw new RunError('模型服务没有返回内容。');
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
        const failure =
          MODEL_FAILURES[
            Object.hasOwn(MODEL_FAILURES, error) ? (error as keyof typeof MODEL_FAILURES) : 'JINGYUE_MODEL_UNAVAILABLE'
          ];
        throw new RunError(failure.message, false, failure.category);
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

    throw new RunError('模型连接中断，未写入本次不完整文件；已有源码保留，请重试。', false, 'network');
  }
  options.signal.throwIfAborted();
  options.onProgress?.(text.length);

  if (finish !== 'stop') {
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

  return text;
}
