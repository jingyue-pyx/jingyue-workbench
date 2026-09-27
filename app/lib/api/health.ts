/** Measure the deployed health endpoint; never substitute a page or fake RTT. */
export async function measureHealthLatency(): Promise<number> {
  const start = performance.now();
  const response = await fetch('/healthz', {
    method: 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Health check failed (HTTP ${response.status})`);
  }

  const body: unknown = await response.json();

  if (!body || typeof body !== 'object' || Array.isArray(body) || !('status' in body) || body.status !== 'ok') {
    throw new Error('Health check returned an invalid response');
  }

  return Math.round(performance.now() - start);
}
