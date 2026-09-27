import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { authenticated, safePath, apiAllowed, safeModelRequest, modelCatalog } from './security.mjs';
import { projectRoute } from './project-protocol.mjs';
import { handleProjectApi } from './project-api.mjs';

// Never emit messages, stacks, URLs or arbitrary error properties: upstream
// failures can contain prompts, credentials and headers. These finite labels
// are sufficient to distinguish stream cancellation from runtime failures.
export function failureDetails(error) {
  const names = ['AbortError', 'TypeError', 'RangeError', 'SyntaxError', 'Error'];
  const codes = [
    'ABORT_ERR',
    'ERR_INVALID_STATE',
    'ERR_STREAM_PREMATURE_CLOSE',
    'ERR_HTTP_HEADERS_SENT',
    'ECONNRESET',
    'EPIPE',
  ];
  try {
    const name = error?.name;
    const code = error?.code;
    return {
      errorType: names.includes(name) ? name : 'Other',
      errorCode: codes.includes(code) ? code : 'OTHER',
    };
  } catch {
    return { errorType: 'Other', errorCode: 'OTHER' };
  }
}

export async function createGateway({
  config,
  clientDirectory,
  handler,
  report = () => {},
  requestScope = (_signal, operation) => operation(),
  timeoutMs = 285000,
  projectStore = null,
}) {
  const clientRoot = await realpath(clientDirectory);
  const maxBody = 4 * 1024 * 1024;
  let activeCalls = 0;
  let modelWindow = { at: Date.now(), count: 0 };
  let authWindow = { at: Date.now(), count: 0 };
  let projectWindow = { at: Date.now(), count: 0 };
  let activeProjects = 0;

  const headers = {
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    // WebContainer's headless frame needs the embedding site's origin. Never
    // disclose project paths/query strings, including on same-origin requests.
    'Referrer-Policy': 'strict-origin',
    'Cache-Control': 'private, no-store',
    ...(!config.localTest ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
  const mime = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
    '.wasm': 'application/wasm',
  };

  const server = createServer(async (req, res) => {
    let counted = false;
    const controller = new AbortController();
    let timer;
    const finish = () => {
      clearTimeout(timer);
      controller.abort();
      if (counted) {
        activeCalls--;
        counted = false;
      }
    };
    res.on('close', finish);
    const send = (status, body, extra = {}) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, config.origin);
      const pathname = safePath(url.pathname);
      if (!pathname) return send(400, { error: 'Invalid path' });
      if (pathname === '/healthz' && req.method === 'GET') return send(200, { status: 'ok' });
      if (Date.now() - authWindow.at > 60000) authWindow = { at: Date.now(), count: 0 };
      if (!authenticated(req.headers.authorization, config)) {
        authWindow.count++;
        if (authWindow.count > 120) return send(429, { error: 'Retry later' }, { 'Retry-After': '60' });
        return send(
          401,
          { error: 'Private preview: sign in first' },
          { 'WWW-Authenticate': 'Basic realm="Jingyue private preview", charset="UTF-8"' },
        );
      }
      if (!apiAllowed(pathname) || url.searchParams.get('_data')?.includes('api.'))
        return send(404, { error: 'Not available in the private preview' });
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) return send(405, { error: 'Method not allowed' });
      const isApi = pathname.startsWith('/api/');
      if (req.method === 'POST') {
        if (
          !isApi ||
          req.headers.origin !== config.origin ||
          (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
        )
          return send(403, { error: 'Same-origin requests required' });
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON required' });
      }
      const project = projectRoute(pathname);
      if (project) {
        if (Date.now() - projectWindow.at > 60000) projectWindow = { at: Date.now(), count: 0 };
        if (activeProjects >= 4 || projectWindow.count >= 120)
          return send(
            429,
            { error: { code: 'PROJECT_RATE_LIMIT', message: 'Project request limit reached; retry later' } },
            { 'Retry-After': '60' },
          );
        projectWindow.count++;
        activeProjects++;
        try {
          return await handleProjectApi({ req, route: project, url, store: projectStore, send, report });
        } finally {
          activeProjects--;
        }
      }
      if ((pathname === '/api/models' || pathname === '/api/models/Bailian') && req.method === 'GET')
        return send(200, modelCatalog());
      if (pathname === '/api/check-env-key' && req.method === 'GET')
        return send(200, {
          isSet: url.searchParams.get('provider') === 'Bailian' && !!config.modelEnv.DASHSCOPE_API_KEY,
        });
      let body;
      if (req.method === 'POST') {
        if (!['/api/chat', '/api/enhancer'].includes(pathname)) return send(405, { error: 'Method not allowed' });
        if (Number(req.headers['content-length'] || 0) > maxBody)
          return send(413, { error: 'Project exceeds the private preview request limit' });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > maxBody) return send(413, { error: 'Project exceeds the private preview request limit' });
          chunks.push(chunk);
        }
        let data;
        try {
          data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { error: 'Invalid JSON' });
        }
        if (!safeModelRequest(data, pathname))
          return send(400, { error: 'Only the configured Bailian models are available' });
        if (Date.now() - modelWindow.at > 60000) modelWindow = { at: Date.now(), count: 0 };
        if (activeCalls >= 2 || modelWindow.count >= 10)
          return send(429, { error: 'Private preview model request limit reached' }, { 'Retry-After': '60' });
        activeCalls++;
        counted = true;
        modelWindow.count++;
        body = JSON.stringify(data);
      }
      if (!isApi && (req.method === 'GET' || req.method === 'HEAD')) {
        const candidate = resolve(clientRoot, `.${pathname}`);
        if (candidate !== clientRoot && !candidate.startsWith(clientRoot + sep))
          return send(404, { error: 'Not found' });
        try {
          const actual = await realpath(candidate);
          if (actual.startsWith(clientRoot + sep) && (await stat(actual)).isFile()) {
            res.writeHead(200, { ...headers, 'Content-Type': mime[extname(actual)] || 'application/octet-stream' });
            if (req.method === 'HEAD') return res.end();
            return await pipeline(createReadStream(actual), res);
          }
        } catch {
          /* A missing static file may be a Remix route. */
        }
      }
      // Never forward access credentials or user-supplied provider/key cookies.
      const requestHeaders = new Headers();
      for (const name of ['accept', 'accept-language', 'content-type', 'user-agent'])
        if (req.headers[name]) requestHeaders.set(name, req.headers[name]);
      const request = new Request(new URL(pathname + url.search, config.origin), {
        method: req.method,
        headers: requestHeaders,
        body,
        signal: controller.signal,
      });
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await requestScope(controller.signal, () =>
        handler(request, { cloudflare: { env: config.modelEnv } }),
      );
      const responseHeaders = Object.fromEntries(response.headers);
      // Node treats names case-insensitively but object spread does not. Remove
      // upstream copies before adding policy headers, otherwise COOP/COEP become
      // comma-joined duplicate values and WebContainer isolation fails.
      for (const name of Object.keys(headers)) delete responseHeaders[name.toLowerCase()];
      delete responseHeaders['content-length'];
      delete responseHeaders['connection'];
      delete responseHeaders['set-cookie'];
      res.writeHead(response.status, { ...responseHeaders, ...headers });
      res.flushHeaders();
      if (req.method === 'HEAD' || !response.body) return res.end();
      await pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      report('request_failed', error);
      if (!res.headersSent) send(500, { error: 'Request failed; please retry' });
      else res.destroy();
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (counted) {
        activeCalls--;
        counted = false;
      }
    }
  });
  server.requestTimeout = 300000;
  server.headersTimeout = 15000;
  return server;
}
