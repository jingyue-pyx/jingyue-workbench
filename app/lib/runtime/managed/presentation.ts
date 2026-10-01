import { safeDiagnostic, type RunState } from './protocol';
import { PREPARATION_FAILURE_MESSAGE } from './failure-notice';
import type { BatchDiagnostic } from './file-batches';
import type { ManagedModelInput } from './protocol';
import { managedTrace } from './request-policy';

/*
 * Compiler/package logs can contain HTTP 429, line numbers or timings. None of
 * those is evidence of model-account quota exhaustion.
 */
const modelQuotaFailure = (text: string) =>
  /模型(?:调用)?(?:已达到|.*已触发|.*限制)|模型额度|模型.*频率/.test(text) && /额度|频率/.test(text);

// User-facing copy is independent from compiler output and logs.
export function runMessage(
  state: Pick<RunState, 'phase'> & Partial<Pick<RunState, 'events' | 'detail' | 'candidatePending'>>,
) {
  if (state.phase === 'succeeded') {
    return '页面预览已就绪，可以继续查看或修改。';
  }

  if (state.phase === 'unchanged') {
    return `本轮没有修改源码，现有文件和预览保留。\n\n模型的检查意见（尚未进行本轮编译和业务验收）：${safeDiagnostic(state.detail || '').slice(0, 2000)}\n\n如果页面仍不符合要求，请指出具体入口、操作或期望变化，我会继续修改；也可以说“重新检查预览”。`;
  }

  if (state.phase === 'cancelled') {
    return '已停止，当前草稿保留。';
  }

  if (state.phase === 'failed') {
    if (/模型输出达到长度限制/.test(state.detail || '')) {
      return '单文件输出仍达到长度上限：系统已缩小批次并有限重试，不完整内容没有写入。已完成的候选批次保留在本机，现有源码和预览未替换；可以继续要求拆分大组件后修改。';
    }

    if (/分批生成达到/.test(state.detail || '')) {
      return '本次分批生成已达到请求或输出预算，任务安全停止。已完成候选批次保留在本机，现有源码和预览未替换；可以缩小功能范围后继续。';
    }

    if (/文件批次校验仍未通过|文件清单格式校验失败/.test(state.detail || '')) {
      return '文件清单或改动批次未通过校验，有限重试仍未成功。本轮候选未覆盖现有源码，可以继续描述需要修改的具体功能。';
    }

    if (/当前源码版本已变化/.test(state.detail || '')) {
      return '源码在任务执行期间已更新，本轮候选没有覆盖最新内容。请基于当前源码继续；无需重新生成项目。';
    }

    if (/候选源码语法检查失败/.test(state.detail || '')) {
      return '候选代码仍有语法错误，自动修复尚未通过。候选草稿保留在本机，当前工程未被这份候选覆盖；可以继续修复。';
    }

    const stage = state.events?.filter((event) => !['failed', 'cancelled'].includes(event.phase)).at(-1)?.phase;

    if (state.candidatePending && ['installing', 'typechecking', 'building'].includes(stage || '')) {
      const step = stage === 'installing' ? '依赖安装' : stage === 'typechecking' ? '类型检查' : '构建';
      return `候选代码未通过${step}，本轮检查与有限恢复尚未完成。当前源码和原预览未被替换，候选草稿保留在本机；可以继续修复。`;
    }

    if (stage === 'installing' && /依赖安装不完整|安装不完整/.test(state.detail || '')) {
      return '依赖包安装不完整，有限重装仍未通过，尚未进入源码编译。源码保留，不需要重新生成页面；可重新加载工作台后检查预览。';
    }

    if (stage === 'installing' && /超时|连接失败|ECONN|ENOTFOUND|网络|E429|\b429\b/.test(state.detail || '')) {
      return '依赖安装未完成：安装服务连接失败或超时，尚未进入编译。已生成的源码和对话保留，无需调整需求或重新生成；可以发送“重新检查预览”沿用现有源码重试。';
    }

    if (/沙箱启动进程|沙箱读取依赖锁文件|沙箱配置预览检查/.test(state.detail || '')) {
      return '浏览器运行环境暂时没有响应，检查已停止。已保存源码保留，请重新加载工作台恢复运行环境；无需重新生成项目。';
    }

    if (/浏览器沙箱启动|沙箱文件写入/.test(state.detail || '')) {
      return /浏览器沙箱启动/.test(state.detail || '')
        ? '浏览器运行环境未启动，无法写入文件或编译，这不是需求或模型密钥错误。请在 Chrome 打开同一项目并检查 StackBlitz 连接；恢复运行环境后再继续。已保存的对话与源码不会删除。'
        : '浏览器沙箱写入文件中断，尚未通过编译。请重新加载工作台恢复运行环境，再继续；已保存的对话与源码保留，无需重新描述需求。';
    }

    if (stage === 'previewing' && /预览(?:连接检查|检查响应)超时/.test(state.detail || '')) {
      return '代码已写入并通过构建，但预览连接检查超时。开发服务保留，可打开右侧预览查看；当前尚未确认页面可用，不需要因此重新生成整个项目。';
    }

    if (/样式依赖缺失/.test(state.detail || '')) {
      return '页面样式未准备完整：生成的样式类缺少对应样式支持。源码已保留，尚未通过页面检查，可以继续修复。';
    }

    if (/模型未提供实际改动|模型未提供新的有效改动/.test(state.detail || '')) {
      return '本轮模型没有提供实际代码改动，待修复问题仍未解决，不能算作完成。现有源码保留；请补充具体操作现象后继续修改。';
    }

    if (/局部修改/.test(state.detail || '')) {
      return '本轮局部改码未能通过校验：修改片段格式无效或未唯一匹配当前源码，本轮候选内容未写入。此前草稿保留，可以基于当前代码继续修复；这不是预览连接故障。';
    }

    if (/模型输出未完整结束|模型返回格式不完整|模型没有返回可执行/.test(state.detail || '')) {
      return '代码生成未完成：模型没有返回完整、有效的文件改动，本次不完整内容未写入。已有源码保留，可以缩小修改范围后重试。';
    }

    if (modelQuotaFailure(state.detail || '')) {
      return '本次模型调用已达到额度或频率限制，未能继续生成。已有源码保留，请稍后重试。';
    }

    if (/模型连接中断|模型服务暂时失败|模型生成失败|模型服务没有返回内容/.test(state.detail || '')) {
      return '模型服务连接或响应失败，未写入本次不完整文件。已有源码保留，请稍后重试；这不代表现有页面编译失败。';
    }

    if (stage === 'typechecking' || stage === 'building') {
      return `代码未通过${stage === 'typechecking' ? 'TypeScript 类型检查' : '正式构建'}，本轮自动修复尚未解决全部错误。已写入的草稿保留，尚未进入可用预览；可以继续要求修复当前代码，无需重新生成整个页面。`;
    }

    return PREPARATION_FAILURE_MESSAGE;
  }

  if (state.phase === 'planning') {
    return '正在整理方案…';
  }

  if (state.phase === 'reviewing') {
    return '请确认方案后继续';
  }

  if (state.phase === 'repairing') {
    return '正在调整页面…';
  }

  return '正在准备页面…';
}

export function runtimeEvent(state: RunState) {
  // Classify the final failure, not an earlier error already being repaired.
  const text = state.detail || state.errors.at(-1) || '';
  const reason =
    state.phase !== 'failed'
      ? 'none'
      : /模型输出达到长度限制/.test(text)
        ? 'output_limit'
        : /分批生成达到/.test(text)
          ? 'batch_budget'
          : /文件批次校验仍未通过|文件清单格式校验失败/.test(text)
            ? 'model_output'
            : /规划格式|技术方案.*格式|清单格式|模块定义|方案问题|方案选项/.test(text)
              ? 'plan_format'
              : /额外澄清|重复追问/.test(text)
                ? 'plan_clarification'
                : modelQuotaFailure(text)
                  ? 'quota'
                  : /登录/.test(text)
                    ? 'authentication'
                    : /预览.*(?:连接|响应)|preview.*(?:connect|timeout)/i.test(text)
                      ? 'preview_connection'
                      : /浏览器沙箱启动|沙箱文件写入/.test(text)
                        ? 'sandbox'
                        : /超时|时间上限|timeout/i.test(text)
                          ? 'timeout'
                          : /模型未提供实际改动|模型未提供新的有效改动/.test(text)
                            ? 'model_no_change'
                            : /模型输出未完整结束|模型返回格式不完整|模型没有返回可执行|局部修改/.test(text)
                              ? 'model_output'
                              : /模型连接中断|模型服务暂时失败|模型生成失败|模型服务没有返回内容/.test(text)
                                ? 'model_service'
                                : /依赖安装不完整|安装不完整/.test(text)
                                  ? 'dependency_install'
                                  : /样式依赖缺失/.test(text)
                                    ? 'style'
                                    : /网络|ECONN|ENOTFOUND|registry/i.test(text)
                                      ? 'network'
                                      : /TS\d{4}|类型检查|构建|候选源码语法检查失败|未声明的依赖|compile|build/i.test(
                                            text,
                                          )
                                        ? 'compile'
                                        : /沙箱|WebContainer/i.test(text)
                                          ? 'sandbox'
                                          : 'other';

  return {
    outcome: state.phase,
    stage:
      state.events.filter((event) => !['failed', 'cancelled', 'succeeded', 'unchanged'].includes(event.phase)).at(-1)
        ?.phase || 'idle',
    reason,
    attempt: state.attempt,
  };
}

// Best effort: do not block saving. Never send source, chat, credentials or raw logs.
export function reportRuntime(state: RunState, projectId?: string) {
  return reportEvent({ ...runtimeEvent(state), ...managedTrace({ projectId, runId: state.id }) });
}

export function reportModelBatch(input: ManagedModelInput, code: BatchDiagnostic, projectId?: string) {
  return reportEvent({
    outcome: 'retrying',
    stage: input.attempt ? 'repairing' : 'generating',
    reason: code,
    attempt: input.attempt || 0,
    ...managedTrace({ projectId, runId: input.runId, batch: input.batch?.id }),
  });
}

async function reportEvent(event: object) {
  try {
    await fetch('/api/runtime-events', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* A disconnected browser cannot guarantee log delivery. */
  }
}
