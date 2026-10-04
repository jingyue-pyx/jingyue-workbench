// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderInfo } from '~/types/model';

vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
vi.mock('~/lib/auth/account-cookies', () => ({ default: { get: () => undefined, set: vi.fn() } }));
import { APIKeyManager } from './APIKeyManager';

const provider = { name: 'Bailian', getApiKeyLink: 'https://example.invalid/keys' } as ProviderInfo;
const ok = (isSet: boolean) => ({ ok: true, json: async () => ({ isSet }) });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('platform model status on template and chat entry', () => {
  it('shows server configuration without filling a personal key or asking the user to obtain one', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok(true));
    const setApiKey = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    render(<APIKeyManager provider={provider} apiKey="" setApiKey={setApiKey} />);
    expect(await screen.findByText('平台已配置，无需填写')).toBeTruthy();
    expect(screen.queryByTitle('Get API Key')).toBeNull();
    expect(setApiKey.mock.calls.every(([key]) => key === '')).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/check-env-key?provider=Bailian',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('does not mistake an unavailable endpoint for an absent key and allows retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce(ok(true)));
    render(<APIKeyManager provider={provider} apiKey="" setApiKey={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '暂未获取模型配置，点击重试' }));
    expect(await screen.findByText('平台已配置，无需填写')).toBeTruthy();
    expect(screen.queryByText('尚未配置，请设置密钥')).toBeNull();
  });

  it('rechecks configuration after navigation instead of retaining a false module cache', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(ok(false)).mockResolvedValueOnce(ok(true));
    vi.stubGlobal('fetch', fetcher);

    const first = render(<APIKeyManager provider={provider} apiKey="" setApiKey={vi.fn()} />);
    expect(await screen.findByText('尚未配置，请设置密钥')).toBeTruthy();
    first.unmount();
    render(<APIKeyManager provider={provider} apiKey="" setApiKey={vi.fn()} />);
    expect(await screen.findByText('平台已配置，无需填写')).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed configuration responses rather than treating a truthy value as configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ isSet: 'true' }) }));
    render(<APIKeyManager provider={provider} apiKey="" setApiKey={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '暂未获取模型配置，点击重试' })).toBeTruthy();
    expect(screen.queryByText('平台已配置，无需填写')).toBeNull();
  });

  it('does not let a slow response from the old provider overwrite the current status', async () => {
    let finishOld!: (value: unknown) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            finishOld = r;
          }),
      )
      .mockResolvedValueOnce(ok(false));
    vi.stubGlobal('fetch', fetcher);

    const view = render(<APIKeyManager provider={provider} apiKey="" setApiKey={vi.fn()} />);
    view.rerender(<APIKeyManager provider={{ name: 'Other' } as ProviderInfo} apiKey="" setApiKey={vi.fn()} />);
    expect(await screen.findByText('尚未配置，请设置密钥')).toBeTruthy();
    finishOld(ok(true));
    await waitFor(() => expect(screen.queryByText('平台已配置，无需填写')).toBeNull());
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
