// Finite, client-reported diagnostic labels, never arbitrary console output.
export function runtimeEventName(data) {
  const keys = ['outcome', 'stage', 'reason', 'attempt'];
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some((k) => !keys.includes(k)))
    return null;
  if (!['failed', 'succeeded', 'unchanged', 'cancelled'].includes(data.outcome)) return null;
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
      'model_no_change',
      'model_service',
      'sandbox',
      'other',
    ].includes(data.reason)
  )
    return null;
  if (!Number.isInteger(data.attempt) || data.attempt < 0 || data.attempt > 2) return null;
  return `client_runtime_${data.outcome}_${data.stage}_${data.reason}_repair_${data.attempt}`;
}
