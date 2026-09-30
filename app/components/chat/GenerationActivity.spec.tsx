// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
import { GenerationActivity } from './GenerationActivity';
import { recordWrittenFile, runActivity } from '~/lib/runtime/managed/activity';

afterEach(cleanup);
describe('inline generation feedback', () => {
  it('does not describe the sandbox preflight as model thinking', () => {
    render(<GenerationActivity phase="planning" checkingRuntime activity={{ receivedChars: 0, files: [] }} />);
    expect(screen.getByRole('status').textContent).toContain('尚未开始写入代码');
    expect(screen.getByRole('status').textContent).not.toContain('正在思考');
  });
  it('shows real received output but does not claim any files were written', () => {
    render(<GenerationActivity phase="generating" activity={{ receivedChars: 2000, files: [] }} />);
    expect(screen.getByRole('status').textContent).toContain('正在生成代码');
    expect(screen.getByText(/完整检查后写入文件/)).toBeTruthy();
    expect(screen.queryByText(/已新增/)).toBeNull();
  });
  it('shows per-file writes once, preserving creation status across repair', () => {
    runActivity.set({ receivedChars: 0, files: [] });
    recordWrittenFile('src/New.tsx', false);
    recordWrittenFile('src/New.tsx', true);
    recordWrittenFile('src/App.tsx', true);
    render(<GenerationActivity phase="applying" activity={runActivity.get()} />);
    expect(screen.getByText('已新增 1 个文件，更新 1 个文件')).toBeTruthy();
    expect(screen.getByText('src/New.tsx')).toBeTruthy();
  });
  it.each(['idle', 'reviewing', 'failed', 'succeeded', 'cancelled'] as const)(
    'does not show a misleading active spinner for %s',
    (phase) => {
      render(<GenerationActivity phase={phase} activity={{ receivedChars: 0, files: [] }} />);
      expect(screen.queryByRole('status')).toBeNull();
    },
  );
});
