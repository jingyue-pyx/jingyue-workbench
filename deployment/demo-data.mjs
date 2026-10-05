// Generated-app demo data is separate from workbench source/chat persistence.
// Only this adapter can see the Supabase secret; no caller supplies a URL or owner.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[a-z][a-z0-9_-]{0,47}$/;
export const DEMO_BODY_LIMIT = 70 * 1024;
export class DemoDataError extends Error {
  constructor(status, code, message) {
    super(message);
    Object.assign(this, { status, code });
  }
}
const unavailable = () =>
  new DemoDataError(503, 'DATA_UNAVAILABLE', '演示数据服务暂不可用，未确认保存，请保留当前页面后重试。');
export function demoDataRoute(pathname) {
  const match = pathname.match(/^\/api\/demo-data\/([0-9a-f-]{36})(\/status)?$/i);
  return match && UUID.test(match[1]) ? { projectId: match[1].toLowerCase(), status: !!match[2] } : null;
}
export function validateDemoRequest(body) {
  const read = body?.action === 'read';
  const fields = read ? ['action', 'key'] : ['action', 'key', 'value', 'baseRevision', 'requestId'];
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    !['read', 'write'].includes(body.action) ||
    typeof body.key !== 'string' ||
    !KEY.test(body.key) ||
    Object.keys(body).some((key) => !fields.includes(key))
  )
    throw new DemoDataError(422, 'INVALID_DATA', '数据请求格式不正确。');
  if (
    !read &&
    (!Number.isSafeInteger(body.baseRevision) ||
      body.baseRevision < 0 ||
      !UUID.test(body.requestId) ||
      !body.value ||
      typeof body.value !== 'object')
  )
    throw new DemoDataError(422, 'INVALID_DATA', '保存内容必须为 JSON 对象或数组，并附带有效版本。');
  if (!read && Buffer.byteLength(JSON.stringify(body.value)) > 64 * 1024)
    throw new DemoDataError(413, 'DATA_TOO_LARGE', '每份演示数据最多 64KB，请缩小数据量。');
  return body;
}

export function createDemoDataStore(env, fetcher = globalThis.fetch) {
  // Supabase credentials are shared with app authentication. A data project is
  // the explicit opt-in; configuring auth alone must not enable demo storage.
  if (!env.JINGYUE_DEMO_WORKBENCH_PROJECT) return null;
  const names = ['JINGYUE_SUPABASE_URL', 'JINGYUE_SUPABASE_SERVICE_KEY', 'JINGYUE_DEMO_WORKBENCH_PROJECT'];
  if (names.some((name) => !env[name])) throw new Error('Incomplete demo data configuration.');
  const url = new URL(env.JINGYUE_SUPABASE_URL);
  if (
    url.protocol !== 'https:' ||
    !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !UUID.test(env.JINGYUE_DEMO_WORKBENCH_PROJECT)
  )
    throw new Error('Invalid demo data configuration.');
  const secret = env.JINGYUE_SUPABASE_SERVICE_KEY;
  if (typeof secret !== 'string' || secret.length < 20 || /\s/.test(secret))
    throw new Error('Invalid demo data credential.');
  const projectId = env.JINGYUE_DEMO_WORKBENCH_PROJECT.toLowerCase();
  return {
    projectId,
    async execute(ownerId, requestedProject, body, signal) {
      if (!UUID.test(ownerId) || requestedProject !== projectId)
        throw new DemoDataError(403, 'DATA_NOT_ENABLED', '当前项目未启用演示云存储。');
      validateDemoRequest(body);
      const deadline = AbortSignal.timeout(12000);
      let response;
      try {
        response = await fetcher(new URL('/rest/v1/rpc/jingyue_demo_data', url), {
          method: 'POST',
          redirect: 'error',
          headers: {
            apikey: secret,
            ...(secret.startsWith('eyJ') ? { Authorization: `Bearer ${secret}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_owner: ownerId,
            p_project: projectId,
            p_key: body.key,
            p_action: body.action,
            p_value: body.action === 'write' ? body.value : null,
            p_revision: body.baseRevision ?? 0,
            p_request: body.requestId ?? null,
          }),
          signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw unavailable();
        }
        // Bound a malformed upstream response, and never relay upstream errors.
        const reader = response.body.getReader();
        let size = 0;
        const chunks = [];
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > DEMO_BODY_LIMIT) {
            await reader.cancel();
            throw unavailable();
          }
          chunks.push(value);
        }
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (result?.error === 'conflict')
          throw new DemoDataError(
            409,
            'DATA_CONFLICT',
            '数据已在另一页面修改，当前改动未覆盖云端，请先核对再重新载入。',
          );
        if (result?.error === 'quota') throw new DemoDataError(413, 'DATA_QUOTA', '已达到本期演示数据容量限制。');
        if (
          !Number.isSafeInteger(result?.revision) ||
          result.revision < 0 ||
          !(result.value === null || typeof result.value === 'object') ||
          (result.updatedAt !== null && typeof result.updatedAt !== 'string')
        )
          throw unavailable();
        return { revision: result.revision, value: result.value, updatedAt: result.updatedAt };
      } catch (error) {
        if (error instanceof DemoDataError) throw error;
        throw unavailable();
      }
    },
  };
}

export async function handleDemoDataApi({ req, route, store, projects, user, send, signal, report }) {
  try {
    if ((route.status && req.method !== 'GET') || (!route.status && req.method !== 'POST'))
      throw new DemoDataError(405, 'METHOD_NOT_ALLOWED', '请求方法不正确。');
    if (!user || !projects) throw new DemoDataError(403, 'ACCOUNT_REQUIRED', '请登录独立账号后使用演示云存储。');
    const project = await projects.forOwner(user.id).get(route.projectId);
    if (project.deletedAt) throw new DemoDataError(404, 'PROJECT_NOT_FOUND', '项目不存在或已删除。');
    const enabled = !!store && store.projectId === route.projectId;
    if (route.status) return send(200, { enabled, provider: enabled ? 'supabase' : null });
    if (!enabled) throw new DemoDataError(403, 'DATA_NOT_ENABLED', '当前项目未启用演示云存储。');
    if (Number(req.headers['content-length'] || 0) > DEMO_BODY_LIMIT)
      throw new DemoDataError(413, 'DATA_TOO_LARGE', '演示数据超出大小限制。');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > DEMO_BODY_LIMIT) throw new DemoDataError(413, 'DATA_TOO_LARGE', '演示数据超出大小限制。');
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new DemoDataError(400, 'INVALID_JSON', '数据请求格式不正确。');
    }
    return send(200, await store.execute(user.id, route.projectId, validateDemoRequest(body), signal));
  } catch (error) {
    const safe =
      error instanceof DemoDataError
        ? error
        : error?.code === 'PROJECT_NOT_FOUND'
          ? new DemoDataError(404, 'PROJECT_NOT_FOUND', '项目不存在或无访问权限。')
          : unavailable();
    if (safe.status === 503) report('demo_data_unavailable');
    return send(safe.status, { error: { code: safe.code, message: safe.message } });
  }
}
