import { AccountError, readSession, sessionCookie } from './accounts.mjs';
import { accountPage } from './account-pages.mjs';

export async function accountRequest({ req, res, pathname, config, store, headers, send }) {
  const token = readSession(req.headers.cookie, config.localTest, config.localCookieNamespace);
  const authRoute = pathname.startsWith('/api/auth/');
  if (!store) throw new AccountError(503, 'AUTH_UNAVAILABLE', '账号服务暂不可用，请稍后重试。');
  const user = await store.authenticate(token);
  if (['/login', '/register', '/account'].includes(pathname) && req.method === 'GET') {
    if ((!user && pathname === '/account') || (user && pathname !== '/account')) {
      res.writeHead(303, { ...headers, Location: user ? '/' : '/login' });
      res.end();
    } else {
      const { html, nonce } = accountPage(pathname.slice(1), { registrationOpen: config.registrationOpen, user });
      res.writeHead(200, {
        ...headers,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      });
      res.end(html);
    }
    return { handled: true };
  }
  if (pathname === '/api/auth/session' && req.method === 'GET') {
    send(200, { user });
    return { handled: true };
  }
  if (authRoute) {
    if (!['/api/auth/login', '/api/auth/register', '/api/auth/logout', '/api/auth/profile'].includes(pathname))
      throw new AccountError(404, 'NOT_FOUND', '接口不存在。');
    if (req.method !== 'POST') throw new AccountError(405, 'METHOD_NOT_ALLOWED', '请使用登录表单。');
    if (
      req.headers.origin !== config.origin ||
      (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
    )
      throw new AccountError(403, 'INVALID_ORIGIN', '请从本站页面发起请求。');
    if (!req.headers['content-type']?.startsWith('application/json'))
      throw new AccountError(415, 'JSON_REQUIRED', '请求格式不正确。');
    if (Number(req.headers['content-length'] || 0) > 4096) throw new AccountError(413, 'TOO_LARGE', '请求内容过长。');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) throw new AccountError(413, 'TOO_LARGE', '请求内容过长。');
      chunks.push(chunk);
    }
    let data;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new AccountError(400, 'INVALID_JSON', '请求格式不正确。');
    }
    const action = pathname.slice('/api/auth/'.length);
    const keys = {
      login: ['username', 'password'],
      register: ['username', 'password', 'displayName'],
      profile: ['displayName'],
      logout: [],
    }[action];
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      Object.keys(data).some((key) => !keys.includes(key))
    )
      throw new AccountError(422, 'INVALID_FIELDS', '请求中包含无效字段。');
    if (action === 'login' || action === 'register') {
      if (user) throw new AccountError(409, 'ALREADY_SIGNED_IN', '请先退出当前账号再切换。');
      const result = await store[action](data, req.socket.remoteAddress);
      send(
        200,
        { user: result.user },
        { 'Set-Cookie': sessionCookie(result.token, config.localTest, false, config.localCookieNamespace) },
      );
    } else {
      if (!user) throw new AccountError(401, 'SESSION_EXPIRED', '请重新登录。');
      if (req.headers['x-jingyue-user'] !== user.id)
        throw new AccountError(409, 'ACCOUNT_CHANGED', '账号已切换，请重新打开工作台。');
      if (action === 'profile') send(200, { user: await store.rename(user, data.displayName) });
      else {
        await store.logout(token);
        send(
          200,
          { ok: true },
          { 'Set-Cookie': sessionCookie('', config.localTest, true, config.localCookieNamespace) },
        );
      }
    }
    return { handled: true };
  }
  if (!user) {
    if (pathname.startsWith('/api/'))
      throw new AccountError(401, 'SESSION_EXPIRED', '登录已过期，请重新登录。本机草稿仍保留。');
    res.writeHead(303, { ...headers, Location: '/login' });
    res.end();
    return { handled: true };
  }
  // This header is a stale-tab guard, NEVER the identity source. Owner identity
  // always comes from the server-verified session, including every GET.
  if (pathname.startsWith('/api/') && req.headers['x-jingyue-user'] !== user.id)
    throw new AccountError(409, 'ACCOUNT_CHANGED', '账号已切换，请重新打开工作台。本机草稿仍保留。');
  return { user };
}
