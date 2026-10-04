import { RunError, type ManagedModelInput, type ManagedPhase } from './protocol';

/** Optional local adapter. A disabled deployment stays on the existing engine. */
export async function localAgentEngine(model: string): Promise<'managed' | 'opencode'> {
  const response = await fetch('/api/agent-engine', {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10000),
  });

  if (response.status === 404) {
    return 'managed';
  }

  if (!response.ok) {
    throw new RunError('执行引擎状态查询失败，请重新登录或稍后重试。');
  }

  const result = (await response.json()) as { engine?: string; models?: string[] };

  if (result.engine === 'opencode' && result.models?.includes(model)) {
    return 'opencode';
  }

  return 'managed';
}

export async function openCodeRequest(
  phase: ManagedPhase,
  payload: ManagedModelInput,
  options: {
    model: string;
    projectId?: string;
    signal: AbortSignal;
    onProgress?: (receivedChars: number, detail?: string) => void;
  },
): Promise<string> {
  /*
   * The browser runtime adds lockfiles during installation. They remain in
   * the user's project, but are not editable inputs to this candidate adapter.
   */
  const files = Object.fromEntries(
    Object.entries(payload.files).filter(
      ([path]) => !/(^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path),
    ),
  );
  const response = await fetch('/api/opencode', {
    method: 'POST',
    credentials: 'same-origin',
    signal: options.signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, files, phase, projectId: options.projectId, model: options.model }),
  });

  if (!response.ok) {
    throw new RunError(
      response.status === 401
        ? '登录已失效，请重新登录。'
        : response.status === 429
          ? 'OpenCode 任务或模型额度限制已触发，请稍后重试。'
          : `OpenCode 请求失败（${response.status}），已有源码保留。`,
      false,
      'agent',
    );
  }

  if (!response.body) {
    throw new RunError('OpenCode 没有返回执行结果。', false, 'agent');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: string | undefined;
  let received = 0;
  const labels: Record<string, string> = {
    starting: '正在启动隔离的 OpenCode 工作区',
    coding: 'OpenCode 正在读取、修改并检查候选源码',
    repairing: 'OpenCode 正在依据真实检查结果修复',
    installing: '正在安装候选工程依赖',
    typechecking: '正在独立验证候选类型检查',
    building: '正在独立验证候选生产构建',
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      options.signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: true });

      if (buffer.length > 2 * 1024 * 1024) {
        throw new RunError('OpenCode 结果超过大小限制。', false, 'agent');
      }

      let end: number;

      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);

        if (!line.trim()) {
          continue;
        }

        const event = JSON.parse(line);

        if (event.type === 'error') {
          throw new RunError(String(event.message).slice(0, 500), false, 'agent');
        }

        if (event.type === 'progress') {
          received += Number.isSafeInteger(event.chars) && event.chars > 0 ? event.chars : 0;
          options.onProgress?.(received, labels[event.stage]);
        }

        if (event.type === 'result') {
          if (result || !event.patch || !Array.isArray(event.patch.files)) {
            throw new RunError('OpenCode 返回了无效候选结果。', false, 'agent');
          }

          result = JSON.stringify(event.patch);
        }
      }
    }

    options.signal.throwIfAborted();

    if (buffer.trim() || !result) {
      throw new RunError('OpenCode 连接中断或结果不完整，已有源码保留。', false, 'agent');
    }

    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
