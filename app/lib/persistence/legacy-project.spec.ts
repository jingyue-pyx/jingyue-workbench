import { describe, expect, it, vi } from 'vitest';
import { setLegacyProject } from './db';

describe('legacy atomic project persistence', () => {
  it('commits chats and compatible snapshot records in one transaction and awaits completion', async () => {
    const chatPut = vi.fn();
    const snapshotPut = vi.fn();
    const tx = {
      objectStore: (name: string) => ({ put: name === 'chats' ? chatPut : snapshotPut }),
      oncomplete: undefined as any,
      onerror: undefined as any,
      onabort: undefined as any,
    };
    const db = { transaction: vi.fn(() => tx) } as unknown as IDBDatabase;
    const chat = { id: '42', urlId: 'alias', messages: [], timestamp: 'today' };
    const snapshot = { chatIndex: 'message', files: {} };
    let finished = false;
    const pending = setLegacyProject(db, chat, snapshot).then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(db.transaction).toHaveBeenCalledWith(['chats', 'snapshots'], 'readwrite');
    expect(chatPut).toHaveBeenCalledWith(chat);
    expect(snapshotPut).toHaveBeenCalledWith({ chatId: '42', snapshot });
    tx.oncomplete();
    await pending;
    expect(finished).toBe(true);
  });
  it('reports an aborted transaction rather than acknowledging one successful put', async () => {
    const tx = {
      objectStore: () => ({ put: vi.fn(), delete: vi.fn() }),
      oncomplete: undefined as any,
      onerror: undefined as any,
      onabort: undefined as any,
      error: new Error('quota'),
    };
    const pending = setLegacyProject(
      { transaction: () => tx } as unknown as IDBDatabase,
      { id: '42', messages: [], timestamp: 'today' },
      null,
    );
    tx.onabort();
    await expect(pending).rejects.toThrow('quota');
  });
});
