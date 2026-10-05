const messages: Record<string, string> = {
  APP_AUTH_INVALID: '账号须为 3–32 位字母、数字或下划线，以字母开头；密码至少 10 个字符、最多 72 字节。',
  APP_AUTH_CREDENTIALS: '账号或密码不正确。',
  APP_AUTH_EXISTS: '账号已注册，请切换到登录。',
  APP_AUTH_RATE_LIMIT: '认证操作频繁，请稍后重试。',
  APP_AUTH_CAPACITY: '已达到演示账号数量上限。',
  ACCOUNT_CHANGED: '鲸月账号已切换，请重新打开项目。',
  SESSION_EXPIRED: '请先重新登录鲸月工作台。',
  PROJECT_NOT_FOUND: '项目不存在或无权访问。',
  APP_AUTH_UNAVAILABLE: '应用认证暂不可用；若刚提交注册，请稍后尝试登录。',
};

export function attachAppAuthBridge(options: {
  target: Window;
  iframe: () => HTMLIFrameElement | null;
  origin: string;
  projectId: string;
  accountId: string;
  fetcher?: typeof fetch;
}) {
  let disposed = false;
  let busy = false;
  let controller: AbortController | undefined;
  const receive = async (event: MessageEvent) => {
    const child = options.iframe()?.contentWindow;
    const input = event.data;

    if (
      disposed ||
      !child ||
      event.source !== child ||
      event.origin !== options.origin ||
      !/^jingyue:auth-(connect|request)$/.test(input?.type || '') ||
      !/^[a-z0-9-]{16,64}$/i.test(input?.id || '')
    ) {
      return;
    }

    if (input.type === 'jingyue:auth-connect') {
      if (Object.keys(input).every((key) => ['type', 'id'].includes(key))) {
        child.postMessage({ type: 'jingyue:auth-connected', id: input.id }, options.origin);
      }

      return;
    }

    const respond = (body: object) => {
      if (!disposed && child === options.iframe()?.contentWindow) {
        child.postMessage({ type: 'jingyue:auth-response', id: input.id, ...body }, options.origin);
      }
    };
    const error = (code: string) => respond({ error: { code, message: messages[code] } });
    const body = input.body;
    const fields = (
      {
        session: [],
        logout: [],
        register: ['username', 'password', 'displayName'],
        login: ['username', 'password'],
      } as Record<string, string[]>
    )[body?.action];

    if (
      !Array.isArray(fields) ||
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      fields.some((key) => body[key] !== undefined && typeof body[key] !== 'string') ||
      Object.keys(body).some((key) => key !== 'action' && !fields.includes(key)) ||
      JSON.stringify(body).length > 2048
    ) {
      error('APP_AUTH_INVALID');
      return;
    }

    if (busy) {
      error('APP_AUTH_RATE_LIMIT');
      return;
    }

    busy = true;
    controller = new AbortController();

    const timer = setTimeout(() => controller?.abort(), 40000);

    try {
      const response = await (options.fetcher || fetch)(`/api/app-auth/${options.projectId}`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Jingyue-User': options.accountId },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as any;

      if (!response.ok) {
        error(Object.hasOwn(messages, result?.error?.code) ? result.error.code : 'APP_AUTH_UNAVAILABLE');
        return;
      }

      if (
        result.user !== null &&
        (typeof result.user?.id !== 'string' ||
          typeof result.user?.username !== 'string' ||
          typeof result.user?.displayName !== 'string')
      ) {
        throw new Error('Invalid profile');
      }

      // Explicit output allowlist: never forward a future token/secret field.
      respond({
        result: {
          user: result.user
            ? { id: result.user.id, username: result.user.username, displayName: result.user.displayName }
            : null,
        },
      });
    } catch {
      error('APP_AUTH_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  };
  options.target.addEventListener('message', receive);

  return () => {
    disposed = true;
    controller?.abort();
    options.target.removeEventListener('message', receive);
  };
}

export async function previewAppAuthEnabled(project: string, account: string) {
  try {
    const response = await fetch(`/api/app-auth/${project}`, {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', 'X-Jingyue-User': account },
      body: JSON.stringify({ action: 'status' }),
    });
    const result = (await response.json()) as any;

    return (
      response.ok &&
      result.enabled === true &&
      result.provider === 'supabase-auth' &&
      result.scope === 'workbench-preview'
    );
  } catch {
    return false;
  }
}
