import { hash, MAX_REQUEST_BYTES, PublishingError, fail } from './protocol.mjs';

const fields = {
  connect: ['action'],
  authorize: ['action', 'attemptId'],
  disconnect: ['action'],
  teams: ['action'],
  status: ['action'],
  job: ['action', 'projectId'],
  advance: ['action', 'projectId'],
  prepare: ['action', 'projectId', 'requestId', 'revision', 'teamId', 'files', 'confirmPublic'],
};

export async function handlePublishingApi({ req, pathname, service, user, send }) {
  if (pathname !== '/api/publishing') return false;
  if (!user) {
    send(403, { error: { code: 'ACCOUNT_REQUIRED', message: '发布需要独立账号登录。' } });
    return true;
  }
  if (!service) {
    send(200, { enabled: false, connected: false, message: '发布尚未启用，需先配置鲸月自己的 Netlify OAuth 应用。' });
    return true;
  }
  try {
    if (req.method === 'GET') {
      send(200, await service.status(user.id));
      return true;
    }
    if (req.method !== 'POST') fail('METHOD_NOT_ALLOWED', '不支持此请求。', 405);
    if (Number(req.headers['content-length']) > MAX_REQUEST_BYTES) fail('ARTIFACT_TOO_LARGE', '发布请求过大。', 413);
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) fail('ARTIFACT_TOO_LARGE', '发布请求过大。', 413);
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      fail('INVALID_REQUEST', '发布请求格式无效。');
    }
    const allowed = body && fields[body.action];
    if (!Array.isArray(allowed) || Object.keys(body).some((k) => !allowed.includes(k)))
      fail('INVALID_REQUEST', '不支持的发布参数。');
    const session = hash(req.headers.cookie || '');
    const action = body.action;
    const result =
      action === 'connect'
        ? await service.connect(user.id, session)
        : action === 'authorize'
          ? await service.authorize(user.id, session, body.attemptId)
          : action === 'disconnect'
            ? await service.disconnect(user.id)
            : action === 'teams'
              ? await service.teams(user.id)
              : action === 'job'
                ? await service.job(user.id, body.projectId)
                : action === 'prepare'
                  ? await service.prepare(user.id, body)
                  : action === 'advance'
                    ? await service.advance(user.id, body.projectId)
                    : await service.status(user.id);
    send(200, result);
  } catch (error) {
    if (error instanceof PublishingError) send(error.status, { error: { code: error.code, message: error.message } });
    else if (error?.status === 404)
      send(404, { error: { code: 'PROJECT_NOT_FOUND', message: '项目不存在或无权访问。' } });
    else send(503, { error: { code: 'PUBLISHING_UNAVAILABLE', message: '发布服务暂不可用，请稍后重试查询。' } });
  }
  return true;
}
