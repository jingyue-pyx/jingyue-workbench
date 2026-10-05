// Finite, client-reported diagnostic labels, never arbitrary console output.
export function runtimeEventName(data) {
  const keys = ['outcome', 'stage', 'reason', 'attempt', 'runId', 'projectId', 'batch'];
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some((k) => !keys.includes(k)))
    return null;
  if (!['failed', 'succeeded', 'unchanged', 'cancelled', 'retrying'].includes(data.outcome)) return null;
  if (
    ![
      'idle',
      'planning',
      'reviewing',
      'generating',
      'applying',
      'installing',
      'typechecking',
      'building',
      'starting',
      'previewing',
      'repairing',
    ].includes(data.stage)
  )
    return null;
  if (
    ![
      'none',
      'capability',
      'plan_format',
      'plan_clarification',
      'quota',
      'authentication',
      'preview_connection',
      'timeout',
      'network',
      'dependency_install',
      'compile',
      'style',
      'model_output',
      'output_limit',
      'batch_budget',
      'patch_mismatch',
      'patch_format',
      'batch_scope',
      'batch_missing',
      'manifest',
      'model_no_change',
      'model_service',
      'sandbox',
      'other',
      'unsafe_path',
      'protected_config',
      'source_size',
      'recovery_storage',
      'storage_quota',
      'internal_type',
      'internal_reference',
      'internal_error',
    ].includes(data.reason)
  )
    return null;
  if (!Number.isInteger(data.attempt) || data.attempt < 0 || data.attempt > 2) return null;
  let suffix = '';
  for (const key of ['projectId', 'runId']) {
    if (data[key] === undefined) continue;
    if (
      typeof data[key] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data[key])
    )
      return null;
    suffix += `_${key}_${data[key]}`;
  }
  if (data.batch !== undefined) {
    if (!Number.isInteger(data.batch) || data.batch < 1 || data.batch > 32) return null;
    suffix += `_batch_${data.batch}`;
  }
  return `client_runtime_${data.outcome}_${data.stage}_${data.reason}_repair_${data.attempt}${suffix}`;
}
