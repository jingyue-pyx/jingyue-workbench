import type { ProjectDocument } from './project-document';

export type ProjectSyncState = 'cloud' | 'local' | 'conflict' | 'deleted';
export interface CachedProject {
  projectId: string;
  revision: number;
  document: ProjectDocument;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  state: ProjectSyncState;
  error?: string;
  retryable?: boolean;
  migration?: { sourceId: string; legacyId: string };
  pending?: { requestId: string; baseRevision: number; document: ProjectDocument };
}
export interface ProjectCache {
  get(id: string): Promise<CachedProject | undefined>;
  put(project: CachedProject): Promise<void>;
  all(): Promise<CachedProject[]>;
  meta(key: string, value?: string): Promise<string | undefined>;
}

let connection: Promise<IDBDatabase> | undefined;
function database() {
  return (connection ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('本机项目存储不可用，请允许浏览器存储。'));
    const request = indexedDB.open('jingyueProjects', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects', { keyPath: 'projectId' });
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本机项目缓存。'));
  }));
}
async function operation<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = run(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('本机项目保存失败。'));
  });
}
export const projectCache: ProjectCache = {
  get: (id) => operation('projects', 'readonly', (s) => s.get(id)),
  put: async (project) => {
    await operation('projects', 'readwrite', (s) => s.put(project));
  },
  all: () => operation('projects', 'readonly', (s) => s.getAll()),
  meta: async (key, value) => {
    if (value !== undefined) await operation('meta', 'readwrite', (s) => s.put(value, key));
    return operation('meta', 'readonly', (s) => s.get(key));
  },
};

/** Cache eviction never calls a server API and never removes unsynced drafts. */
export async function clearSyncedProjectCache() {
  for (const project of await projectCache.all()) {
    if (project.state === 'cloud' && !project.pending) {
      await operation('projects', 'readwrite', (s) => s.delete(project.projectId));
    }
  }
}
