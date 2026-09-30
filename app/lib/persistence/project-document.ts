import type { Message } from 'ai';
import type { FileMap } from '~/lib/stores/files';
import type { Snapshot } from './types';
import type { IChatMetadata } from './db';

export interface ProjectDocument {
  schemaVersion: 1;
  title: string;
  messages: Message[];
  snapshot: Snapshot | null;
  metadata?: IChatMetadata;
}

export const isProjectId = (id?: string): id is string =>
  !!id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

export function relativeProjectPath(name: string) {
  const relative = name.startsWith('/home/project/') ? name.slice('/home/project/'.length) : name;

  if (
    !relative ||
    relative.startsWith('/') ||
    relative.includes('\\') ||
    /[\u0000-\u001f]/.test(relative) ||
    relative.split('/').some((p) => !p || p === '.' || p === '..')
  ) {
    throw new Error('项目包含不安全路径，已停止同步。');
  }

  return relative;
}

export function excludedProjectPath(name: string) {
  return name
    .split('/')
    .some(
      (part) =>
        part === '.git' ||
        part === 'node_modules' ||
        part === '.jingyue-runtime' ||
        part === '.jingyue-build' ||
        part === '.env' ||
        part.startsWith('.env.'),
    );
}

/** Whitelist project data; never serialize provider settings, cookies or attachments. */
export function cloudFiles(files: FileMap): FileMap {
  const result: FileMap = {};

  for (const [name, entry] of Object.entries(files)) {
    if (!entry || name === '/home/project') {
      continue;
    }

    const relative = relativeProjectPath(name);

    if (excludedProjectPath(relative)) {
      continue;
    }

    const lockedByFolder = entry.lockedByFolder ? relativeProjectPath(entry.lockedByFolder) : undefined;
    result[relative] =
      entry.type === 'file'
        ? {
            type: 'file',
            content: entry.content,
            isBinary: entry.isBinary,
            ...(entry.isLocked === undefined ? {} : { isLocked: entry.isLocked }),
            ...(lockedByFolder ? { lockedByFolder } : {}),
          }
        : {
            type: 'folder',
            ...(entry.isLocked === undefined ? {} : { isLocked: entry.isLocked }),
            ...(lockedByFolder ? { lockedByFolder } : {}),
          };
  }

  return result;
}

export function runtimeFiles(files: FileMap): FileMap {
  return Object.fromEntries(
    Object.entries(files)
      .filter(([name]) => name !== '/home/project')
      .map(([name, entry]) => [
        `/home/project/${relativeProjectPath(name)}`,
        entry && {
          ...entry,
          ...(entry.lockedByFolder
            ? { lockedByFolder: `/home/project/${relativeProjectPath(entry.lockedByFolder)}` }
            : {}),
        },
      ]),
  );
}

function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content) && content.every((part) => part?.type === 'text' && typeof part.text === 'string')) {
    return content.map((part) => part.text).join('\n');
  }

  throw new Error('当前云同步仅支持文本对话，请先导出包含附件的原记录。');
}

function safeMessageText(content: unknown) {
  return messageText(content).replace(/<boltAction\b([^>]*)>([\s\S]*?)<\/boltAction>/gi, (full, attributes: string) => {
    const filePath = /\bfilePath\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];

    if (filePath && excludedProjectPath(filePath)) {
      return '[敏感或依赖目录文件未同步]';
    }

    return full;
  });
}

export function makeProjectDocument(
  title: string,
  messages: Message[],
  snapshot: Snapshot | null,
  metadata?: IChatMetadata,
): ProjectDocument {
  const cleanMessages = messages
    .filter((m) => !m.annotations?.includes('no-store'))
    .map((m) => {
      if (m.experimental_attachments?.length) {
        throw new Error('对话含图片或附件，当前云协议仅支持文本；已保留完整本机草稿，请先导出备份。');
      }

      if (!['user', 'assistant', 'system'].includes(m.role)) {
        throw new Error('当前云同步不支持此消息类型。');
      }

      return {
        id: m.id,
        role: m.role,
        content: safeMessageText(m.content),
        ...(m.createdAt ? { createdAt: m.createdAt } : {}),

        // Only retain known non-secret display/context annotations, not arbitrary provider payloads.
        ...(m.annotations
          ? {
              annotations: m.annotations
                .filter(
                  (a) =>
                    typeof a === 'string' ||
                    (a && typeof a === 'object' && !Array.isArray(a) && a.type === 'chatSummary'),
                )
                .map((a) => (typeof a === 'string' ? a : { type: 'chatSummary', summary: (a as any).summary })),
            }
          : {}),
      } as Message;
    });

  if (snapshot && !cleanMessages.some((m) => m.id === snapshot.chatIndex)) {
    throw new Error('项目快照与对话不一致，已停止同步。');
  }

  if (metadata?.gitUrl) {
    const url = new URL(metadata.gitUrl);

    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Git 地址包含凭据或额外参数，已停止云同步；请改为无凭据的 HTTPS 地址。');
    }
  }

  const document: ProjectDocument = {
    schemaVersion: 1,
    title: (title.trim() || '未命名项目').slice(0, 200),
    messages: cleanMessages,
    snapshot: snapshot
      ? {
          chatIndex: snapshot.chatIndex,
          files: cloudFiles(snapshot.files),
          ...(snapshot.summary ? { summary: snapshot.summary } : {}),
        }
      : null,
    ...(metadata
      ? {
          metadata: {
            ...(metadata.gitUrl ? { gitUrl: metadata.gitUrl } : {}),
            ...(metadata.gitBranch ? { gitBranch: metadata.gitBranch } : {}),
            ...(metadata.netlifySiteId ? { netlifySiteId: metadata.netlifySiteId } : {}),
          } as IChatMetadata,
        }
      : {}),
  };

  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > 4 * 1024 * 1024 - 1024) {
    throw new Error('项目超过云同步 4 MiB 上限；本机草稿保留，请导出或缩小项目。');
  }

  return document;
}
