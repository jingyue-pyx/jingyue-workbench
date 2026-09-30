import { atom } from 'nanostores';
import { currentAccount } from '~/lib/auth/account-context';
import { projectCache, type CachedProject, type ProjectCache } from './project-cache';
import {
  excludedProjectPath,
  makeProjectDocument,
  relativeProjectPath,
  type ProjectDocument,
} from './project-document';
import { projectPersistence } from '~/lib/stores/project-persistence';

export const projectChanges = atom(0);
export const activeProjectState = atom<CachedProject | undefined>();
export const projectListError = atom('');

class ProjectApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
type Summary = Omit<CachedProject, 'document' | 'state'> & { title: string };
type MutationAck = Pick<CachedProject, 'projectId' | 'revision' | 'updatedAt' | 'deletedAt'>;

export class ProjectRepository {
  private _sessions = new Map<string, CachedProject>();
  private _queues = new Map<string, Promise<unknown>>();
  constructor(
    private _cache: ProjectCache,
    private _fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async _request<T>(url: string, body?: unknown): Promise<T> {
    const response = await this._fetcher(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(currentAccount ? { 'X-Jingyue-User': currentAccount.id } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: { code?: string } };

    if (!response.ok) {
      throw new ProjectApiError(
        response.status,
        result.error?.code || 'REQUEST_FAILED',
        response.status === 503
          ? '云存储暂不可用，本机草稿已保留。'
          : response.status === 409
            ? '云端项目已更新或删除，请选择载入云端或复制本机项目。'
            : '云同步失败，本机草稿已保留。',
      );
    }

    return result as T;
  }
  private async _remember(project: CachedProject) {
    await this._cache.put(project);
    this._sessions.set(project.projectId, project);

    if (activeProjectState.get()?.projectId === project.projectId) {
      activeProjectState.set(project);

      if (project.state === 'cloud') {
        projectPersistence.set('saved');
      } else if (project.state === 'conflict' || project.state === 'deleted') {
        projectPersistence.set(project.state);
      } else if (project.error) {
        projectPersistence.set('local');
      }
    }

    projectChanges.set(projectChanges.get() + 1);

    return project;
  }
  private _serial<T>(id: string, task: () => Promise<T>): Promise<T> {
    const next = (this._queues.get(id) || Promise.resolve()).catch(() => {}).then(task);
    this._queues.set(id, next);

    return next;
  }
  async local(id: string) {
    return this._sessions.get(id) || this._cache.get(id);
  }
  async load(id: string, remoteOnly = false): Promise<CachedProject> {
    const local = await this.local(id);

    if (!remoteOnly && local && local.state !== 'cloud') {
      this._sessions.set(id, local);
      return local;
    }

    try {
      const remote = await this._request<CachedProject>(`/api/projects/${encodeURIComponent(id)}`);

      if (
        remote.projectId !== id ||
        !Number.isInteger(remote.revision) ||
        remote.revision < 1 ||
        remote.document?.schemaVersion !== 1
      ) {
        throw new Error('云项目格式异常。');
      }

      const document = makeProjectDocument(
        remote.document.title,
        remote.document.messages,
        remote.document.snapshot,
        remote.document.metadata,
      );

      // Private project configuration remains on this browser only, never in API payloads.
      if (!remoteOnly && document.snapshot && local?.document.snapshot) {
        for (const [name, file] of Object.entries(local.document.snapshot.files)) {
          if (
            file &&
            excludedProjectPath(name) &&
            !name.split('/').some((part) => part === 'node_modules' || part === '.git')
          ) {
            document.snapshot.files[relativeProjectPath(name)] = file;
          }
        }
      }

      return await this._remember({ ...remote, document, state: remote.deletedAt ? 'deleted' : 'cloud' });
    } catch (error) {
      if (remoteOnly || !local || (error instanceof ProjectApiError && [404, 409, 401, 403].includes(error.status))) {
        throw error;
      }

      return this._remember({ ...local, state: 'local', error: '云端暂时无法连接，当前为本机缓存，尚未同步。' });
    }
  }
  async create(document: ProjectDocument, migration?: CachedProject['migration']) {
    if (migration) {
      const existing = await this._cache.meta(`migration:${migration.legacyId}`);

      if (existing) {
        return (await this.local(existing)) || (await this.load(existing));
      }
    }

    const projectId = crypto.randomUUID();
    const now = new Date().toISOString();
    await this._remember({
      projectId,
      revision: 0,
      document,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      state: 'local',
      migration,
    });

    if (migration) {
      await this._cache.meta(`migration:${migration.legacyId}`, projectId);
    }

    return this.save(projectId, document);
  }
  async save(
    id: string,
    update: ProjectDocument | ((document: ProjectDocument) => ProjectDocument),
  ): Promise<CachedProject> {
    return this._serial(id, async () => {
      let project = await this.local(id);

      if (!project) {
        throw new Error('找不到本机项目，请先打开项目。');
      }

      if (project.deletedAt || project.state === 'deleted') {
        throw new Error('项目已删除，不能自动恢复；请复制为新项目。');
      }

      const document = typeof update === 'function' ? update(project.document) : update;
      project = await this._remember({
        ...project,
        document,
        state: project.state === 'conflict' ? 'conflict' : 'local',
      });

      if (project.state === 'conflict') {
        return project;
      }

      try {
        // Replay an uncertain request with exactly the same id and document before sending a newer draft.
        for (;;) {
          const sanitized = makeProjectDocument(
            project.document.title,
            project.document.messages,
            project.document.snapshot,
            project.document.metadata,
          );

          if (!project.pending) {
            project = await this._remember({
              ...project,
              pending: { requestId: crypto.randomUUID(), baseRevision: project.revision, document: sanitized },
            });
          }

          const pending = project.pending!;
          const ack = await this._request<MutationAck>(
            project.revision === 0 ? '/api/projects' : `/api/projects/${id}/checkpoint`,
            project.revision === 0
              ? {
                  projectId: id,
                  requestId: pending.requestId,
                  document: pending.document,
                  ...(project.migration ? { migration: project.migration } : {}),
                }
              : { requestId: pending.requestId, baseRevision: pending.baseRevision, document: pending.document },
          );

          if (
            ack.projectId !== id ||
            !Number.isInteger(ack.revision) ||
            ack.revision <= pending.baseRevision ||
            typeof ack.updatedAt !== 'string'
          ) {
            throw new Error('云端确认格式异常，本机草稿已保留。');
          }

          const same = JSON.stringify(pending.document) === JSON.stringify(sanitized);
          project = await this._remember({
            ...project,
            revision: ack.revision,
            updatedAt: ack.updatedAt,
            deletedAt: ack.deletedAt,
            pending: undefined,
            state: ack.deletedAt ? 'deleted' : same ? 'cloud' : 'local',
            error: undefined,
          });

          if (ack.deletedAt || same) {
            return project;
          }
        }
      } catch (error) {
        return this._remember({
          ...project,
          retryable: error instanceof ProjectApiError && error.status === 503,
          state: error instanceof ProjectApiError && error.status === 409 ? 'conflict' : 'local',
          error:
            error instanceof ProjectApiError || (error instanceof Error && !error.name.includes('TypeError'))
              ? error.message
              : '网络不可用，本机草稿已保留。',
        });
      }
    });
  }
  async copy(id: string) {
    await this._queues.get(id)?.catch(() => {});

    const original = (await this.local(id)) || (await this.load(id));

    return this.create({ ...original.document, title: `${original.document.title}（副本）`.slice(0, 200) });
  }
  async rename(id: string, title: string) {
    if (!(await this.local(id))) {
      await this.load(id);
    }

    return this.save(id, (document) => ({ ...document, title }));
  }
  async remove(id: string, restore = false) {
    return this._serial(id, async () => {
      const project = (await this.local(id)) || (await this.load(id));

      if (!project.revision) {
        if (project.pending) {
          throw new Error('首次云保存尚未确认，请先重试同步后再删除，避免遗留云端记录。');
        }

        if (restore) {
          return this._remember({ ...project, state: 'local', deletedAt: null });
        }

        return this._remember({ ...project, state: 'deleted', deletedAt: new Date().toISOString() });
      }

      if (project.pending || project.state === 'local' || project.state === 'conflict') {
        throw new Error('本机仍有未确认的修改，请先重试云同步或复制本机项目，再删除或恢复云端记录。');
      }

      const ack = await this._request<MutationAck>(`/api/projects/${id}/${restore ? 'restore' : 'delete'}`, {
        requestId: crypto.randomUUID(),
        baseRevision: project.revision,
      });

      if (ack.projectId !== id || !Number.isInteger(ack.revision) || ack.revision <= project.revision) {
        throw new Error('云端操作尚未确认，请刷新回收站状态后重试。');
      }

      return this._remember({ ...project, ...ack, state: ack.deletedAt ? 'deleted' : 'cloud', pending: undefined });
    });
  }
  async list(deleted = false): Promise<Summary[]> {
    const remote: Summary[] = [];
    let offline = false;

    try {
      let cursor: string | null = null;

      do {
        const page: { items: Summary[]; nextCursor: string | null } = await this._request(
          `/api/projects?limit=20&deleted=${deleted ? '1' : '0'}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        remote.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      projectListError.set('');
    } catch {
      offline = true;
      projectListError.set('云项目列表暂不可用，当前仅显示本机已有记录。');
    }

    const rows = new Map(remote.map((p) => [p.projectId, p]));

    for (const p of await this._cache.all()) {
      if (!!p.deletedAt !== deleted) {
        continue;
      }

      if (p.state !== 'cloud' || offline) {
        rows.set(p.projectId, { ...p, title: p.document.title });
      }
    }

    return [...rows.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async migrationSource() {
    let sourceId = await this._cache.meta('migration-source');

    if (!sourceId) {
      sourceId = (await this._cache.meta('migration-source', crypto.randomUUID()))!;
    }

    return sourceId;
  }
}
export const projects = new ProjectRepository(projectCache);
