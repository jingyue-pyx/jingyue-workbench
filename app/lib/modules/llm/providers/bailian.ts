import { BaseProvider } from '~/lib/modules/llm/base-provider';
import { createOpenAI } from '@ai-sdk/openai';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

export default class BailianProvider extends BaseProvider {
  name = 'Bailian';
  getApiKeyLink = 'https://bailian.console.aliyun.com/';
  labelForGetApiKey = '阿里云百炼控制台';

  config = {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    baseUrlKey: 'DASHSCOPE_BASE_URL',
    apiTokenKey: 'DASHSCOPE_API_KEY',
  };

  // No /models probe is required. Availability depends on the user's region and workspace.
  staticModels: ModelInfo[] = [
    { name: 'qwen3-coder-next', label: '百炼 · Qwen3 Coder Next', provider: 'Bailian', maxTokenAllowed: 16000 },
    { name: 'qwen-plus', label: '百炼 · Qwen Plus', provider: 'Bailian', maxTokenAllowed: 8000 },
  ];

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys: options.apiKeys,
      providerSettings: options.providerSettings?.[this.name],
      serverEnv: options.serverEnv as unknown as Record<string, string>,
      defaultBaseUrlKey: 'DASHSCOPE_BASE_URL',
      defaultApiTokenKey: 'DASHSCOPE_API_KEY',
    });

    if (!apiKey || !baseUrl) {
      throw new Error('请先在本机配置阿里云百炼 API Key；接口地址必须与密钥地域、业务空间一致。');
    }

    const endpoint = new URL(baseUrl);

    if (endpoint.protocol !== 'https:') {
      throw new Error('百炼接口必须使用 HTTPS，避免明文传输密钥。');
    }

    // Bailian supports stream_options.include_usage; strict mode asks the SDK to request it.
    return createOpenAI({ baseURL: baseUrl, apiKey, compatibility: 'strict' })(options.model);
  }
}
