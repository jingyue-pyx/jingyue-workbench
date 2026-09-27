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
});
