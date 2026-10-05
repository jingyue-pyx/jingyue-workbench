// Loopback-only runtime acceptance. Uses local PGlite and the existing private Bailian configuration.
// Run after `pnpm build`; data is in a new temporary, local PGlite directory.
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotPreviewBuild } from './preview-build.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
// Explicit, temporary test-session override; production and the default stay at 20.
const modelLimit = Number(process.env.JINGYUE_LOCAL_MODEL_REQUESTS || '20');
if (!Number.isInteger(modelLimit) || modelLimit < 1 || modelLimit > 100) throw new Error('Invalid local test quota.');
const previewPort = Number(process.env.JINGYUE_LOCAL_PREVIEW_PORT || '9025');
if (!Number.isInteger(previewPort) || previewPort < 9025 || previewPort > 9035) throw new Error('Invalid local preview port.');
const { parse } = require('dotenv');
const localSettings = parse(await readFile(resolve(root, '百炼配置.txt'), 'utf8').catch(() => ''));
for (const name of ['DASHSCOPE_API_KEY', 'DASHSCOPE_BASE_URL']) {
  if (localSettings[name]) process.env[name] = localSettings[name];
}
// Read only the dedicated optional file, never print or embed its values in the bundle.
const demoSettings = parse(await readFile(resolve(root, '.supabase.local.env'), 'utf8').catch(() => ''));
for (const name of ['JINGYUE_SUPABASE_URL', 'JINGYUE_SUPABASE_SERVICE_KEY', 'JINGYUE_DEMO_WORKBENCH_PROJECT']) {
  if (demoSettings[name]) process.env[name] = demoSettings[name];
}
// Optional server-side publishing configuration; never included in the bundle.
const publishingSettings = parse(await readFile(resolve(root, '.publishing.local.env'), 'utf8').catch(() => ''));
for (const name of ['JINGYUE_NETLIFY_ENABLED', 'JINGYUE_NETLIFY_CLIENT_ID', 'JINGYUE_PUBLISHING_ENCRYPTION_KEY']) {
  if (publishingSettings[name]) process.env[name] = publishingSettings[name];
}

const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const databaseDirectory =
  process.env.JINGYUE_LOCAL_PREVIEW_DATA || (await mkdtemp(join(tmpdir(), 'jingyue-managed-preview-')));
if (!databaseDirectory.startsWith(join(tmpdir(), 'jingyue-managed-preview-')) || databaseDirectory.includes('..'))
  throw new Error('Only the temporary preview database may be reused.');
const snapshot = await snapshotPreviewBuild(resolve(root, 'build'), resolve(root, 'deployment/releases'), previewPort);
const outfile = resolve(snapshot.directory, 'server.mjs');
await build({
  stdin: {
    contents: `
    import { readFile } from 'node:fs/promises';
    import { randomBytes, randomUUID } from 'node:crypto';
    import { openPreviewDatabase } from './deployment/preview-database.mjs';
    import { createRequestHandler } from '@remix-run/node';
    import * as app from ${JSON.stringify(snapshot.serverEntry)};
    import { createGateway, failureDetails } from './deployment/gateway.mjs';
    import { configuration } from './deployment/security.mjs';
    import { AccountStore } from './deployment/accounts.mjs';
    import { PostgresProjectStore } from './deployment/project-store.mjs';
    import { createDemoDataStore } from './deployment/demo-data.mjs';
    import { createLocalOpenCode } from './deployment/opencode/runner.mjs';
    import { createPublishingService } from './deployment/publishing/service.mjs';
    import { createAppAuthService } from './deployment/app-auth.mjs';
    const database = await openPreviewDatabase(${JSON.stringify(databaseDirectory)});
    for (const file of ['001-projects.sql','003-accounts.sql','005-publishing.sql','006-app-auth.sql']) await database.exec(await readFile(${JSON.stringify(resolve(root, 'deployment/sql'))}+'/'+file, 'utf8'));
    let previous=Promise.resolve();
    const pool={async connect(){const wait=previous;let release;previous=new Promise(r=>release=r);await wait;return {query:(s,a)=>database.query(s,a),release};},async query(s,a){const c=await this.connect();try{return await c.query(s,a);}finally{c.release();}}};
    const config=configuration({JINGYUE_PUBLIC_ORIGIN:'http://127.0.0.1:${previewPort}',JINGYUE_LOCAL_TEST:'1',PORT:'${previewPort}',WORKBENCH_ACCESS_USER:'local-preview-owner',WORKBENCH_ACCESS_PASSWORD:randomBytes(32).toString('base64url'),JINGYUE_AUTH_MODE:'accounts',JINGYUE_REGISTRATION_OPEN:'1',JINGYUE_USER_DAILY_REQUESTS:${JSON.stringify(String(modelLimit))},DASHSCOPE_API_KEY:process.env.DASHSCOPE_API_KEY,DASHSCOPE_BASE_URL:process.env.DASHSCOPE_BASE_URL});
    const owner=randomUUID();
    if (process.env.JINGYUE_LOCAL_AGENT==='opencode') config.localCookieNamespace='opencode-${previewPort}';
    const accounts=new AccountStore(pool,config,owner);
    if (!(await pool.query("SELECT id FROM jingyue.accounts WHERE username='preview_alice'")).rows.length) await accounts.register({username:'preview_alice',displayName:'小月 · 验收账号',password:'Local-test-password-7248'},'local-fixture');
    const demoDataStore=createDemoDataStore(process.env);
    const report=(event,error)=>process.stdout.write(JSON.stringify({event,...(error?failureDetails(error):{})})+'\\n');
    const opencodeRunner=process.env.JINGYUE_LOCAL_AGENT==='opencode' ? await createLocalOpenCode({config,report}) : null;
    const projectStore=new PostgresProjectStore(pool,owner);
    const publishingService=createPublishingService(process.env,projectStore);
    const appAuthService=createAppAuthService(process.env,projectStore);
    const server=await createGateway({config,demoDataStore,opencodeRunner,publishingService,appAuthService,report,clientDirectory:${JSON.stringify(snapshot.clientDirectory)},accountStore:accounts,projectStore,handler:async (request,context)=>createRequestHandler(app,'production')(request,context)});
    server.listen(${previewPort},'127.0.0.1',()=>process.stdout.write('Managed runtime preview ready at http://127.0.0.1:${previewPort}/register; local workbench database; optional demo backend configured: '+Boolean(demoDataStore)+'; model limit ${modelLimit}/day.\\n'));
    let stopping=false;
    const stop=()=>{
      if(stopping)return;
      stopping=true;
      const keepAlive=setInterval(()=>{},1000);
      server.closeAllConnections();
      server.close(async()=>{
        let failed=false;
        try { await opencodeRunner?.close(); } catch { failed=true; report('local_agent_close_failed'); }
        try { await previous; await database.close(); report('local_preview_database_closed'); }
        catch { failed=true; report('local_preview_database_close_failed'); }
        clearInterval(keepAlive);
        process.exit(failed?1:0);
      });
    };
    process.once('SIGTERM',stop);
    process.once('SIGINT',stop);
  `,
    resolveDir: root,
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@electric-sql/pglite'],
  alias: { 'react-dom/server': 'react-dom/server.browser' },
  define: { 'process.env.NODE_ENV': '"production"' },
  banner: {
    js: "import { createRequire as __makeRequire } from 'node:module'; const require = __makeRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
await import(outfile);
