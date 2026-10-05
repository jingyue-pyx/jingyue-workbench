// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  Object.assign(window, { __vite_plugin_react_preamble_installed__: true });
  return { request: vi.fn() };
});
vi.mock('~/lib/publishing/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('~/lib/publishing/client')>()),
  publishRequest: mock.request,
}));
import { NetlifyConnectionSettings } from './NetlifyConnectionSettings';

beforeEach(() => mock.request.mockReset());
afterEach(cleanup);

it('keeps a disabled connection entry visible when the platform is not configured', async () => {
  mock.request.mockResolvedValue({ enabled: false, connected: false });
  render(<NetlifyConnectionSettings />);
  await screen.findByText('平台暂未启用 Netlify 连接');
  expect((screen.getByRole('button', { name: '连接 Netlify 账号' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/你无需创建 OAuth 应用/)).toBeTruthy();
  expect(document.querySelector('input')).toBeNull();
  expect(mock.request.mock.calls).toEqual([[]]);
  mock.request.mockResolvedValue({ enabled: true, connected: false });
  fireEvent.click(screen.getByRole('button', { name: '重新检查连接' }));
  await screen.findByText('尚未连接你的 Netlify 账号');
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '连接 Netlify 账号' }) as HTMLButtonElement).disabled).toBe(false),
  );
});

it('connects without a project, sandbox, build or publish call and only after explicit consent check', async () => {
  let connected = false;
  let authorized = false;
  mock.request.mockImplementation(async (body) => {
    if (!body) {
      return { enabled: true, connected, displayName: 'Example' };
    }

    if (body.action === 'connect') {
      return {
        attemptId: 'attempt',
        authorizeUrl: 'https://app.netlify.com/authorize?response_type=ticket&ticket=demo',
      };
    }

    if (body.action === 'authorize') {
      connected = authorized;
      return { pending: !authorized };
    }

    throw new Error('Must not publish or inspect projects from account settings');
  });
  render(<NetlifyConnectionSettings />);

  const connect = await screen.findByRole('button', { name: '连接 Netlify 账号' });
  await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false));
  expect(mock.request.mock.calls).toEqual([[]]);
  fireEvent.click(connect);

  const link = await screen.findByRole('link', { name: '打开 Netlify 官方授权页 ↗' });
  expect(link.getAttribute('href')).toBe('https://app.netlify.com/authorize?response_type=ticket&ticket=demo');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(screen.queryByText('已连接 · Example')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '我已授权，检查连接' }));
  await screen.findByText('尚未收到授权，请先在 Netlify 完成确认。');
  authorized = true;
  fireEvent.click(screen.getByRole('button', { name: '我已授权，检查连接' }));
  await screen.findByText('已连接 · Example');
  expect(screen.queryByRole('link', { name: '打开 Netlify 官方授权页 ↗' })).toBeNull();
});

it('requires a second explicit choice before disconnecting and preserves published websites', async () => {
  let connected = true;
  mock.request.mockImplementation(async (body) => {
    if (!body) {
      return { enabled: true, connected, displayName: 'Example' };
    }

    if (body.action === 'disconnect') {
      connected = false;
      return { message: '授权已断开，网站未删除。' };
    }

    throw new Error('Unexpected action');
  });
  render(<NetlifyConnectionSettings />);
  await screen.findByText('已连接 · Example');
  fireEvent.click(screen.getByRole('button', { name: '断开连接' }));
  expect(screen.getByText(/不会删除已发布的网站/)).toBeTruthy();
  expect(mock.request.mock.calls).toEqual([[]]);
  fireEvent.click(screen.getByRole('button', { name: '保留连接' }));
  expect(screen.queryByRole('button', { name: '确认断开' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '断开连接' }));
  fireEvent.click(screen.getByRole('button', { name: '确认断开' }));
  await screen.findByText('尚未连接你的 Netlify 账号');
  expect(mock.request.mock.calls.filter(([body]) => body?.action === 'disconnect')).toHaveLength(1);
});

it('offers retry after status failure without auto starting authorization', async () => {
  mock.request.mockRejectedValueOnce(new Error('网络暂不可用')).mockResolvedValue({ enabled: true, connected: false });
  render(<NetlifyConnectionSettings />);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '网络暂不可用');
  fireEvent.click(screen.getByRole('button', { name: '重试连接检查' }));
  await screen.findByText('尚未连接你的 Netlify 账号');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mock.request.mock.calls).toEqual([[], []]);
});

it('does not render an authorization URL outside Netlify', async () => {
  mock.request.mockImplementation(async (body) =>
    !body
      ? { enabled: true, connected: false }
      : {
          attemptId: 'attempt',
          authorizeUrl: 'https://app.netlify.com.evil.example/authorize?response_type=ticket&ticket=demo',
        },
  );
  render(<NetlifyConnectionSettings />);

  const connect = await screen.findByRole('button', { name: '连接 Netlify 账号' });
  await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(connect);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '授权地址无效，未打开页面，请重新检查连接。');
  expect(screen.queryByRole('link')).toBeNull();
});

it('deduplicates rapid clicks while an authorization request is pending', async () => {
  let finish!: (value: object) => void;
  mock.request.mockImplementation((body) =>
    !body
      ? Promise.resolve({ enabled: true, connected: false })
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  render(<NetlifyConnectionSettings />);

  const connect = await screen.findByRole('button', { name: '连接 Netlify 账号' });
  await waitFor(() => expect((connect as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(connect);
  fireEvent.click(connect);
  expect(mock.request.mock.calls.filter(([body]) => body?.action === 'connect')).toHaveLength(1);
  finish({ attemptId: 'attempt', authorizeUrl: 'https://app.netlify.com/authorize?response_type=ticket&ticket=demo' });
  await screen.findByRole('link', { name: '打开 Netlify 官方授权页 ↗' });
});
