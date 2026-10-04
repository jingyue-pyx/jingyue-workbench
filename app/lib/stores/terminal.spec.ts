import { expect, it, vi } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import type { ITerminal } from '~/types/terminal';
vi.mock('~/utils/shell', () => ({ newBoltShellProcess: () => ({ init: vi.fn() }), newShellProcess: vi.fn() }));
import { newShellProcess } from '~/utils/shell';
import { TerminalStore } from './terminal';

it('starts collapsed and removes only the closed user terminal process', async () => {
  const first = { kill: vi.fn(), resize: vi.fn() };
  const second = { kill: vi.fn(), resize: vi.fn() };
  vi.mocked(newShellProcess)
    .mockResolvedValueOnce(first as never)
    .mockResolvedValueOnce(second as never);

  const store = new TerminalStore(Promise.resolve({} as WebContainer));
  expect(store.showTerminal.get()).toBe(false);

  const a = {} as ITerminal;
  await store.attachTerminal(a);
  await store.attachTerminal({} as ITerminal);
  store.detachTerminal(a);
  store.onTerminalResize(80, 24);
  expect(first.kill).toHaveBeenCalledOnce();
  expect(first.resize).not.toHaveBeenCalled();
  expect(second.kill).not.toHaveBeenCalled();
  expect(second.resize).toHaveBeenCalledWith({ cols: 80, rows: 24 });
});

it('kills a late-created terminal after it was closed during startup', async () => {
  let finish!: (value: never) => void;
  vi.mocked(newShellProcess).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );

  const store = new TerminalStore(Promise.resolve({} as WebContainer));
  const terminal = {} as ITerminal;
  const pending = store.attachTerminal(terminal);
  await Promise.resolve();
  store.detachTerminal(terminal);

  const process = { kill: vi.fn() };
  finish(process as never);
  await pending;
  expect(process.kill).toHaveBeenCalledOnce();
});
