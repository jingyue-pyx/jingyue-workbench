// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Template } from '~/types/template';

vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
import { appendCreationExample, CREATION_EXAMPLES, CreationHomeIntro, CreationHomeLibrary } from './CreationHome';

const templates: Template[] = [
  {
    name: 'Vite React',
    label: 'React + Vite + TypeScript',
    description: 'Existing starter',
    githubRepo: 'existing-owner/react-template',
    tags: ['react', 'vite', 'typescript'],
    icon: 'i-bolt:react',
  },
];

afterEach(cleanup);

describe('new-conversation creation home', () => {
  it('keeps the existing intro animation target and gives the page one clear heading', () => {
    render(<CreationHomeIntro />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('把想法，变成可以打开的页面');
    expect(document.querySelector('#intro')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows factual examples without automatically selecting or executing one', () => {
    const select = vi.fn();
    render(<CreationHomeLibrary templates={templates} onSelectPrompt={select} />);
    expect(document.querySelector('#examples')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /示例需求$/ })).toHaveLength(4);
    expect(screen.getByRole('status').textContent).toContain('不是已生成的作品');
    expect(select).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('only returns the selected prompt and explains that sending remains a separate action', () => {
    const select = vi.fn();
    render(<CreationHomeLibrary templates={templates} onSelectPrompt={select} />);
    fireEvent.click(screen.getByRole('button', { name: '使用营销 Agent 工作台示例需求' }));
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(CREATION_EXAMPLES[0].prompt);
    expect(screen.getByRole('status').textContent).toContain('点击发送后才开始生成');
  });

  it('filters examples using keyboard-accessible pressed buttons', () => {
    render(<CreationHomeLibrary templates={templates} onSelectPrompt={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '管理工具' }));
    expect(screen.getByRole('button', { name: '管理工具' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('button', { name: /示例需求$/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '使用供应链管理示例需求' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getAllByRole('button', { name: /示例需求$/ })).toHaveLength(4);
  });

  it('preserves real starter destinations and distinguishes them from example prompts', () => {
    const select = vi.fn();
    render(<CreationHomeLibrary templates={templates} onSelectPrompt={select} />);
    fireEvent.click(screen.getByRole('button', { name: '代码模板' }));
    expect(screen.getByRole('button', { name: '代码模板' }).getAttribute('aria-pressed')).toBe('true');

    const link = screen.getByRole('link', { name: /React \+ Vite \+ TypeScript/ });
    expect(link.getAttribute('href')).toBe('/git?url=https://github.com/existing-owner/react-template.git');
    expect(screen.queryByRole('button', { name: /示例需求$/ })).toBeNull();
    expect(document.body.textContent).toContain('兼容性需单独确认');
    expect(select).not.toHaveBeenCalled();
  });

  it('handles legacy templates without optional presentation metadata', () => {
    render(
      <CreationHomeLibrary
        templates={[{ name: 'Basic', label: 'Basic', githubRepo: 'owner/basic', description: 'Basic' }]}
        onSelectPrompt={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '代码模板' }));
    expect(screen.getByRole('link', { name: /Basic/ }).textContent).toContain('开源代码模板');
  });

  it('does not accept an example while the surface is disabled', () => {
    const select = vi.fn();
    render(<CreationHomeLibrary templates={templates} onSelectPrompt={select} disabled />);
    fireEvent.click(screen.getByRole('button', { name: '使用个人作品集示例需求' }));
    expect(select).not.toHaveBeenCalled();
  });

  it('never submits an enclosing form when selecting examples or filters', () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <CreationHomeLibrary templates={templates} onSelectPrompt={vi.fn()} />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: '营销增长' }));
    fireEvent.click(screen.getByRole('button', { name: '使用营销 Agent 工作台示例需求' }));
    fireEvent.click(screen.getByRole('button', { name: '代码模板' }));
    expect(submit).not.toHaveBeenCalled();
  });
});

describe('creation examples preserve drafts', () => {
  it('fills an empty input', () => {
    expect(appendCreationExample('  ', '示例需求')).toBe('示例需求');
  });

  it('appends inspiration without deleting the user’s existing request', () => {
    expect(appendCreationExample('保留我的品牌和内容', '示例需求')).toBe('保留我的品牌和内容\n\n参考方向：示例需求');
  });

  it('does not duplicate an example on repeated clicks', () => {
    const current = appendCreationExample('我的草稿', CREATION_EXAMPLES[0].prompt);
    expect(appendCreationExample(current, CREATION_EXAMPLES[0].prompt)).toBe(current);
  });
});
