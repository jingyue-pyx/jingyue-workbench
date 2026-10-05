// Finite descriptions only: never persist raw model output, paths or source in failure notices.
export const BATCH_FAILURE_REASONS = {
  patch_mismatch: '修改片段没有唯一匹配当前源码',
  patch_format: '模型返回的文件改动 JSON 或字段格式无效',
  batch_scope: '模型返回了当前批次不允许修改的文件',
  batch_missing: '模型遗漏了当前批次要求的文件',
} as const;

export type BatchFailureCode = keyof typeof BATCH_FAILURE_REASONS;

export function batchFailureCode(detail: string): BatchFailureCode | undefined {
  const match = /^文件批次校验仍未通过（([a-z_]+)）/.exec(detail);
  return match && Object.hasOwn(BATCH_FAILURE_REASONS, match[1]) ? (match[1] as BatchFailureCode) : undefined;
}
