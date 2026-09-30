// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Cookies from 'js-cookie';

const state = vi.hoisted(() => ({
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  values: new Map<string, string>(),
  fail: false,
}));
vi.mock('./account-context', () => ({
  currentAccount: { id: state.id, legacyOwner: false },
  accountStorage: {
    getItem: (key: string) => state.values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (state.fail) {
        throw new Error('Storage full');
      }

      state.values.set(key, value);
    },
    removeItem: (key: string) => state.values.delete(key),
  },
}));
beforeEach(() => {
  vi.resetModules();
  state.values.clear();
  state.fail = false;

  for (const name of Object.keys(Cookies.get())) {
    Cookies.remove(name);
  }
});
afterEach(() => vi.restoreAllMocks());

describe('bulky browser preferences stay out of request cookies', () => {
  it('stores large logs/settings/drafts locally without adding request bytes', async () => {
    const { default: preferences } = await import('./account-cookies');

    for (const key of ['eventLogs', 'providers', 'tabConfiguration', 'cachedPrompt']) {
      const value = 'test-data-'.repeat(1000);
      preferences.set(key, value);
      expect(preferences.get(key)).toBe(value);
      expect(preferences.get()[key]).toBe(value);
    }
    expect(document.cookie).toBe('');
  });
  it('migrates only the current account, without touching session or other account cookies', async () => {
    Cookies.set(`jy_${state.id}_eventLogs`, 'old logs');
    Cookies.set('jy_other_eventLogs', 'another account');
    Cookies.set('eventLogs', 'legacy logs');
    Cookies.set('test_session', 'not-a-real-session');

    const { default: preferences } = await import('./account-cookies');
    expect(preferences.get('eventLogs')).toBe('old logs');
    expect(Cookies.get(`jy_${state.id}_eventLogs`)).toBeUndefined();
    expect(Cookies.get('jy_other_eventLogs')).toBe('another account');
    expect(Cookies.get('eventLogs')).toBe('legacy logs');
    expect(Cookies.get('test_session')).toBe('not-a-real-session');
    preferences.remove('eventLogs');
    expect(preferences.get('eventLogs')).toBeUndefined();
  });
  it('preserves the old cookie if local migration cannot be saved and never writes a large new cookie', async () => {
    Cookies.set(`jy_${state.id}_providers`, 'old settings');
    state.fail = true;

    const { default: preferences } = await import('./account-cookies');
    expect(preferences.get('providers')).toBe('old settings');
    expect(Cookies.get(`jy_${state.id}_providers`)).toBe('old settings');
    preferences.set('eventLogs', 'large-log'.repeat(1000));
    expect(Cookies.get(`jy_${state.id}_eventLogs`)).toBeUndefined();
    expect(preferences.get('eventLogs')).toHaveLength(9000);
  });
  it('honors preference expiry and leaves small cookies supported', async () => {
    const { default: preferences } = await import('./account-cookies');
    preferences.set('cachedPrompt', 'old draft', { expires: new Date(0) });
    expect(preferences.get('cachedPrompt')).toBeUndefined();
    preferences.set('selectedModel', 'test-model');
    expect(Cookies.get(`jy_${state.id}_selectedModel`)).toBe('test-model');
  });
});
