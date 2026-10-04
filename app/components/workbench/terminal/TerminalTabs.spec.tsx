// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { atom } from 'nanostores';
import { forwardRef } from 'react';
vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
vi.mock('react-resizable-panels', () => ({ Panel: forwardRef(({ children }: any, _ref) => <div>{children}</div>) }));
vi.mock('./Terminal', () => ({
  Terminal: forwardRef(({ id, className }: any, _ref) => <div className={className} data-testid={id} />),
}));
vi.mock('~/lib/stores/theme', () => ({ themeStore: atom('light') }));
vi.mock('~/lib/hooks', () => ({ shortcutEventEmitter: { on: () => () => undefined } }));
vi.mock('~/lib/stores/workbench', () => ({ workbenchStore: { showTerminal: atom(false), toggleTerminal: vi.fn() } }));
import { TerminalTabs } from './TerminalTabs';
afterEach(cleanup);
it('mounts one managed log, creates optional terminals on demand, closes the selected terminal', () => {
  render(<TerminalTabs />);
  expect(screen.getAllByTestId(/terminal_/)).toHaveLength(1);
  expect(screen.getByRole('button', { name: '运行日志' })).toBeTruthy();
  fireEvent.click(screen.getByTitle('新建浏览器终端'));
  fireEvent.click(screen.getByTitle('新建浏览器终端'));
  expect(screen.getAllByTestId(/terminal_/)).toHaveLength(3);
  fireEvent.click(screen.getByTitle('关闭终端 2'));
  expect(screen.queryByTestId('terminal_2')).toBeNull();
  expect(screen.getByTestId('terminal_0').classList.contains('hidden')).toBe(false);
  fireEvent.click(screen.getByTitle('关闭终端 1'));
  expect(screen.getAllByTestId(/terminal_/)).toHaveLength(1);
});
