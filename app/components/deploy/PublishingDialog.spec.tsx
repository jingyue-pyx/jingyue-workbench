// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  Object.assign(window, { __vite_plugin_react_preamble_installed__: true });

  const project = {
    projectId: 'ad3474eb-d6ad-4a30-8bc4-c3247b2a608a',
    revision: 1,
    state: 'cloud',
    document: { snapshot: { files: {} } },
  };

  return { project, request: vi.fn(), build: vi.fn(), unsaved: new Set<string>(), streaming: false };
});
vi.mock('@nanostores/react', () => ({ useStore: (store: { get: () => unknown }) => store.get() }));
vi.mock('~/lib/persistence/projects', () => ({ activeProjectState: { get: () => mock.project } }));
vi.mock('~/lib/stores/workbench', () => ({ workbenchStore: { unsavedFiles: { get: () => mock.unsaved } } }));
vi.mock('~/lib/stores/streaming', () => ({ streamingState: { get: () => mock.streaming } }));
vi.mock('~/lib/webcontainer', () => ({ webcontainer: Promise.resolve({}) }));
vi.mock('~/lib/publishing/build', () => ({ buildPublishArtifacts: mock.build }));
vi.mock('~/lib/publishing/client', () => ({
  publishRequest: mock.request,
  PUBLISH_PHASES: { idle: '尚未发布', published: '已发布，公网访问已验证', uploading: '正在上传' },
}));
import { PublishingDialog } from './PublishingDialog.client';

beforeEach(() => {
  mock.unsaved.clear();
  mock.streaming = false;
  mock.project.state = 'cloud';
  mock.request.mockReset();
  mock.build.mockReset();
  mock.build.mockResolvedValue([{ path: 'index.html', base64: 'eA==' }]);
});
afterEach(cleanup);

function connected() {
  mock.request.mockImplementation(async (body) => {
    if (!body) {
      return { enabled: true, connected: true, displayName: 'Test user' };
    }

    if (body.action === 'teams') {
      return { teams: [{ id: 'team1', slug: 'team-one', name: 'Team one' }] };
    }

    if (body.action === 'job') {
      return { phase: 'idle' };
    }

    if (body.action === 'prepare') {
      return { id: 'job1', phase: 'prepared' };
    }

    if (body.action === 'advance') {
      return { id: 'job1', phase: 'published', url: 'https://test.netlify.app' };
    }

    throw new Error('Unexpected action');
  });
}

const open = () => {
  render(<PublishingDialog />);
  fireEvent.click(screen.getByRole('button', { name: '发布网站' }));
};

describe('account-mode publishing interaction', () => {
  it('clearly disables unconfigured integration instead of offering token fields', async () => {
    mock.request.mockResolvedValue({ enabled: false, connected: false, message: '管理员尚未配置发布。' });
    open();
    expect(await screen.findByText('管理员尚未配置发布。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '连接 Netlify 账号' })).toBeNull();
    expect(document.querySelector('input[type=password]')).toBeNull();
  });
  it('requires explicit public confirmation and a saved project before building', async () => {
    connected();
    open();
    await screen.findByText('已连接 · Test user');

    const publish = await screen.findByRole('button', { name: '构建并发布已保存版本' });
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
    expect(mock.build).not.toHaveBeenCalled();
    fireEvent.click(publish);
    await screen.findByText('已发布，公网访问已验证');
    expect(mock.request).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'prepare', confirmPublic: true, revision: 1, teamId: 'team1' }),
    );
    expect(mock.build).toHaveBeenCalledTimes(1);
  });
  it('does not upload when local build fails and shows the actual stage', async () => {
    connected();
    mock.build.mockRejectedValue(new Error('安装发布依赖失败，未上传。'));
    open();
    await screen.findByText('已连接 · Test user');
    fireEvent.click(screen.getByRole('checkbox'));

    const publish = screen.getByRole('button', { name: '构建并发布已保存版本' });
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(publish);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '安装发布依赖失败，未上传。');
    expect(mock.request.mock.calls.some(([body]) => body?.action === 'prepare')).toBe(false);
  });
  it('leaves dirty projects disabled even after confirmation', async () => {
    connected();
    mock.unsaved.add('src/App.tsx');
    open();
    await screen.findByText('已连接 · Test user');
    fireEvent.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('button', { name: '构建并发布已保存版本' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('explains private-default access without automatically changing site protection', async () => {
    connected();

    const request = mock.request.getMockImplementation()!;
    mock.request.mockImplementation((body) =>
      body?.action === 'job'
        ? Promise.resolve({ phase: 'access_unverified', manageUrl: 'https://app.netlify.com/projects/site1/overview' })
        : request(body),
    );
    open();
    expect(await screen.findByText(/不会自动关闭访问保护/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '打开 Netlify 项目设置 ↗' }).getAttribute('href')).toBe(
      'https://app.netlify.com/projects/site1/overview',
    );
    expect(mock.request.mock.calls.some(([body]) => body?.action === 'advance')).toBe(false);
  });
  it('stopping a build keeps remote data and shows a clear message, not a raw AbortError', async () => {
    connected();
    mock.build.mockImplementation(
      (_container, _snapshot, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    open();
    await screen.findByText('已连接 · Test user');
    fireEvent.click(screen.getByRole('checkbox'));

    const publish = screen.getByRole('button', { name: '构建并发布已保存版本' });
    await waitFor(() => expect((publish as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(publish);
    fireEvent.click(await screen.findByRole('button', { name: '停止本机操作' }));
    expect(await screen.findByText('已停止本机后续操作；已提交的远端发布未删除，可以稍后继续查询。')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mock.request.mock.calls.some(([body]) => body?.action === 'prepare')).toBe(false);
  });
  it('opens only the official authorization link and explicitly checks consent', async () => {
    mock.request.mockImplementation(async (body) => {
      if (!body) {
        return { enabled: true, connected: false };
      }

      if (body.action === 'job') {
        return { phase: 'idle' };
      }

      if (body.action === 'connect') {
        return {
          attemptId: 'attempt1',
          authorizeUrl: 'https://app.netlify.com/authorize?response_type=ticket&ticket=test',
        };
      }

      if (body.action === 'authorize') {
        return { pending: true };
      }

      throw new Error('Unexpected action');
    });
    open();

    const connect = await screen.findByRole('button', { name: '连接 Netlify 账号' });
    expect(screen.getByText(/并非仅限当前站点/)).toBeTruthy();
    await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(connect);
    expect((await screen.findByRole('link', { name: '打开 Netlify 官方授权页 ↗' })).getAttribute('rel')).toBe(
      'noopener noreferrer',
    );
    fireEvent.click(screen.getByRole('button', { name: '我已授权，检查连接' }));
    expect(await screen.findByText('尚未收到授权，请先在 Netlify 完成确认。')).toBeTruthy();
    expect(mock.build).not.toHaveBeenCalled();
  });
});
