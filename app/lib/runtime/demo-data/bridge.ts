export interface DemoDraft {
  action: 'write';
  key: string;
  value: object;
  baseRevision: number;
  requestId: string;
}

// PostgreSQL JSONB may reorder object keys. Compare JSON content, not its wire order.
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  }

  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;

  return (
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
  );
}

/*
 * The generated iframe never receives a cookie, user ID, Supabase key or an
 * arbitrary URL. Its only capability is a bounded JSON document in this project.
 */
export function attachDemoDataBridge(options: {
  target: Window;
  iframe: () => HTMLIFrameElement | null;
  origin: string;
  projectId: string;
  accountId: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  fetcher?: typeof fetch;
}) {
  const { target, iframe, origin, projectId, accountId, storage } = options;
  const fetcher = options.fetcher || fetch;
  const controllers = new Set<AbortController>();
  let disposed = false;
  const prefix = `jingyue:demo-data:${accountId}:${projectId}:`;
  const messages: Record<string, string> = {
    DATA_CONFLICT: '另一页面已更新数据，当前草稿保留；请核对后再重新载入。',
    DATA_NOT_ENABLED: '当前项目尚未接通云存储，请联系工作台配置。',
    DATA_RATE_LIMIT: '保存请求较多，请稍后重试；当前改动仍保留。',
    DATA_TOO_LARGE: '演示数据超过 64KB，请减少数据量。',
    DATA_QUOTA: '已达到演示数据容量限制。',
    ACCOUNT_CHANGED: '账号已切换，请重新打开工作台。',
    SESSION_EXPIRED: '登录已过期，请重新登录。',
    PROJECT_NOT_FOUND: '项目尚未保存到服务端、已删除或无访问权限。',
    DATA_UNAVAILABLE: '云存储暂不可用，当前草稿保留，可稍后重试。',
  };
  const receive = async (event: MessageEvent) => {
    const child = iframe()?.contentWindow;
    const input = event.data;

    if (
      disposed ||
      !child ||
      event.source !== child ||
      event.origin !== origin ||
      !['jingyue:data-request', 'jingyue:data-connect'].includes(input?.type)
    ) {
      return;
    }

    if (typeof input.id !== 'string' || !/^[a-z0-9-]{16,64}$/i.test(input.id)) {
      return;
    }

    /*
     * A WebContainer service-worker bootstrap can replace document.referrer.
     * Reveal only this host's origin to the exact currently mounted iframe.
     */
    if (input.type === 'jingyue:data-connect') {
      if (Object.keys(input).every((key) => ['type', 'id'].includes(key))) {
        child.postMessage({ type: 'jingyue:data-connected', id: input.id }, origin);
      }

      return;
    }

    const respond = (body: object) => {
      if (!disposed && child === iframe()?.contentWindow) {
        child.postMessage({ type: 'jingyue:data-response', id: input.id, ...body }, origin);
      }
    };
    const body = input.body;
    const read = body?.action === 'read';
    const staged = body?.action === 'draft';
    const fields = read
      ? ['action', 'key']
      : staged
        ? ['action', 'key', 'value', 'baseRevision']
        : ['action', 'key', 'value', 'baseRevision', 'requestId'];

    if (
      !body ||
      typeof body !== 'object' ||
      !['read', 'write', 'draft'].includes(body.action) ||
      typeof body.key !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,47}$/.test(body.key) ||
      Object.keys(body).some((key) => !fields.includes(key)) ||
      (!read &&
        (!body.value ||
          typeof body.value !== 'object' ||
          !Number.isSafeInteger(body.baseRevision) ||
          body.baseRevision < 0 ||
          (!staged && !/^[0-9a-f-]{36}$/i.test(body.requestId))))
    ) {
      respond({ error: { code: 'INVALID_DATA', message: '数据请求格式不正确。' } });
      return;
    }

    if (controllers.size >= 3) {
      respond({ error: { code: 'DATA_RATE_LIMIT', message: messages.DATA_RATE_LIMIT } });
      return;
    }

    const controller = new AbortController();
    controllers.add(controller);

    const timer = setTimeout(() => controller.abort(), 18000);

    try {
      const serialized = JSON.stringify(body);

      if (new TextEncoder().encode(serialized).byteLength > 68 * 1024) {
        respond({ error: { code: 'DATA_TOO_LARGE', message: messages.DATA_TOO_LARGE } });
        return;
      }

      const key = prefix + body.key;

      if (staged) {
        storage.setItem(key, serialized);
        respond({ result: { revision: body.baseRevision, value: body.value, updatedAt: null } });

        return; // Local draft acknowledgement is NOT a cloud save acknowledgement.
      }

      if (!read) {
        storage.setItem(key + ':pending', serialized);
      }

      const response = await fetcher(`/api/demo-data/${projectId}`, {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Jingyue-User': accountId },
        body: serialized,
      });
      const result = (await response.json()) as any;

      if (!response.ok) {
        const code = Object.hasOwn(messages, result?.error?.code) ? result.error.code : 'DATA_UNAVAILABLE';
        respond({ error: { code, message: messages[code] } });

        return;
      }

      if (
        !Number.isSafeInteger(result.revision) ||
        result.revision < 0 ||
        !(result.value === null || typeof result.value === 'object')
      ) {
        throw new Error('Invalid response');
      }

      const parse = (item: string) => {
        try {
          return JSON.parse(storage.getItem(item) || 'null');
        } catch {
          return null;
        }
      };
      let draft = parse(key);
      let pending: DemoDraft | null = parse(key + ':pending');

      if (!read) {
        if (pending?.requestId === body.requestId) {
          storage.removeItem(key + ':pending');
        }

        if (draft && sameJson(draft.value, result.value)) {
          storage.removeItem(key);
        } else if (draft?.baseRevision === body.baseRevision) {
          storage.setItem(key, JSON.stringify({ ...draft, baseRevision: result.revision }));
        }

        respond({ result });
      } else {
        if (
          pending?.action === 'write' &&
          pending.key === body.key &&
          result.revision === pending.baseRevision + 1 &&
          sameJson(result.value, pending.value)
        ) {
          if (draft?.baseRevision === pending.baseRevision) {
            draft = { ...draft, baseRevision: result.revision };
            storage.setItem(key, JSON.stringify(draft));
          }

          storage.removeItem(key + ':pending');
          pending = null;
        }

        if (draft && sameJson(draft.value, result.value) && draft.baseRevision === result.revision) {
          storage.removeItem(key);
          draft = null;
        }

        const recover =
          pending ||
          (draft?.action === 'draft' && draft.key === body.key
            ? { ...draft, action: 'write', requestId: crypto.randomUUID() }
            : null);
        respond({
          result: {
            ...result,
            ...(recover
              ? {
                  draft: recover,
                  latestValue: draft?.value ?? recover.value,
                  conflict: recover.baseRevision !== result.revision,
                }
              : {}),
          },
        });
      }
    } catch {
      respond({ error: { code: 'DATA_UNAVAILABLE', message: messages.DATA_UNAVAILABLE } });
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  };
  target.addEventListener('message', receive);

  return () => {
    disposed = true;
    target.removeEventListener('message', receive);
    controllers.forEach((controller) => controller.abort());
  };
}
