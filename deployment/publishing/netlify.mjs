import { PublishingError, fail, identifier } from './protocol.mjs';

export async function readLimited(response, limit = 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        fail('PROVIDER_RESPONSE', '平台响应过大，已停止读取。', 502);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

// Capture native fetch before the model-only network adapter is installed.
// No URL, redirect target or authorization token comes from the browser.
export class NetlifyProvider {
  constructor(fetchImpl = globalThis.fetch) {
    this.fetch = fetchImpl;
  }
  async request(path, { token, method = 'GET', body, binary = false } = {}) {
    let response;
    try {
      response = await this.fetch(`https://api.netlify.com/api/v1${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: binary ? body : JSON.stringify(body) } : {}),
      });
    } catch {
      fail('PROVIDER_UNAVAILABLE', '暂时无法连接 Netlify；请重试查询，不要重复新建站点。', 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      const code =
        response.status === 401 || response.status === 403
          ? 'PROVIDER_AUTH'
          : response.status === 404
            ? 'PROVIDER_NOT_FOUND'
            : response.status === 429
              ? 'PROVIDER_LIMIT'
              : 'PROVIDER_UNAVAILABLE';
      throw new PublishingError(
        code,
        code === 'PROVIDER_AUTH'
          ? 'Netlify 授权失效或权限不足，请重新授权。'
          : code === 'PROVIDER_LIMIT'
            ? 'Netlify 请求限流，请稍后再查询。'
            : 'Netlify 暂未完成请求，请检查发布状态。',
        502,
      );
    }
    if (response.status === 204) return {};
    // API errors or unexpected HTML must never be relayed to clients/logs.
    try {
      return JSON.parse(await readLimited(response));
    } catch {
      fail('PROVIDER_RESPONSE', 'Netlify 返回了无法识别的响应。', 502);
    }
  }
  segment(value) {
    if (!identifier(value)) fail('PROVIDER_RESPONSE', 'Netlify 资源标识无效。', 502);
    return encodeURIComponent(value);
  }
  ticket(clientId) {
    return this.request(`/oauth/tickets?client_id=${encodeURIComponent(clientId)}`, {
      method: 'POST',
      body: { message: '鲸月：授权发布静态网站到你选择的 Netlify 团队。' },
    });
  }
  ticketStatus(id) {
    return this.request(`/oauth/tickets/${this.segment(id)}`);
  }
  exchange(id) {
    return this.request(`/oauth/tickets/${this.segment(id)}/exchange`, { method: 'POST' });
  }
  user(token) {
    return this.request('/user', { token });
  }
  accounts(token) {
    return this.request('/accounts', { token });
  }
  site(token, id) {
    return this.request(`/sites/${this.segment(id)}`, { token });
  }
  siteByName(token, name) {
    return this.request(`/sites/${this.segment(name)}.netlify.app`, { token });
  }
  createSite(token, account, name) {
    return this.request(`/${this.segment(account)}/sites`, { token, method: 'POST', body: { name } });
  }
  deploy(token, site, title, files) {
    return this.request(`/sites/${this.segment(site)}/deploys?title=${encodeURIComponent(title)}&production=true`, {
      token,
      method: 'POST',
      body: { files: Object.fromEntries(files.map((f) => [`/${f.path}`, f.digest])), draft: false, async: true },
    });
  }
  deployment(token, id) {
    return this.request(`/deploys/${this.segment(id)}`, { token });
  }
  deployments(token, site) {
    return this.request(`/sites/${this.segment(site)}/deploys?per_page=100`, { token });
  }
  upload(token, deployment, file) {
    return this.request(
      `/deploys/${this.segment(deployment)}/files/${file.path.split('/').map(encodeURIComponent).join('/')}`,
      {
        token,
        method: 'PUT',
        binary: true,
        body: Buffer.from(file.base64, 'base64'),
      },
    );
  }
}
