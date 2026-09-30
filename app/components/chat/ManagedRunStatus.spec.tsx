// @vitest-environment jsdom
import { atom } from 'nanostores';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { RunState } from '~/lib/runtime/managed/protocol';
vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
vi.mock('~/lib/runtime/managed/session', () => ({
  runState: atom({
    id: '',
    phase: 'idle',
    detail: '',
    events: [],
    errors: [],
    changed: [],
    attempt: 0,
    maxRepairs: 2,
    startedAt: 0,
  }),
  planReviewReady: atom(false),
  stopManagedRun: vi.fn(),
  verifyRestoredProject: vi.fn(),
  restoreBeforeRun: vi.fn(),
  confirmManagedPlan: vi.fn(),
  adjustManagedPlan: vi.fn(),
}));
import { runState } from '~/lib/runtime/managed/session';
import { ManagedRunStatus } from './ManagedRunStatus';
afterEach(cleanup);
it('shows no idle technical task panel', () => {
  runState.set({ ...runState.get(), id: '', phase: 'idle' });

  const { container } = render(<ManagedRunStatus />);
  expect(container.textContent).toBe('');
});
it('does not render failure details, repair counters or execution records', () => {
  runState.set({
    ...runState.get(),
    id: 'fixture',
    phase: 'failed',
    detail: 'private diagnostic',
    events: [{ phase: 'failed', detail: 'private diagnostic', at: 1 }],
  } as RunState);

  const { container } = render(<ManagedRunStatus />);
  expect(container.textContent).not.toMatch(/任务未通过|private diagnostic|执行记录|2 轮/);
  expect(container.textContent).toBe('');
});
it('does not introduce an extra running panel outside the existing chat controls', () => {
  runState.set({ ...runState.get(), phase: 'building', detail: 'private diagnostic' });
  render(<ManagedRunStatus />);
  expect(screen.queryByRole('status')).toBeNull();
});
