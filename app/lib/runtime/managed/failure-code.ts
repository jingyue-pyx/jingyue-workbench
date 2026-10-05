import { RunError } from './protocol';

// Only these public labels may reach the UI, saved history or diagnostic logs.
export const FAILURE_REASONS = {
  unsafe_path: '模型返回了禁止写入的文件路径，安全检查已阻止写入',
  protected_config: '模型试图改动受保护的编译配置或基础依赖版本，当前工程未被替换',
  source_size: '文件或项目上下文超过本次处理上限，需拆分修改范围',
  recovery_storage: '浏览器无法保存本次恢复点，为保护现有源码已停止修改',
  storage_quota: '浏览器本机存储空间不足，恢复点未保存，当前源码未被替换',
  internal_type: '运行调度发生类型异常，本次任务已停止，需修复执行流程',
  internal_reference: '运行调度引用异常，本次任务已停止，需修复执行流程',
  internal_error: '运行调度发生未分类异常，本次任务已停止',
} as const;

export function failureCode(error: unknown): keyof typeof FAILURE_REASONS | undefined {
  if (error instanceof RunError) {
    const codes: Record<string, keyof typeof FAILURE_REASONS> = {
      'unsafe-path': 'unsafe_path',
      'protected-config': 'protected_config',
      'source-size': 'source_size',
      'recovery-storage': 'recovery_storage',
    };

    return Object.hasOwn(codes, error.category) ? codes[error.category] : undefined;
  }

  const name = error instanceof Error ? error.name : '';

  if (name === 'QuotaExceededError') {
    return 'storage_quota';
  }

  if (['DataCloneError', 'InvalidStateError', 'UnknownError'].includes(name)) {
    return 'recovery_storage';
  }

  return name === 'TypeError' ? 'internal_type' : name === 'ReferenceError' ? 'internal_reference' : 'internal_error';
}

export function failureReason(code: string | undefined) {
  return code && Object.hasOwn(FAILURE_REASONS, code)
    ? FAILURE_REASONS[code as keyof typeof FAILURE_REASONS]
    : undefined;
}
