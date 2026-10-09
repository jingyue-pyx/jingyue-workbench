import { RunError } from './protocol';

// Finite classifications, not provider messages or string-matched UI copy.
export const REQUEST_FAILURES = {
  model_network: {
    category: 'network',
    retryable: true,
    message: '模型连接中断，自动重连仍未完成。已有源码保留，可以继续提问或稍后继续这次任务。',
  },
  model_unavailable: {
    category: 'model-service',
    retryable: true,
    message: '模型服务暂时不可用，自动重试仍未恢复。已有源码保留，无需重新描述项目。',
  },
  model_incomplete: {
    category: 'model-output',
    retryable: true,
    message: '模型响应意外中断，自动补试仍未完成。不完整内容未写入，已有源码保留。',
  },
  model_auth: {
    category: 'model-service',
    retryable: false,
    message: '平台模型连接配置需要管理员处理。已有源码保留，你不需要提供个人 API Key。',
  },
  model_limit: {
    category: 'quota',
    retryable: false,
    message: '模型额度或频率限制已触发。已有源码保留，请等待额度恢复后继续，不需要调整需求。',
  },
  model_rate_limit: {
    category: 'quota',
    retryable: true,
    message: '模型请求暂时较多，按服务端等待后重试仍未恢复。已有源码保留，可稍后继续这次任务。',
  },
  model_daily_limit: {
    category: 'quota',
    retryable: false,
    message: '今日模型调用额度已用完，当前任务已停止，已有源码保留。需要等待额度恢复或由管理员调整额度；无需修改需求。',
  },
  model_request: {
    category: 'model-service',
    retryable: false,
    message: '模型服务未接受本次请求，需要检查服务端请求配置。已有源码保留，可以继续询问失败原因。',
  },
  model_unknown: {
    category: 'model-service',
    retryable: false,
    message: '模型服务未完成请求，原因尚未确认。已有源码保留，系统已记录本次失败以便排查。',
  },
  model_policy: {
    category: 'model-output',
    retryable: false,
    message: '模型未接受本次生成内容，系统不会自动重复提交。已有源码保留，可以调整内容后继续。',
  },
  session_expired: {
    category: 'authentication',
    retryable: false,
    message: '登录已失效，请重新登录后继续；本机草稿保留。',
  },
  request_denied: {
    category: 'authorization',
    retryable: false,
    message: '当前账号没有执行这项操作的权限。已有源码保留，请检查登录账号或项目访问权限。',
  },
} as const;

export type RequestFailure = keyof typeof REQUEST_FAILURES;

export class ModelRequestError extends RunError {
  readonly retryable: boolean;
  readonly retryAfterMs: number;

  constructor(
    readonly reason: RequestFailure,
    retryAfterMs = 60000,
  ) {
    const failure = REQUEST_FAILURES[reason];
    super(failure.message, false, failure.category);
    this.name = 'ModelRequestError';
    this.retryable = failure.retryable;
    this.retryAfterMs =
      reason === 'model_rate_limit'
        ? Number.isFinite(retryAfterMs)
          ? Math.max(1000, Math.min(60000, retryAfterMs))
          : 60000
        : 0;
  }
}

export function requestFailureMessage(code: string | undefined) {
  return code && Object.hasOwn(REQUEST_FAILURES, code) ? REQUEST_FAILURES[code as RequestFailure].message : undefined;
}

export function retryDelay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
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
  });
}

/** One bounded retry policy; the caller owns budget accounting and source guards. */
export async function withRequestRecovery<T>(
  attempt: () => Promise<T>,
  signal: AbortSignal,
  options: { retry?(error: ModelRequestError): boolean; wait?: typeof retryDelay } = {},
): Promise<T> {
  for (let retry = 0; ; retry++) {
    signal.throwIfAborted();

    try {
      return await attempt();
    } catch (error) {
      signal.throwIfAborted();

      if (!(error instanceof ModelRequestError) || !error.retryable || retry >= 2 || options.retry?.(error) === false) {
        throw error;
      }

      await (options.wait || retryDelay)(error.retryAfterMs || 500 * 2 ** retry, signal);
    }
  }
}
