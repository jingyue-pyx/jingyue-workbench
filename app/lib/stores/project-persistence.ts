import { atom } from 'nanostores';

export const projectPersistence = atom<'idle' | 'saving' | 'saved' | 'local' | 'conflict' | 'deleted' | 'error'>(
  'idle',
);
