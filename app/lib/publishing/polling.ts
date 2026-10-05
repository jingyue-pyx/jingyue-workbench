/** Only waits; never creates or retries a provider mutation. */
export function publishingDelay(ms: number, signal: AbortSignal): Promise<void> {
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

/** Bound a shared startup promise without cancelling the shared sandbox itself. */
export async function publishingReady<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => {};

  try {
    const result = await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(new Error('浏览器沙箱未就绪，请先恢复预览。')), 30000);
      }),
    ]);
    signal.throwIfAborted();

    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
