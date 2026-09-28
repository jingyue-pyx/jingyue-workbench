import { currentAccount } from './account-context';

/*
 * A tab keeps the account it booted with. Never silently re-scope a live
 * editor when another tab changes the HttpOnly session cookie.
 */
export function installAccountGuard() {
  if (typeof window !== 'undefined' && currentAccount) {
    const account = currentAccount;
    const originalFetch = window.fetch.bind(window);
    let blocked = false;
    const block = () => {
      if (blocked) {
        return;
      }

      blocked = true;

      const root = document.getElementById('root');

      if (root) {
        root.inert = true;
        root.style.visibility = 'hidden';
      }

      const panel = document.createElement('div');
      panel.setAttribute('role', 'alert');
      Object.assign(panel.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        display: 'grid',
        placeContent: 'center',
        gap: '18px',
        padding: '30px',
        background: '#f8f8f3',
        color: '#244f3c',
        fontFamily: 'sans-serif',
      });

      const heading = document.createElement('h2');
      heading.textContent = '登录已过期或账号已切换';

      const text = document.createElement('p');
      text.textContent = '当前页面已锁定。本机草稿未删除，请使用原账号重新登录后继续。';

      const link = document.createElement('a');
      link.href = '/login';
      link.textContent = '重新打开工作台 →';
      panel.appendChild(heading);
      panel.appendChild(text);
      panel.appendChild(link);
      document.body.appendChild(panel);
    };

    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);

      if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
        return originalFetch(input, init);
      }

      if (blocked) {
        throw new Error('账号已切换，本机草稿保留，请重新登录。');
      }

      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('X-Jingyue-User', account.id);

      const response = await originalFetch(input, { ...init, headers });

      if (response.status === 401 || response.status === 409) {
        const result = (await response
          .clone()
          .json()
          .catch(() => ({}))) as { error?: { code?: string } };

        if (['SESSION_EXPIRED', 'ACCOUNT_CHANGED'].includes(result.error?.code || '')) {
          block();
        }
      }

      return response;
    };

    const check = async () => {
      if (blocked) {
        return;
      }

      try {
        const response = await originalFetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });

        if (!response.ok) {
          return;
        } // A network/DB outage is not evidence of logout.

        const data = (await response.json()) as { user?: { id: string } };

        if (data.user?.id !== account.id) {
          block();
        }
      } catch {
        /* Offline drafts remain usable by the same tab. */
      }
    };
    window.addEventListener('focus', () => void check());
    window.addEventListener('pageshow', () => void check());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void check();
      }
    });

    try {
      const channel = new BroadcastChannel('jingyue-account-change');
      channel.onmessage = () => void check();
    } catch {
      /* Visibility checking and server guards still apply. */
    }
    void check();
  }
}
