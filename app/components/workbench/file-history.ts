import { diffLines } from 'diff';
import type { FileHistory } from '~/types/actions';
import type { FileMap } from '~/lib/stores/files';

// Session-only change tracking. The first loaded snapshot is a baseline, not an edit.
export function recordFileChanges(
  before: FileMap,
  after: FileMap,
  history: Record<string, FileHistory>,
  now = Date.now(),
) {
  let result = history;

  for (const [path, file] of Object.entries(after)) {
    if (file?.type !== 'file' || file.isBinary || file.content.length > 1024 * 1024) {
      continue;
    }

    const previous = before[path];

    if (previous?.type !== 'file' || previous.isBinary || previous.content === file.content) {
      continue;
    }

    const entry = history[path];
    const originalContent = entry?.originalContent ?? previous.content;

    if (result === history) {
      result = { ...history };
    }

    if (originalContent === file.content) {
      delete result[path];
      continue;
    }

    result[path] = {
      originalContent,
      lastModified: now,
      changes: diffLines(originalContent, file.content),
      versions: [...(entry?.versions || []), { timestamp: now, content: file.content }].slice(-10),
      changeSource: 'external',
    };
  }

  return result;
}

export function filterFileChanges(history: Record<string, FileHistory>, query: string) {
  const needle = query.trim().toLowerCase();
  return Object.entries(history).filter(([path]) => path.toLowerCase().includes(needle));
}
