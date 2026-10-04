import React, { useState, useEffect } from 'react';
import { IconButton } from '~/components/ui/IconButton';
import type { ProviderInfo } from '~/types/model';
import Cookies from '~/lib/auth/account-cookies';

interface APIKeyManagerProps {
  provider: ProviderInfo;
  apiKey: string;
  setApiKey: (key: string) => void;
  getApiKeyLink?: string;
  labelForGetApiKey?: string;
}

const apiKeyMemoizeCache: { [k: string]: Record<string, string> } = {};

export function getApiKeysFromCookies() {
  const storedApiKeys = Cookies.get('apiKeys');
  let parsedKeys: Record<string, string> = {};

  if (storedApiKeys) {
    parsedKeys = apiKeyMemoizeCache[storedApiKeys];

    if (!parsedKeys) {
      parsedKeys = apiKeyMemoizeCache[storedApiKeys] = JSON.parse(storedApiKeys);
    }
  }

  return parsedKeys;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const APIKeyManager: React.FC<APIKeyManagerProps> = ({ provider, apiKey, setApiKey }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);
  const [envKeyStatus, setEnvKeyStatus] = useState<'checking' | 'configured' | 'missing' | 'error'>('checking');
  const [statusRetry, setStatusRetry] = useState(0);

  // Reset states and load saved key when provider changes
  useEffect(() => {
    // Load saved API key from cookies for this provider
    const savedKeys = getApiKeysFromCookies();
    const savedKey = savedKeys[provider.name] || '';

    setTempKey(savedKey);
    setApiKey(savedKey);
    setIsEditing(false);
  }, [provider.name]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setEnvKeyStatus('checking');

    /*
     * Templates use the same server-side key. Only a boolean status crosses
     * this boundary; never copy the platform secret into browser settings.
     */
    void (async () => {
      try {
        const response = await fetch(`/api/check-env-key?provider=${encodeURIComponent(provider.name)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error('Model configuration status unavailable');
        }

        const data = (await response.json()) as { isSet?: unknown };

        if (typeof data.isSet !== 'boolean') {
          throw new Error('Invalid model configuration status');
        }

        if (active) {
          setEnvKeyStatus(data.isSet ? 'configured' : 'missing');
        }
      } catch {
        if (active) {
          setEnvKeyStatus('error');
        }
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [provider.name, statusRetry]);

  const handleSave = () => {
    // Save to parent state
    setApiKey(tempKey);

    // Save to cookies
    const currentKeys = getApiKeysFromCookies();
    const newKeys = { ...currentKeys, [provider.name]: tempKey };
    Cookies.set('apiKeys', JSON.stringify(newKeys));

    setIsEditing(false);
  };

  return (
    <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-2 py-2.5 px-1">
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-xs font-medium text-bolt-elements-textSecondary">模型连接</span>
          {!isEditing && (
            <div className="flex items-center gap-2">
              {apiKey ? (
                <>
                  <div className="i-ph:check-circle-fill text-green-500 w-4 h-4" />
                  <span className="text-xs text-bolt-elements-textSecondary">已配置个人密钥</span>
                </>
              ) : envKeyStatus === 'configured' ? (
                <>
                  <div className="i-ph:check-circle-fill text-green-500 w-4 h-4" />
                  <span className="text-xs text-bolt-elements-textSecondary">平台已配置，无需填写</span>
                </>
              ) : envKeyStatus === 'checking' ? (
                <span className="text-xs text-bolt-elements-textSecondary" role="status">
                  正在检测平台模型配置…
                </span>
              ) : envKeyStatus === 'error' ? (
                <button
                  type="button"
                  className="text-xs text-bolt-elements-textSecondary underline"
                  onClick={() => setStatusRetry((value) => value + 1)}
                >
                  暂未获取模型配置，点击重试
                </button>
              ) : (
                <>
                  <div className="i-ph:x-circle-fill text-red-500 w-4 h-4" />
                  <span className="text-xs text-bolt-elements-textSecondary">尚未配置，请设置密钥</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        {isEditing ? (
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <input
              type="password"
              value={tempKey}
              placeholder="Enter API Key"
              onChange={(e) => setTempKey(e.target.value)}
              aria-label={`${provider.name} API Key`}
              className="w-[220px] max-w-full min-w-0 px-3 py-1.5 text-sm rounded border border-bolt-elements-borderColor
                        bg-bolt-elements-prompt-background text-bolt-elements-textPrimary 
                        focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
            />
            <IconButton
              onClick={handleSave}
              title="Save API Key"
              className="bg-green-500/10 hover:bg-green-500/20 text-green-500"
            >
              <div className="i-ph:check w-4 h-4" />
            </IconButton>
            <IconButton
              onClick={() => setIsEditing(false)}
              title="Cancel"
              className="bg-red-500/10 hover:bg-red-500/20 text-red-500"
            >
              <div className="i-ph:x w-4 h-4" />
            </IconButton>
          </div>
        ) : (
          <>
            {
              <IconButton
                onClick={() => setIsEditing(true)}
                title="Edit API Key"
                className="bg-blue-500/10 hover:bg-blue-500/20 text-blue-500"
              >
                <div className="i-ph:pencil-simple w-4 h-4" />
              </IconButton>
            }
            {provider?.getApiKeyLink && !apiKey && envKeyStatus === 'missing' && (
              <IconButton
                onClick={() => window.open(provider?.getApiKeyLink)}
                title="Get API Key"
                className="bg-purple-500/10 hover:bg-purple-500/20 text-purple-500 flex items-center gap-2"
              >
                <span className="text-xs whitespace-nowrap">{provider?.labelForGetApiKey || 'Get API Key'}</span>
                <div className={`${provider?.icon || 'i-ph:key'} w-4 h-4`} />
              </IconButton>
            )}
          </>
        )}
      </div>
    </div>
  );
};
