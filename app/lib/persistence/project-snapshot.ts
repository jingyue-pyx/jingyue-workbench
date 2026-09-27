import { Buffer } from 'node:buffer';
import type { FileMap } from '~/lib/stores/files';
import { path } from '~/utils/path';

interface ProjectFileSystem {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  writeFile(path: string, data: string | Uint8Array): Promise<unknown>;
}

/** Restore bytes directly, never turn project contents into executable chat markup. */
export async function restoreProjectFiles(fs: ProjectFileSystem, workdir: string, files: FileMap) {
  const entries = Object.entries(files).map(([name, entry]) => {
    const absolute = path.isAbsolute(name) ? name : path.join(workdir, name);
    const relative = path.relative(workdir, absolute);

    if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
      throw new Error('项目快照包含工作目录之外的路径，已停止恢复。');
    }

    if (relative.split('/').some((part) => part === 'node_modules' || part === '.git')) {
      return undefined;
    }

    return { relative, entry };
  });

  for (const item of entries) {
    if (!item?.entry) continue;
    const { relative, entry } = item;

    if (entry.type === 'folder') {
      await fs.mkdir(relative, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(relative), { recursive: true });
      await fs.writeFile(relative, entry.isBinary ? Buffer.from(entry.content, 'base64') : entry.content);
    }
  }
}
