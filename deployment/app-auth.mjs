import { createHash, randomBytes } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const SESSION_SECONDS = 24 * 60 * 60;
export class AppAuthError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}
const fail = (status, code, message) => {
  throw new AppAuthError(status, code, message);
};
const unavailable = () =>
  new AppAuthError(503, 'APP_AUTH_UNAVAILABLE', '应用认证服务暂不可用，请稍后重试；不要重新注册已有账号。');
export function appAuthRoute(path) {
  const match = path.match(/^\/api\/app-auth\/([0-9a-f-]{36})$/i);
  return match && UUID.test(match[1]) ? match[1].toLowerCase() : null;
}
export function validateAppAuth(body) {
  const fields = {
    status: [],
    session: [],
    logout: [],
    login: ['username', 'password'],
    register: ['username', 'password', 'displayName'],
  }[body?.action];
  if (
    !Array.isArray(fields) ||
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== 'action' && !fields.includes(key))
  )
    fail(422, 'APP_AUTH_INVALID', '应用认证请求格式不正确。');
  if (['login', 'register'].includes(body.action)) {
    if (typeof body.username !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(body.username.trim()))
      fail(422, 'APP_AUTH_INVALID', '账号须为 3–32 位英文字母、数字或下划线，以字母开头。');
    if (typeof body.password !== 'string' || [...body.password].length < 10 || Buffer.byteLength(body.password) > 72)
      fail(422, 'APP_AUTH_INVALID', '密码至少 10 个字符，最多 72 字节。');
    if (
      body.action === 'register' &&
      body.displayName !== undefined &&
      (typeof body.displayName !== 'string' ||
        !body.displayName.trim() ||
        [...body.displayName].length > 40 ||
        /[\u0000-\u001f\u007f]/.test(body.displayName))
    )
      fail(422, 'APP_AUTH_INVALID', '显示名须为 1–40 个字符。');
    return { ...body, username: body.username.trim().toLowerCase() };
  }
  return body;
}
export function appSessionCookie(project, token, local, clear = false) {
  return `${local ? 'jingyue_app_session_test' : '__Secure-jingyue_app_session'}=${token}; Path=/api/app-auth/${project}; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_SECONDS}${local ? '' : '; Secure'}`;
}
export function readAppSession(cookie, local) {
  const name = local ? 'jingyue_app_session_test' : '__Secure-jingyue_app_session';
  const values = (cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

// Admin key is captured before the model-only outbound adapter is installed.
// Synthetic, non-deliverable identities provide project-scoped USERNAME login;
// no email is sent and no caller can choose an email, tenant or app metadata.
export function createSupabaseAppAuth(env, fetcher = globalThis.fetch) {
  if (env.JINGYUE_APP_AUTH_ENABLED !== '1') return null;
  const url = new URL(env.JINGYUE_SUPABASE_URL || 'invalid:');
  const secret = env.JINGYUE_SUPABASE_SERVICE_KEY;
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    typeof secret !== 'string' ||
    secret.length < 20 ||
    /\s/.test(secret)
  )
    throw new Error('Invalid generated-app authentication configuration.');
  const request = async (path, { method = 'GET', body, token, signal } = {}) => {
    try {
      const response = await fetcher(new URL(`/auth/v1/${path}`, url), {
        method,
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
        headers: {
          apikey: secret,
          ...(token || secret.startsWith('eyJ') ? { Authorization: `Bearer ${token || secret}` } : {}),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let size = 0;
      const chunks = [];
      if (response.body)
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 32768) throw unavailable();
          chunks.push(chunk);
        }
      let data = null;
      try {
        data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      } catch {
        throw unavailable();
      }
      if (!response.ok) {
        if (response.status === 429) fail(429, 'APP_AUTH_RATE_LIMIT', '认证请求较多，请稍后重试。');
        if (path.startsWith('token?') && [400, 401, 422].includes(response.status))
          fail(401, 'APP_AUTH_CREDENTIALS', '账号或密码不正确。');
        if (
          method === 'POST' &&
          path === 'admin/users' &&
          ['email_exists', 'user_already_exists'].includes(data?.code || data?.error_code)
        )
          fail(409, 'APP_AUTH_EXISTS', '该账号已注册，请直接登录。');
        if (method === 'GET' && path.startsWith('admin/users/') && response.status === 404) return null;
        throw unavailable();
      }
      return data;
    } catch (error) {
      if (error instanceof AppAuthError) throw error;
      throw unavailable();
    }
  };
  const identity = (owner, project, username) => `${hash(`${owner}:${project}:${username}`)}@jingyue-app.invalid`;
  const scoped = (user, owner, project, username) => {
    if (
      !user ||
      !UUID.test(user.id) ||
      user.app_metadata?.jingyue_owner !== owner ||
      user.app_metadata?.jingyue_project !== project ||
      typeof user.app_metadata?.jingyue_username !== 'string' ||
      (username && user.app_metadata.jingyue_username !== username) ||
      !user.updated_at ||
      (user.banned_until && Date.parse(user.banned_until) > Date.now())
    )
      return null;
    return {
      id: user.id,
      username: user.app_metadata.jingyue_username,
      displayName: user.user_metadata?.display_name || user.app_metadata.jingyue_username,
      version: user.updated_at,
    };
  };
  return {
    async register(owner, project, body, signal) {
      const user = await request('admin/users', {
        method: 'POST',
        signal,
        body: {
          email: identity(owner, project, body.username),
          password: body.password,
          email_confirm: true,
          app_metadata: { jingyue_owner: owner, jingyue_project: project, jingyue_username: body.username },
          user_metadata: { display_name: body.displayName?.trim() || body.username },
        },
      });
      return (
        scoped(user, owner, project, body.username) ||
        (() => {
          throw unavailable();
        })()
      );
    },
    async login(owner, project, body, signal) {
      const session = await request('token?grant_type=password', {
        method: 'POST',
        signal,
        body: { email: identity(owner, project, body.username), password: body.password },
      });
      if (typeof session?.access_token !== 'string') throw unavailable();
      // This BFF issues its OWN revocable opaque session. Do not persist or
      // expose Supabase access/refresh tokens; close the short-lived upstream
      // password-check session before issuing a browser cookie.
      await request('logout?scope=local', { method: 'POST', token: session.access_token, signal });
      const user = scoped(session.user, owner, project, body.username);
      if (!user) fail(401, 'APP_AUTH_CREDENTIALS', '账号或密码不正确。');
      return this.user(owner, project, user.id, signal);
    },
    async user(owner, project, id, signal) {
      if (!UUID.test(id)) return null;
      return scoped(await request(`admin/users/${id}`, { signal }), owner, project);
    },
  };
}

export class AppAuthService {
  constructor(pool, provider) {
    this.pool = pool;
    this.provider = provider;
  }
  async consume(owner, project, action, username = '') {
    const bucket = `${owner}:${project}:${action}:${hash(username)}:${Math.floor(Date.now() / 900000)}`;
    const limit = ['login', 'register'].includes(action) ? 10 : 120;
    const result = await this.pool.query(
      `INSERT INTO jingyue.app_auth_limits(bucket,count,expires_at) VALUES($1,1,clock_timestamp()+interval '30 minutes')
      ON CONFLICT(bucket) DO UPDATE SET count=app_auth_limits.count+1 WHERE app_auth_limits.count<$2 RETURNING count`,
      [bucket, limit],
    );
    if (!result.rows.length) fail(429, 'APP_AUTH_RATE_LIMIT', '操作过于频繁，请稍后再试。');
  }
  async reserve(owner, project, username) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`app-auth:${owner}`]);
      const existing = (
        await db.query(
          'SELECT remote_id FROM jingyue.app_auth_accounts WHERE owner_id=$1 AND project_id=$2 AND username=$3',
          [owner, project, username],
        )
      ).rows[0];
      if (existing?.remote_id) fail(409, 'APP_AUTH_EXISTS', '该账号已注册，请直接登录。');
      if (!existing) {
        const counts = (
          await db.query(
            'SELECT count(*) AS total,count(*) FILTER (WHERE project_id=$2) AS project FROM jingyue.app_auth_accounts WHERE owner_id=$1',
            [owner, project],
          )
        ).rows[0];
        if (Number(counts.total) >= 100 || Number(counts.project) >= 20)
          fail(409, 'APP_AUTH_CAPACITY', '已达到演示账号上限（每应用 20 个）。');
        await db.query('INSERT INTO jingyue.app_auth_accounts(owner_id,project_id,username) VALUES($1,$2,$3)', [
          owner,
          project,
          username,
        ]);
      }
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  async issue(owner, project, user) {
    if (!user) fail(401, 'APP_AUTH_CREDENTIALS', '账号或密码不正确。');
    const token = randomBytes(32).toString('base64url');
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `app-session:${owner}:${project}:${user.id}`,
      ]);
      await db.query('DELETE FROM jingyue.app_auth_sessions WHERE expires_at<=clock_timestamp()');
      await db.query('DELETE FROM jingyue.app_auth_limits WHERE expires_at<=clock_timestamp()');
      await db.query(
        'DELETE FROM jingyue.app_auth_sessions WHERE owner_id=$1 AND project_id=$2 AND remote_id=$3 AND token_hash IN (SELECT token_hash FROM jingyue.app_auth_sessions WHERE owner_id=$1 AND project_id=$2 AND remote_id=$3 ORDER BY created_at DESC OFFSET 4)',
        [owner, project, user.id],
      );
      await db.query(
        "INSERT INTO jingyue.app_auth_sessions(token_hash,owner_id,project_id,remote_id,credential_version,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '24 hours')",
        [hash(token), owner, project, user.id, user.version],
      );
      await db.query(
        'UPDATE jingyue.app_auth_accounts SET remote_id=$4 WHERE owner_id=$1 AND project_id=$2 AND username=$3',
        [owner, project, user.username, user.id],
      );
      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
    return { token, user: this.publicUser(user) };
  }
  publicUser(user) {
    return { id: user.id, username: user.username, displayName: user.displayName };
  }
  async execute(owner, project, body, token, signal) {
    body = validateAppAuth(body);
    await this.consume(owner, project, 'all');
    if (body.action === 'status') return { enabled: true, provider: 'supabase-auth', scope: 'workbench-preview' };
    if (['register', 'login'].includes(body.action)) {
      await this.consume(owner, project, body.action, body.username);
      if (body.action === 'register') await this.reserve(owner, project, body.username);
      const user = await this.provider[body.action](owner, project, body, signal);
      const result = await this.issue(owner, project, user);
      if (token) await this.revoke(owner, project, token);
      return result;
    }
    if (body.action === 'logout') {
      await this.revoke(owner, project, token);
      return { user: null, clear: true };
    }
    if (!token) return { user: null, clear: true };
    const saved = (
      await this.pool.query(
        'SELECT remote_id,credential_version FROM jingyue.app_auth_sessions WHERE token_hash=$1 AND owner_id=$2 AND project_id=$3 AND expires_at>clock_timestamp()',
        [hash(token), owner, project],
      )
    ).rows[0];
    if (!saved) return { user: null, clear: true };
    const user = await this.provider.user(owner, project, saved.remote_id, signal);
    if (!user || user.version !== saved.credential_version) {
      await this.revoke(owner, project, token);
      return { user: null, clear: true };
    }
    return { user: this.publicUser(user) };
  }
  async revoke(owner, project, token) {
    if (token)
      await this.pool.query(
        'DELETE FROM jingyue.app_auth_sessions WHERE token_hash=$1 AND owner_id=$2 AND project_id=$3',
        [hash(token), owner, project],
      );
  }
}
export function createAppAuthService(env, projects, fetcher = globalThis.fetch) {
  const provider = createSupabaseAppAuth(env, fetcher);
  if (!provider) return null;
  if (!projects?.pool) throw new Error('Generated-app sessions require persistent storage.');
  return new AppAuthService(projects.pool, provider);
}
export async function handleAppAuthApi({ req, project, service, projects, user, send, config, signal, report }) {
  try {
    if (req.method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', '请使用认证接口。');
    if (!user || !projects) fail(403, 'ACCOUNT_REQUIRED', '请先登录鲸月工作台。');
    const owned = await projects.forOwner(user.id).get(project);
    if (owned.deletedAt) fail(404, 'PROJECT_NOT_FOUND', '项目不存在或已删除。');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) fail(413, 'APP_AUTH_INVALID', '认证请求过大。');
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      fail(400, 'APP_AUTH_INVALID', '认证请求格式不正确。');
    }
    body = validateAppAuth(body);
    if (!service) {
      if (body.action === 'status') return send(200, { enabled: false, provider: null });
      fail(503, 'APP_AUTH_UNAVAILABLE', '当前环境尚未启用应用认证。');
    }
    const result = await service.execute(
      user.id,
      project,
      body,
      readAppSession(req.headers.cookie, config.localTest),
      signal,
    );
    const { token, clear, ...safe } = result;
    return send(
      200,
      safe,
      token || clear ? { 'Set-Cookie': appSessionCookie(project, token || '', config.localTest, !!clear) } : {},
    );
  } catch (error) {
    const safe =
      error instanceof AppAuthError
        ? error
        : error?.code === 'PROJECT_NOT_FOUND'
          ? new AppAuthError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问。')
          : unavailable();
    if (safe.status === 503) report('app_auth_unavailable');
    return send(safe.status, { error: { code: safe.code, message: safe.message } });
  }
}
