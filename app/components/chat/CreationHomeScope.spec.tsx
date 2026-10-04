// @vitest-environment jsdom
import React, { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderInfo } from '~/types/model';

vi.hoisted(() => Object.assign(window, { __vite_plugin_react_preamble_installed__: true }));
vi.mock('remix-utils/client-only', () => ({ ClientOnly: ({ children }: any) => children() }));
vi.mock('~/components/sidebar/Menu.client', () => ({ Menu: () => null }));
vi.mock('~/components/workbench/Workbench.client', () => ({
  Workbench: ({ chatStarted }: any) => <div data-testid="existing-workbench" data-started={chatStarted} />,
}));
vi.mock('./Messages.client', () => ({ Messages: () => <div>原有会话消息</div> }));
vi.mock('~/utils/constants', () => ({ PROVIDER_LIST: [], STARTER_TEMPLATES: [] }));
vi.mock('~/lib/auth/account-cookies', () => ({ default: { get: () => undefined, set: vi.fn(), remove: vi.fn() } }));
vi.mock('./APIKeyManager', () => ({
  getApiKeysFromCookies: () => ({}),
  APIKeyManager: () => <div>原有模型连接</div>,
}));
vi.mock('./ModelSelector', () => ({ ModelSelector: () => <div data-testid="model-selector">原有模型选择</div> }));
vi.mock('./chatExportAndImport/ExportChatButton', () => ({ ExportChatButton: () => <button>导出</button> }));
vi.mock('./chatExportAndImport/ImportButtons', () => ({ ImportButtons: () => <button>原有导入控件</button> }));
vi.mock('./GitCloneButton', () => ({ default: () => <button>原有仓库导入</button> }));
vi.mock('./FilePreview', () => ({ default: () => null }));
vi.mock('./SpeechRecognition', () => ({ SpeechRecognitionButton: () => null }));
vi.mock('./ScreenshotStateManager', () => ({ ScreenshotStateManager: () => null }));
vi.mock('~/components/deploy/DeployAlert', () => ({ default: () => null }));
vi.mock('./ChatAlert', () => ({ default: () => null }));
vi.mock('./ProgressCompilation', () => ({ default: () => null }));
vi.mock('~/lib/stores/settings', () => ({ LOCAL_PROVIDERS: [] }));
vi.mock('./SupabaseAlert', () => ({ SupabaseChatAlert: () => null }));
vi.mock('./SupabaseConnection', () => ({ SupabaseConnection: () => null }));
vi.mock('~/components/workbench/ExpoQrModal', () => ({ ExpoQrModal: () => null }));
vi.mock('~/lib/stores/qrCodeStore', () => ({ expoUrlAtom: null }));
vi.mock('@nanostores/react', () => ({ useStore: () => null }));
vi.mock('~/lib/api/model-catalog', () => ({
  fetchModelCatalog: vi.fn(async () => [
    { name: 'test-model', label: '测试模型', provider: 'TestProvider', maxTokenAllowed: 8000 },
  ]),
}));
vi.mock('~/lib/hooks', () => ({
  StickToBottom: Object.assign(({ children, className }: any) => <div className={className}>{children}</div>, {
    Content: ({ children }: any) => <div>{children}</div>,
  }),
  useStickToBottomContext: () => ({ isAtBottom: true }),
}));

import { BaseChat } from './BaseChat';

afterEach(cleanup);

const provider = { name: 'TestProvider' } as ProviderInfo;
const props = { provider, providerList: [provider], model: 'test-model', handleInputChange: vi.fn() };

describe('creation home is scoped to new conversations', () => {
  it('only fills the composer when a home example is selected and preserves the original send action', async () => {
    const input = vi.fn();
    const send = vi.fn();
    const textareaRef = createRef<HTMLTextAreaElement>();
    const { rerender } = render(
      <BaseChat {...props} textareaRef={textareaRef} input="已有需求" handleInputChange={input} sendMessage={send} />,
    );
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
    textareaRef.current!.scrollIntoView = vi.fn();
    fireEvent.click(screen.getByRole('button', { name: '使用供应链管理示例需求' }));
    expect(input).toHaveBeenCalledTimes(1);
    expect(input.mock.calls[0][0].target.value).toContain('已有需求\n\n参考方向：');
    expect(send).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textareaRef.current);
    rerender(
      <BaseChat
        {...props}
        textareaRef={textareaRef}
        input={input.mock.calls[0][0].target.value}
        handleInputChange={input}
        sendMessage={send}
      />,
    );
    await waitFor(() =>
      expect((screen.getByRole('button', { name: '发送需求' }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps upload, import and model settings available on the creation home', async () => {
    render(<BaseChat {...props} />);
    await waitFor(() => expect(screen.getByTestId('model-selector')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Upload file' })).toBeTruthy();
    expect(screen.getByText('原有导入控件')).toBeTruthy();
    expect(screen.getByText('原有仓库导入')).toBeTruthy();
    expect(screen.getByTestId('model-selector').parentElement?.className).toBe('hidden');
    fireEvent.click(screen.getByTitle('Model Settings'));
    expect(screen.getByTestId('model-selector').parentElement?.className).toBe('');
  });

  it('does not render home decoration, examples or altered composer sizing for an existing conversation', async () => {
    render(<BaseChat {...props} chatStarted input="继续修改" />);
    await waitFor(() => expect(screen.getByTestId('model-selector')).toBeTruthy());
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByLabelText('创作灵感与代码模板')).toBeNull();
    expect(screen.getByText('原有会话消息')).toBeTruthy();
    expect(screen.getByTestId('existing-workbench').getAttribute('data-started')).toBe('true');
    expect(screen.getByLabelText('需求输入').style.minHeight).toBe('76px');
    expect(screen.getByTestId('model-selector').parentElement?.className).toBe('');
    expect(document.querySelector('[data-chat-started]')?.className).not.toContain('HomeSurface');
  });

  it('removes home styles after the first message without replacing the preview mount', async () => {
    const { rerender } = render(<BaseChat {...props} />);
    const workbench = screen.getByTestId('existing-workbench');
    await waitFor(() => expect(screen.getByTestId('model-selector')).toBeTruthy());
    rerender(<BaseChat {...props} chatStarted />);
    expect(screen.queryByLabelText('创作灵感与代码模板')).toBeNull();
    expect(screen.getByTestId('existing-workbench')).toBe(workbench);
    expect(document.querySelector('[data-chat-started]')?.className).not.toContain('HomeSurface');
    expect(screen.getByTestId('model-selector').parentElement?.className).toBe('');
  });
});
