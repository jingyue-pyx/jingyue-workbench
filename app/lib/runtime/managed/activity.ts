import { atom } from 'nanostores';

export interface RunActivity {
  receivedChars: number;
  files: { path: string; kind: 'created' | 'updated' }[];
}

// Transient UI feedback, never a substitute for the verified task result.
export const runActivity = atom<RunActivity>({ receivedChars: 0, files: [] });

export function recordWrittenFile(path: string, existed: boolean) {
  const current = runActivity.get();

  if (current.files.some((file) => file.path === path)) {
    return;
  }

  runActivity.set({
    ...current,
    files: [...current.files, { path, kind: existed ? 'updated' : 'created' }],
  });
}
