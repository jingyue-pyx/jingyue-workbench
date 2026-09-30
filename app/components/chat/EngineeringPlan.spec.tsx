// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  // Remix injects the development refresh guard into TSX modules in jsdom.
  Object.assign(window, { __vite_plugin_react_preamble_installed__: true });
});
import { parsePlan } from '~/lib/runtime/managed/protocol';
import { EngineeringPlan } from './EngineeringPlan';

afterEach(cleanup);

const base = { goal: '演示页面', steps: ['实现', '验证'], supported: true };
describe('engineering plan interactions', () => {
  it('shows boundaries and requires an explicit click to confirm', () => {
    const confirm = vi.fn();
    render(
      <EngineeringPlan plan={parsePlan(JSON.stringify(base))} reviewing ready onConfirm={confirm} onAdjust={vi.fn()} />,
    );
    expect(screen.getByText(/不自动创建或部署业务后端/)).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认方案，开始生成' }));
    expect(confirm).toHaveBeenCalledWith(undefined);
  });
  it('does not preselect answers and sends the actual user choice', () => {
    const confirm = vi.fn();
    const plan = parsePlan(
      JSON.stringify({
        ...base,
        questions: [
          {
            id: 'layout',
            title: '布局',
            options: [
              { id: 'table', label: '表格', description: '信息密集' },
              { id: 'cards', label: '卡片', description: '突出概览' },
            ],
          },
        ],
      }),
    );
    render(<EngineeringPlan plan={plan} reviewing ready onConfirm={confirm} onAdjust={vi.fn()} />);

    const submit = screen.getByRole('button', { name: '用这些选择更新方案' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /卡片/ }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(confirm).toHaveBeenCalledWith({ layout: 'cards' });
  });
  it('blocks confirmation before the plan record is saved', () => {
    render(
      <EngineeringPlan
        plan={parsePlan(JSON.stringify(base))}
        reviewing
        ready={false}
        onConfirm={vi.fn()}
        onAdjust={vi.fn()}
      />,
    );
    expect((screen.getByRole('button', { name: '确认方案，开始生成' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps technical details collapsed, and adjustment does not approve', () => {
    const confirm = vi.fn();
    const adjust = vi.fn();
    const { container } = render(
      <EngineeringPlan plan={parsePlan(JSON.stringify(base))} reviewing ready onConfirm={confirm} onAdjust={adjust} />,
    );
    expect(container.querySelector('details')?.open).toBe(false);
    expect(screen.queryByText('任务未通过')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '调整需求' }));
    expect(screen.getByRole('textbox', { name: '你想调整哪些地方？' })).toBeTruthy();
    expect(adjust).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('requires feedback, submits it once, and never approves the revised plan automatically', () => {
    const adjust = vi.fn();
    const confirm = vi.fn();
    render(
      <EngineeringPlan plan={parsePlan(JSON.stringify(base))} reviewing ready onConfirm={confirm} onAdjust={adjust} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '调整需求' }));

    const submit = screen.getByRole('button', { name: '提交调整，更新方案' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  增加预算字段  ' } });
    fireEvent.click(submit);
    expect(adjust).toHaveBeenCalledOnce();
    expect(adjust).toHaveBeenCalledWith('增加预算字段');
    expect(confirm).not.toHaveBeenCalled();
  });
  it('can return to the unchanged plan without submitting feedback', () => {
    const adjust = vi.fn();
    render(
      <EngineeringPlan plan={parsePlan(JSON.stringify(base))} reviewing ready onConfirm={vi.fn()} onAdjust={adjust} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '调整需求' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留这个草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '返回原方案' }));
    expect(screen.getByRole('button', { name: '确认方案，开始生成' })).toBeTruthy();
    expect(adjust).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '调整需求' }));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('保留这个草稿');
  });
});
