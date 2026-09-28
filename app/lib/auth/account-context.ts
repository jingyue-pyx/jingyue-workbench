export interface AccountUser {
  id: string;
  username: string;
  displayName: string;
  legacyOwner: boolean;
}

/*
 * Rendered by the server before any modules execute. This is only browser
 * namespacing metadata; the gateway independently authenticates every request.
 */
export function readAccountContext(): AccountUser | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const value = document.querySelector('meta[name="jingyue-account"]')?.getAttribute('content');

  if (!value) {
    return null;
  }

  try {
    const user = JSON.parse(value);

    if (
      /^[a-f0-9-]{36}$/.test(user.id) &&
      typeof user.username === 'string' &&
      typeof user.displayName === 'string' &&
      typeof user.legacyOwner === 'boolean'
    ) {
      return user;
    }
  } catch {
    // Malformed bootstrap data must not be used as an account namespace.
  }
  throw new Error('账号信息无效，请重新登录。');
}

export const currentAccount = readAccountContext();
export function scopedDatabaseName(name: string, account = currentAccount): string {
  // Existing personal projects remain accessible only to the proved old owner.
  return account && !account.legacyOwner ? `${name}:user:${account.id}` : name;
}

export function createAccountStorage(storage: Storage, account: AccountUser | null): Storage {
  const prefix = account && !account.legacyOwner ? `jingyue:user:${account.id}:` : '';
  const keys = () =>
    Object.keys(storage)
      .filter((key) => (prefix ? key.startsWith(prefix) : !key.startsWith('jingyue:user:')))
      .map((key) => key.slice(prefix.length));
  const methods = {
    getItem: (key: string) => storage.getItem(prefix + key),
    setItem: (key: string, value: string) => storage.setItem(prefix + key, value),
    removeItem: (key: string) => storage.removeItem(prefix + key),
    clear: () => keys().forEach((key) => storage.removeItem(prefix + key)),
    key: (index: number) => keys()[index] ?? null,
  };

  return new Proxy({} as Storage, {
    get: (_target, key) =>
      key === 'length'
        ? keys().length
        : typeof key === 'string' && key in methods
          ? methods[key as keyof typeof methods]
          : typeof key === 'string'
            ? methods.getItem(key)
            : undefined,
    ownKeys: keys,
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    set: (_target, key, value) => {
      if (typeof key !== 'string') {
        return false;
      }

      methods.setItem(key, String(value));

      return true;
    },
  });
}

let storage: Storage | undefined;
const storageOverrides = new Map<PropertyKey, unknown>();
export const accountStorage = new Proxy({} as Storage, {
  get: (_target, key) => {
    if (storageOverrides.has(key)) {
      return storageOverrides.get(key);
    }

    if (typeof window === 'undefined') {
      return key === 'getItem' ? () => null : undefined;
    }

    storage ??= createAccountStorage(window.localStorage, currentAccount);

    return Reflect.get(storage, key);
  },
  set: (_target, key, value) => {
    /*
     * The upstream preview store wraps setItem to publish storage changes.
     * Keep that wrapper separate from user data and configurable across mounts.
     */
    storageOverrides.set(key, value);
    return true;
  },
  ownKeys: () => {
    if (typeof window === 'undefined') {
      return [];
    }

    storage ??= createAccountStorage(window.localStorage, currentAccount);

    return Reflect.ownKeys(storage);
  },
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});
