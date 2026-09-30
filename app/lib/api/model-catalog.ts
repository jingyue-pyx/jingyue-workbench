import type { ModelInfo } from '~/lib/modules/llm/types';

function isModel(value: unknown): value is ModelInfo {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const model = value as Partial<ModelInfo>;

  return (
    typeof model.name === 'string' &&
    typeof model.label === 'string' &&
    typeof model.provider === 'string' &&
    typeof model.maxTokenAllowed === 'number' &&
    Number.isFinite(model.maxTokenAllowed)
  );
}

export async function fetchModelCatalog(provider?: string, signal?: AbortSignal): Promise<ModelInfo[]> {
  const path = provider ? `/api/models/${encodeURIComponent(provider)}` : '/api/models';
  const response = await fetch(path, { signal });

  /*
   * An FC error or authentication response is not a model catalog. Never put its
   * missing modelList into React state or render the upstream body to the user.
   */
  if (!response.ok) {
    throw new Error(`模型列表加载失败（HTTP ${response.status}），请重试。`);
  }

  let data: unknown;

  try {
    data = await response.json();
  } catch {
    throw new Error('模型列表响应格式异常，请重试。');
  }

  const models = data && typeof data === 'object' ? (data as { modelList?: unknown }).modelList : undefined;

  if (!Array.isArray(models) || !models.every(isModel)) {
    throw new Error('模型列表响应格式异常，请重试。');
  }

  return models;
}
