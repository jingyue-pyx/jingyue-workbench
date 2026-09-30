// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from 'ai';

const mocks = vi.hoisted(() => {
  Object.assign(window, { __vite_plugin_react_preamble_installed__: true });
  return { artifact: vi.fn(() => null) };
});
vi.mock('./Artifact', () => ({ Artifact: mocks.artifact }));
vi.mock('./CodeBlock', () => ({ CodeBlock: ({ code }: { code: string }) => <pre>{code}</pre> }));
import { ProjectLoadingView } from './ProjectLoadingView';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const messages: Message[] = [
  { id: 'user', role: 'user', content: '做一个采购管理页面' },
  { id: 'assistant', role: 'assistant', content: '已完成表单和采购列表。' },
];

describe('read-only progressive project loading', () => {
  it('explains the stages without guessing that the database is asleep', () => {
    render(<ProjectLoadingView onRetry={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('正在恢复会话');
    expect(screen.getByText('先加载历史对话，再恢复代码与预览。')).toBeTruthy();
    expect(screen.queryByLabelText('代码与预览恢复')).toBeNull();
    expect(document.body.textContent).not.toContain('数据库');
  });

  it('displays conversation with a separate code/preview placeholder and no editing controls', () => {
    render(<ProjectLoadingView messages={messages} onRetry={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('会话已恢复，正在加载代码');
    expect(screen.getByText('做一个采购管理页面')).toBeTruthy();
    expect(screen.getByText('已完成表单和采购列表。')).toBeTruthy();
    expect(screen.getByLabelText('代码与预览恢复').textContent).toContain('正在恢复源码与运行环境');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps conversation readable after source loading fails and offers an explicit retry', () => {
    const retry = vi.fn();
    render(<ProjectLoadingView messages={messages} error="运行环境恢复超时" onRetry={retry} />);
    expect(screen.getByRole('alert').textContent).toContain('会话已恢复，代码暂未加载');
    expect(screen.getByText('已完成表单和采购列表。')).toBeTruthy();
    expect(screen.getByText('运行环境恢复超时')).toBeTruthy();
    expect(retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('distinguishes failure to fetch conversation from failure to restore code', () => {
    render(<ProjectLoadingView error="请重新登录" onRetry={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('会话暂未恢复');
    expect(screen.queryByLabelText('代码与预览恢复')).toBeNull();
  });

  it('never mounts historical action controls and hides internal messages', () => {
    const stored: Message[] = [
      { id: 'hidden', role: 'user', content: 'internal restore', annotations: ['hidden'] },
      {
        id: 'raw',
        role: 'assistant',
        content:
          '代码已保存。<boltArtifact><boltAction type="shell">npm install test-canary</boltAction></boltArtifact>',
      },
      { id: 'rendered', role: 'assistant', content: '<div class="__boltArtifact__" data-message-id="raw"></div>' },
    ];
    render(<ProjectLoadingView messages={stored} onRetry={vi.fn()} />);
    expect(document.body.textContent).not.toContain('internal restore');
    expect(document.body.textContent).not.toContain('npm install test-canary');
    expect(document.body.textContent).toContain('源码文件将在右侧恢复');
    expect(mocks.artifact).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
    expect(stored[1].content).toContain('npm install test-canary');
  });
});
