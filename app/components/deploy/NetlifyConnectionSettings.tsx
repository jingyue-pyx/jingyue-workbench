import { useEffect, useRef, useState } from 'react';
import { publishRequest, type PublishingStatus } from '~/lib/publishing/client';
import { NetlifyAuthorization } from './NetlifyAuthorization';

/** Account connection is independent of project selection and browser-sandbox startup. */
export function NetlifyConnectionSettings() {
  const [status, setStatus] = useState<PublishingStatus>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const generation = useRef(0);

  const refresh = async () => {
    const started = generation.current;
    const next = await publishRequest<PublishingStatus>();

    if (started === generation.current) {
      setStatus(next);
    }
  };
  const run = async (operation: () => Promise<void>) => {
    if (pending.current) {
      return;
    }

    pending.current = true;

    const started = generation.current;
    setBusy(true);
    setError('');
    setMessage('');

    try {
      await operation();
    } catch (cause) {
      if (started === generation.current) {
        setError(cause instanceof Error ? cause.message : '连接失败，请重试。');
      }
    } finally {
      if (started === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    pending.current = false;
    void run(refresh);

    return () => {
      generation.current++;
    };
  }, []);

  return (
    <section
      aria-label="Netlify 连接"
      className="rounded-xl border border-bolt-elements-borderColor p-5 space-y-4 text-bolt-elements-textPrimary"
    >
      <div>
        <h3 className="font-medium">Netlify 连接</h3>
        <p className="mt-1 text-sm text-bolt-elements-textSecondary">
          通过官方授权连接自己的账号，再把静态网页发布到自己的团队。
        </p>
      </div>
      {(status || busy || !error) && (
        <NetlifyAuthorization status={status} busy={busy} run={run} refresh={refresh} onMessage={setMessage} />
      )}
      {message && (
        <p className="text-sm text-bolt-elements-textSecondary" role="status">
          {message}
        </p>
      )}
      {error && (
        <div className="space-y-2">
          <p className="text-sm text-red-500" role="alert">
            {error}
          </p>
          <button className="text-sm underline underline-offset-4" disabled={busy} onClick={() => void run(refresh)}>
            重试连接检查
          </button>
        </div>
      )}
    </section>
  );
}
