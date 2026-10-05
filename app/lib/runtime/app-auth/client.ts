// Copied unchanged into generated projects. No password/token is persisted here.
import { useSyncExternalStore } from 'react';

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
}
export interface AppAuthResult {
  user: AppUser | null;
}
export async function appAuthRequest(body: object): Promise<AppAuthResult> {
  return new Promise((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error('此应用认证仅在已登录的鲸月工作台预览中可用。'));
      return;
    }

    const id = crypto.randomUUID();
    let origin = '';
    const timer = setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(new Error('认证连接超时。若注册已提交，请先尝试登录，不要反复注册。'));
    }, 45000);

    function receive(event: MessageEvent) {
      if (event.source !== window.parent || event.data?.id !== id) {
        return;
      }

      if (!origin && event.data.type === 'jingyue:auth-connected' && /^https?:\/\//.test(event.origin)) {
        origin = event.origin;
        window.parent.postMessage({ type: 'jingyue:auth-request', id, body }, origin);

        return;
      }

      if (!origin || event.origin !== origin || event.data.type !== 'jingyue:auth-response') {
        return;
      }

      clearTimeout(timer);
      window.removeEventListener('message', receive);

      if (event.data.error) {
        reject(new Error(event.data.error.message));
      } else {
        resolve(event.data.result);
      }
    }
    window.addEventListener('message', receive);

    // Only a nonce is broadcast. Credentials wait for the bound parent origin.
    window.parent.postMessage({ type: 'jingyue:auth-connect', id }, '*');
  });
}

/*
 * One in-memory store per generated document, not per component. Nested forms
 * and route guards share the SAME login/logout transition without localStorage.
 */
export function createAppAuthState(request = appAuthRequest) {
  let state: { user: AppUser | null; loading: boolean; error: string } = { user: null, loading: true, error: '' };
  const listeners = new Set<() => void>();
  let pending: Promise<boolean> | undefined;
  let pendingAction = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  const publish = (next: typeof state) => {
    state = next;
    listeners.forEach((notify) => notify());
  };
  const run = async (body: { action: string; [key: string]: unknown }): Promise<boolean> => {
    if (pending) {
      if (body.action === 'session') {
        return pending;
      }

      if (pendingAction !== 'session') {
        return false;
      }

      // A background session read must not silently swallow a user's logout.
      await pending;

      if (pending !== undefined) {
        return false;
      }
    }

    pendingAction = body.action;

    const operation = Promise.resolve().then(async () => {
      /*
       * Background focus/timer checks must not unmount a route guard or form
       * between pointer-down and click. Initial loading and mutations still block.
       */
      publish({ ...state, loading: body.action === 'session' ? state.loading : true, error: '' });

      try {
        const result = await request(body);
        publish({ user: result.user, loading: false, error: '' });

        return true;
      } catch (cause) {
        publish({ user: null, loading: false, error: cause instanceof Error ? cause.message : '认证失败，请重试。' });
        return false;
      }
    });
    pending = operation;

    try {
      return await operation;
    } finally {
      if (pending === operation) {
        pending = undefined;
      }
    }
  };
  const refresh = () => {
    if (document.visibilityState === 'visible') {
      void run({ action: 'session' });
    }
  };

  return {
    snapshot: () => state,
    subscribe: (notify: () => void) => {
      listeners.add(notify);

      if (listeners.size === 1) {
        window.addEventListener('focus', refresh);
        timer = setInterval(refresh, 60000);
        void run({ action: 'session' });
      }

      return () => {
        listeners.delete(notify);

        if (!listeners.size) {
          window.removeEventListener('focus', refresh);
          clearInterval(timer);
        }
      };
    },
    run,
  };
}

const sharedAuth = createAppAuthState();

export function useAppAuth() {
  const state = useSyncExternalStore(sharedAuth.subscribe, sharedAuth.snapshot, sharedAuth.snapshot);
  const run = sharedAuth.run;

  return {
    ...state,
    login: (username: string, password: string) => run({ action: 'login', username, password }),
    register: (username: string, password: string, displayName?: string) =>
      run({ action: 'register', username, password, ...(displayName ? { displayName } : {}) }),
    logout: () => run({ action: 'logout' }),
    refresh: () => run({ action: 'session' }),
  };
}
