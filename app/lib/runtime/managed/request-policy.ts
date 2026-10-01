/** Finite output budgets, not caller-supplied token counts. Gateway quotas still apply per call. */
export function managedOutputTokens(phase: string, mode?: unknown) {
  if (phase === 'intent' || phase === 'answer') {
    return 1600;
  }

  if (phase === 'plan' || phase === 'manifest') {
    return 2600;
  }

  if (mode === 'file') {
    return 8000;
  }

  if (mode === 'recovery') {
    return 16000;
  }

  return 12000; // Compatibility for already-open clients.
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Never log client-supplied text, paths, code, prompts or credentials. */
export function managedTrace(value: unknown) {
  const trace: { projectId?: string; runId?: string; attempt?: number; batch?: number } = {};

  if (!value || typeof value !== 'object') {
    return trace;
  }

  const data = value as Record<string, unknown>;

  for (const key of ['projectId', 'runId'] as const) {
    if (typeof data[key] === 'string' && uuid.test(data[key])) {
      trace[key] = data[key];
    }
  }

  if (Number.isInteger(data.attempt) && Number(data.attempt) >= 0 && Number(data.attempt) <= 2) {
    trace.attempt = Number(data.attempt);
  }

  if (Number.isInteger(data.batch) && Number(data.batch) >= 1 && Number(data.batch) <= 32) {
    trace.batch = Number(data.batch);
  }

  return trace;
}
