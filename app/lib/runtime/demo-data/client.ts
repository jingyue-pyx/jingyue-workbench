// This file is copied into generated React projects. It contains NO credentials.
import { useEffect, useRef, useState } from 'react';

type Status = 'loading' | 'ready' | 'saving' | 'saved' | 'error' | 'conflict';
type Write<T> = { action: 'write'; key: string; value: T; baseRevision: number; requestId: string };
type Result<T> = {
  revision: number;
  value: T | null;
  updatedAt: string | null;
  draft?: Write<T>;
  latestValue?: T;
  conflict?: boolean;
};
type State<T> = { data: T; status: Status; error: string; ready: boolean };
export class DataError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function previewDataRequest<T>(body: object): Promise<Result<T>> {
  return new Promise((resolve, reject) => {
    let origin: string | undefined;

    if (window.parent === window) {
      reject(new DataError('NO_WORKBENCH', '请在已登录的工作台预览内使用云存储。'));
      return;
    }

    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      window.removeEventListener('message', receive);
      reject(new DataError('DATA_UNAVAILABLE', '保存连接超时，当前草稿保留，请稍后重试。'));
    }, 20000);

    function receive(event: MessageEvent) {
      if (event.source !== window.parent || event.data?.id !== id) {
        return;
      }

      if (!origin && event.data?.type === 'jingyue:data-connected') {
        /*
         * Only a parent handshake is broadcast, never business data. The host
         * validates this iframe's origin and window before acknowledging it.
         */
        if (!/^https?:\/\//.test(event.origin)) {
          return;
        }

        origin = event.origin;
        window.parent.postMessage({ type: 'jingyue:data-request', id, body }, origin);

        return;
      }

      if (!origin || event.origin !== origin || event.data?.type !== 'jingyue:data-response' || event.data.id !== id) {
        return;
      }

      clearTimeout(timer);
      window.removeEventListener('message', receive);

      if (event.data.error) {
        reject(new DataError(event.data.error.code, event.data.error.message));
      } else {
        resolve(event.data.result);
      }
    }
    window.addEventListener('message', receive);

    // The nonce-only hello works even when the sandbox has rewritten referrer.
    window.parent.postMessage({ type: 'jingyue:data-connect', id }, '*');
  });
}

/*
 * Serialize writes and retain one stable mutation ID across network retries.
 * Revision conflicts NEVER silently reload and overwrite another page's edits.
 */
export class DemoDocument<T extends object> {
  state: State<T>;
  private _revision = 0;
  private _version = 0;
  private _pending?: { body: Write<T>; version: number };
  private _timer?: ReturnType<typeof setTimeout>;
  private _disposed = false;
  private _busy = false;
  private _staged: Promise<unknown> = Promise.resolve();
  constructor(
    private _key: string,
    initial: T,
    private _publish: (state: State<T>) => void,
    private _request: <V>(body: object) => Promise<Result<V>> = previewDataRequest,
  ) {
    this.state = { data: initial, status: 'loading', error: '', ready: false };
  }
  private _set(part: Partial<State<T>>) {
    this.state = { ...this.state, ...part };

    if (!this._disposed) {
      this._publish(this.state);
    }
  }
  async load() {
    if (this._busy || this._disposed || this.state.ready) {
      return;
    }

    this._busy = true;

    try {
      const result = await this._request<T>({ action: 'read', key: this._key });

      if (this._disposed) {
        return;
      }

      this._revision = result.revision;

      if (result.draft) {
        this._version++;
        this._pending = { body: result.draft, version: this._version };

        if (result.latestValue && JSON.stringify(result.latestValue) !== JSON.stringify(result.draft.value)) {
          this._version++;
        }

        this._set({
          data: result.latestValue ?? result.draft.value,
          ready: true,
          status: result.conflict ? 'conflict' : 'error',
          error: result.conflict
            ? '云端数据已更新，本机草稿保留，请先核对，勿直接覆盖。'
            : '已恢复未确认保存的草稿，请点重试保存。',
        });
      } else {
        this._set({
          data: result.value ?? this.state.data,
          ready: true,
          status: result.revision ? 'saved' : 'ready',
          error: '',
        });
      }
    } catch (error) {
      this._set({ status: 'error', error: error instanceof Error ? error.message : '读取失败，请重试。' });
    } finally {
      this._busy = false;
    }
  }
  update(value: T | ((previous: T) => T)) {
    if (!this.state.ready || this._disposed || this.state.status === 'conflict') {
      return;
    }

    const next = typeof value === 'function' ? (value as (previous: T) => T)(this.state.data) : value;

    // Store immutable JSON so in-place caller mutations cannot alter in-flight writes.
    let snapshot: T;

    try {
      snapshot = JSON.parse(JSON.stringify(next));
    } catch {
      this._set({ status: 'error', error: '数据不是可保存的 JSON。' });
      return;
    }
    this._version++;
    this._set({ data: snapshot, status: 'saving', error: '' });
    this._staged = this._request<T>({ action: 'draft', key: this._key, value: snapshot, baseRevision: this._revision });

    // Keep the rejection available to flush without an unhandled rejection.
    void this._staged.catch(() => {});
    clearTimeout(this._timer);
    this._timer = setTimeout(() => void this.flush(), 600);
  }
  async flush() {
    clearTimeout(this._timer);

    if (
      this._busy ||
      this._disposed ||
      !this.state.ready ||
      ['conflict', 'saved', 'ready'].includes(this.state.status)
    ) {
      return;
    }

    this._busy = true;

    try {
      do {
        await this._staged;

        if (this._disposed) {
          return;
        }

        this._pending ??= {
          body: {
            action: 'write',
            key: this._key,
            value: this.state.data,
            baseRevision: this._revision,
            requestId: crypto.randomUUID(),
          },
          version: this._version,
        };

        const pending = this._pending;
        this._set({ status: 'saving', error: '' });

        let result: Result<T> | undefined;

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            result = await this._request<T>(pending.body);
            break;
          } catch (error) {
            if (this._disposed) {
              return;
            }

            if (
              !(error instanceof DataError) ||
              !['DATA_UNAVAILABLE', 'DATA_RATE_LIMIT'].includes(error.code) ||
              attempt === 2
            ) {
              throw error;
            }

            await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
          }
        }

        if (this._disposed) {
          return;
        }

        if (!result || result.revision !== pending.body.baseRevision + 1) {
          throw new DataError('DATA_UNAVAILABLE', '服务器尚未确认保存，请重试。');
        }

        this._revision = result.revision;
        this._pending = undefined;

        if (pending.version === this._version) {
          this._set({ status: 'saved', error: '' });
          break;
        }
      } while (!this._disposed);
    } catch (error) {
      this._set({
        status: error instanceof DataError && error.code === 'DATA_CONFLICT' ? 'conflict' : 'error',
        error: error instanceof Error ? error.message : '保存失败，草稿保留。',
      });
    } finally {
      this._busy = false;
    }
  }
  retry() {
    if (!this.state.ready) {
      return this.load();
    }

    if (this.state.status === 'conflict' || this._busy || this._disposed) {
      return undefined;
    }

    this._staged = this._request<T>({
      action: 'draft',
      key: this._key,
      value: this.state.data,
      baseRevision: this._revision,
    });
    void this._staged.catch(() => {});

    return this.flush();
  }
  dispose() {
    this._disposed = true;
    clearTimeout(this._timer);
  }
}

export function useDemoData<T extends object>(key: string, initial: T) {
  const initialRef = useRef(initial);
  const store = useRef<DemoDocument<T>>();
  const [state, setState] = useState<State<T>>({ data: initial, status: 'loading', ready: false, error: '' });
  useEffect(() => {
    const document = new DemoDocument(key, initialRef.current, setState);
    store.current = document;
    setState(document.state);
    void document.load();

    const warn = (event: BeforeUnloadEvent) => {
      if (['saving', 'error', 'conflict'].includes(document.state.status) && document.state.ready) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);

    return () => {
      document.dispose();
      window.removeEventListener('beforeunload', warn);
    };
  }, [key]);

  return {
    ...state,
    setData: (value: T | ((previous: T) => T)) => store.current?.update(value),
    retry: () => store.current?.retry(),
  };
}
