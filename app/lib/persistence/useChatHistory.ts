import { useLoaderData, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useRef } from 'react';
import { atom } from 'nanostores';
import { generateId, type Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { getMessages, getSnapshot, openDatabase, duplicateChat, setLegacyProject, type IChatMetadata } from './db';
import { webcontainer } from '~/lib/webcontainer';
import { detectProjectCommands, createCommandActionsString } from '~/utils/projectCommands';
import { restoreProjectFiles } from './project-snapshot';
import { projectPersistence } from '~/lib/stores/project-persistence';
import { isProjectId, runtimeFiles, type ProjectDocument } from './project-document';
import { activeProjectState, projects } from './projects';
import type { Snapshot } from './types';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: IChatMetadata;
  storage?: 'cloud' | 'legacy';
}

export const db = !import.meta.env.VITE_DISABLE_PERSISTENCE ? await openDatabase() : undefined;
export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);

export async function readProject(id: string): Promise<ProjectDocument> {
  if (isProjectId(id)) {
    return (await projects.load(id)).document;
  }

  if (!db) {
    throw new Error('旧项目浏览器存储不可用。');
  }

  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('找不到项目。');
  }

  return {
    schemaVersion: 1,
    title: chat.description || '未命名项目',
    messages: chat.messages,
    snapshot: (await getSnapshot(db, chat.id)) || (await getSnapshot(db, id)) || null,
    metadata: chat.metadata,
  };
}

export function useChatHistory({ restore = true }: { restore?: boolean } = {}) {
  const { id: mixedId } = useLoaderData<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const routeKey = `${mixedId || ''}?${searchParams.toString()}`;
  const [loadedKey, setLoadedKey] = useState('');
  const [conversation, setConversation] = useState<{ key: string; messages: Message[] }>();
  const restoring = useRef(restore && !!mixedId);
  const archived = useRef<Message[]>([]);
  const current = useRef<ProjectDocument>();
  const saving = useRef<Promise<unknown>>(Promise.resolve());

  async function persist(document: ProjectDocument) {
    if (restoring.current) {
      throw new Error('正在恢复项目代码，请完成加载后再保存；已保存的源码不会被覆盖。');
    }

    projectPersistence.set('saving');

    const id = chatId.get();

    try {
      if (id && !isProjectId(id)) {
        if (!db) {
          throw new Error('本机项目存储不可用。');
        }

        const old = await getMessages(db, id);
        await setLegacyProject(
          db,
          {
            ...old,
            description: document.title,
            messages: document.messages,
            metadata: document.metadata,
            timestamp: new Date().toISOString(),
          },
          document.snapshot,
        );
        projectPersistence.set('local');
      } else {
        const result = id ? await projects.save(id, document) : await projects.create(document);
        chatId.set(result.projectId);
        activeProjectState.set(result);
        projectPersistence.set(
          result.state === 'cloud'
            ? 'saved'
            : result.state === 'conflict'
              ? 'conflict'
              : result.state === 'deleted'
                ? 'deleted'
                : 'local',
        );

        if (!id) {
          navigateChat(result.projectId);
        }
      }

      current.current = document;
      description.set(document.title);
      chatMetadata.set(document.metadata);
    } catch (error) {
      projectPersistence.set('error');
      throw error;
    }
  }

  function enqueue(task: () => Promise<void>) {
    const next = saving.current.catch(() => {}).then(task);
    saving.current = next;

    return next;
  }

  useEffect(() => {
    if (!restore) {
      return undefined;
    }

    return workbenchStore.onFileSaved(() =>
      enqueue(async () => {
        await workbenchStore.whenActionsSettled();

        const document = current.current;
        const lastMessage = document?.messages.at(-1);

        if (!document || !lastMessage) {
          throw new Error('项目尚未保存，请等待生成完成。');
        }

        await persist({
          ...document,
          title: description.get() || document.title,
          snapshot: {
            chatIndex: lastMessage.id,
            files: workbenchStore.files.get(),
            summary: document.snapshot?.summary,
          },
        });
      }),
    );
  }, [restore]);

  useEffect(() => {
    if (!restore) {
      setReady(true);
      return undefined;
    }

    let cancelled = false;
    let conversationLoaded = false;
    const restoreAbort = new AbortController();
    setLoadError('');
    setConversation(undefined);
    restoring.current = !!mixedId;
    setLoadedKey(routeKey);

    if (!mixedId) {
      chatId.set(undefined);
      description.set(undefined);
      chatMetadata.set(undefined);
      activeProjectState.set(undefined);
      projectPersistence.set('idle');
      current.current = undefined;
      archived.current = [];
      setInitialMessages([]);
      setReady(true);

      return undefined;
    }

    setReady(false);
    (async () => {
      let document: ProjectDocument;
      let canonicalId = mixedId;

      if (isProjectId(mixedId)) {
        const project = await projects.load(mixedId);

        if (cancelled) {
          return;
        }

        activeProjectState.set(project);

        if (project.deletedAt) {
          throw new Error('此项目已删除。请从回收站明确恢复，或复制本机副本。');
        }

        document = project.document;
        projectPersistence.set(
          project.state === 'cloud' ? 'saved' : project.state === 'conflict' ? 'conflict' : 'local',
        );
      } else {
        document = await readProject(mixedId);

        if (cancelled) {
          return;
        }

        canonicalId = (await getMessages(db!, mixedId)).id;

        if (cancelled) {
          return;
        }

        projectPersistence.set('local');
        activeProjectState.set(undefined);
      }

      if (cancelled) {
        return;
      }

      current.current = document;
      chatId.set(canonicalId);
      description.set(document.title);
      chatMetadata.set(document.metadata);

      const rewind = searchParams.get('rewindTo');

      if (rewind && isProjectId(mixedId)) {
        throw new Error('云项目暂不支持按消息回退，请移除地址中的 rewindTo 参数后重新打开。');
      }

      const ending = rewind ? document.messages.findIndex((m) => m.id === rewind) + 1 : document.messages.length;
      const snapshotIndex = document.snapshot
        ? document.messages.findIndex((m) => m.id === document.snapshot!.chatIndex)
        : -1;

      /*
       * A conversation can be saved before the model has produced any files.
       * Do not replace that conversation with an empty source-restoration artifact.
       */
      const hasSnapshotFiles = Object.values(document.snapshot?.files || {}).some((file) => file?.type === 'file');
      const useSnapshot = hasSnapshotFiles && snapshotIndex >= 0 && snapshotIndex < ending && !rewind;
      archived.current = useSnapshot ? document.messages.slice(0, snapshotIndex + 1) : [];

      let messages = document.messages.slice(useSnapshot ? snapshotIndex + 1 : 0, ending);

      /*
       * Read-only history can be shown before the sandbox boots. Do not mount
       * ChatImpl yet: its parser/saver may otherwise replay commands or save an
       * empty filesystem over the still-restoring snapshot.
       */
      conversationLoaded = true;
      setConversation({ key: routeKey, messages: document.messages.slice(0, ending) });

      if (useSnapshot) {
        const snapshot = document.snapshot!;
        const files = isProjectId(mixedId) ? runtimeFiles(snapshot.files) : snapshot.files;
        let bootTimeout: ReturnType<typeof setTimeout> | undefined;
        const container = await Promise.race([
          webcontainer,
          new Promise<never>((_resolve, reject) => {
            bootTimeout = setTimeout(
              () => reject(new Error('浏览器运行环境恢复超时；项目数据保留，请刷新重试。')),
              45000,
            );
          }),
        ]).finally(() => clearTimeout(bootTimeout));

        if (cancelled) {
          return;
        }

        await restoreProjectFiles(container.fs, container.workdir, files, restoreAbort.signal);

        if (cancelled) {
          return;
        }

        workbenchStore.files.set(files);
        workbenchStore.setDocuments(files);
        workbenchStore.setShowWorkbench(true);

        const commands = await detectProjectCommands(
          Object.entries(files).flatMap(([path, file]) =>
            file?.type === 'file' ? [{ path, content: file.content }] : [],
          ),
        );
        messages = [
          {
            id: generateId(),
            role: 'user',
            content: 'Restore project from snapshot',
            annotations: ['no-store', 'hidden'],
          },
          {
            id: snapshot.chatIndex,
            role: 'assistant',
            content: `已恢复项目已保存源码。<boltArtifact id="restored-project-setup" title="恢复项目运行环境" type="bundled">${createCommandActionsString(commands)}</boltArtifact>`,
            annotations: [
              'no-store',
              ...(snapshot.summary ? [{ type: 'chatSummary', summary: snapshot.summary }] : []),
            ],
          },
          ...messages,
        ];

        if (document.messages.some((message) => message.annotations?.includes('managed-run'))) {
          /*
           * Managed projects restore source bytes, then verify without replaying
           * model commands or spending model quota.
           */
          messages = [
            ...document.messages
              .slice(0, ending)
              .map((message) => ({ ...message, annotations: [...(message.annotations || []), 'managed-run'] })),
            {
              id: generateId(),
              role: 'assistant',
              content: '已恢复云端／本机保存的源码，正在重新编译并检查预览；不重新调用模型。',
              annotations: ['no-store', 'managed-run', 'managed-restore'],
            },
          ];
        }
      }

      if (!cancelled) {
        restoring.current = false;
        setInitialMessages(messages);
        setReady(true);
      }
    })().catch((error) => {
      if (!cancelled) {
        setLoadError(error.message || '项目加载失败。');

        // A sandbox restore failure is not evidence that cloud saving failed.
        if (!conversationLoaded) {
          projectPersistence.set('error');
        }
      }
    });

    return () => {
      cancelled = true;
      restoreAbort.abort();
    };
  }, [mixedId, searchParams, restore, routeKey]);

  return {
    ready: !restore || !mixedId || (loadedKey === routeKey && ready),
    loadError: loadedKey === routeKey ? loadError : '',
    conversationMessages: conversation?.key === routeKey ? conversation.messages : undefined,
    initialMessages,
    updateChatMestaData: (metadata: IChatMetadata) =>
      enqueue(async () => {
        if (!current.current) {
          throw new Error('项目尚未就绪。');
        }

        await persist({ ...current.current, metadata });
      }),
    storeMessageHistory: (messages: Message[]) =>
      enqueue(async () => {
        const clean = messages.filter((m) => !m.annotations?.includes('no-store'));

        if (!clean.length) {
          return;
        }

        await workbenchStore.whenActionsSettled();

        const all = [...new Map([...archived.current, ...clean].map((m) => [m.id, m])).values()];
        const last = all.at(-1)!;
        const annotation = last.annotations?.find(
          (a) => a && typeof a === 'object' && !Array.isArray(a) && a.type === 'chatSummary',
        ) as { summary?: string } | undefined;
        await persist({
          schemaVersion: 1,
          title: description.get() || workbenchStore.firstArtifact?.title || '未命名项目',
          messages: all,
          snapshot: {
            chatIndex: last.id,
            files: workbenchStore.files.get(),
            summary: annotation?.summary || current.current?.snapshot?.summary,
          },
          metadata: chatMetadata.get(),
        });
      }),
    duplicateCurrentChat: async (listItemId: string) => {
      const id = listItemId || chatId.get();

      if (!id) {
        return;
      }

      try {
        const newId = isProjectId(id)
          ? (await projects.copy(id)).projectId
          : db
            ? await duplicateChat(db, id)
            : undefined;

        if (newId) {
          window.location.href = `/chat/${newId}`;
        }
      } catch (error) {
        toast.error((error as Error).message);
      }
    },
    importChat: async (
      title: string,
      messages: Message[],
      metadata?: IChatMetadata,
      snapshot: Snapshot | null = null,
    ) => {
      const result = await projects.create({ schemaVersion: 1, title, messages, snapshot, metadata });
      window.location.href = `/chat/${result.projectId}`;
    },
    exportChat: async (id = chatId.get()) => {
      if (!id) {
        return;
      }

      const projectDocument = isProjectId(id)
        ? ((await projects.local(id)) || (await projects.load(id))).document
        : await readProject(id);
      const blob = new Blob(
        [
          JSON.stringify(
            { ...projectDocument, description: projectDocument.title, exportDate: new Date().toISOString() },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'jingyue-project.json';
      a.click();
      URL.revokeObjectURL(url);
    },
  };
}

function navigateChat(id: string) {
  const url = new URL(window.location.href);
  url.pathname = `/chat/${id}`;
  window.history.replaceState({}, '', url);
}
