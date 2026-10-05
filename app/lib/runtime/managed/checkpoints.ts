import { scopedDatabaseName } from '~/lib/auth/account-context';
import { RunError, type SourceFiles } from './protocol';

// Bounded local recovery points per account/project; never cookies or provider settings.
export async function checkpoint(
  project: string,
  kind: 'before' | 'verified' | 'candidate',
  files?: SourceFiles,
): Promise<SourceFiles | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(scopedDatabaseName('jingyueRunRecovery'), 1);
    open.onupgradeneeded = () => open.result.createObjectStore('points');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });

  try {
    if (files && new TextEncoder().encode(JSON.stringify(files)).byteLength > 4 * 1024 * 1024) {
      throw new RunError('恢复点超过本机 4 MiB 上限，未开始自动修改。', false, 'recovery-storage');
    }

    return await new Promise((resolve, reject) => {
      const tx = db.transaction('points', files ? 'readwrite' : 'readonly');
      const store = tx.objectStore('points');
      const key = `${project}:${kind}`;
      const request = files ? store.put(files, key) : store.get(key);
      tx.oncomplete = () => resolve(files || request.result);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
