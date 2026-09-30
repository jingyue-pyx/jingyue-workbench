// Loopback-only acceptance fixture. Does not call models or change production.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { parse } = require('dotenv');
const env = parse(await readFile(resolve(root, '.supabase.local.env'), 'utf8'));
const id = env.JINGYUE_DEMO_WORKBENCH_PROJECT;
if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Configure the local demo project binding first.');
const port = Number(process.env.JINGYUE_LOCAL_PREVIEW_PORT || '9026');
if (!Number.isInteger(port) || port < 9025 || port > 9035) throw new Error('Only dedicated loopback acceptance ports are allowed.');
const origin = `http://127.0.0.1:${port}`;
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const built = await build({
  stdin: { contents: "export { DEMO_STORAGE_FIXTURE as default } from './app/lib/runtime/demo-data/fixture';", resolveDir: root },
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'raw-fixture', setup(api) {
    api.onResolve({ filter: /\?raw$/ }, ({ path, resolveDir }) => ({ path: resolve(resolveDir, path.slice(0, -4)), namespace: 'demo-raw' }));
    api.onLoad({ filter: /.*/, namespace: 'demo-raw' }, async ({ path }) => ({ contents: await readFile(path, 'utf8'), loader: 'text' }));
  } }],
});
const { default: sources } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const login = await fetch(origin + '/api/auth/login', { method: 'POST',
  headers: { origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'preview_alice', password: 'Local-test-password-7248' }),
});
if (!login.ok) throw new Error('Local fixture account login failed.');
const cookie = login.headers.get('set-cookie')?.split(';')[0];
const user = (await login.json()).user;
if (!cookie || !user?.id) throw new Error('Local fixture session unavailable.');
const headers = { origin, cookie, 'X-Jingyue-User': user.id, 'Content-Type': 'application/json' };
const existing = await fetch(origin + '/api/projects/' + id, { headers });
if (existing.status === 404) {
  const message = { id: randomUUID(), role: 'assistant', content: '本机 Supabase 采购清单验收示例：无需重新调用模型。' };
  const result = await fetch(origin + '/api/projects', { method: 'POST', headers,
    body: JSON.stringify({ projectId: id, requestId: randomUUID(), document: {
      schemaVersion: 1, title: 'Supabase 自动保存验收 · 采购清单', messages: [message],
      snapshot: { chatIndex: message.id, files: Object.fromEntries(Object.entries(sources).map(([name, content]) =>
        [name, { type: 'file', content, isBinary: false }])) },
    } }),
  });
  if (!result.ok) throw new Error('Local fixture project creation failed.');
} else if (!existing.ok) throw new Error('Local fixture status unavailable.');
else if (process.argv.includes('--refresh-helper')) {
  const current = await existing.json();
  if (current.document?.title !== 'Supabase 自动保存验收 · 采购清单' || !current.document.snapshot?.files)
    throw new Error('Refusing to modify a non-fixture project.');
  current.document.snapshot.files['src/lib/jingyue-data.ts'] = {
    type: 'file', content: sources['src/lib/jingyue-data.ts'], isBinary: false,
  };
  const updated = await fetch(origin + '/api/projects/' + id + '/checkpoint', {
    method: 'POST', headers, body: JSON.stringify({ requestId: randomUUID(),
      baseRevision: current.revision, document: current.document }),
  });
  if (!updated.ok) throw new Error('Fixture helper refresh failed.');
}
// This is a genuine RPC read, not proof of browser integration or saving yet.
const read = await fetch(origin + '/api/demo-data/' + id, { method: 'POST', headers,
  body: JSON.stringify({ action: 'read', key: 'orders' }),
});
process.stdout.write(JSON.stringify({ fixtureReady: true, url: origin + '/chat/' + id,
  remoteReadPassed: read.ok, remoteReadStatus: read.status, modelCalls: 0 }) + '\n');
