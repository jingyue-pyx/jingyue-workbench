// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderInfo } from '~/types/model';
import type { ModelInfo } from '~/lib/modules/llm/types';

vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
vi.mock('~/lib/auth/account-cookies', () => ({ default: { get: () => undefined, set: vi.fn() } }));
import { SendButton } from './SendButton.client';
import { ModelSelector } from './ModelSelector';
import { APIKeyManager } from './APIKeyManager';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('workbench presentation preserves controls', () => {
  it('reconciles an unsupported saved provider/model pair to the server catalog', async () => {
    const setProvider = vi.fn();
    const setModel = vi.fn();
    const provider = { name: 'Bailian' } as ProviderInfo;
    render(
      <ModelSelector
        provider={{ name: 'Anthropic' } as ProviderInfo}
        model="claude"
        providerList={[provider]}
        modelList={[{ name: 'qwen', label: '百炼', provider: 'Bailian' } as ModelInfo]}
        setProvider={setProvider}
        setModel={setModel}
        apiKeys={{}}
      />,
    );
    await waitFor(() => expect(setProvider).toHaveBeenCalledWith(provider));
    expect(setModel).toHaveBeenCalledWith('qwen');
    fireEvent.click(screen.getByRole('combobox', { name: '模型服务商' }));
    expect(screen.queryByRole('option', { name: 'Anthropic' })).toBeNull();
  });
  it('labels and dispatches send without submitting an outer form', () => {
    const send = vi.fn();
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <SendButton show onClick={send} />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
  });

  it('preserves the stop action and disabled protection', () => {
    const stop = vi.fn();
    const { rerender } = render(<SendButton show isStreaming onClick={stop} />);
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    expect(stop).toHaveBeenCalledTimes(1);
    rerender(<SendButton show isStreaming disabled onClick={stop} />);
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps both searchable model selectors and dispatches the selection', () => {
    const provider = { name: 'TestProvider' } as ProviderInfo;
    const models = [
      { name: 'model-one', label: '模型一', provider: provider.name },
      { name: 'model-two', label: '模型二', provider: provider.name },
    ] as ModelInfo[];
    const select = vi.fn();
    render(
      <ModelSelector
        provider={provider}
        providerList={[provider]}
        model="model-one"
        modelList={models}
        setModel={select}
        apiKeys={{}}
      />,
    );
    expect(screen.getByRole('combobox', { name: '模型服务商' })).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: '生成模型' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search models' }), { target: { value: '模型二' } });
    fireEvent.click(screen.getByRole('option', { name: '模型二' }));
    expect(select).toHaveBeenCalledWith('model-two');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('explains server configuration without removing the existing key edit control', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ isSet: true })));
    render(
      <APIKeyManager provider={{ name: 'ConfiguredTestProvider' } as ProviderInfo} apiKey="" setApiKey={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText('平台已配置，无需填写')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit API Key' }));

    const input = screen.getByLabelText('ConfiguredTestProvider API Key') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});
