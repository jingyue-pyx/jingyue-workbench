// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  route: {} as { id?: string },
  params: new URLSearchParams(),
  navigate: vi.fn(),
  savedHandler: undefined as undefined | (() => Promise<void>),
  files: {} as Record<string, any>,
  getMessages: vi.fn(),
  getSnapshot: vi.fn(),
  setSnapshot: vi.fn(),
  setMessages: vi.fn(),
  setLegacyProject: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  settled: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@remix-run/react', () => ({
  useLoaderData: () => state.route,
  useNavigate: () => state.navigate,
  useSearchParams: () => [state.params],
}));
vi.mock('./db', () => ({
  openDatabase: async () => ({}),
  getMessages: state.getMessages,
  getSnapshot: state.getSnapshot,
  setSnapshot: state.setSnapshot,
  setMessages: state.setMessages,
  setLegacyProject: state.setLegacyProject,
  getNextId: async () => '42',
  getUrlId: async () => 'generated-site',
  duplicateChat: vi.fn(),
  createChatFromMessages: vi.fn(),
}));
vi.mock('./projects', async () => ({
  activeProjectState: (await import('nanostores')).atom(undefined),
  projects: { create: state.create, save: state.save, load: state.load },
}));
vi.mock('~/lib/stores/workbench', () => ({
  workbenchStore: {
    onFileSaved: (handler: () => Promise<void>) => {
      state.savedHandler = handler;

      return () => {
        state.savedHandler = undefined;
      };
    },
    files: {
      get: () => state.files,
      set: (files: typeof state.files) => {
        state.files = files;
      },
    },
    firstArtifact: { id: 'site', title: '生成的网站' },
    whenActionsSettled: state.settled,
    setDocuments: vi.fn(),
    setShowWorkbench: vi.fn(),
  },
}));
vi.mock('~/lib/webcontainer', () => ({
  webcontainer: Promise.resolve({
    workdir: '/home/project',
    fs: { mkdir: state.mkdir, writeFile: state.writeFile },
  }),
}));
vi.mock('~/lib/stores/logs', () => ({ logStore: { logError: vi.fn() } }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { chatId, useChatHistory } from './useChatHistory';
import { projectPersistence } from '~/lib/stores/project-persistence';

const messages = [{ id: 'answer', role: 'assistant' as const, content: 'Generated project' }];
const cloudId = '8c5c51a9-4686-4c61-a978-8c373a2a693f';
const cloud = (document: any, state = 'cloud') => ({
  projectId: cloudId,
  revision: 1,
  document,
  state,
  deletedAt: null,
});
const source = (content: string) => ({ '/home/project/src/App.jsx': { type: 'file', content, isBinary: false } });

beforeEach(() => {
  vi.clearAllMocks();
  state.route = {};
  state.params = new URLSearchParams();
  state.savedHandler = undefined;
  state.files = source('initial');
  state.settled.mockResolvedValue(undefined);
  state.setSnapshot.mockResolvedValue(undefined);
  state.setMessages.mockResolvedValue(undefined);
  state.setLegacyProject.mockResolvedValue(undefined);
  state.create.mockImplementation(async (document) => cloud(document));
  state.save.mockImplementation(async (_id, document) => cloud(document));
  state.getMessages.mockResolvedValue({ id: '42', urlId: 'generated-site', messages });
  state.getSnapshot.mockResolvedValue(undefined);
  state.mkdir.mockResolvedValue(undefined);
  state.writeFile.mockResolvedValue(undefined);
  chatId.set(undefined);
  projectPersistence.set('idle');
});
afterEach(cleanup);

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function savedSourceProject() {
  return cloud({
    schemaVersion: 1,
    title: '恢复测试',
    messages: [{ id: 'answer', role: 'assistant', content: '已完成采购页面', annotations: ['managed-run'] }],
    snapshot: { chatIndex: 'answer', files: source('saved source') },
  });
}

describe('progressive project restoration', () => {
  it('shows saved conversation before source writes finish, without enabling execution or saving', async () => {
    const write = deferred();
    const project = savedSourceProject();
    state.route = { id: cloudId };
    state.load.mockResolvedValue(project);
    state.writeFile.mockReturnValue(write.promise);

    const { result } = renderHook(() => useChatHistory());

    await waitFor(() => expect(result.current.conversationMessages).toEqual(project.document.messages));
    expect(result.current.ready).toBe(false);
    expect(result.current.initialMessages).toEqual([]);
    expect(state.files).toEqual(source('initial'));
    await expect(result.current.storeMessageHistory(messages)).rejects.toThrow('正在恢复项目代码');
    await expect(state.savedHandler!()).rejects.toThrow('正在恢复项目代码');
    expect(state.save).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();

    await act(async () => write.resolve());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(state.files).toEqual(source('saved source'));
    expect(result.current.initialMessages.at(-1)?.annotations).toContain('managed-restore');
    expect(state.save).not.toHaveBeenCalled();
  });

  it('retains readable history on a code restore failure without falsely claiming a cloud save failure', async () => {
    const write = deferred();
    const project = savedSourceProject();
    state.route = { id: cloudId };
    state.load.mockResolvedValue(project);
    state.writeFile.mockReturnValue(write.promise);

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.conversationMessages).toEqual(project.document.messages));
    await act(async () => write.reject(new Error('源码写入暂不可用')));
    await waitFor(() => expect(result.current.loadError).toBe('源码写入暂不可用'));
    expect(result.current.conversationMessages).toEqual(project.document.messages);
    expect(result.current.ready).toBe(false);
    expect(projectPersistence.get()).toBe('saved');
    await expect(result.current.storeMessageHistory(messages)).rejects.toThrow('正在恢复项目代码');
    expect(state.save).not.toHaveBeenCalled();
  });

  it('does not expose history or restore source when authenticated project loading is rejected', async () => {
    state.route = { id: cloudId };
    state.load.mockRejectedValueOnce(new Error('请重新登录'));

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.loadError).toBe('请重新登录'));
    expect(result.current.conversationMessages).toBeUndefined();
    expect(result.current.ready).toBe(false);
    expect(state.writeFile).not.toHaveBeenCalled();
    expect(projectPersistence.get()).toBe('error');
  });

  it('ignores a previous project response after switching routes', async () => {
    const load = deferred<ReturnType<typeof cloud>>();
    state.route = { id: cloudId };
    state.load.mockReturnValueOnce(load.promise);

    const { result, rerender } = renderHook(() => useChatHistory());
    state.route = {};
    rerender();
    await act(async () => load.resolve(savedSourceProject()));
    expect(result.current.ready).toBe(true);
    expect(result.current.conversationMessages).toBeUndefined();
    expect(result.current.initialMessages).toEqual([]);
    expect(chatId.get()).toBeUndefined();
    expect(state.writeFile).not.toHaveBeenCalled();
  });

  it('hides old history and cancels pending restore writes after switching projects', async () => {
    const directory = deferred();
    const newId = '4824c5cb-4d5e-4f4d-9de4-1634e2c33496';
    state.route = { id: cloudId };
    state.load.mockResolvedValueOnce(savedSourceProject());
    state.mkdir.mockReturnValueOnce(directory.promise);

    const { result, rerender } = renderHook(() => useChatHistory());
    await waitFor(() => expect(state.mkdir).toHaveBeenCalled());
    state.route = { id: newId };
    state.load.mockResolvedValueOnce({
      ...cloud({ schemaVersion: 1, title: '另一会话', messages, snapshot: null }),
      projectId: newId,
    });
    rerender();
    expect(result.current.conversationMessages).toBeUndefined();
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => directory.resolve());
    expect(result.current.conversationMessages).toEqual(messages);
    expect(result.current.initialMessages).toEqual(messages);
    expect(chatId.get()).toBe(newId);
    expect(state.writeFile).not.toHaveBeenCalled();
  });
});

describe('project persistence lifecycle', () => {
  it('waits for generated file writes then atomically saves messages and source as a UUID cloud document', async () => {
    let release!: () => void;
    state.settled.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const { result } = renderHook(() => useChatHistory());
    let saving!: Promise<void>;
    await act(async () => {
      saving = result.current.storeMessageHistory(messages);
    });
    expect(state.create).not.toHaveBeenCalled();
    state.files = source('completed AI output');
    await act(async () => {
      release();
      await saving;
    });
    expect(state.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages,
        snapshot: expect.objectContaining({
          chatIndex: 'answer',
          files: source('completed AI output'),
        }),
      }),
    );
    expect(chatId.get()).toBe(cloudId);
    expect(state.setMessages).not.toHaveBeenCalled();
    expect(projectPersistence.get()).toBe('saved');
  });

  it('checkpoints direct edits even without another chat message', async () => {
    const { result } = renderHook(() => useChatHistory());
    await act(async () => {
      await result.current.storeMessageHistory(messages);
    });
    state.files = source('directly edited title');
    await act(async () => {
      await state.savedHandler!();
    });
    expect(state.save).toHaveBeenCalledWith(
      cloudId,
      expect.objectContaining({
        messages,
        snapshot: expect.objectContaining({
          chatIndex: 'answer',
          files: source('directly edited title'),
        }),
      }),
    );
  });

  it('restores an alias URL from the canonical snapshot, including a first-message snapshot', async () => {
    state.route = { id: 'generated-site' };
    state.getSnapshot.mockResolvedValue({ chatIndex: 'answer', files: source('saved direct edit') });

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(state.getSnapshot).toHaveBeenCalledWith(expect.anything(), '42');
    expect(state.writeFile).toHaveBeenCalledWith('src/App.jsx', 'saved direct edit');
    expect(result.current.initialMessages[1].content).not.toContain('saved direct edit');
    expect(chatId.get()).toBe('42');
  });

  it('sidebar consumers do not restore files or overwrite the active save handler', async () => {
    state.route = { id: 'generated-site' };

    const { result } = renderHook(() => useChatHistory({ restore: false }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(state.getMessages).not.toHaveBeenCalled();
    expect(state.savedHandler).toBeUndefined();
  });

  it('reports storage failures instead of claiming a saved project', async () => {
    const { result } = renderHook(() => useChatHistory());
    await act(async () => {
      await result.current.storeMessageHistory(messages);
    });
    state.save.mockRejectedValueOnce(new Error('Storage full'));
    await expect(state.savedHandler!()).rejects.toThrow('Storage full');
    expect(projectPersistence.get()).toBe('error');
  });

  it('keeps editing a legacy project local and atomically preserves its snapshot without upload', async () => {
    state.route = { id: 'generated-site' };

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.storeMessageHistory(messages);
    });
    expect(state.setLegacyProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: '42', messages }),
      expect.objectContaining({ chatIndex: 'answer', files: state.files }),
    );
    expect(state.create).not.toHaveBeenCalled();
    expect(projectPersistence.get()).toBe('local');
  });

  it('displays local-only state on failed cloud save, not saved', async () => {
    state.create.mockImplementation(async (document) => cloud(document, 'local'));

    const { result } = renderHook(() => useChatHistory());
    await act(async () => {
      await result.current.storeMessageHistory(messages);
    });
    expect(projectPersistence.get()).toBe('local');
  });

  it('restores relative cloud files into WebContainer absolute editor paths', async () => {
    state.route = { id: cloudId };
    state.load.mockResolvedValue(
      cloud({
        schemaVersion: 1,
        title: '云项目',
        messages,
        snapshot: {
          chatIndex: 'answer',
          files: { 'src/App.jsx': { type: 'file', content: 'cloud source', isBinary: false } },
        },
      }),
    );

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(state.writeFile).toHaveBeenCalledWith('src/App.jsx', 'cloud source');
    expect(state.files['/home/project/src/App.jsx'].content).toBe('cloud source');
    expect(state.getMessages).not.toHaveBeenCalled();
  });

  it('restores managed task sources without replaying legacy install/start artifacts', async () => {
    state.route = { id: cloudId };
    state.load.mockResolvedValue(
      cloud({
        schemaVersion: 1,
        title: '自动运行项目',
        messages: [{ id: 'answer', role: 'assistant', content: '自动任务完成', annotations: ['managed-run'] }],
        snapshot: {
          chatIndex: 'answer',
          files: { 'src/App.jsx': { type: 'file', content: 'saved source', isBinary: false } },
        },
      }),
    );

    const { result } = renderHook(() => useChatHistory());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.initialMessages.at(-1)?.annotations).toContain('managed-restore');
    expect(result.current.initialMessages[0].content).toBe('自动任务完成');
    expect(result.current.initialMessages[0].content).not.toContain('boltArtifact');
    expect(state.writeFile).toHaveBeenCalledWith('src/App.jsx', 'saved source');
  });

  it.each([{}, { src: { type: 'folder' } }])(
    'restores conversation-only projects without a synthetic source artifact (%j)',
    async (files) => {
      const conversation = [
        { id: 'question', role: 'user' as const, content: 'hello' },
        { id: 'answer', role: 'assistant' as const, content: 'What would you like to build?' },
      ];
      state.route = { id: cloudId };
      state.files = {};
      state.load.mockResolvedValue(
        cloud({
          schemaVersion: 1,
          title: 'Conversation only',
          messages: conversation,
          snapshot: { chatIndex: 'answer', files },
        }),
      );

      const { result } = renderHook(() => useChatHistory());
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(result.current.initialMessages).toEqual(conversation);
      expect(state.writeFile).not.toHaveBeenCalled();
      await act(async () => {
        await result.current.storeMessageHistory(result.current.initialMessages);
      });
      expect(state.save).toHaveBeenCalledWith(cloudId, expect.objectContaining({ messages: conversation }));
    },
  );
});
