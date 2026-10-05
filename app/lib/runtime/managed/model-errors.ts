import { managedTrace } from './request-policy';

export const MODEL_FAILURES = {
  JINGYUE_MODEL_NETWORK: { category: 'network', message: '模型连接中断，未收到完整响应；已有源码保留，请稍后重试。' },
  JINGYUE_MODEL_LIMIT: { category: 'quota', message: '模型服务额度或频率限制已触发，请稍后重试或检查服务端额度。' },
  JINGYUE_MODEL_AUTH: {
    category: 'model-service',
    message: '模型服务端认证失败，请管理员检查模型配置；无需在页面填写密钥。',
  },
  JINGYUE_MODEL_REQUEST: {
    category: 'model-service',
    message: '模型服务拒绝了本次请求，请检查模型参数或缩小需求后重试。',
  },
  JINGYUE_MODEL_UNAVAILABLE: {
    category: 'model-service',
    message: '模型服务暂不可用，尚未完成本次生成；已有源码保留，请稍后重试。',
  },
} as const;

/** Never inspect or forward message, responseBody, request data, URLs or headers. */
function modelFailureDetail(error: unknown): { code: keyof typeof MODEL_FAILURES; reason: string } {
  let current = error;

  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth++) {
    try {
      const item = current as { statusCode?: unknown; code?: unknown; cause?: unknown; lastError?: unknown };

      if (item.statusCode === 429) {
        return { code: 'JINGYUE_MODEL_LIMIT', reason: 'HTTP_429' };
      }

      if (item.statusCode === 401 || item.statusCode === 403) {
        return { code: 'JINGYUE_MODEL_AUTH', reason: `HTTP_${item.statusCode}` };
      }

      if (
        Number.isInteger(item.statusCode) &&
        typeof item.statusCode === 'number' &&
        item.statusCode >= 500 &&
        item.statusCode <= 599
      ) {
        return { code: 'JINGYUE_MODEL_UNAVAILABLE', reason: `HTTP_${item.statusCode}` };
      }

      if (
        Number.isInteger(item.statusCode) &&
        typeof item.statusCode === 'number' &&
        item.statusCode >= 400 &&
        item.statusCode <= 499
      ) {
        return { code: 'JINGYUE_MODEL_REQUEST', reason: `HTTP_${item.statusCode}` };
      }

      if (
        typeof item.code === 'string' &&
        [
          'ECONNRESET',
          'ETIMEDOUT',
          'EAI_AGAIN',
          'ENOTFOUND',
          'ECONNREFUSED',
          'ERR_STREAM_PREMATURE_CLOSE',
          'UND_ERR_SOCKET',
          'UND_ERR_CONNECT_TIMEOUT',
          'UND_ERR_HEADERS_TIMEOUT',
          'UND_ERR_BODY_TIMEOUT',
        ].includes(item.code)
      ) {
        return { code: 'JINGYUE_MODEL_NETWORK', reason: item.code };
      }

      current = item.lastError || item.cause;
    } catch {
      break;
    }
  }

  return { code: 'JINGYUE_MODEL_UNAVAILABLE', reason: 'UNKNOWN' };
}

export function modelFailureCode(error: unknown): keyof typeof MODEL_FAILURES {
  return modelFailureDetail(error).code;
}

export function modelFailureEvent(phase: string, code: keyof typeof MODEL_FAILURES, trace: unknown, error?: unknown) {
  const stage = ['intent', 'answer', 'plan', 'manifest', 'generate', 'repair'].includes(phase) ? phase : 'unknown';
  return (
    `managed_model_${stage}_${code}${error === undefined ? '' : `_reason_${modelFailureDetail(error).reason}`}` +
    Object.entries(managedTrace(trace))
      .map(([key, value]) => `_${key}_${value}`)
      .join('')
  );
}
