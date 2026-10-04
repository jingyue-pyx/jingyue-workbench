import { currentAccount } from '~/lib/auth/account-context';

export interface PublishJob {
  id?: string;
  phase: string;
  revision?: number;
  url?: string | null;
  manageUrl?: string | null;
  error?: string | null;
  uploaded?: number;
  fileCount?: number;
  lastPublished?: { url: string; revision: number } | null;
}
export interface PublishingStatus {
  enabled: boolean;
  connected: boolean;
  displayName?: string;
  message?: string;
}
export interface PublishingTeam {
  id: string;
  slug: string;
  name: string;
}

export async function publishRequest<T>(body?: Record<string, unknown>): Promise<T> {
  if (!currentAccount) {
    throw new Error('请先登录独立账号。');
  }

  let response: Response;

  try {
    response = await fetch('/api/publishing', {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { 'X-Jingyue-User': currentAccount.id, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(55000),
    });
  } catch {
    throw new Error('连接中断，请查询已有发布状态；不要重复创建网站。');
  }

  const data = (await response.json().catch(() => ({}))) as { error?: { message?: string }; enabled?: boolean };

  if (!response.ok) {
    throw new Error(data.error?.message || '发布请求失败，请重新查询状态。');
  }

  if (body && data.enabled === false) {
    throw new Error('管理员尚未启用 Netlify 发布。');
  }

  return data as T;
}

export const PUBLISH_PHASES: Record<string, string> = {
  idle: '尚未发布',
  prepared: '产物已保存，准备发布',
  creating_site: '正在创建或核对站点',
  creating_deploy: '正在提交或核对部署',
  uploading: '正在上传静态产物',
  waiting: '等待 Netlify 完成部署',
  access_unverified: '平台已部署，公网访问尚未确认',
  published: '已发布，公网访问已验证',
  failed: '发布失败',
};
