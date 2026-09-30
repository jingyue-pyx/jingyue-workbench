/** Runs only while this page is mounted and visible. No worker, keepalive or infinite retry. */
export function visibleProjectRetry(
  retry: () => Promise<boolean>,
  visibility: { isVisible(): boolean; subscribe(listener: () => void): () => void },
) {
  const delays = [5000, 10000, 20000, 30000, 30000];
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const schedule = () => {
    if (stopped || running || timer || attempt >= delays.length || !visibility.isVisible()) {
      return;
    }

    timer = setTimeout(async () => {
      timer = undefined;

      if (stopped || !visibility.isVisible()) {
        return;
      }

      running = true;
      attempt++;

      try {
        if (!(await retry())) {
          stopped = true;
        }
      } catch {
        stopped = true;
      }
      running = false;
      schedule();
    }, delays[attempt]);
  };
  const unsubscribe = visibility.subscribe(() => {
    if (!visibility.isVisible() && timer) {
      clearTimeout(timer);
      timer = undefined;
    }

    schedule();
  });
  schedule();

  return () => {
    stopped = true;

    if (timer) {
      clearTimeout(timer);
    }

    unsubscribe();
  };
}
