import { atom } from 'nanostores';

export type BootStatus = 'loading' | 'slow' | 'ready' | 'error';
export const webcontainerBootStatus = atom<BootStatus>('loading');

/*
 * The SDK can wait indefinitely for its remote iframe handshake. Report a slow
 * startup without rejecting the shared promise or interrupting a late success.
 */
export function monitorBoot<T>(boot: Promise<T>, update: (status: BootStatus) => void, delay = 30_000) {
  update('loading');

  const timer = setTimeout(() => update('slow'), delay);
  void boot.then(
    () => {
      clearTimeout(timer);
      update('ready');
    },
    () => {
      clearTimeout(timer);
      update('error');
    },
  );
}
