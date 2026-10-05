import { createHash } from 'node:crypto';
import { containsCredential, safeProjectPath } from '../project-protocol.mjs';

export class PublishingError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export const fail = (code, message, status) => {
  throw new PublishingError(code, message, status);
};
export const identifier = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
export const uuid = (value) =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
export const hash = (value) => createHash('sha256').update(value).digest('hex');

// This endpoint is a static artifact uploader, never a proxy or code runner.
export function validateArtifacts(input) {
  if (!Array.isArray(input) || !input.length || input.length > 300)
    fail('INVALID_ARTIFACT', '静态产物必须包含 1–300 个文件。');
  let size = 0;
  const paths = new Set();
  const files = input.map((entry) => {
    if (
      !entry ||
      Object.keys(entry).sort().join(',') !== 'base64,path' ||
      !safeProjectPath(entry.path) ||
      entry.path.length > 200 ||
      !/^[a-zA-Z0-9_./@+-]+$/.test(entry.path) ||
      entry.path.split('/').some((p) => !p || p.startsWith('.')) ||
      /(?:^|\/)(?:package(?:-lock)?\.json|netlify\.toml|_headers|_redirects|functions|server)(?:\/|$)/i.test(
        entry.path,
      ) ||
      /\.(?:map|sql|env|pem|key)$/i.test(entry.path) ||
      paths.has(entry.path)
    )
      fail('INVALID_ARTIFACT', '产物中包含重复、私密或非静态文件。');
    if (
      typeof entry.base64 !== 'string' ||
      entry.base64.length > MAX_ARTIFACT_BYTES * 1.4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.base64)
    )
      fail('INVALID_ARTIFACT', '文件编码无效。');
    const bytes = Buffer.from(entry.base64, 'base64');
    size += bytes.length;
    if (size > MAX_ARTIFACT_BYTES) fail('ARTIFACT_TOO_LARGE', '首期发布产物总计不能超过 8 MiB。', 413);
    // Inspect textual artifacts too: a secret embedded in a bundle is public.
    const text = bytes.toString('utf8');
    if (containsCredential(text) || /(?:nfp_[A-Za-z0-9]{20,}|-----BEGIN .*PRIVATE KEY-----)/.test(text))
      fail('ARTIFACT_SECRET', '产物疑似包含凭据，已阻止上传。请先移除服务端密钥。');
    if (/jingyue[.-]demo[.-]data|jingyue:demo-data|jingyue:(?:data|auth)-(?:connect|request)|\/api\/(?:demo-data|app-auth)\//i.test(text))
      fail('PREVIEW_STORAGE_ONLY', '此页面依赖工作台预览存储或认证，尚不能作为独立网站发布。');
    paths.add(entry.path);
    return { ...entry, digest: createHash('sha1').update(bytes).digest('hex') };
  });
  if (!paths.has('index.html')) fail('INVALID_ARTIFACT', '没有找到静态首页 index.html。');
  return files;
}

export function publicSiteURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      /^[a-z0-9-]+\.netlify\.app$/.test(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
      ? url.origin
      : null;
  } catch {
    return null;
  }
}
