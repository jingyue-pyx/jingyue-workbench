import { useEffect, useState } from 'react';
import { netlifyAuthorizationURL, publishRequest, type PublishingStatus } from '~/lib/publishing/client';

const button =
  'px-3 py-2 rounded-lg border border-bolt-elements-borderColor text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bolt-elements-item-backgroundActive focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

interface Props {
  status?: PublishingStatus;
  busy: boolean;
  run: (operation: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  onMessage: (message: string) => void;
}

/** The settings and publishing surfaces share the same server-owned OAuth flow. */
export function NetlifyAuthorization({ status, busy, run, refresh, onMessage }: Props) {
  const [attempt, setAttempt] = useState<{ attemptId: string; authorizeUrl: string }>();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    if (!status?.enabled || status.connected) {
      setAttempt(undefined);
    }

    setConfirmDisconnect(false);
  }, [status?.enabled, status?.connected]);

  const connect = () =>
    void run(async () => {
      const next = await publishRequest<{ attemptId: string; authorizeUrl: string }>({ action: 'connect' });
      const authorizeUrl = netlifyAuthorizationURL(next.authorizeUrl);

      if (!authorizeUrl || !next.attemptId) {
        throw new Error('授权地址无效，未打开页面，请重新检查连接。');
      }

      setAttempt({ attemptId: next.attemptId, authorizeUrl });
      onMessage('');
    });

  if (!status) {
    return <p role="status">正在检查 Netlify 连接…</p>;
  }

  if (!status.enabled) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium" role="status">
          平台暂未启用 Netlify 连接
        </p>
        <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
          需要鲸月管理员先完成平台 OAuth 应用配置。你无需创建 OAuth 应用，也无需填写 Client Secret 或个人令牌。
        </p>
        {status.message && <p className="text-sm text-bolt-elements-textSecondary">{status.message}</p>}
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled>
            连接 Netlify 账号
          </button>
          <button className={button} disabled={busy} onClick={() => void run(refresh)}>
            重新检查连接
          </button>
        </div>
      </div>
    );
  }

  if (status.connected) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span role="status">已连接 · {status.displayName || 'Netlify 账号'}</span>
          <button className={button} disabled={busy} onClick={() => setConfirmDisconnect(true)}>
            断开连接
          </button>
        </div>
        <p className="text-sm text-bolt-elements-textSecondary">
          连接属于你当前的鲸月账号。打开已保存的项目，点击“发布网站”后选择团队并确认发布；连接本身不会创建网站。
        </p>
        {confirmDisconnect && (
          <div className="rounded-lg border border-bolt-elements-borderColor p-3 space-y-3">
            <p className="text-sm leading-relaxed">
              断开只会删除鲸月保存的授权，不会删除已发布的网站。完整撤销还需到 Netlify 的应用设置操作。
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await publishRequest<{ message: string }>({ action: 'disconnect' });
                    setAttempt(undefined);
                    setConfirmDisconnect(false);
                    await refresh();
                    onMessage(result.message);
                  })
                }
              >
                确认断开
              </button>
              <button className={button} disabled={busy} onClick={() => setConfirmDisconnect(false)}>
                保留连接
              </button>
            </div>
          </div>
        )}
        <button className={button} disabled={busy} onClick={() => void run(refresh)}>
          重新检查连接
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium" role="status">
        尚未连接你的 Netlify 账号
      </p>
      <p className="text-sm text-bolt-elements-textSecondary leading-relaxed">
        Netlify 的授权允许鲸月创建和管理你团队中的项目，并非仅限当前站点。 凭据只由鲸月服务端加密保存；你可以随时在
        Netlify 撤销授权。这里只连接账号，不会发布或购买套餐。
      </p>
      <button className={button} disabled={busy} onClick={connect}>
        {attempt ? '重新发起授权' : '连接 Netlify 账号'}
      </button>
      {attempt && (
        <div className="rounded-lg border border-bolt-elements-borderColor p-3 space-y-3 text-sm">
          <a
            href={attempt.authorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-bolt-elements-item-contentAccent underline underline-offset-4"
          >
            打开 Netlify 官方授权页 ↗
          </a>
          <p className="text-bolt-elements-textSecondary">
            在官方页面登录并确认授权，再返回这里检查。授权请求 10 分钟内有效；未授权不会连接。
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await publishRequest<{ pending: boolean }>({
                  action: 'authorize',
                  attemptId: attempt.attemptId,
                });

                if (result.pending) {
                  onMessage('尚未收到授权，请先在 Netlify 完成确认。');
                } else {
                  setAttempt(undefined);
                  await refresh();
                  onMessage('账号已连接。');
                }
              })
            }
          >
            我已授权，检查连接
          </button>
        </div>
      )}
      <p className="text-xs text-bolt-elements-textSecondary">不需要把 Netlify 密码或访问令牌填入鲸月。</p>
    </div>
  );
}
