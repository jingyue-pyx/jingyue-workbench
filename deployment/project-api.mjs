import { ProjectError, PROJECT_BODY_LIMIT, validateMutation } from './project-protocol.mjs';

export async function handleProjectApi({ req, route, url, store, send, report }) {
  try {
    if (
      (req.method === 'GET' && route.action) ||
      (req.method === 'POST' && route.id && !route.action) ||
      !['GET', 'POST'].includes(req.method)
    )
      return send(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
    if (!store) throw new ProjectError(503, 'PERSISTENCE_UNAVAILABLE', 'Cloud project storage is not configured');
    if (req.method === 'GET') {
      if (route.id) return send(200, await store.get(route.id));
      const limit = Number(url.searchParams.get('limit') || 20);
      const deleted = url.searchParams.get('deleted') || '0';
      const cursor = url.searchParams.get('cursor') || undefined;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        !['0', '1'].includes(deleted) ||
        (cursor && cursor.length > 1024)
      )
        throw new ProjectError(422, 'INVALID_QUERY', 'Invalid project list query');
      return send(200, await store.list({ limit, cursor, deleted: deleted === '1' }));
    }
    if (Number(req.headers['content-length'] || 0) > PROJECT_BODY_LIMIT)
      throw new ProjectError(413, 'PROJECT_TOO_LARGE', 'Project exceeds the size limit');
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > PROJECT_BODY_LIMIT) throw new ProjectError(413, 'PROJECT_TOO_LARGE', 'Project exceeds the size limit');
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ProjectError(400, 'INVALID_JSON', 'Invalid JSON');
    }
    const mutation = validateMutation(route, body);
    const result = await store.mutate(mutation);
    return send(route.id ? 200 : 201, result);
  } catch (error) {
    if (error instanceof ProjectError)
      return send(
        error.status,
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
          },
        },
        error.status === 503 ? { 'Retry-After': '5' } : {},
      );
    report('project_storage_request_failed');
    return send(
      503,
      {
        error: { code: 'PERSISTENCE_UNAVAILABLE', message: 'Cloud project storage is temporarily unavailable' },
      },
      { 'Retry-After': '5' },
    );
  }
}
