import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectRepository, projectListError } from './projects';
import type { CachedProject, ProjectCache } from './project-cache';
import { cloudFiles, makeProjectDocument, runtimeFiles, type ProjectDocument } from './project-document';

const id = '8c5c51a9-4686-4c61-a978-8c373a2a693f';
const doc = (title = '鲸月项目'): ProjectDocument => ({
  schemaVersion: 1,
  title,
  messages: [{ id: 'm1', role: 'assistant', content: 'hello' }],
  snapshot: {
    chatIndex: 'm1',
    files: { '/home/project/src/App.tsx': { type: 'file', content: title, isBinary: false } },
  },
});
const ack = (projectId = id, revision = 1) => ({
  projectId,
  revision,
  updatedAt: '2026-09-28T00:00:00Z',
  deletedAt: null,
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let data: Map<string, CachedProject>;
let meta: Map<string, string>;
let cache: ProjectCache;
let fetcher: ReturnType<typeof vi.fn>;
let repository: ProjectRepository;
beforeEach(() => {
  data = new Map();
  meta = new Map();
  cache = {
    get: async (key) => structuredClone(data.get(key)),
    put: async (value) => {
      data.set(value.projectId, structuredClone(value));
    },
    all: async () => structuredClone([...data.values()]),
    meta: async (key, value) => {
      if (value !== undefined) {
        meta.set(key, value);
      }

      return meta.get(key);
    },
  };
  fetcher = vi.fn();
  repository = new ProjectRepository(cache, fetcher as typeof fetch);
});

describe('cloud project repository', () => {
  it('keeps a new UUID project locally before acknowledgement, then marks cloud only after ack', async () => {
    let release!: (value: Response) => void;
    fetcher.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const pending = repository.create(doc());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(data.get(body.projectId)?.state).toBe('local');
    expect(body.document.snapshot.files['src/App.tsx'].content).toBe('鲸月项目');
    expect(body.projectId).toMatch(/^[\da-f-]{36}$/);
    release(response(ack(body.projectId)));
    expect((await pending).state).toBe('cloud');
  });
  it('preserves complete drafts on 503 and replays the identical create request ID', async () => {
    fetcher.mockResolvedValueOnce(response({ error: { code: 'DATABASE_UNAVAILABLE' } }, 503));

    const local = await repository.create(doc());
    expect(local.state).toBe('local');
    expect(local.document.snapshot?.files['/home/project/src/App.tsx']).toBeDefined();

    const first = JSON.parse(fetcher.mock.calls[0][1].body);
    fetcher.mockResolvedValueOnce(response(ack(local.projectId)));
    expect((await repository.save(local.projectId, doc())).state).toBe('cloud');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(first);
  });
  it('replays uncertain data before checkpointing a newer offline draft', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('offline'));

    const local = await repository.create(doc('old'));
    fetcher
      .mockResolvedValueOnce(response(ack(local.projectId)))
      .mockResolvedValueOnce(response(ack(local.projectId, 2)));

    const saved = await repository.save(local.projectId, doc('new'));
    const requests = fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2].document.title).toBe('new');
    expect(requests[2].baseRevision).toBe(1);
    expect(saved.revision).toBe(2);
  });
  it('does not overwrite after conflict and can copy full local source into a new project', async () => {
    await cache.put({
      projectId: id,
      revision: 2,
      document: doc(),
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      state: 'cloud',
    });
    fetcher.mockResolvedValueOnce(response({ error: { code: 'REVISION_CONFLICT', currentRevision: 3 } }, 409));

    const conflict = await repository.save(id, doc('local edit'));
    expect(conflict.state).toBe('conflict');
    await repository.save(id, doc('another edit'));
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockImplementation(async (_url, init) => response(ack(JSON.parse(init.body).projectId)));

    const copy = await repository.copy(id);
    expect(copy.projectId).not.toBe(id);
    expect(copy.document.snapshot?.files['/home/project/src/App.tsx']?.type).toBe('file');
    expect(data.get(id)?.revision).toBe(2);
  });
  it('preserves stale session revisions even when another tab updates the cache', async () => {
    const p = {
      projectId: id,
      revision: 1,
      document: doc(),
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      state: 'local' as const,
    };
    await cache.put(p);
    await repository.load(id);
    await cache.put({ ...p, revision: 8 });
    fetcher.mockResolvedValueOnce(response({ error: { code: 'REVISION_CONFLICT' } }, 409));
    await repository.save(id, doc('stale'));
    expect(JSON.parse(fetcher.mock.calls[0][1].body).baseRevision).toBe(1);
  });
  it('refuses to save a deleted project rather than resurrecting it', async () => {
    await cache.put({
      projectId: id,
      revision: 3,
      document: doc(),
      createdAt: '',
      updatedAt: '',
      deletedAt: 'today',
      state: 'deleted',
    });
    await expect(repository.save(id, doc())).rejects.toThrow('已删除');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not claim a possibly-created cloud project was deleted when its first ack was lost', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('offline'));

    const project = await repository.create(doc());
    await expect(repository.remove(project.projectId)).rejects.toThrow('尚未确认');
    expect(data.get(project.projectId)?.deletedAt).toBeNull();
  });

  it('renames after queued source saves without replacing newer source with an older snapshot', async () => {
    await cache.put({
      projectId: id,
      revision: 1,
      document: doc('old'),
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      state: 'cloud',
    });

    let finish!: (value: Response) => void;
    fetcher
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(response(ack(id, 3)));

    const save = repository.save(id, doc('new source'));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());

    const rename = repository.rename(id, '新名称');
    finish(response(ack(id, 2)));
    await save;

    const renamed = await rename;
    expect(renamed.document.title).toBe('新名称');
    expect(renamed.document.snapshot?.files['/home/project/src/App.tsx']).toEqual({
      type: 'file',
      content: 'new source',
      isBinary: false,
    });
  });

  it.each([false, true])(
    'does not discard an existing cloud project pending draft during delete/restore (%s)',
    async (restore) => {
      const draft: CachedProject = {
        projectId: id,
        revision: 2,
        document: doc('unsynced'),
        createdAt: '',
        updatedAt: '',
        deletedAt: restore ? 'yesterday' : null,
        state: 'local',
        pending: { requestId: crypto.randomUUID(), baseRevision: 2, document: doc('unsynced') },
      };
      await cache.put(draft);
      await expect(repository.remove(id, restore)).rejects.toThrow('未确认');
      expect(fetcher).not.toHaveBeenCalled();
      expect(data.get(id)).toEqual(draft);
    },
  );

  it('retains local-only environment files when refreshing a clean cloud snapshot without ever uploading them', async () => {
    const local = doc();
    local.snapshot!.files['/home/project/.env.local'] = { type: 'file', content: 'LOCAL_ONLY=value', isBinary: false };
    await cache.put({
      projectId: id,
      revision: 1,
      document: local,
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      state: 'cloud',
    });
    fetcher.mockResolvedValueOnce(response({ ...ack(), createdAt: '', document: doc('remote') }));

    const loaded = await repository.load(id);
    expect(loaded.document.snapshot?.files['.env.local']).toBeDefined();
    expect(runtimeFiles(loaded.document.snapshot!.files)['/home/project/.env.local']).toBeDefined();
    expect(
      JSON.stringify(makeProjectDocument(loaded.document.title, loaded.document.messages, loaded.document.snapshot)),
    ).not.toContain('LOCAL_ONLY');
  });
  it('restores the server version only on explicit remote load', async () => {
    await cache.put({
      projectId: id,
      revision: 1,
      document: doc('draft'),
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      state: 'conflict',
    });
    expect((await repository.load(id)).document.title).toBe('draft');
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(response({ ...ack(), createdAt: '', document: doc('remote') }));
    expect((await repository.load(id, true)).document.title).toBe('remote');
  });
  it('does not make any legacy migration request without explicit create and persists its mapping', async () => {
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(response({ error: { code: 'DATABASE_UNAVAILABLE' } }, 503));

    const migration = { sourceId: await repository.migrationSource(), legacyId: '42' };
    const first = await repository.create(doc(), migration);
    const second = await repository.create(doc(), migration);
    expect(first.projectId).toBe(second.projectId);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(meta.get('migration:42')).toBe(first.projectId);
  });
  it('uses pagination and excludes an old clean cache no longer in the live cloud list', async () => {
    await cache.put({
      projectId: id,
      revision: 1,
      document: doc(),
      createdAt: '',
      updatedAt: '',
      deletedAt: null,
      state: 'cloud',
    });
    fetcher
      .mockResolvedValueOnce(response({ items: [], nextCursor: 'next' }))
      .mockResolvedValueOnce(response({ items: [], nextCursor: null }));
    expect(await repository.list()).toEqual([]);
    expect(fetcher.mock.calls[1][0]).toContain('cursor=next');
    expect(projectListError.get()).toBe('');
  });
  it('keeps an oversized draft without sending it', async () => {
    const large = doc();
    large.messages[0].content = 'x'.repeat(4 * 1024 * 1024);

    const result = await repository.create(large);
    expect(result.state).toBe('local');
    expect(result.error).toContain('4 MiB');
    expect(result.document.messages[0].content.length).toBe(4 * 1024 * 1024);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not mark malformed successful responses as saved', async () => {
    fetcher.mockResolvedValueOnce(response({}));
    expect((await repository.create(doc())).state).toBe('local');
  });
});

describe('project document whitelist', () => {
  it('normalizes paths and omits sensitive files and dependency directories', () => {
    const files = cloudFiles({
      '/home/project/.env': { type: 'file', content: 'secret', isBinary: false },
      '.env.production': { type: 'file', content: 'secret', isBinary: false },
      '.git/config': { type: 'file', content: 'secret', isBinary: false },
      'node_modules/x': { type: 'folder' },
      '/home/project/src/a.ts': { type: 'file', content: 'ok', isBinary: false },
    });
    expect(Object.keys(files)).toEqual(['src/a.ts']);
    expect(runtimeFiles(files)['/home/project/src/a.ts']).toBeDefined();
  });
  it.each(['../bad', '/etc/passwd', 'src/../bad', 'C:\\bad', 'src//bad'])('rejects unsafe path %s', (name) => {
    expect(() => cloudFiles({ [name]: { type: 'folder' } })).toThrow('不安全');
  });
  it('keeps binary files and strips secret file actions from chat text', () => {
    const project = makeProjectDocument(
      'test',
      [{ id: 'a', role: 'assistant', content: '<boltAction type="file" filePath=".env">TOKEN=secret</boltAction>' }],
      { chatIndex: 'a', files: { 'logo.png': { type: 'file', isBinary: true, content: 'YWJj' } } },
    );
    expect(JSON.stringify(project)).not.toContain('TOKEN');
    expect(project.snapshot?.files['logo.png']).toEqual({ type: 'file', isBinary: true, content: 'YWJj' });
  });
  it('rejects orphan snapshots and credential-bearing metadata', () => {
    expect(() => makeProjectDocument('test', [], { chatIndex: 'missing', files: {} })).toThrow('不一致');
    expect(() => makeProjectDocument('test', [], null, { gitUrl: 'https://token@example.com/repo' })).toThrow('凭据');
  });
  it('rejects unsupported attachments without falsely saving a text-only project', () => {
    expect(() =>
      makeProjectDocument(
        'test',
        [
          {
            id: 'a',
            role: 'user',
            content: 'image',
            experimental_attachments: [{ url: 'data:image/png;base64,abc', contentType: 'image/png' }],
          },
        ],
        null,
      ),
    ).toThrow('附件');
  });
});
