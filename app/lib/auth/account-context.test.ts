// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  accountStorage,
  createAccountStorage,
  readAccountContext,
  scopedDatabaseName,
  type AccountUser,
} from './account-context';

const alice: AccountUser = {
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  username: 'alice',
  displayName: '小月',
  legacyOwner: false,
};
const bob: AccountUser = { ...alice, id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb', username: 'bob' };
const { JSDOM } = createRequire(import.meta.url)('jsdom');
const localStorage: Storage = new JSDOM('', { url: 'https://example.test' }).window.localStorage;
afterEach(() => {
  localStorage.clear();
  document.head.innerHTML = '';
});
describe('account-scoped browser data', () => {
  it('allows the existing preview store to wrap setItem across repeated mounts without redefining properties', () => {
    const original = accountStorage.setItem;
    const first = () => {};
    const second = () => {};
    accountStorage.setItem = first;
    expect(accountStorage.setItem).toBe(first);
    accountStorage.setItem = second;
    expect(accountStorage.setItem).toBe(second);
    accountStorage.setItem = original;
  });
  it('isolates drafts, tokens, enumeration and clear operations without deleting old data', () => {
    localStorage.setItem('draft', 'legacy draft');

    const a = createAccountStorage(localStorage, alice);
    const b = createAccountStorage(localStorage, bob);
    a.setItem('draft', 'Alice draft');
    a.setItem('token', 'fake-a-token');
    b.setItem('draft', 'Bob draft');
    expect(a.getItem('draft')).toBe('Alice draft');
    expect(b.getItem('draft')).toBe('Bob draft');
    expect(b.getItem('token')).toBeNull();
    expect(Object.keys(b)).toEqual(['draft']);
    expect(a.length).toBe(2);
    expect(a.key(0)).toBe('draft');
    b.clear();
    expect(a.getItem('draft')).toBe('Alice draft');
    expect(localStorage.getItem('draft')).toBe('legacy draft');

    const legacy = createAccountStorage(localStorage, { ...alice, legacyOwner: true });
    expect(Object.keys(legacy)).toEqual(['draft']);
    legacy.clear();
    expect(a.getItem('token')).toBe('fake-a-token');
  });
  it('namespaces both project and legacy history databases and reserves legacy cache for its owner', () => {
    for (const name of ['boltHistory', 'jingyueProjects', 'boltDB']) {
      expect(scopedDatabaseName(name, alice)).not.toBe(scopedDatabaseName(name, bob));
      expect(scopedDatabaseName(name, alice)).not.toBe(name);
      expect(scopedDatabaseName(name, { ...alice, legacyOwner: true })).toBe(name);
      expect(scopedDatabaseName(name, null)).toBe(name);
    }
  });
  it('reads server identity metadata and rejects malformed metadata', () => {
    expect(readAccountContext()).toBeNull();

    const meta = document.createElement('meta');
    meta.name = 'jingyue-account';
    meta.content = JSON.stringify(alice);
    document.head.appendChild(meta);
    expect(readAccountContext()).toEqual(alice);
    meta.content = '{}';
    expect(() => readAccountContext()).toThrow();
  });
});
