// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
import { PreparationFailureNotice } from './PreparationFailureNotice';
import {
  isPreparationFailureNotice,
  LEGACY_PREPARATION_FAILURE,
  PREPARATION_FAILURE_MESSAGE,
  preparationFailureReason,
} from '~/lib/runtime/managed/failure-notice';

afterEach(cleanup);
describe('inline preparation failure guidance', () => {
  it('separates the truthful outcome, next step and sample questions without starting a task', () => {
    render(<PreparationFailureNotice />);

    const note = screen.getByRole('note', { name: '页面准备提示' });
    expect(note.textContent).toContain('这一步还没完成，当前草稿已保留');
    expect(note.textContent).toContain('继续提问');
    expect(screen.getByText('“为什么没有完成？”')).toBeTruthy();
    expect(screen.getByText('“重试上次任务”')).toBeTruthy();
    expect(screen.getByText('“我想调整……”')).toBeTruthy();
    expect(note.textContent).toContain('未完成原因：暂未定位具体原因');
    expect(note.querySelectorAll('p')).toHaveLength(4);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(note.textContent).not.toContain('已就绪');
  });
  it.each([
    ['planning', 'plan_format', '方案整理阶段：模型返回的方案格式不完整'],
    ['installing', 'timeout', '依赖安装阶段：操作超过等待时限'],
    ['previewing', 'preview_connection', '预览连接检查阶段：预览连接未成功，不能据此判断代码有错'],
    ['generating', 'model_output', '代码生成阶段：模型没有返回完整、有效的文件改动'],
  ])('shows the saved %s failure, not one fixed explanation', (stage, reason, copy) => {
    render(<PreparationFailureNotice annotations={[`managed-outcome:failed:${stage}:${reason}:0`]} />);
    expect(screen.getByRole('note').textContent).toContain(`未完成原因：${copy}。`);
  });
  it.each(['other', 'none'])('does not guess a cause for %s diagnostics', (reason) => {
    expect(preparationFailureReason([`managed-outcome:failed:generating:${reason}:0`])).toBe(
      '停在代码生成，暂未定位具体原因。',
    );
  });
  it.each([
    'managed-outcome:failed:planning:private-canary:0',
    'managed-outcome:failed:private-canary:timeout:0',
    'managed-outcome:failed:planning:timeout:0\npassword=private-canary',
    'managed-outcome:failed:constructor:timeout:0',
    'managed-outcome:succeeded:previewing:none:0',
    'managed-outcome:cancelled:planning:timeout:0',
  ])('does not invent failure details or render untrusted diagnostic content', (annotation) => {
    const reason = preparationFailureReason([annotation]);
    expect(reason).toContain('这条记录没有保留明确的失败阶段和原因');
    expect(reason).not.toContain('private-canary');
  });
  it('keeps each saved result tied to its own message', () => {
    const { rerender } = render(
      <PreparationFailureNotice annotations={['managed-outcome:failed:planning:plan_format:0']} />,
    );
    expect(screen.getByRole('note').textContent).toContain('方案格式不完整');
    rerender(<PreparationFailureNotice annotations={['managed-outcome:failed:installing:timeout:0']} />);
    expect(screen.getByRole('note').textContent).toContain('依赖安装阶段：操作超过等待时限');
    expect(screen.getByRole('note').textContent).not.toContain('方案格式不完整');
  });
  it.each([LEGACY_PREPARATION_FAILURE, PREPARATION_FAILURE_MESSAGE])(
    'styles saved and new fallback messages',
    (content) => {
      expect(isPreparationFailureNotice({ role: 'assistant', content, annotations: ['managed-run'] })).toBe(true);
      expect(
        isPreparationFailureNotice({
          role: 'assistant',
          content,
          annotations: ['managed-run', 'managed-outcome:failed:planning:plan_format:0'],
        }),
      ).toBe(true);
    },
  );
  it('does not restyle quoted user messages, ordinary answers or another outcome', () => {
    expect(
      isPreparationFailureNotice({ role: 'user', content: LEGACY_PREPARATION_FAILURE, annotations: ['managed-run'] }),
    ).toBe(false);
    expect(isPreparationFailureNotice({ role: 'assistant', content: LEGACY_PREPARATION_FAILURE })).toBe(false);
    expect(
      isPreparationFailureNotice({
        role: 'assistant',
        content: LEGACY_PREPARATION_FAILURE,
        annotations: ['managed-run', 'managed-outcome:succeeded:previewing:none:0'],
      }),
    ).toBe(false);
    expect(
      isPreparationFailureNotice({
        role: 'assistant',
        content: '依赖安装未完成：请重新检查预览。',
        annotations: ['managed-run'],
      }),
    ).toBe(false);
  });
  it('keeps stored output as readable text, without markup or automatic commands', () => {
    expect(PREPARATION_FAILURE_MESSAGE).toContain('下方继续提问');
    expect(PREPARATION_FAILURE_MESSAGE).not.toMatch(/<|onclick|boltAction/);
  });
});
