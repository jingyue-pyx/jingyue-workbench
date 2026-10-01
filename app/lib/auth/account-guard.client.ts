import { currentAccount } from './account-context';

/*
 * A tab keeps the account it booted with. Never silently re-scope a live
 * editor when another tab changes the HttpOnly session cookie.
 */
export function installAccountGuard(navigate = (url: string) => window.location.replace(url)) {
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

      /*
       * Leave account-scoped drafts intact, but never keep editing a stale
       * account. Replace history so Back does not reopen this locked page.
       */
      navigate('/login');
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
