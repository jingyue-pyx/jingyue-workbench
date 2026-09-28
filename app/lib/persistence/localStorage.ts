import { accountStorage } from '~/lib/auth/account-context';
// Client-side storage utilities
const isClient = typeof window !== 'undefined' && typeof accountStorage !== 'undefined';

export function getLocalStorage(key: string): any | null {
  if (!isClient) {
    return null;
  }

  try {
    const item = accountStorage.getItem(key);
    return item ? JSON.parse(item) : null;
  } catch (error) {
    console.error(`Error reading from localStorage key "${key}":`, error);
    return null;
  }
}

export function setLocalStorage(key: string, value: any): void {
  if (!isClient) {
    return;
  }

  try {
    accountStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Error writing to localStorage key "${key}":`, error);
  }
}
