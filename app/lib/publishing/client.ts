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

export function netlifyAuthorizationURL(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value);
    return url.origin === 'https://app.netlify.com' &&
      !url.username &&
      !url.password &&
      url.pathname === '/authorize' &&
      !url.hash &&
      url.searchParams.get('response_type') === 'ticket' &&
      /^[a-zA-Z0-9_-]{1,128}$/.test(url.searchParams.get('ticket') || '') &&
      [...url.searchParams.keys()].sort().join(',') === 'response_type,ticket'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function validResponse(data: Record<string, unknown>, action: unknown): boolean {
  switch (action) {
    case undefined:
    case 'status':
      return typeof data.enabled === 'boolean' && typeof data.connected === 'boolean';
    case 'connect':
      return typeof data.attemptId === 'string' && !!data.attemptId && !!netlifyAuthorizationURL(data.authorizeUrl);
    case 'authorize':
      return data.pending === true || (data.pending === false && data.connected === true);
    case 'disconnect':
      return data.connected === false && typeof data.message === 'string';
    case 'teams':
      return (
        Array.isArray(data.teams) &&
        data.teams.every(
          (team) =>
            team && typeof team.id === 'string' && typeof team.slug === 'string' && typeof team.name === 'string',
        )
      );
    case 'job':
    case 'prepare':
    case 'advance':
      return typeof data.phase === 'string' && Object.hasOwn(PUBLISH_PHASES, data.phase);
    default:
      return false;
  }
}

export async function publishRequest<T>(
  body?: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  if (!currentAccount) {
    throw new Error('请先登录独立账号。');
  }

  let response: Response;
  options.signal?.throwIfAborted();

  try {
    response = await fetch('/api/publishing', {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { 'X-Jingyue-User': currentAccount.id, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(55000)])
        : AbortSignal.timeout(55000),
    });
  } catch {
    options.signal?.throwIfAborted();
    throw new Error('连接中断，请查询已有发布状态；不要重复创建网站。');
  }

  if (response.status === 401) {
    throw new Error('登录已过期，请重新登录后查询已有发布状态。');
  }

  let data: Record<string, unknown>;

  try {
    data = await response.json();
  } catch {
    options.signal?.throwIfAborted();
    throw new Error('发布响应不完整或连接中断，请查询已有发布状态；不要重复创建网站。');
  }

  options.signal?.throwIfAborted();

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('发布响应格式无效，请重新查询状态。');
  }

  if (!response.ok) {
    const error = data.error as { message?: unknown } | undefined;
    throw new Error(typeof error?.message === 'string' ? error.message : '发布请求失败，请重新查询状态。');
  }

  if (body && data.enabled === false) {
    throw new Error('管理员尚未启用 Netlify 发布。');
  }

  if (!validResponse(data, body?.action)) {
    throw new Error('发布响应格式无效，未确认操作成功；请重新查询已有状态。');
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
