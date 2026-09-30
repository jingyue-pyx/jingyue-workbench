import Cookies from 'js-cookie';
import { accountStorage, currentAccount } from './account-context';

const prefix = currentAccount && !currentAccount.legacyOwner ? `jy_${currentAccount.id}_` : '';

/*
 * These are client-only data, not authentication cookies. Sending logs,
 * settings and prompt drafts on every HTTP request can exceed the FC 8 KiB cap.
 */
const localOnly = new Set(['eventLogs', 'providers', 'tabConfiguration', 'cachedPrompt']);
const memory = new Map<string, string>();
const storageKey = (name: string) => `browser-preference:${name}`;

function readPreference(name: string): string | undefined {
  let stored: string | null = null;

  try {
    stored = accountStorage.getItem(storageKey(name));
  } catch {
    // Blocked/full browser storage must not prevent the workbench from opening.
  }

  if (stored !== null) {
    try {
      const entry = JSON.parse(stored);

      if (typeof entry.value === 'string' && (entry.expiresAt === null || entry.expiresAt > Date.now())) {
        return entry.value;
      }

      removePreference(name);

      return undefined;
    } catch {
      removePreference(name);
      return undefined;
    }
  }

  if (memory.has(name)) {
    return memory.get(name);
  }

  const previous = Cookies.get(prefix + name);

  if (previous !== undefined) {
    writePreference(name, previous);
  }

  return previous;
}

function writePreference(name: string, value: string, options?: Cookies.CookieAttributes) {
  memory.set(name, value);

  try {
    const expiresAt =
      options?.expires instanceof Date
        ? options.expires.getTime()
        : typeof options?.expires === 'number'
          ? Date.now() + options.expires * 86400000
          : null;
    accountStorage.setItem(storageKey(name), JSON.stringify({ value, expiresAt }));

    // Only remove this account's old copy after successful durable migration.
    Cookies.remove(prefix + name, { path: '/' });
  } catch {
    // Retain any old cookie and use memory for this session; never add new bulk cookies.
  }
}

function removePreference(name: string) {
  memory.delete(name);

  try {
    accountStorage.removeItem(storageKey(name));
  } catch {
    // Keep UI usable if browser storage is unavailable.
  }
  Cookies.remove(prefix + name, { path: '/' });
}

function get(name: string): string | undefined;
function get(): Record<string, string>;
function get(name?: string) {
  if (name !== undefined) {
    return localOnly.has(name) ? readPreference(name) : Cookies.get(prefix + name);
  }

  const values = Object.fromEntries(
    Object.entries(Cookies.get())
      .filter(([key]) => (prefix ? key.startsWith(prefix) : !key.startsWith('jy_')))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );

  for (const key of localOnly) {
    const value = readPreference(key);

    if (value !== undefined) {
      values[key] = value;
    } else {
      delete values[key];
    }
  }

  return values;
}

const accountCookies = {
  get,
  set: (name: string, value: string, options?: Cookies.CookieAttributes) =>
    localOnly.has(name) ? writePreference(name, value, options) : Cookies.set(prefix + name, value, options),
  remove: (name: string, options?: Cookies.CookieAttributes) =>
    localOnly.has(name) ? removePreference(name) : Cookies.remove(prefix + name, options),
};
export default accountCookies;
